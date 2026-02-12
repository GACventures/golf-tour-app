"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

type Tee = "M" | "F";

type RoundRow = {
  id: string;
  tour_id: string;
  name: string | null;
  created_at: string | null;
  round_no: number | null;
  course_id: string | null;
  courses?: { name: string } | null;

  // ✅ correct round date column
  played_on: string | null;
};

type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean | null;
};

type ParRow = {
  course_id: string;
  hole_number: number;
  tee?: Tee | null; // ✅ prefer this
  par?: number | null;
  stroke_index?: number | null;

  // legacy / optional columns (keep as fallback)
  par_m?: number | null;
  stroke_index_m?: number | null;
  par_f?: number | null;
  stroke_index_f?: number | null;
};

type MobilePlayer = { id: string; name: string; gender?: string | null; startHandicap: number };

function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  const raw = String(iso).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const d = new Date(isDateOnly ? `${raw}T00:00:00.000Z` : raw);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

function rawScoreFor(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  return String(strokes);
}

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" || s === "FEMALE" || s === "W" ? "F" : "M";
}

function pickParSiFromRow(row: ParRow | undefined | null, tee: Tee) {
  if (!row) return { par: 0, si: 0 };

  const hasMF =
    row &&
    (row.par_m !== undefined ||
      row.par_f !== undefined ||
      row.stroke_index_m !== undefined ||
      row.stroke_index_f !== undefined);

  if (hasMF) {
    const par = Number(tee === "F" ? row.par_f ?? row.par_m : row.par_m ?? row.par_f);
    const si = Number(tee === "F" ? row.stroke_index_f ?? row.stroke_index_m : row.stroke_index_m ?? row.stroke_index_f);
    return { par: Number.isFinite(par) ? par : 0, si: Number.isFinite(si) ? si : 0 };
  }

  const par = Number(row.par);
  const si = Number(row.stroke_index);
  return { par: Number.isFinite(par) ? par : 0, si: Number.isFinite(si) ? si : 0 };
}

type Shade = "ace" | "eagle" | "birdie" | "par" | "bogey" | "dbogey" | "none";

/**
 * Blue palette (distinct shades)
 * (DO NOT CHANGE — keep scorebox colours)
 */
const BLUE_ACE = "#082B5C";
const BLUE_EAGLE = "#1757D6";
const BLUE_BIRDIE = "#4DA3FF";

function shadeForGross(gross: number | null, pickup: boolean | null | undefined, par: number): Shade {
  if (pickup) return "dbogey";
  if (!Number.isFinite(Number(gross))) return "none";

  const diff = Number(gross) - Number(par);
  if (diff <= -3) return "ace";
  if (diff === -2) return "eagle";
  if (diff === -1) return "birdie";
  if (diff === 0) return "par";
  if (diff === 1) return "bogey";
  return "dbogey";
}

function blueStyleForShade(s: Shade): React.CSSProperties | undefined {
  if (s === "ace") return { backgroundColor: BLUE_ACE, color: "white" };
  if (s === "eagle") return { backgroundColor: BLUE_EAGLE, color: "white" };
  if (s === "birdie") return { backgroundColor: BLUE_BIRDIE, color: "white" };
  return undefined;
}

async function loadPlayersForTour(tourId: string): Promise<MobilePlayer[]> {
  const { data: tpData, error: tpErr } = await supabase
    .from("tour_players")
    .select("player_id,starting_handicap,players(id,name,gender)")
    .eq("tour_id", tourId);

  if (!tpErr && (tpData ?? []).length > 0) {
    return (tpData ?? [])
      .map((r: any) => ({
        id: String(r.players?.id ?? r.player_id),
        name: String(r.players?.name ?? "(missing name)"),
        gender: (r.players as any)?.gender ?? null,
        startHandicap: Number.isFinite(Number(r.starting_handicap)) ? Number(r.starting_handicap) : 0,
      }))
      .filter((p: any) => !!p.id);
  }

  const { data: pData, error: pErr } = await supabase
    .from("players")
    .select("*")
    .eq("tour_id", tourId)
    .order("name", { ascending: true });

  if (pErr) throw pErr;

  return (pData ?? [])
    .map((p: any) => ({
      id: String(p.id),
      name: String(p.name ?? "(missing name)"),
      gender: (p.gender as any) ?? null,
      startHandicap: Number.isFinite(Number(p.start_handicap))
        ? Number(p.start_handicap)
        : Number.isFinite(Number(p.starting_handicap))
        ? Number(p.starting_handicap)
        : Number.isFinite(Number(p.playing_handicap))
        ? Number(p.playing_handicap)
        : 0,
    }))
    .filter((x: any) => !!x.id);
}

