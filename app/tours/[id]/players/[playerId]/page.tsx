// app/tours/[id]/players/[playerId]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import {
  computePlayerTourStats,
  pct,
  type HoleParSI,
  type RoundPlayerRow,
  type RoundRow,
  type ScoreRow,
  type PlayerTourStats,
  type OutcomeCounts,
} from "@/lib/stats/playerTourStats";

// Adjust if needed
const T_TOURS = "tours";
const T_PLAYERS = "players";
const T_TOUR_PLAYERS = "tour_players";
const T_ROUNDS = "rounds";
const T_PARS = "pars";
const T_SCORES = "scores";
const T_ROUND_PLAYERS = "round_players";

type Tour = { id: string; name: string };
type Player = { id: string; name: string };

function fmt(n: number | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function StatCard(props: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-sm text-gray-600">{props.label}</div>
      <div className="mt-1 text-2xl font-semibold">{props.value}</div>
      {props.sub ? <div className="mt-1 text-xs text-gray-500">{props.sub}</div> : null}
    </div>
  );
}

function OutcomesCombinedTable(props: {
  holesPlayed: number;
  gross: OutcomeCounts;
  net: OutcomeCounts;
}) {
  const { holesPlayed, gross, net } = props;

  const rows: Array<{ label: string; key: keyof OutcomeCounts }> = [
    { label: "Eagle or better", key: "eagleOrBetter" },
    { label: "Birdies", key: "birdie" },
    { label: "Pars", key: "par" },
    { label: "Bogeys", key: "bogey" },
    { label: "Double bogey or worse (incl P)", key: "doubleOrWorse" },
  ];

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 text-lg font-semibold">Gross vs Net outcomes (all holes played)</div>

      <div className="overflow-x-auto">
        <table className="min-w-[720px] w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 text-left font-medium text-gray-600" />
              <th className="py-2 text-center font-semibold" colSpan={2}>
                Gross
              </th>
              <th className="py-2 text-center font-semibold" colSpan={2}>
                Net
              </th>
            </tr>
            <tr className="border-b">
              <th className="py-2 text-left font-medium text-gray-600">Outcome</th>
              <th className="py-2 text-right font-medium text-gray-600">Count</th>
              <th className="py-2 text-right font-medium text-gray-600">%</th>
              <th className="py-2 text-right font-medium text-gray-600">Count</th>
              <th className="py-2 text-right font-medium text-gray-600">%</th>
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => {
              const g = gross[r.key] ?? 0;
              const n = net[r.key] ?? 0;

              return (
                <tr key={r.key} className="border-b last:border-b-0">
                  <td className="py-2">{r.label}</td>
                  <td className="py-2 text-right tabular-nums">{g}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(pct(g, holesPlayed), 1)}%</td>
                  <td className="py-2 text-right tabular-nums">{n}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(pct(n, holesPlayed), 1)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-2 text-xs text-gray-500">
        Based on all holes played (any hole with a saved score). Pickups (P) count as double bogey or worse.
      </div>
    </div>
  );
}

