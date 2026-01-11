// app/m/tours/[id]/leaderboards/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

// If you already have MobileNav in this location (you previously did):
import MobileNav from "../_components/MobileNav";

type Tee = "M" | "F";
type BoardKind = "individual" | "pairs" | "teams";

type Tour = { id: string; name: string };

type RoundRow = {
  id: string;
  tour_id: string;
  name: string | null;
  round_no: number | null;
  course_id: string | null;
  created_at: string | null;
};

type PlayerRow = {
  id: string;
  name: string;
  gender: Tee | null;
};

type TourPlayerRow = {
  tour_id: string;
  player_id: string;
  starting_handicap: number | null;
  players: { id: string; name: string; gender: Tee | null } | null;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean | null;
  playing_handicap: number | null;
};

type ParRow = {
  course_id: string;
  hole_number: number;
  tee: Tee;
  par: number;
  stroke_index: number;
};

type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean | null;
};

type IndividualRule =
  | { mode: "ALL" }
  | { mode: "BEST_N"; n: number; finalRequired: boolean };

const UI_HILITE = {
  // ✅ single “counting rounds” highlight style (one colour only)
  borderClass: "border-sky-400",
  bgClass: "bg-sky-900/20",
};

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function fmtRoundHeading(roundIndex1: number, isFinal: boolean) {
  return isFinal ? `R${roundIndex1} (F)` : `R${roundIndex1}`;
}

