// app/m/tours/[id]/matches/results/[roundId]/match/[matchId]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

type Tee = "M" | "F";
type Side = "A" | "B";

type MatchFormat = "INDIVIDUAL_MATCHPLAY" | "BETTERBALL_MATCHPLAY" | "INDIVIDUAL_STABLEFORD";

type Player = {
  id: string;
  name: string;
  gender: Tee | null;
};

type MatchPlayerRow = {
  side: Side;
  slot: number; // 1..2
  player: Player;
};

type RoundRow = {
  id: string;
  course_id: string | null;
  round_no: number | null;
  created_at: string | null;
  played_on?: string | null;
  round_date?: string | null;
  name?: string | null;
  courses?: { name: string } | { name: string }[] | null;
};

type RoundPlayerRow = {
  player_id: string;
  playing: boolean;
  playing_handicap: number;
};

type ScoreRow = {
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup: boolean;
};

type ParRow = {
  tee: Tee;
  hole_number: number;
  par: number;
  stroke_index: number;
};

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  const isF = s === "F" || s === "FEMALE" || s === "W" || s === "WOMEN" || s === "WOMAN";
  return isF ? "F" : "M";
}

function safeName(v: any, fallback: string) {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function normalizeRawScore(strokes: number | null, pickup: boolean) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  const n = Number(strokes);
  return Number.isFinite(n) ? String(n) : "";
}

function formatFormatShort(fmt: MatchFormat | null): string {
  if (!fmt) return "Matchplay";
  if (fmt === "INDIVIDUAL_MATCHPLAY") return "Ind. M/P";
  if (fmt === "BETTERBALL_MATCHPLAY") return "BB M/P";
  if (fmt === "INDIVIDUAL_STABLEFORD") return "Ind. Stblfd";
  return "Matchplay";
}

function pickBestRoundDateISO(r: RoundRow): string | null {
  return (r.round_date as any) ?? (r.played_on as any) ?? r.created_at ?? null;
}