export default function PlayerStatsPage() {
  const params = useParams();
  const tourId = (params?.id as string) || "";
  const playerId = (params?.playerId as string) || "";

  const [tour, setTour] = useState<Tour | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [startingHandicap, setStartingHandicap] = useState<number | null>(null);

  const [stats, setStats] = useState<PlayerTourStats | null>(null);

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErrorMsg("");

      try {
        if (!tourId) throw new Error("Missing tour id in route.");
        if (!playerId) throw new Error("Missing player id in route.");

        const [{ data: tData, error: tErr }, { data: pData, error: pErr }] = await Promise.all([
          supabase.from(T_TOURS).select("id,name").eq("id", tourId).single(),
          supabase.from(T_PLAYERS).select("id,name").eq("id", playerId).single(),
        ]);

        if (tErr) throw new Error(tErr.message);
        if (pErr) throw new Error(pErr.message);

        // ✅ membership check via tour_players
        const { data: tpData, error: tpErr } = await supabase
          .from(T_TOUR_PLAYERS)
          .select("starting_handicap")
          .eq("tour_id", tourId)
          .eq("player_id", playerId)
          .maybeSingle();

        if (tpErr) throw new Error(tpErr.message);
        if (!tpData) throw new Error("Player is not in this tour.");

        const { data: roundsData, error: roundsErr } = await supabase
          .from(T_ROUNDS)
          .select("id,tour_id,course_id,name,created_at")
          .eq("tour_id", tourId)
          .order("created_at", { ascending: true });

        if (roundsErr) throw new Error(roundsErr.message);

        const rounds = (roundsData ?? []) as RoundRow[];
        const roundIds = rounds.map((r) => r.id);

        const courseIds = Array.from(new Set(rounds.map((r) => r.course_id).filter(Boolean))) as string[];

        const { data: parsData, error: parsErr } = await supabase
          .from(T_PARS)
          .select("course_id,hole_number,par,stroke_index")
          .in("course_id", courseIds);

        if (parsErr) throw new Error(parsErr.message);

        const { data: scoresData, error: scoresErr } = await supabase
          .from(T_SCORES)
          .select("round_id,player_id,hole_number,strokes,pickup")
          .eq("player_id", playerId)
          .in("round_id", roundIds);

        if (scoresErr) throw new Error(scoresErr.message);

        const { data: rpData, error: rpErr } = await supabase
          .from(T_ROUND_PLAYERS)
          .select("round_id,player_id,playing_handicap")
          .eq("player_id", playerId)
          .in("round_id", roundIds);

        if (rpErr) throw new Error(rpErr.message);

        const computed = computePlayerTourStats({
          rounds,
          pars: (parsData ?? []) as HoleParSI[],
          scores: (scoresData ?? []) as ScoreRow[],
          roundPlayers: (rpData ?? []) as RoundPlayerRow[],
          playerId,
        });

        if (cancelled) return;

        setTour(tData as Tour);
        setPlayer(pData as Player);
        setStartingHandicap(tpData.starting_handicap ?? 0);
        setStats(computed);
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e?.message ?? "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [tourId, playerId]);

  const completedRounds = stats?.rounds;
  const holes = stats?.holes;

  const completedRoundList = useMemo(() => {
    const all = stats?.rounds.roundSummaries ?? [];
    return all.filter((r) => r.is_complete);
  }, [stats]);

  return (
    <div className="mx-auto max-w-5xl p-4 space-y-4">
      <div className="text-sm text-gray-600">
        <Link className="underline" href={`/tours/${tourId}`}>
          {tour?.name ?? "Tour"}
        </Link>{" "}
        <span className="text-gray-400">/</span>{" "}
        <Link className="underline" href={`/tours/${tourId}/players`}>
          Players
        </Link>{" "}
        <span className="text-gray-400">/</span>{" "}
        <span className="text-gray-700">Player stats</span>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{player?.name ?? "Player"}</h1>
          {tour ? <div className="mt-1 text-sm text-gray-600">{tour.name}</div> : null}
          {startingHandicap != null ? (
            <div className="mt-1 text-xs text-gray-600">Starting handicap (tour): {startingHandicap}</div>
          ) : null}
        </div>

        <div className="flex gap-2">
          <Link className="rounded border px-3 py-2 text-sm hover:bg-gray-50" href={`/tours/${tourId}/players`}>
            Back to players
          </Link>
          <Link className="rounded border px-3 py-2 text-sm hover:bg-gray-50" href={`/tours/${tourId}/leaderboard`}>
            Leaderboard
          </Link>
        </div>
      </div>

      {loading ? <div className="text-sm text-gray-600">Loading…</div> : null}
      {errorMsg ? <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{errorMsg}</div> : null}

      {!loading && !errorMsg && stats ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StatCard
              label="Rounds played (completed)"
              value={String(completedRounds?.roundsPlayedCompleted ?? 0)}
              sub="Completed = 18 scored holes (strokes or pickup)"
            />
            <StatCard
              label="Holes played (all)"
              value={String(holes?.holesPlayedAll ?? 0)}
              sub="Includes partial rounds (any scored hole with pars+SI available)"
            />
            <StatCard label="Average Stableford (completed rounds)" value={fmt(completedRounds?.avgStableford ?? null, 1)} />
            <StatCard label="Best Stableford round" value={completedRounds?.bestStableford == null ? "—" : String(completedRounds.bestStableford)} />
            <StatCard label="Worst Stableford round" value={completedRounds?.worstStableford == null ? "—" : String(completedRounds.worstStableford)} />
            <StatCard label="Std dev Stableford (completed rounds)" value={fmt(completedRounds?.stdDevStableford ?? null, 2)} sub="Sample std dev (n-1)" />
          </div>

          <OutcomesCombinedTable
            holesPlayed={holes?.holesPlayedAll ?? 0}
            gross={holes!.grossOutcomes}
            net={holes!.netOutcomes}
          />

          <div className="rounded-lg border p-4">
            <div className="mb-2 text-lg font-semibold">Completed rounds (Stableford totals)</div>
            {completedRoundList.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-[560px] w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-2 text-left font-medium text-gray-600">Round</th>
                      <th className="py-2 text-right font-medium text-gray-600">Stableford</th>
                      <th className="py-2 text-right font-medium text-gray-600">Holes scored</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedRoundList.map((r, idx) => (
                      <tr key={r.round_id} className="border-b last:border-b-0">
                        <td className="py-2">Round {idx + 1}</td>
                        <td className="py-2 text-right tabular-nums">{r.stableford_total}</td>
                        <td className="py-2 text-right tabular-nums">{r.holes_scored}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-gray-600">No completed rounds for this player yet.</div>
            )}
          </div>

          {process.env.NODE_ENV !== "production" ? (
            <div className="rounded-lg border p-4">
              <div className="mb-2 text-lg font-semibold">Debug</div>
              <ul className="list-disc pl-5 text-sm text-gray-700">
                <li>stablefordAdapterMode: {stats.debug.stablefordAdapterMode}</li>
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
