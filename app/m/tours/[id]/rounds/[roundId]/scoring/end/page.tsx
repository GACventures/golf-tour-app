"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";
import { recalcAndSaveTourHandicaps } from "@/lib/handicaps/recalcAndSaveTourHandicaps";

type Tee = "M" | "F";

type RoundRow = {
  id: string;
  tour_id: string;
  name: string | null;
  created_at: string | null;
  round_no: number | null;
  course_id: string | null;
  courses?: { name: string } | null;
  played_on: string | null;
  is_locked?: boolean | null;
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
  tee?: Tee | null;
  par?: number | null;
  stroke_index?: number | null;
  par_m?: number | null;
  stroke_index_m?: number | null;
  par_f?: number | null;
  stroke_index_f?: number | null;
};

type MobilePlayer = { id: string; name: string; gender?: string | null; startHandicap: number };

const SHOW_DIAGNOSTICS = false;

type Shade = "ace" | "eagle" | "birdie" | "par" | "bogey" | "dbogey" | "none";

const BLUE_ACE = "#082B5C";
const BLUE_EAGLE = "#1757D6";
const BLUE_BIRDIE = "#4DA3FF";

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

function normalizeRawInput(v: string): string {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s) return "";
  if (s === "P") return "P";
  if (/^\d+$/.test(s)) return s;
  return "";
}

function rawToStrokes(raw: string): number | null {
  const s = normalizeRawInput(raw);
  if (!s || s === "P") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
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
    row.par_m !== undefined ||
    row.par_f !== undefined ||
    row.stroke_index_m !== undefined ||
    row.stroke_index_f !== undefined;

  if (hasMF) {
    const par = Number(tee === "F" ? row.par_f ?? row.par_m : row.par_m ?? row.par_f);
    const si = Number(tee === "F" ? row.stroke_index_f ?? row.stroke_index_m : row.stroke_index_m ?? row.stroke_index_f);
    return { par: Number.isFinite(par) ? par : 0, si: Number.isFinite(si) ? si : 0 };
  }

  const par = Number(row.par);
  const si = Number(row.stroke_index);
  return { par: Number.isFinite(par) ? par : 0, si: Number.isFinite(si) ? si : 0 };
}

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
  const attempt1 = await supabase
    .from("pars")
    .select("course_id,hole_number,tee,par,stroke_index")
    .eq("course_id", courseId);

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