function isMissingColumnError(msg: string, column: string) {
  const m = String(msg ?? "").toLowerCase();
  const c = column.toLowerCase();
  return m.includes("does not exist") && (m.includes(`.${c}`) || m.includes(`"${c}"`) || m.includes(` ${c} `));
}

async function loadParsForCourse(courseId: string) {
  const attempt1 = await supabase.from("pars").select("course_id,hole_number,tee,par,stroke_index").eq("course_id", courseId);

  if (!attempt1.error) return (attempt1.data ?? []) as ParRow[];

  if (isMissingColumnError(attempt1.error.message, "tee")) {
    const attempt2 = await supabase
      .from("pars")
      .select("course_id,hole_number,par,stroke_index,par_m,stroke_index_m,par_f,stroke_index_f")
      .eq("course_id", courseId);

    if (attempt2.error) throw attempt2.error;
    return (attempt2.data ?? []) as ParRow[];
  }

  throw attempt1.error;
}

export default function MobileRoundPlayerResultPage() {
  const params = useParams<{ id?: string; roundId?: string; playerId?: string }>();
  const router = useRouter();

  const tourId = String(params?.id ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();
  const playerId = String(params?.playerId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [round, setRound] = useState<RoundRow | null>(null);
  const [player, setPlayer] = useState<MobilePlayer | null>(null);
  const [hcp, setHcp] = useState<number>(0);

  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);

  function goBack() {
    router.push(`/m/tours/${tourId}/rounds/${roundId}/results`);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!tourId || !roundId || !playerId) return;

      setLoading(true);
      setErrorMsg("");

      try {
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,tour_id,name,created_at,played_on,round_no,course_id,courses(name)")
          .eq("id", roundId)
          .eq("tour_id", tourId)
          .single();
        if (rErr) throw rErr;

        const courseId = String((rData as any)?.course_id ?? "");

        const allPlayers = await loadPlayersForTour(tourId);
        const p = allPlayers.find((x) => x.id === playerId) ?? null;

        const { data: rpData, error: rpErr } = await supabase
          .from("round_players")
          .select("round_id,player_id,playing,playing_handicap")
          .eq("round_id", roundId)
          .eq("player_id", playerId)
          .maybeSingle();
        if (rpErr) throw rpErr;

        const startHcp = p?.startHandicap ?? 0;
        const h = Number.isFinite(Number((rpData as any)?.playing_handicap)) ? Number((rpData as any).playing_handicap) : startHcp;

        const { data: sData, error: sErr } = await supabase
          .from("scores")
          .select("round_id,player_id,hole_number,strokes,pickup")
          .eq("round_id", roundId)
          .eq("player_id", playerId);
        if (sErr) throw sErr;

        const ps = courseId ? await loadParsForCourse(courseId) : [];

        if (cancelled) return;

        setRound(rData as any);
        setPlayer(p);
        setHcp(h);
        setScores((sData ?? []) as any);
        setPars(ps);
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.message ?? "Failed to load player scorecard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [tourId, roundId, playerId]);

  const parRowsByHole = useMemo(() => {
    const byHole = new Map<number, { M?: ParRow; F?: ParRow; legacy?: ParRow }>();

    const hasTee = pars.some(
      (p) => String((p as any)?.tee ?? "").toUpperCase() === "M" || String((p as any)?.tee ?? "").toUpperCase() === "F"
    );

    for (const p of pars) {
      const hole = Number((p as any).hole_number);
      if (!Number.isFinite(hole)) continue;

      if (!byHole.has(hole)) byHole.set(hole, {});

      const slot = byHole.get(hole)!;

      if (hasTee) {
        const tee = String((p as any)?.tee ?? "").toUpperCase() === "F" ? "F" : "M";
        (slot as any)[tee] = p;
      } else {
        slot.legacy = p;
      }
    }

    return { byHole, hasTee };
  }, [pars]);

  const scoreByHole = useMemo(() => {
    const m = new Map<number, ScoreRow>();
    for (const s of scores) {
      const hole = Number(s.hole_number);
      if (Number.isFinite(hole)) m.set(hole, s);
    }
    return m;
  }, [scores]);

  const computed = useMemo(() => {
    const tee: Tee = normalizeTee(player?.gender ?? null);

    const holes = Array.from({ length: 18 }, (_, i) => i + 1).map((hole) => {
      const prSlot = parRowsByHole.byHole.get(hole);

      let par = 0;
      let si = 0;

      if (parRowsByHole.hasTee) {
        const row = (prSlot as any)?.[tee] as ParRow | undefined;
        const picked = pickParSiFromRow(row, tee);
        par = picked.par;
        si = picked.si;
      } else {
        const row = prSlot?.legacy;
        const picked = pickParSiFromRow(row, tee);
        par = picked.par;
        si = picked.si;
      }

      const sc = scoreByHole.get(hole);
      const gross = Number.isFinite(Number(sc?.strokes)) ? Number(sc?.strokes) : null;
      const pickup = sc?.pickup === true;

      const raw = rawScoreFor(sc?.strokes ?? null, sc?.pickup ?? null);
      const pts =
        raw && par > 0 && si > 0
          ? netStablefordPointsForHole({
              rawScore: raw,
              par,
              strokeIndex: si,
              playingHandicap: hcp,
            })
          : 0;

      const shade = par > 0 && (pickup || gross !== null) ? shadeForGross(gross, pickup, par) : "none";

      return { hole, par, gross, pickup, pts, shade, teeUsed: tee };
    });

    const front = holes.slice(0, 9);
    const back = holes.slice(9, 18);

    const sum = (arr: { par: number; gross: number | null; pickup: boolean; pts: number }[]) => {
      const par = arr.reduce((s, x) => s + (Number.isFinite(x.par) ? x.par : 0), 0);
      const gross = arr.reduce((s, x) => s + (Number.isFinite(Number(x.gross)) ? Number(x.gross) : 0), 0);
      const pts = arr.reduce((s, x) => s + (Number.isFinite(Number(x.pts)) ? Number(x.pts) : 0), 0);
      return { par, gross, pts };
    };

    return {
      tee,
      holes,
      front,
      back,
      out: sum(front),
      inn: sum(back),
      total: sum(holes),
    };
  }, [parRowsByHole, scoreByHole, player?.gender, hcp]);

  const diag = useMemo(() => {
    const holes = [1, 2, 14];

    if (!round?.course_id) return { courseId: "", hasTee: parRowsByHole.hasTee, rows: [] as any[] };

    const courseId = String(round.course_id);
    const tee = computed.tee;

    const rows = holes.map((h) => {
      const slot = parRowsByHole.byHole.get(h);

      const pick = (t: Tee) => {
        if (parRowsByHole.hasTee) {
          const row = (slot as any)?.[t] as ParRow | undefined;
          const { par, si } = pickParSiFromRow(row, t);
          return { par, si };
        }
        const { par, si } = pickParSiFromRow(slot?.legacy, t);
        return { par, si };
      };

      const cur = pick(tee);
      const other = pick(tee === "M" ? "F" : "M");

      return {
        hole: h,
        teeUsed: tee,
        par: cur.par,
        si: cur.si,
        otherTee: tee === "M" ? "F" : "M",
        otherPar: other.par,
        otherSi: other.si,
      };
    });

    return { courseId, hasTee: parRowsByHole.hasTee, rows };
  }, [round?.course_id, computed.tee, parRowsByHole]);

  const roundIndexText = useMemo(() => {
    const n = Number(round?.round_no);
    if (Number.isFinite(n) && n > 0) return `Round ${n}`;
    return "Round";
  }, [round?.round_no]);

  const roundDate = useMemo(() => formatDate(round?.played_on ?? null), [round?.played_on]);

  const course = useMemo(() => {
    const c = round?.courses?.name ?? "";
    return String(c ?? "").trim();
  }, [round?.courses?.name]);

  function ScoreBox({ shade, label }: { shade: Shade; label: string | number }) {
    const isBlue = shade === "ace" || shade === "eagle" || shade === "birdie";

    const base = "min-w-[28px] px-1.5 py-0.5 rounded text-center text-sm font-extrabold";

    const className =
      shade === "par"
        ? `${base} bg-white text-gray-900 border border-gray-300`
        : shade === "bogey"
        ? `${base} bg-[#f8cfcf] text-gray-900`
        : shade === "dbogey"
        ? `${base} bg-[#c0392b] text-white`
        : `${base} bg-transparent text-gray-900`;

    return (
      <div className={className} style={isBlue ? blueStyleForShade(shade) : undefined}>
        {label}
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      {/* Header (match tee-times/results style; do NOT duplicate tour name/home header from layout) */}
      <div className="border-b bg-white">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-base font-semibold">Scorecard</div>
            <button
              type="button"
              onClick={goBack}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-gray-800 hover:bg-gray-100 active:bg-gray-200"
            >
              Back
            </button>
          </div>
        </div>
      </div>

      <div className="border-b bg-gray-50">
        <div className="mx-auto max-w-md px-4 py-3 text-sm font-semibold text-gray-800">
          {roundIndexText} · {roundDate} · {course}
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-4 pt-4 pb-24">
        {errorMsg ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorMsg}</div>
        ) : null}

        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">Loading…</div>
        ) : (
          <>
            <div className="mt-0 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
              <div className="font-semibold text-slate-900">Diagnostics</div>
              <div className="mt-1">
                CourseId: <span className="font-mono">{diag.courseId || "(none)"}</span> · Pars schema:{" "}
                <span className="font-semibold">{diag.hasTee ? "tee rows (M/F)" : "legacy (single row)"}</span> · Tee used:{" "}
                <span className="font-semibold">{computed.tee}</span>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-1">
                {diag.rows.map((r: any) => (
                  <div key={r.hole}>
                    Hole <span className="font-semibold">{r.hole}</span>:{" "}
                    <span className="font-semibold">
                      {r.teeUsed} par {r.par} / SI {r.si}
                    </span>{" "}
                    · other tee {r.otherTee}: par {r.otherPar} / SI {r.otherSi}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-2xl font-extrabold">{player?.name ?? "(player)"}</div>
                <div className="mt-1 text-sm text-slate-600">
                  HCP: <span className="font-semibold text-slate-900">{hcp}</span>
                </div>
              </div>

              <div className="rounded-2xl bg-white text-gray-900 px-4 py-3 text-center shadow-sm border border-slate-200">
                <div className="text-4xl font-extrabold">{computed.total.pts}</div>
                <div className="text-sm font-extrabold tracking-wide">POINTS</div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl bg-white text-gray-900 overflow-hidden shadow-sm border border-slate-200">
              <div className="grid grid-cols-[repeat(9,1fr)_64px] border-b border-slate-200 bg-slate-50 text-xs font-semibold">
                {computed.front.map((h) => (
                  <div key={h.hole} className="py-2 text-center">
                    {h.hole}
                  </div>
                ))}
                <div className="py-2 text-center">Out</div>
              </div>

              <div className="grid grid-cols-[repeat(9,1fr)_64px] border-b border-slate-200 text-base font-semibold">
                {computed.front.map((h) => (
                  <div key={h.hole} className="py-2 text-center">
                    {h.par || ""}
                  </div>
                ))}
                <div className="py-2 text-center font-bold">{computed.out.par || ""}</div>
              </div>

              <div className="grid grid-cols-[repeat(9,1fr)_64px] border-b border-slate-200">
                {computed.front.map((h) => {
                  const label = h.pickup ? "P" : h.gross ?? "";
                  return (
                    <div key={h.hole} className="py-2 flex items-center justify-center">
                      <ScoreBox shade={h.shade} label={label} />
                    </div>
                  );
                })}
                <div className="py-2 text-center text-lg font-extrabold">{computed.out.gross}</div>
              </div>

              <div className="grid grid-cols-[repeat(9,1fr)_64px] text-base font-semibold">
                {computed.front.map((h) => (
                  <div key={h.hole} className="py-2 text-center">
                    {h.pts}
                  </div>
                ))}
                <div className="py-2 text-center text-lg font-extrabold">{computed.out.pts}</div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl bg-white text-gray-900 overflow-hidden shadow-sm border border-slate-200">
              <div className="grid grid-cols-[repeat(9,1fr)_64px] border-b border-slate-200 bg-slate-50 text-xs font-semibold">
                {computed.back.map((h) => (
                  <div key={h.hole} className="py-2 text-center">
                    {h.hole}
                  </div>
                ))}
                <div className="py-2 text-center">In</div>
              </div>

              <div className="grid grid-cols-[repeat(9,1fr)_64px] border-b border-slate-200 text-base font-semibold">
                {computed.back.map((h) => (
                  <div key={h.hole} className="py-2 text-center">
                    {h.par || ""}
                  </div>
                ))}
                <div className="py-2 text-center font-bold">{computed.inn.par || ""}</div>
              </div>

              <div className="grid grid-cols-[repeat(9,1fr)_64px] border-b border-slate-200">
                {computed.back.map((h) => {
                  const label = h.pickup ? "P" : h.gross ?? "";
                  return (
                    <div key={h.hole} className="py-2 flex items-center justify-center">
                      <ScoreBox shade={h.shade} label={label} />
                    </div>
                  );
                })}
                <div className="py-2 text-center text-lg font-extrabold">{computed.inn.gross}</div>
              </div>

              <div className="grid grid-cols-[repeat(9,1fr)_64px] text-base font-semibold">
                {computed.back.map((h) => (
                  <div key={h.hole} className="py-2 text-center">
                    {h.pts}
                  </div>
                ))}
                <div className="py-2 text-center text-lg font-extrabold">{computed.inn.pts}</div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <div className="rounded-md px-3 py-2 text-sm font-bold border border-slate-300 bg-slate-50 text-slate-900">
                Ace/Albatross{" "}
                <span className="ml-2 inline-block w-3 h-3 align-middle rounded-sm" style={{ backgroundColor: BLUE_ACE }} />
              </div>
              <div className="rounded-md px-3 py-2 text-sm font-bold border border-slate-300 bg-slate-50 text-slate-900">
                Eagle{" "}
                <span className="ml-2 inline-block w-3 h-3 align-middle rounded-sm" style={{ backgroundColor: BLUE_EAGLE }} />
              </div>
              <div className="rounded-md px-3 py-2 text-sm font-bold border border-slate-300 bg-slate-50 text-slate-900">
                Birdie{" "}
                <span className="ml-2 inline-block w-3 h-3 align-middle rounded-sm" style={{ backgroundColor: BLUE_BIRDIE }} />
              </div>
              <div className="rounded-md px-3 py-2 text-sm font-bold border border-slate-300 bg-slate-50 text-slate-900">
                Par <span className="ml-2 inline-block w-3 h-3 align-middle rounded-sm bg-white border border-slate-300" />
              </div>
              <div className="rounded-md px-3 py-2 text-sm font-bold border border-slate-300 bg-slate-50 text-slate-900">
                Bogey{" "}
                <span className="ml-2 inline-block w-3 h-3 align-middle rounded-sm" style={{ backgroundColor: "#f8cfcf" }} />
              </div>
              <div className="rounded-md px-3 py-2 text-sm font-bold border border-slate-300 bg-slate-50 text-slate-900">
                D. Bogey +{" "}
                <span className="ml-2 inline-block w-3 h-3 align-middle rounded-sm" style={{ backgroundColor: "#c0392b" }} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
