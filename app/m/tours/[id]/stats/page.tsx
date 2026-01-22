// app/m/tours/[id]/stats/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import MobileNav from "../_components/MobileNav";

import {
  computePlayerTourStats,
  pct,
  type HoleParSI,
  type PlayerTourStats,
  type RoundPlayerRow as StatsRoundPlayerRow,
  type RoundRow as StatsRoundRow,
  type ScoreRow as StatsScoreRow,
} from "@/lib/stats/playerTourStats";

type Tee = "M" | "F";

type Tour = { id: string; name: string };

type RoundRow = {
  id: string;
  tour_id: string;
  course_id: string | null;
  name: string | null;
  round_no: number | null;
  created_at: string | null;
};

type PlayerRow = {
  id: string;
  name: string;
  gender?: Tee | null;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing_handicap: number | null;
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
  tee: Tee;
  par: number;
  stroke_index: number;
};

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function safeName(v: any, fallback: string) {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function fmt(n: number | null | undefined, digits = 1) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return x.toFixed(digits);
}

function fmtInt(n: number | null | undefined) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  return String(Math.round(x));
}

function fmtPct(n: number) {
  if (!Number.isFinite(n)) return "0%";
  return `${n.toFixed(1)}%`;
}

// ✅ IMPORTANT: Supabase/PostgREST often caps at 1000 rows per request.
// This helper fetches ALL score rows in pages.
async function fetchAllScores(roundIds: string[], playerIds: string[]): Promise<ScoreRow[]> {
  const pageSize = 1000;
  let from = 0;
  const out: ScoreRow[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("scores")
      .select("round_id,player_id,hole_number,strokes,pickup")
      .in("round_id", roundIds)
      .in("player_id", playerIds)
      .order("round_id", { ascending: true })
      .order("player_id", { ascending: true })
      .order("hole_number", { ascending: true })
      .range(from, to);

    if (error) throw error;

    const rows = (data ?? []) as any[];

    out.push(
      ...rows.map((x) => ({
        round_id: String(x.round_id),
        player_id: String(x.player_id),
        hole_number: Number(x.hole_number),
        strokes: x.strokes === null || x.strokes === undefined ? null : Number(x.strokes),
        pickup: x.pickup === true ? true : x.pickup === false ? false : (x.pickup ?? null),
      }))
    );

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

type Row = {
  playerId: string;
  name: string;
  stats: PlayerTourStats;
};

export default function MobileTourStatsPage() {
  const params = useParams<{ id?: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);

  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    let alive = true;

    async function loadAll() {
      setLoading(true);
      setErrorMsg("");

      try {
        const { data: tData, error: tErr } = await supabase.from("tours").select("id,name").eq("id", tourId).single();
        if (tErr) throw tErr;
        if (!alive) return;
        setTour(tData as Tour);

        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,tour_id,course_id,name,round_no,created_at")
          .eq("tour_id", tourId)
          .order("round_no", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true });
        if (rErr) throw rErr;

        const rr = (rData ?? []) as RoundRow[];
        if (!alive) return;
        setRounds(rr);

        const { data: tpData, error: tpErr } = await supabase
          .from("tour_players")
          .select("tour_id,player_id,players(id,name,gender)")
          .eq("tour_id", tourId)
          .order("name", { ascending: true, foreignTable: "players" });

        if (tpErr) throw tpErr;

        const ps: PlayerRow[] = (tpData ?? [])
          .map((row: any) => row.players)
          .filter(Boolean)
          .map((p: any) => ({
            id: String(p.id),
            name: safeName(p.name, "(unnamed)"),
            gender: p.gender ? normalizeTee(p.gender) : null,
          }));

        if (!alive) return;
        setPlayers(ps);

        const roundIds = rr.map((r) => r.id);
        const playerIds = ps.map((p) => p.id);

        // round_players (handicap per round)
        if (roundIds.length > 0 && playerIds.length > 0) {
          const { data: rpData, error: rpErr } = await supabase
            .from("round_players")
            .select("round_id,player_id,playing_handicap")
            .in("round_id", roundIds)
            .in("player_id", playerIds);

          if (rpErr) throw rpErr;

          const rpRows: RoundPlayerRow[] = (rpData ?? []).map((x: any) => ({
            round_id: String(x.round_id),
            player_id: String(x.player_id),
            playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
          }));

          if (!alive) return;
          setRoundPlayers(rpRows);
        } else {
          setRoundPlayers([]);
        }

        // ✅ scores (PAGINATED)
        if (roundIds.length > 0 && playerIds.length > 0) {
          const allScores = await fetchAllScores(roundIds, playerIds);
          if (!alive) return;
          setScores(allScores);
        } else {
          setScores([]);
        }

        // pars (both tees)
        const courseIds = Array.from(new Set(rr.map((r) => r.course_id).filter(Boolean))) as string[];
        if (courseIds.length > 0) {
          const { data: pData, error: pErr } = await supabase
            .from("pars")
            .select("course_id,hole_number,tee,par,stroke_index")
            .in("course_id", courseIds)
            .in("tee", ["M", "F"])
            .order("course_id", { ascending: true })
            .order("hole_number", { ascending: true });

          if (pErr) throw pErr;

          const pr: ParRow[] = (pData ?? []).map((x: any) => ({
            course_id: String(x.course_id),
            hole_number: Number(x.hole_number),
            tee: normalizeTee(x.tee),
            par: Number(x.par),
            stroke_index: Number(x.stroke_index),
          }));

          if (!alive) return;
          setPars(pr);
        } else {
          setPars([]);
        }
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load stats.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    void loadAll();

    return () => {
      alive = false;
    };
  }, [tourId]);

  const statsRows: Row[] = useMemo(() => {
    if (!players.length || !rounds.length) return [];

    const roundsForStats: StatsRoundRow[] = rounds.map((r) => ({
      id: r.id,
      tour_id: r.tour_id,
      course_id: r.course_id,
      name: r.name,
      created_at: r.created_at,
    }));

    // pre-group for speed
    const scoresByPlayer = new Map<string, StatsScoreRow[]>();
    for (const s of scores) {
      const pid = String(s.player_id);
      if (!scoresByPlayer.has(pid)) scoresByPlayer.set(pid, []);
      scoresByPlayer.get(pid)!.push({
        round_id: String(s.round_id),
        player_id: pid,
        hole_number: Number(s.hole_number),
        strokes: s.strokes,
        pickup: s.pickup ?? null,
      });
    }

    const rpByPlayer = new Map<string, StatsRoundPlayerRow[]>();
    for (const rp of roundPlayers) {
      const pid = String(rp.player_id);
      if (!rpByPlayer.has(pid)) rpByPlayer.set(pid, []);
      rpByPlayer.get(pid)!.push({
        round_id: String(rp.round_id),
        player_id: pid,
        playing_handicap: rp.playing_handicap ?? 0,
      });
    }

    // pars grouped by tee for the player’s gender
    const parsByTee = new Map<Tee, HoleParSI[]>();
    for (const tee of ["M", "F"] as Tee[]) parsByTee.set(tee, []);
    for (const p of pars) {
      parsByTee.get(p.tee)!.push({
        course_id: p.course_id,
        hole_number: p.hole_number,
        par: p.par,
        stroke_index: p.stroke_index,
      });
    }

    const rows: Row[] = players.map((p) => {
      const tee: Tee = normalizeTee(p.gender);
      const stats = computePlayerTourStats({
        rounds: roundsForStats,
        pars: parsByTee.get(tee) ?? [],
        scores: scoresByPlayer.get(p.id) ?? [],
        roundPlayers: rpByPlayer.get(p.id) ?? [],
        playerId: p.id,
      });
      return { playerId: p.id, name: p.name, stats };
    });

    // sort by avg stableford desc, then name
    rows.sort((a, b) => {
      const av = a.stats.rounds.avgStableford ?? -999999;
      const bv = b.stats.rounds.avgStableford ?? -999999;
      if (bv !== av) return bv - av;
      return a.name.localeCompare(b.name);
    });

    return rows;
  }, [players, rounds, scores, roundPlayers, pars]);

  if (!tourId || !isLikelyUuid(tourId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900 pb-24">
        <div className="mx-auto max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">
            Missing or invalid tour id in route.
            <div className="mt-2">
              <Link className="underline" href="/m">
                Go to mobile home
              </Link>
            </div>
          </div>
        </div>
        <MobileNav />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-base font-semibold text-gray-900">Stats</div>
          {tour?.name ? <div className="text-xs text-gray-500">{tour.name}</div> : null}
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-5 w-40 rounded bg-gray-100" />
            <div className="h-64 rounded-2xl border bg-white" />
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorMsg}</div>
        ) : players.length === 0 ? (
          <div className="rounded-2xl border p-4 text-sm text-gray-700">No players found for this tour.</div>
        ) : rounds.length === 0 ? (
          <div className="rounded-2xl border p-4 text-sm text-gray-700">No rounds found for this tour.</div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-[1200px] w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="sticky left-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700">
                      Player
                    </th>

                    <th className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700">
                      Rds (18)
                    </th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700">
                      Avg
                    </th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700">
                      Best
                    </th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700">
                      Worst
                    </th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700">
                      SD
                    </th>

                    <th className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700">
                      Holes
                    </th>

                    <th
                      className="border-b border-gray-200 px-3 py-2 text-center text-xs font-semibold text-gray-700"
                      colSpan={5}
                    >
                      Gross outcomes (%)
                    </th>
                    <th
                      className="border-b border-gray-200 px-3 py-2 text-center text-xs font-semibold text-gray-700"
                      colSpan={5}
                    >
                      Net outcomes (%)
                    </th>
                  </tr>

                  <tr className="bg-gray-50">
                    <th className="sticky left-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left text-[11px] font-semibold text-gray-500">
                      &nbsp;
                    </th>

                    <th className="border-b border-gray-200 px-3 py-2 text-right text-[11px] font-semibold text-gray-500">
                      &nbsp;
                    </th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right text-[11px] font-semibold text-gray-500">
                      &nbsp;
                    </th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right text-[11px] font-semibold text-gray-500">
                      &nbsp;
                    </th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right text-[11px] font-semibold text-gray-500">
                      &nbsp;
                    </th>
                    <th className="border-b border-gray-200 px-3 py-2 text-right text-[11px] font-semibold text-gray-500">
                      &nbsp;
                    </th>

                    <th className="border-b border-gray-200 px-3 py-2 text-right text-[11px] font-semibold text-gray-500">
                      &nbsp;
                    </th>

                    {["E+", "B", "Par", "Bog", "D+"].map((h) => (
                      <th
                        key={`g-${h}`}
                        className="border-b border-gray-200 px-3 py-2 text-right text-[11px] font-semibold text-gray-500"
                      >
                        {h}
                      </th>
                    ))}
                    {["E+", "B", "Par", "Bog", "D+"].map((h) => (
                      <th
                        key={`n-${h}`}
                        className="border-b border-gray-200 px-3 py-2 text-right text-[11px] font-semibold text-gray-500"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {statsRows.map((r) => {
                    const holesPlayed = r.stats.holes.holesPlayedAll || 0;

                    const g = r.stats.holes.grossOutcomes;
                    const n = r.stats.holes.netOutcomes;

                    const gp = {
                      eagleOrBetter: fmtPct(pct(g.eagleOrBetter ?? 0, holesPlayed)),
                      birdie: fmtPct(pct(g.birdie ?? 0, holesPlayed)),
                      par: fmtPct(pct(g.par ?? 0, holesPlayed)),
                      bogey: fmtPct(pct(g.bogey ?? 0, holesPlayed)),
                      doubleOrWorse: fmtPct(pct(g.doubleOrWorse ?? 0, holesPlayed)),
                    };

                    const np = {
                      eagleOrBetter: fmtPct(pct(n.eagleOrBetter ?? 0, holesPlayed)),
                      birdie: fmtPct(pct(n.birdie ?? 0, holesPlayed)),
                      par: fmtPct(pct(n.par ?? 0, holesPlayed)),
                      bogey: fmtPct(pct(n.bogey ?? 0, holesPlayed)),
                      doubleOrWorse: fmtPct(pct(n.doubleOrWorse ?? 0, holesPlayed)),
                    };

                    return (
                      <tr key={r.playerId} className="border-b last:border-b-0">
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap">
                          {r.name}
                        </td>

                        <td className="px-3 py-2 text-right text-sm tabular-nums">{fmtInt(r.stats.rounds.roundsPlayedCompleted)}</td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums">{fmt(r.stats.rounds.avgStableford, 1)}</td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums">{fmtInt(r.stats.rounds.bestStableford)}</td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums">{fmtInt(r.stats.rounds.worstStableford)}</td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums">{fmt(r.stats.rounds.stdDevStableford, 2)}</td>

                        <td className="px-3 py-2 text-right text-sm tabular-nums">{fmtInt(holesPlayed)}</td>

                        <td className="px-3 py-2 text-right text-sm tabular-nums">{gp.eagleOrBetter}</td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums">{gp.birdie}</td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums">{gp.par}</td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums">{gp.bogey}</td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums">{gp.doubleOrWorse}</td>

                        <td className="px-3 py-2 text-right text-sm tabular-nums">{np.eagleOrBetter}</td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums">{np.birdie}</td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums">{np.par}</td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums">{np.bogey}</td>
                        <td className="px-3 py-2 text-right text-sm tabular-nums">{np.doubleOrWorse}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-xs text-gray-600">
              Rds (18) = completed rounds (18 scored holes). Outcomes are percentages of{" "}
              <span className="font-semibold">all scored holes</span>. Pickups (P) count as Double+.
            </div>
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