function safeNum(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function rawScoreFor(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  return String(strokes);
}

/**
 * Decide which round indices (0-based) count for the TOTAL.
 * - ALL: all rounds count
 * - BEST_N: choose best N totals; if finalRequired, the final round must be included
 */
function chooseCountingRounds(params: {
  perRoundTotals: number[];
  rule: IndividualRule;
  finalIndex: number; // 0-based
}): Set<number> {
  const { perRoundTotals, rule, finalIndex } = params;

  const count = perRoundTotals.length;
  const all = new Set<number>();
  for (let i = 0; i < count; i++) all.add(i);

  if (rule.mode === "ALL") return all;

  const n = Math.max(1, Math.min(rule.n, count));

  // Sort indices by score desc
  const idxs = Array.from({ length: count }, (_, i) => i);
  idxs.sort((a, b) => (perRoundTotals[b] ?? 0) - (perRoundTotals[a] ?? 0));

  const picked = new Set<number>();

  if (rule.finalRequired && finalIndex >= 0 && finalIndex < count) {
    picked.add(finalIndex);

    // Add best remaining until size == n
    for (const i of idxs) {
      if (picked.size >= n) break;
      if (i === finalIndex) continue;
      picked.add(i);
    }
    return picked;
  }

  // No final requirement: take top N
  for (let k = 0; k < n; k++) picked.add(idxs[k]);
  return picked;
}

export default function MobileLeaderboardsPage() {
  const params = useParams<{ id: string }>();
  const tourId = String(params?.id ?? "").trim();

  // ✅ fixed selector (UI only; parameters not editable)
  const [kind, setKind] = useState<BoardKind>("individual");

  // ✅ Step 1 rule constants (can later be read from DB, but mobile remains read-only)
  const individualRule: IndividualRule = { mode: "ALL" };
  // Examples you might use later:
  // const individualRule: IndividualRule = { mode: "BEST_N", n: 4, finalRequired: true };

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);

  useEffect(() => {
    if (!tourId) return;
    let alive = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");

      try {
        // Tour
        const { data: tData, error: tErr } = await supabase
          .from("tours")
          .select("id,name")
          .eq("id", tourId)
          .single();
        if (tErr) throw tErr;

        // Rounds
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,tour_id,name,round_no,course_id,created_at")
          .eq("tour_id", tourId)
          .order("round_no", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true });
        if (rErr) throw rErr;

        const roundRows = (rData ?? []) as RoundRow[];

        // Tour players (roster)
        const { data: tpData, error: tpErr } = await supabase
          .from("tour_players")
          .select("tour_id,player_id,starting_handicap,players(id,name,gender)")
          .eq("tour_id", tourId)
          .order("name", { ascending: true, foreignTable: "players" });
        if (tpErr) throw tpErr;

        const roster: PlayerRow[] = (tpData ?? [])
          .map((row: any) => ({
            id: String(row.players?.id ?? row.player_id),
            name: String(row.players?.name ?? "(missing name)"),
            gender: row.players?.gender ? normalizeTee(row.players.gender) : null,
          }))
          .filter((p: any) => !!p.id);

        const playerIds = roster.map((p) => p.id);
        const roundIds = roundRows.map((r) => r.id);

        // Round players (to get playing_handicap per round; used in Stableford)
        let rpRows: RoundPlayerRow[] = [];
        if (roundIds.length && playerIds.length) {
          const { data: rpData, error: rpErr } = await supabase
            .from("round_players")
            .select("round_id,player_id,playing,playing_handicap")
            .in("round_id", roundIds)
            .in("player_id", playerIds);
          if (rpErr) throw rpErr;

          rpRows = (rpData ?? []).map((x: any) => ({
            round_id: String(x.round_id),
            player_id: String(x.player_id),
            playing: x.playing === true,
            playing_handicap: Number.isFinite(Number(x.playing_handicap))
              ? Number(x.playing_handicap)
              : null,
          }));
        }

        // Pars (for all courses referenced by rounds)
        const courseIds = Array.from(
          new Set(roundRows.map((r) => r.course_id).filter(Boolean) as string[])
        );

        let parRows: ParRow[] = [];
        if (courseIds.length) {
          const { data: pData, error: pErr } = await supabase
            .from("pars")
            .select("course_id,hole_number,tee,par,stroke_index")
            .in("course_id", courseIds)
            .in("tee", ["M", "F"])
            .order("course_id", { ascending: true })
            .order("tee", { ascending: true })
            .order("hole_number", { ascending: true });

          if (pErr) throw pErr;

          parRows = (pData ?? []).map((row: any) => ({
            course_id: String(row.course_id),
            hole_number: Number(row.hole_number),
            tee: normalizeTee(row.tee),
            par: Number(row.par),
            stroke_index: Number(row.stroke_index),
          }));
        }

        // Scores (all rounds + roster players)
        let scoreRows: ScoreRow[] = [];
        if (roundIds.length && playerIds.length) {
          const { data: sData, error: sErr } = await supabase
            .from("scores")
            .select("round_id,player_id,hole_number,strokes,pickup")
            .in("round_id", roundIds)
            .in("player_id", playerIds);

          if (sErr) throw sErr;
          scoreRows = (sData ?? []) as ScoreRow[];
        }

        if (!alive) return;

        setTour(tData as Tour);
        setRounds(roundRows);
        setPlayers(roster);
        setRoundPlayers(rpRows);
        setPars(parRows);
        setScores(scoreRows);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load leaderboards.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [tourId]);

  const sortedRounds = useMemo(() => {
    const arr = [...rounds];
    // Ensure deterministic ordering: round_no then created_at
    arr.sort((a, b) => {
      const an = a.round_no ?? 999999;
      const bn = b.round_no ?? 999999;
      if (an !== bn) return an - bn;
      return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
    });
    return arr;
  }, [rounds]);

  const finalRoundIndex = useMemo(() => {
    return sortedRounds.length ? sortedRounds.length - 1 : -1;
  }, [sortedRounds]);

  const playerById = useMemo(() => {
    const m = new Map<string, PlayerRow>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const roundPlayerHcp = useMemo(() => {
    // key = roundId|playerId -> playing_handicap (fallback 0)
    const m = new Map<string, number>();
    for (const rp of roundPlayers) {
      const key = `${rp.round_id}|${rp.player_id}`;
      if (Number.isFinite(Number(rp.playing_handicap))) m.set(key, Number(rp.playing_handicap));
    }
    return m;
  }, [roundPlayers]);

  const parByCourseTeeHole = useMemo(() => {
    // courseId|tee -> hole -> {par, si}
    const m = new Map<string, Map<number, { par: number; si: number }>>();
    for (const pr of pars) {
      const key = `${pr.course_id}|${pr.tee}`;
      if (!m.has(key)) m.set(key, new Map());
      m.get(key)!.set(pr.hole_number, { par: pr.par, si: pr.stroke_index });
    }
    return m;
  }, [pars]);

  const scoreByKey = useMemo(() => {
    // roundId|playerId|hole -> ScoreRow
    const m = new Map<string, ScoreRow>();
    for (const s of scores) {
      const key = `${String(s.round_id)}|${String(s.player_id)}|${Number(s.hole_number)}`;
      m.set(key, s);
    }
    return m;
  }, [scores]);

  const individualRows = useMemo(() => {
    if (!sortedRounds.length || !players.length) return [];

    // roundId -> courseId
    const courseByRound = new Map<string, string>();
    for (const r of sortedRounds) {
      if (r.course_id) courseByRound.set(r.id, String(r.course_id));
    }

    const rows: Array<{
      playerId: string;
      name: string;
      totalsByRound: number[]; // aligned with sortedRounds
      countingSet: Set<number>;
      total: number;
    }> = [];

    for (const p of players) {
      const totalsByRound: number[] = [];

      for (let ri = 0; ri < sortedRounds.length; ri++) {
        const r = sortedRounds[ri];
        const courseId = courseByRound.get(r.id);
        if (!courseId) {
          totalsByRound.push(0);
          continue;
        }

        const tee: Tee = p.gender ? normalizeTee(p.gender) : "M";
        const parMap = parByCourseTeeHole.get(`${courseId}|${tee}`);
        if (!parMap) {
          totalsByRound.push(0);
          continue;
        }

        const hcp = roundPlayerHcp.get(`${r.id}|${p.id}`) ?? 0;

        let sum = 0;
        for (let hole = 1; hole <= 18; hole++) {
          const pr = parMap.get(hole);
          if (!pr) continue;

          const sc = scoreByKey.get(`${r.id}|${p.id}|${hole}`);
          if (!sc) continue;

          const raw = rawScoreFor(sc.strokes, (sc as any).pickup);

          sum += netStablefordPointsForHole({
            rawScore: raw,
            par: pr.par,
            strokeIndex: pr.si,
            playingHandicap: hcp,
          });
        }

        totalsByRound.push(sum);
      }

      const countingSet = chooseCountingRounds({
        perRoundTotals: totalsByRound,
        rule: individualRule,
        finalIndex: finalRoundIndex,
      });

      let total = 0;
      for (const i of countingSet) total += totalsByRound[i] ?? 0;

      rows.push({
        playerId: p.id,
        name: p.name,
        totalsByRound,
        countingSet,
        total,
      });
    }

    // Sort by total desc, then name
    rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return rows;
  }, [
    sortedRounds,
    players,
    parByCourseTeeHole,
    roundPlayerHcp,
    scoreByKey,
    individualRule,
    finalRoundIndex,
  ]);

  const description = useMemo(() => {
    if (kind === "individual") {
      if (individualRule.mode === "ALL") {
        return "Individual Stableford · Total points across all rounds";
      }
      return individualRule.finalRequired
        ? `Individual Stableford · Best ${individualRule.n} rounds (Final required)`
        : `Individual Stableford · Best ${individualRule.n} rounds`;
    }

    if (kind === "pairs") {
      return "Pairs Better Ball Stableford · (Coming next step)";
    }

    // Teams
    return "Teams Stableford · Best Y scores per hole, minus 1 for each zero · (Coming next step)";
  }, [kind, individualRule]);

  return (
    <div className="min-h-dvh bg-white pb-[88px]">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <Link
              href={`/m/tours/${tourId}`}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-gray-700 hover:bg-gray-100 active:bg-gray-200"
            >
              ← Back
            </Link>
            <div className="min-w-0 text-right">
              <div className="text-base font-semibold text-gray-900">Boards</div>
              <div className="truncate text-sm text-gray-500">{tour?.name ?? ""}</div>
            </div>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4 space-y-4">
        {errorMsg ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {errorMsg}
          </div>
        ) : null}

        {/* Selector */}
        <div className="rounded-2xl border border-gray-200 bg-white p-2 shadow-sm">
          <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-gray-200">
            {[
              { key: "individual", label: "Individual" },
              { key: "pairs", label: "Pairs" },
              { key: "teams", label: "Teams" },
            ].map((it) => {
              const active = kind === (it.key as BoardKind);
              return (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => setKind(it.key as BoardKind)}
                  className={`py-2 text-sm font-semibold ${
                    active ? "bg-gray-900 text-white" : "bg-white text-gray-700"
                  }`}
                >
                  {it.label}
                </button>
              );
            })}
          </div>

          <div className="mt-2 text-xs text-gray-600">{description}</div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
            Loading…
          </div>
        ) : sortedRounds.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
            No rounds found for this tour.
          </div>
        ) : kind !== "individual" ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
            This leaderboard will be implemented next.
          </div>
        ) : individualRows.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
            No players found for this tour.
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            {/* header row */}
            <div className="flex border-b bg-gray-50">
              <div className="w-[44px] shrink-0 px-2 py-2 text-xs font-bold text-gray-600 text-center">
                #
              </div>
              <div className="min-w-[150px] flex-1 px-2 py-2 text-xs font-bold text-gray-600">
                Name
              </div>

              {/* Tour total highlighted */}
              <div className="w-[74px] shrink-0 px-2 py-2 text-xs font-black text-gray-900 bg-gray-900 text-white text-center">
                Total
              </div>

              {/* Rounds scroll */}
              <div className="flex-1 overflow-x-auto">
                <div className="flex">
                  {sortedRounds.map((r, i) => (
                    <div
                      key={r.id}
                      className="w-[62px] shrink-0 px-2 py-2 text-xs font-bold text-gray-600 text-center"
                    >
                      {fmtRoundHeading(i + 1, i === finalRoundIndex)}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* body rows */}
            <div>
              {individualRows.map((row, idx) => (
                <div key={row.playerId} className="flex border-b last:border-b-0">
                  <div className="w-[44px] shrink-0 px-2 py-3 text-sm font-semibold text-gray-700 text-center">
                    {idx + 1}
                  </div>

                  <div className="min-w-[150px] flex-1 px-2 py-3 text-sm font-semibold text-gray-900 truncate">
                    {row.name}
                  </div>

                  <div className="w-[74px] shrink-0 px-2 py-3 text-base font-black bg-gray-900 text-white text-center">
                    {row.total}
                  </div>

                  <div className="flex-1 overflow-x-auto">
                    <div className="flex">
                      {row.totalsByRound.map((v, ri) => {
                        const counts = row.countingSet.has(ri);
                        return (
                          <div
                            key={ri}
                            className="w-[62px] shrink-0 px-2 py-3 text-center"
                          >
                            <div
                              className={`mx-auto w-full rounded-lg px-1 py-1 text-sm font-bold ${
                                counts
                                  ? `border ${UI_HILITE.borderClass} ${UI_HILITE.bgClass}`
                                  : "border border-transparent"
                              }`}
                            >
                              {safeNum(v)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Bottom nav */}
      <MobileNav />
    </div>
  );
}