export default function MobileEndOfRoundScoreEntryPage() {
  const params = useParams<{ id?: string; roundId?: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const tourId = String(params?.id ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();
  const playerId = String(searchParams.get("meId") ?? "").trim();

  const initialScoresRef = useRef<Record<number, string>>({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [submitMsg, setSubmitMsg] = useState("");

  const [round, setRound] = useState<RoundRow | null>(null);
  const [player, setPlayer] = useState<MobilePlayer | null>(null);
  const [hcp, setHcp] = useState<number>(0);

  const [scores, setScores] = useState<Record<number, string>>({});
  const [pars, setPars] = useState<ParRow[]>([]);

  const [selectedHole, setSelectedHole] = useState(1);
  const [prefix1, setPrefix1] = useState(false);

  const isLocked = round?.is_locked === true;

  function goBack() {
    router.push(`/m/tours/${tourId}/rounds/${roundId}/scoring`);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!tourId || !roundId || !playerId) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorMsg("");
      setSubmitMsg("");

      try {
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,tour_id,name,created_at,played_on,round_no,course_id,is_locked,courses(name)")
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

        const nextScores: Record<number, string> = {};
        for (const row of (sData ?? []) as ScoreRow[]) {
          const hole = Number(row.hole_number);
          if (!Number.isFinite(hole)) continue;
          nextScores[hole] = normalizeRawInput(row.pickup ? "P" : row.strokes === null || row.strokes === undefined ? "" : String(row.strokes));
        }

        const ps = courseId ? await loadParsForCourse(courseId) : [];

        if (cancelled) return;

        setRound(rData as any);
        setPlayer(p);
        setHcp(h);
        setScores(nextScores);
        initialScoresRef.current = nextScores;
        setPars(ps);

        const firstBlank = Array.from({ length: 18 }, (_, i) => i + 1).find((hNo) => !nextScores[hNo]);
        setSelectedHole(firstBlank ?? 1);
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.message ?? "Failed to load end of round score entry.");
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

      const raw = normalizeRawInput(scores[hole] ?? "");
      const pickup = raw === "P";
      const gross = pickup ? null : rawToStrokes(raw);

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

      return { hole, par, gross, pickup, raw, pts, shade, teeUsed: tee };
    });

    const front = holes.slice(0, 9);
    const back = holes.slice(9, 18);

    const sum = (arr: { par: number; gross: number | null; pickup: boolean; pts: number }[]) => {
      const par = arr.reduce((s, x) => s + (Number.isFinite(x.par) ? x.par : 0), 0);
      const gross = arr.reduce((s, x) => s + (Number.isFinite(Number(x.gross)) ? Number(x.gross) : 0), 0);
      const pts = arr.reduce((s, x) => s + (Number.isFinite(Number(x.pts)) ? Number(x.pts) : 0), 0);
      return { par, gross, pts };
    };

    return { tee, holes, front, back, out: sum(front), inn: sum(back), total: sum(holes) };
  }, [parRowsByHole, scores, player?.gender, hcp]);

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

      return { hole: h, teeUsed: tee, par: cur.par, si: cur.si, otherTee: tee === "M" ? "F" : "M", otherPar: other.par, otherSi: other.si };
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

  async function fetchTourIdForRound(rid: string): Promise<string | null> {
    if (!rid) return null;
    const { data, error } = await supabase.from("rounds").select("tour_id").eq("id", rid).maybeSingle();
    if (error) throw error;
    const tid = (data as any)?.tour_id ? String((data as any).tour_id) : "";
    return tid.trim() ? tid : null;
  }

  async function saveAll(): Promise<boolean> {
    setErrorMsg("");
    setSubmitMsg("");

    if (!roundId || !playerId) return false;

    if (isLocked) {
      setErrorMsg("Round is locked.");
      return false;
    }

    const upserts: ScoreRow[] = [];
    const deletes: { round_id: string; player_id: string; hole_number: number }[] = [];

    const initial = initialScoresRef.current ?? {};

    for (let hole = 1; hole <= 18; hole++) {
      const raw = normalizeRawInput(scores[hole] ?? "");
      const had = normalizeRawInput(initial[hole] ?? "");

      if (!raw) {
        if (had) deletes.push({ round_id: roundId, player_id: playerId, hole_number: hole });
        continue;
      }

      const isPickup = raw === "P";
      const strokes = isPickup ? null : Number(raw);

      upserts.push({
        round_id: roundId,
        player_id: playerId,
        hole_number: hole,
        strokes: Number.isFinite(strokes as any) ? (strokes as any) : null,
        pickup: isPickup,
      });
    }

    setSaving(true);

    try {
      for (const d of deletes) {
        const { error } = await supabase
          .from("scores")
          .delete()
          .eq("round_id", d.round_id)
          .eq("player_id", d.player_id)
          .eq("hole_number", d.hole_number);
        if (error) throw error;
      }

      if (upserts.length > 0) {
        const { error } = await supabase.from("scores").upsert(upserts as any, {
          onConflict: "round_id,player_id,hole_number",
        });
        if (error) throw error;
      }

      try {
        const tid = await fetchTourIdForRound(roundId);
        if (tid) {
          await recalcAndSaveTourHandicaps({
            supabase,
            tourId: tid,
            fromRoundId: roundId,
          });
        }
      } catch {
        // keep score save successful even if handicap refresh fails
      }

      initialScoresRef.current = { ...scores };
      setSubmitMsg("Score submitted");
      return true;
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Save failed.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  function advanceAfterEntry(currentHole: number) {
    setPrefix1(false);
    const next = currentHole < 18 ? currentHole + 1 : currentHole;
    setSelectedHole(next);
  }

  function setHoleRaw(hole: number, raw: string, shouldAdvance = true) {
    if (isLocked) return;

    const norm = normalizeRawInput(raw);

    setScores((prev) => ({
      ...prev,
      [hole]: norm,
    }));

    setSubmitMsg("");
    setErrorMsg("");

    if (shouldAdvance) advanceAfterEntry(hole);
  }

  function pressDigit(digit: number) {
    if (isLocked) return;

    const next = prefix1 ? String(10 + digit) : String(digit);
    setHoleRaw(selectedHole, next, true);
  }

  function pressPrefix1() {
    if (isLocked) return;
    setPrefix1((prev) => !prev);
  }

  function pressZero() {
    if (isLocked) return;

    if (prefix1) {
      setHoleRaw(selectedHole, "10", true);
      return;
    }

    setHoleRaw(selectedHole, "", true);
  }

  function pressPickup() {
    if (isLocked) return;
    setHoleRaw(selectedHole, "P", true);
  }

  function ScoreBox({
    shade,
    label,
    hole,
  }: {
    shade: Shade;
    label: string | number;
    hole: number;
  }) {
    const isSelected = selectedHole === hole;
    const isBlue = shade === "ace" || shade === "eagle" || shade === "birdie";
    const base = "min-w-[28px] px-1.5 py-0.5 rounded text-center text-sm font-extrabold border";

    const colourClass =
      shade === "par"
        ? `${base} bg-white text-gray-900 border-gray-300`
        : shade === "bogey"
        ? `${base} bg-[#f8cfcf] text-gray-900 border-transparent`
        : shade === "dbogey"
        ? `${base} bg-[#c0392b] text-white border-transparent`
        : `${base} bg-transparent text-gray-900 border-transparent`;

    const selectedClass = isSelected ? "ring-4 ring-slate-400 bg-slate-300 border-slate-500" : "";

    return (
      <button
        type="button"
        onClick={() => {
          setSelectedHole(hole);
          setPrefix1(false);
          setSubmitMsg("");
        }}
        className={`${colourClass} ${selectedClass}`}
        style={isBlue && !isSelected ? blueStyleForShade(shade) : undefined}
      >
        {label}
      </button>
    );
  }

  function KeyButton({
    label,
    onClick,
    selected,
  }: {
    label: string;
    onClick: () => void;
    selected?: boolean;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={isLocked || saving}
        className={[
          "h-14 rounded-xl border text-xl font-black active:scale-[0.99] disabled:opacity-50",
          selected ? "bg-sky-600 text-white border-sky-700" : "bg-white text-slate-900 border-slate-300",
        ].join(" ")}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      <div className="border-b bg-white">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-base font-semibold">Score Entry - End of Round</div>
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

      <div className="mx-auto w-full max-w-md px-4 pt-3 pb-24">
        {errorMsg ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorMsg}</div> : null}
        {submitMsg ? <div className="mt-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm font-semibold text-green-700">{submitMsg}</div> : null}

        {!playerId ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            Select a player before opening end of round scoring.
          </div>
        ) : loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">Loading…</div>
        ) : (
          <>
            {SHOW_DIAGNOSTICS ? (
              <div className="mt-0 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                <div className="font-semibold text-slate-900">Diagnostics</div>
                <div className="mt-1">
                  CourseId: <span className="font-mono">{diag.courseId || "(none)"}</span> · Pars schema:{" "}
                  <span className="font-semibold">{diag.hasTee ? "tee rows (M/F)" : "legacy (single row)"}</span> · Tee used:{" "}
                  <span className="font-semibold">{computed.tee}</span>
                </div>
              </div>
            ) : null}

            <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-start gap-3">
              <div className="min-w-0 pt-1">
                <div className="truncate text-2xl font-extrabold">{player?.name ?? "(player)"}</div>
                <div className="mt-1 text-sm text-slate-600">
                  HCP: <span className="font-semibold text-slate-900">{hcp}</span>
                </div>
              </div>

              <div className="rounded-2xl bg-white text-gray-900 px-4 py-2 text-center shadow-sm border border-slate-200">
                <div className="text-4xl font-extrabold">{computed.total.pts}</div>
                <div className="text-sm font-extrabold tracking-wide">POINTS</div>
              </div>

              <button
                type="button"
                onClick={() => void saveAll()}
                disabled={saving || isLocked}
                className="rounded-2xl bg-gray-900 px-4 py-3 text-center text-base font-semibold text-white shadow-sm active:bg-gray-700 disabled:bg-gray-400"
              >
                {saving ? "Submitting…" : isLocked ? "Locked" : "Submit Score"}
              </button>
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
                  const label = h.pickup ? "P" : h.raw || "";
                  return (
                    <div key={h.hole} className="py-2 flex items-center justify-center">
                      <ScoreBox shade={h.shade} label={label} hole={h.hole} />
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
                  const label = h.pickup ? "P" : h.raw || "";
                  return (
                    <div key={h.hole} className="py-2 flex items-center justify-center">
                      <ScoreBox shade={h.shade} label={label} hole={h.hole} />
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

            <div className="mt-5 rounded-2xl border border-sky-300 bg-sky-100 px-3 py-3">
              <div className="mb-2 text-center text-xs font-extrabold text-slate-700">Enter Strokes</div>

              <div className="grid grid-cols-6 gap-2">
                <KeyButton label="1" onClick={() => pressDigit(1)} selected={!prefix1 && scores[selectedHole] === "1"} />
                <KeyButton label="2" onClick={() => pressDigit(2)} selected={!prefix1 && scores[selectedHole] === "2"} />
                <KeyButton label="3" onClick={() => pressDigit(3)} selected={!prefix1 && scores[selectedHole] === "3"} />
                <KeyButton label="4" onClick={() => pressDigit(4)} selected={!prefix1 && scores[selectedHole] === "4"} />
                <KeyButton label="5" onClick={() => pressDigit(5)} selected={!prefix1 && scores[selectedHole] === "5"} />
                <KeyButton label="6" onClick={() => pressDigit(6)} selected={!prefix1 && scores[selectedHole] === "6"} />

                <KeyButton label="7" onClick={() => pressDigit(7)} selected={!prefix1 && scores[selectedHole] === "7"} />
                <KeyButton label="8" onClick={() => pressDigit(8)} selected={!prefix1 && scores[selectedHole] === "8"} />
                <KeyButton label="9" onClick={() => pressDigit(9)} selected={!prefix1 && scores[selectedHole] === "9"} />
                <KeyButton label="1-" onClick={pressPrefix1} selected={prefix1 || /^1\d$/.test(scores[selectedHole] ?? "")} />
                <KeyButton label="0" onClick={pressZero} selected={false} />
                <KeyButton label="P" onClick={pressPickup} selected={scores[selectedHole] === "P"} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}