function parseDateForDisplay(s: string | null): Date | null {
  if (!s) return null;
  const raw = String(s).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const iso = isDateOnly ? `${raw}T00:00:00.000Z` : raw;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtNzDate(d: Date | null): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}`.replace(/\s+/g, " ");
}

function getCourseName(r: RoundRow) {
  const c: any = r.courses;
  if (!c) return "Course";
  if (Array.isArray(c)) return c?.[0]?.name ?? "Course";
  return c?.name ?? "Course";
}

function isMissingColumnError(msg: string, column: string) {
  const m = String(msg ?? "").toLowerCase();
  const c = column.toLowerCase();
  return m.includes("does not exist") && (m.includes(`.${c}`) || m.includes(`"${c}"`) || m.includes(` ${c} `));
}

function holeResultLabel(aPts: number | null, bPts: number | null): "A" | "B" | "AS" | "—" {
  if (aPts === null || bPts === null) return "—";
  if (aPts > bPts) return "A";
  if (bPts > aPts) return "B";
  return "AS";
}

function renderLiveText(args: { diff: number; thru: number; labelA: string; labelB: string }) {
  const { diff, thru, labelA, labelB } = args;
  if (thru <= 0) return "Not started";
  if (diff === 0) return `All Square (after ${thru} holes)`;
  const leader = diff > 0 ? labelA : labelB;
  const up = Math.abs(diff);
  return `${leader} is ${up} up (after ${thru} holes)`;
}

function renderFinalText(args: { diff: number; decidedAt: number | null; labelA: string; labelB: string }) {
  const { diff, decidedAt, labelA, labelB } = args;
  if (diff === 0) return "All Square";

  const winner = diff > 0 ? labelA : labelB;
  const loser = diff > 0 ? labelB : labelA;
  const up = Math.abs(diff);

  // If decided early, use X & Y based on decidedAt (clinch hole)
  if (decidedAt != null && decidedAt >= 1 && decidedAt <= 18) {
    const remaining = 18 - decidedAt;
    if (remaining > 0) return `${winner} def ${loser} ${up} & ${remaining}`;
  }

  // Otherwise (decided on 18), traditional "n up"
  return `${winner} def ${loser} ${up} up`;
}

export default function MatchDetailPage() {
  const params = useParams<{ id?: string; roundId?: string; matchId?: string }>();
  const router = useRouter();

  const tourId = String(params?.id ?? "").trim();
  const roundIdFromRoute = String(params?.roundId ?? "").trim();
  const matchId = String(params?.matchId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [format, setFormat] = useState<MatchFormat | null>(null);

  const [round, setRound] = useState<RoundRow | null>(null);
  const [playersBySide, setPlayersBySide] = useState<{ A: MatchPlayerRow[]; B: MatchPlayerRow[] }>({ A: [], B: [] });

  const [roundPlayers, setRoundPlayers] = useState<Map<string, RoundPlayerRow>>(new Map());
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [parsByTee, setParsByTee] = useState<Map<Tee, Map<number, { par: number; si: number }>>>(new Map());

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const { data: mRow, error: mErr } = await supabase
          .from("match_round_matches")
          .select("id,settings_id,match_no,match_round_settings(id,round_id,tour_id,format)")
          .eq("id", matchId)
          .maybeSingle();

        if (mErr) throw mErr;
        if (!mRow) throw new Error("Match not found.");

        const settings = (mRow as any)?.match_round_settings;
        const fmt = String(settings?.format ?? "").trim() as MatchFormat;
        const sRoundId = String(settings?.round_id ?? "").trim();
        const sTourId = String(settings?.tour_id ?? "").trim();

        if (sTourId && tourId && sTourId !== tourId) {
          throw new Error("This match does not belong to this tour.");
        }
        if (!sRoundId) throw new Error("Match settings are missing round_id.");

        setFormat(fmt || null);

        const { data: mpRows, error: mpErr } = await supabase
          .from("match_round_match_players")
          .select("side,slot,player_id,players(id,name,gender)")
          .eq("match_id", matchId)
          .order("side", { ascending: true })
          .order("slot", { ascending: true });

        if (mpErr) throw mpErr;

        const mapped: MatchPlayerRow[] = (mpRows ?? []).map((r: any) => {
          const p = r.players;
          return {
            side: String(r.side) === "B" ? "B" : "A",
            slot: Number(r.slot),
            player: {
              id: String(p?.id ?? r.player_id),
              name: safeName(p?.name, "(unnamed)"),
              gender: p?.gender ? normalizeTee(p.gender) : null,
            },
          };
        });

        const a = mapped.filter((x) => x.side === "A").sort((x, y) => x.slot - y.slot);
        const b = mapped.filter((x) => x.side === "B").sort((x, y) => x.slot - y.slot);

        const allPlayerIds = Array.from(new Set(mapped.map((x) => x.player.id).filter(Boolean)));

        const baseCols = "id,course_id,round_no,created_at,played_on,name,courses(name)";
        const cols1 = `${baseCols},round_date`;

        let rRow: any = null;
        const r1 = await supabase.from("rounds").select(cols1).eq("id", sRoundId).maybeSingle();
        if (r1.error) {
          if (isMissingColumnError(r1.error.message, "round_date")) {
            const r2 = await supabase.from("rounds").select(baseCols).eq("id", sRoundId).maybeSingle();
            if (r2.error) throw r2.error;
            rRow = r2.data;
          } else {
            throw r1.error;
          }
        } else {
          rRow = r1.data;
        }
        if (!rRow) throw new Error("Round not found.");

        let rpMap = new Map<string, RoundPlayerRow>();
        if (allPlayerIds.length > 0) {
          const { data: rpRows, error: rpErr } = await supabase
            .from("round_players")
            .select("player_id,playing,playing_handicap")
            .eq("round_id", sRoundId)
            .in("player_id", allPlayerIds);

          if (rpErr) throw rpErr;

          (rpRows ?? []).forEach((rp: any) => {
            rpMap.set(String(rp.player_id), {
              player_id: String(rp.player_id),
              playing: rp.playing === true,
              playing_handicap: Number.isFinite(Number(rp.playing_handicap)) ? Math.floor(Number(rp.playing_handicap)) : 0,
            });
          });
        }

        let scRows: ScoreRow[] = [];
        if (allPlayerIds.length > 0) {
          const { data: sRows, error: sErr } = await supabase
            .from("scores")
            .select("player_id,hole_number,strokes,pickup")
            .eq("round_id", sRoundId)
            .in("player_id", allPlayerIds);

          if (sErr) throw sErr;

          scRows = (sRows ?? []).map((s: any) => ({
            player_id: String(s.player_id),
            hole_number: Number(s.hole_number),
            strokes: s.strokes === null || s.strokes === undefined ? null : Number(s.strokes),
            pickup: s.pickup === true,
          }));
        }

        const courseId = String(rRow.course_id ?? "").trim();
        let parsMap = new Map<Tee, Map<number, { par: number; si: number }>>();
        if (courseId) {
          const { data: pRows, error: pErr } = await supabase
            .from("pars")
            .select("tee,hole_number,par,stroke_index")
            .eq("course_id", courseId)
            .in("tee", ["M", "F"])
            .order("hole_number", { ascending: true });

          if (pErr) throw pErr;

          (pRows ?? []).forEach((p: ParRow | any) => {
            const tee: Tee = normalizeTee(p.tee);
            if (!parsMap.has(tee)) parsMap.set(tee, new Map());
            parsMap.get(tee)!.set(Number(p.hole_number), { par: Number(p.par), si: Number(p.stroke_index) });
          });
        }

        if (!alive) return;

        setPlayersBySide({ A: a, B: b });
        setRound(rRow as RoundRow);
        setRoundPlayers(rpMap);
        setScores(scRows);
        setParsByTee(parsMap);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load match detail.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    if (tourId && matchId) void load();
    else {
      setError("Missing route params.");
      setLoading(false);
    }

    return () => {
      alive = false;
    };
  }, [tourId, matchId]);

  const scoreByPlayerHole = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    for (const s of scores) m.set(`${s.player_id}|${s.hole_number}`, s);
    return m;
  }, [scores]);

  const parsForTee = useMemo(() => {
    const m = parsByTee.get("M") ?? null;
    const f = parsByTee.get("F") ?? null;
    return { M: m, F: f };
  }, [parsByTee]);

  const ptsByPlayerHole = useMemo(() => {
    const m = new Map<string, number | null>();

    const all = [...playersBySide.A, ...playersBySide.B].map((x) => x.player);
    const seen = new Set<string>();
    const players = all.filter((p) => {
      if (!p?.id || seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });

    for (const p of players) {
      const tee: Tee = p.gender ? normalizeTee(p.gender) : "M";
      const pars = (tee === "F" ? parsForTee.F : parsForTee.M) ?? parsForTee.M ?? parsForTee.F;
      if (!pars) continue;

      const rp = roundPlayers.get(p.id);
      const playingHandicap = Number.isFinite(Number(rp?.playing_handicap)) ? Number(rp?.playing_handicap) : 0;

      for (let h = 1; h <= 18; h++) {
        const pr = pars.get(h);
        if (!pr) {
          m.set(`${p.id}|${h}`, null);
          continue;
        }

        const sc = scoreByPlayerHole.get(`${p.id}|${h}`);
        if (!sc) {
          m.set(`${p.id}|${h}`, null);
          continue;
        }

        const raw = normalizeRawScore(sc.strokes, sc.pickup);
        const pts = netStablefordPointsForHole({
          rawScore: raw,
          par: pr.par,
          strokeIndex: pr.si,
          playingHandicap,
        });

        m.set(`${p.id}|${h}`, pts);
      }
    }

    return m;
  }, [playersBySide, parsForTee, roundPlayers, scoreByPlayerHole]);

  const sidePtsByHole = useMemo(() => {
    const out = new Map<string, number | null>();

    function sidePlayers(side: Side) {
      return side === "A" ? playersBySide.A : playersBySide.B;
    }

    for (const side of ["A", "B"] as Side[]) {
      for (let h = 1; h <= 18; h++) {
        const ps = sidePlayers(side);

        if (format === "BETTERBALL_MATCHPLAY") {
          const vals = ps
            .map((mp) => ptsByPlayerHole.get(`${mp.player.id}|${h}`))
            .filter((v) => typeof v === "number") as number[];
          out.set(`${side}|${h}`, vals.length ? Math.max(...vals) : null);
        } else {
          const p1 = ps.find((x) => x.slot === 1)?.player ?? ps[0]?.player ?? null;
          const v = p1 ? ptsByPlayerHole.get(`${p1.id}|${h}`) : null;
          out.set(`${side}|${h}`, typeof v === "number" ? v : null);
        }
      }
    }

    return out;
  }, [playersBySide, ptsByPlayerHole, format]);

  const sideLabel = useMemo(() => {
    function label(side: Side) {
      const ps = side === "A" ? playersBySide.A : playersBySide.B;
      if (ps.length === 0) return side;
      if (format === "BETTERBALL_MATCHPLAY") {
        const n1 = ps.find((x) => x.slot === 1)?.player?.name ?? "";
        const n2 = ps.find((x) => x.slot === 2)?.player?.name ?? "";
        return [n1, n2].filter(Boolean).join(" / ");
      }
      return ps.find((x) => x.slot === 1)?.player?.name ?? ps[0]?.player?.name ?? side;
    }
    return { A: label("A"), B: label("B") };
  }, [playersBySide, format]);

  // ✅ Step-2 core fix: freeze at clinch hole and blank the remaining holes
  const computed = useMemo(() => {
    let diff = 0;
    let thru = 0;
    let decidedAt: number | null = null;

    // diff at clinch (or final) that we should use for display
    let diffFrozen: number | null = null;

    const rows: Array<{
      hole: number;
      aPts: number | null;
      bPts: number | null;
      holeResult: "A" | "B" | "AS" | "—";
      statusAfter: string; // blank for holes after match over
    }> = [];

    for (let h = 1; h <= 18; h++) {
      // If match already decided, push blank rows
      if (decidedAt !== null) {
        rows.push({ hole: h, aPts: null, bPts: null, holeResult: "—", statusAfter: "" });
        continue;
      }

      const aPts = sidePtsByHole.get(`A|${h}`) ?? null;
      const bPts = sidePtsByHole.get(`B|${h}`) ?? null;

      const hr = holeResultLabel(aPts, bPts);

      // Only advance state if computable
      if (hr !== "—") {
        thru = h;
        if (hr === "A") diff += 1;
        else if (hr === "B") diff -= 1;

        const remaining = 18 - h;
        if (Math.abs(diff) > remaining) {
          decidedAt = h;
          diffFrozen = diff; // freeze right at clinch hole
        }
      }

      const statusAfter =
        hr === "—"
          ? "—"
          : diff === 0
          ? "AS"
          : diff > 0
          ? `A ${Math.abs(diff)}up`
          : `B ${Math.abs(diff)}up`;

      rows.push({ hole: h, aPts: hr === "—" ? null : aPts, bPts: hr === "—" ? null : bPts, holeResult: hr, statusAfter });
    }

    const complete = decidedAt !== null || thru === 18;
    const diffForDisplay = diffFrozen !== null ? diffFrozen : diff;

    const headerText = complete
      ? renderFinalText({ diff: diffForDisplay, decidedAt, labelA: sideLabel.A || "A", labelB: sideLabel.B || "B" })
      : renderLiveText({ diff: diffForDisplay, thru, labelA: sideLabel.A || "A", labelB: sideLabel.B || "B" });

    const liveText = renderLiveText({ diff: diffForDisplay, thru, labelA: sideLabel.A || "A", labelB: sideLabel.B || "B" });

    return {
      rows,
      diff: diffForDisplay,
      thru,
      decidedAt,
      complete,
      headerText,
      liveText,
    };
  }, [sidePtsByHole, sideLabel.A, sideLabel.B]);

  function goBack() {
    router.push(`/m/tours/${tourId}/matches/results/${roundIdFromRoute}`);
  }

  if (loading) {
    return (
      <div className="min-h-dvh bg-white text-gray-900">
        <div className="mx-auto w-full max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">Loading match…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-dvh bg-white text-gray-900">
        <div className="mx-auto w-full max-w-md px-4 py-6 space-y-3">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
          <button
            className="w-full h-10 rounded-xl border border-gray-200 bg-white text-sm font-semibold active:bg-gray-50"
            onClick={goBack}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  const best = round ? pickBestRoundDateISO(round) : null;
  const dateText = fmtNzDate(parseDateForDisplay(best));
  const courseName = round ? getCourseName(round) : "Course";
  const rn = round?.round_no ?? null;

  const fmtShort = formatFormatShort(format);

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-10">
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-gray-900">Match detail</div>
            <div className="truncate text-xs text-gray-600">
              {rn != null ? `R${rn} · ` : ""}
              {dateText ? `${dateText} · ` : ""}
              {courseName}
            </div>
          </div>

          <button
            type="button"
            onClick={goBack}
            className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm active:bg-gray-50"
          >
            Back
          </button>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4 space-y-4">
        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="p-4 border-b">
            <div className="text-sm font-semibold text-gray-900">{fmtShort}</div>
            <div className="mt-1 text-xs text-gray-600">
              {computed.complete ? "Final" : "In progress"} · {computed.headerText}
            </div>
          </div>

          <div className="p-4 space-y-3">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-gray-600">Side A</div>
                  <div className="truncate text-sm font-extrabold text-gray-900">{sideLabel.A || "A"}</div>
                </div>
                <div className="min-w-0 text-right">
                  <div className="text-xs font-semibold text-gray-600">Side B</div>
                  <div className="truncate text-sm font-extrabold text-gray-900">{sideLabel.B || "B"}</div>
                </div>
              </div>
            </div>

            {!computed.complete ? (
              <div className="text-xs text-gray-600">
                Current: <span className="font-semibold">{computed.liveText}</span>
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="p-4 border-b">
            <div className="text-sm font-semibold text-gray-900">Hole-by-hole</div>
            <div className="mt-1 text-xs text-gray-600">
              Matchplay is decided by net Stableford points per hole (pickup = 0). Equal points = halved.
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-max border-collapse w-full">
              <thead>
                <tr className="bg-gray-50">
                  <th className="sticky left-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700">
                    Hole
                  </th>
                  <th className="border-b border-gray-200 px-3 py-2 text-center text-xs font-semibold text-gray-700">A pts</th>
                  <th className="border-b border-gray-200 px-3 py-2 text-center text-xs font-semibold text-gray-700">B pts</th>
                  <th className="border-b border-gray-200 px-3 py-2 text-center text-xs font-semibold text-gray-700">Result</th>
                  <th className="border-b border-gray-200 px-3 py-2 text-center text-xs font-semibold text-gray-700">Match</th>
                </tr>
              </thead>

              <tbody>
                {computed.rows.map((r) => {
                  const badge =
                    r.holeResult === "A"
                      ? "bg-green-100 text-green-800"
                      : r.holeResult === "B"
                      ? "bg-amber-100 text-amber-900"
                      : r.holeResult === "AS"
                      ? "bg-gray-100 text-gray-700"
                      : "bg-white text-gray-400";

                  return (
                    <tr key={r.hole} className="border-b last:border-b-0">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-semibold text-gray-900">{r.hole}</td>
                      <td className="px-3 py-2 text-center text-sm text-gray-900">{r.aPts === null ? "" : r.aPts}</td>
                      <td className="px-3 py-2 text-center text-sm text-gray-900">{r.bPts === null ? "" : r.bPts}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`inline-flex min-w-[56px] justify-center rounded-full px-2 py-1 text-xs font-semibold ${badge}`}>
                          {r.holeResult === "—" ? "" : r.holeResult}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center text-sm font-semibold text-gray-900">{r.statusAfter || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="p-4 border-b">
            <div className="text-sm font-semibold text-gray-900">How each side scored</div>
            <div className="mt-1 text-xs text-gray-600">
              Raw score + computed net Stableford points per player per hole. For Better Ball, the highest points on a side are used.
            </div>
          </div>

          <div className="p-2">
            <details className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <summary className="cursor-pointer select-none text-sm font-semibold text-gray-900">
                Show details (tap to expand)
              </summary>

              <div className="mt-3 space-y-4">
                {Array.from({ length: 18 }).map((_, idx) => {
                  const hole = idx + 1;

                  // ✅ If match is over and this is after clinch hole, hide remaining hole detail blocks
                  if (computed.decidedAt !== null && hole > computed.decidedAt) {
                    return (
                      <div key={hole} className="rounded-xl border border-gray-200 bg-white p-3">
                        <div className="text-sm font-extrabold text-gray-900">Hole {hole}</div>
                        <div className="mt-1 text-xs text-gray-500">Match already decided.</div>
                      </div>
                    );
                  }

                  const aSide = playersBySide.A;
                  const bSide = playersBySide.B;

                  function playerLine(mp: MatchPlayerRow) {
                    const pid = mp.player.id;
                    const sc = scoreByPlayerHole.get(`${pid}|${hole}`);
                    const raw = sc ? normalizeRawScore(sc.strokes, sc.pickup) : "";
                    const pts = ptsByPlayerHole.get(`${pid}|${hole}`);
                    const showPts = typeof pts === "number" ? String(pts) : "—";
                    const ph = roundPlayers.get(pid)?.playing_handicap ?? 0;
                    const playing = roundPlayers.get(pid)?.playing ?? true;

                    return (
                      <div key={`${mp.side}-${mp.slot}-${pid}`} className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-gray-900">{mp.player.name}</div>
                          <div className="text-[11px] text-gray-600">
                            HCP {ph} {playing ? "" : "· not playing"}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-sm font-semibold text-gray-900">{raw || "—"}</div>
                          <div className="text-[11px] text-gray-600">{showPts} pts</div>
                        </div>
                      </div>
                    );
                  }

                  const aPts = sidePtsByHole.get(`A|${hole}`) ?? null;
                  const bPts = sidePtsByHole.get(`B|${hole}`) ?? null;

                  const aCounted =
                    format === "BETTERBALL_MATCHPLAY"
                      ? aSide
                          .map((mp) => ({ mp, pts: ptsByPlayerHole.get(`${mp.player.id}|${hole}`) }))
                          .filter((x) => typeof x.pts === "number")
                          .sort((x, y) => Number(y.pts) - Number(x.pts))[0]?.mp ?? null
                      : aSide.find((x) => x.slot === 1) ?? aSide[0] ?? null;

                  const bCounted =
                    format === "BETTERBALL_MATCHPLAY"
                      ? bSide
                          .map((mp) => ({ mp, pts: ptsByPlayerHole.get(`${mp.player.id}|${hole}`) }))
                          .filter((x) => typeof x.pts === "number")
                          .sort((x, y) => Number(y.pts) - Number(x.pts))[0]?.mp ?? null
                      : bSide.find((x) => x.slot === 1) ?? bSide[0] ?? null;

                  return (
                    <div key={hole} className="rounded-xl border border-gray-200 bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-extrabold text-gray-900">Hole {hole}</div>
                        <div className="text-xs font-semibold text-gray-700">
                          A {aPts === null ? "—" : aPts} · B {bPts === null ? "—" : bPts}
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-1 gap-3">
                        <div className="rounded-lg border border-gray-200 p-2">
                          <div className="text-xs font-semibold text-gray-600 mb-2">
                            Side A{" "}
                            {format === "BETTERBALL_MATCHPLAY" && aCounted ? `· counted: ${aCounted.player.name}` : ""}
                          </div>
                          <div className="space-y-2">{aSide.map(playerLine)}</div>
                        </div>

                        <div className="rounded-lg border border-gray-200 p-2">
                          <div className="text-xs font-semibold text-gray-600 mb-2">
                            Side B{" "}
                            {format === "BETTERBALL_MATCHPLAY" && bCounted ? `· counted: ${bCounted.player.name}` : ""}
                          </div>
                          <div className="space-y-2">{bSide.map(playerLine)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          </div>
        </section>

        <div className="text-[11px] text-gray-400">Dates shown in Pacific/Auckland.</div>

        <div className="pt-2">
          <Link className="underline text-sm text-gray-700" href={`/m/tours/${tourId}/matches/results/${roundIdFromRoute}`}>
            Back to round results
          </Link>
        </div>
      </main>
    </div>
  );
}
