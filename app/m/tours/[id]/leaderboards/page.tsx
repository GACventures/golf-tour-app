"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import MobileNav from "../_components/MobileNav";
import { supabase } from "@/lib/supabaseClient";

/* =======================
   Types
======================= */
type Tee = "M" | "F";
type LeaderboardKind = "individual" | "pairs" | "teams";

type Tour = { id: string; name: string };

type RoundRow = {
  id: string;
  tour_id: string;
  name: string | null;
  round_no: number | null;
  created_at: string | null;
  course_id: string | null;
};

type PlayerRow = {
  id: string;
  name: string;
  gender?: Tee | null;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean;
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

type IndividualRule =
  | { mode: "ALL" }
  | { mode: "BEST_N"; n: number; finalRequired: boolean };

type PairRule =
  | { mode: "ALL" }
  | { mode: "BEST_Q"; q: number; finalRequired: boolean };

type TeamRule = { bestY: number };

/* =======================
   Helpers
======================= */
function isLikelyUuid(v: string) {
  return /^[0-9a-f-]{36}$/i.test(v);
}

function normalizeTee(v: any): Tee {
  return String(v).toUpperCase() === "F" ? "F" : "M";
}

function roundLabel(round: RoundRow, index: number, isFinal: boolean) {
  const n = round.round_no ?? index + 1;
  return isFinal ? `R${n} (F)` : `R${n}`;
}

function normalizeRawScore(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  return String(strokes);
}

function netStablefordPointsForHole(params: {
  rawScore: string;
  par: number;
  strokeIndex: number;
  playingHandicap: number;
}) {
  const { rawScore, par, strokeIndex, playingHandicap } = params;
  if (!rawScore || rawScore === "P") return 0;

  const strokes = Number(rawScore);
  if (!Number.isFinite(strokes)) return 0;

  const hcp = Math.max(0, Math.floor(playingHandicap || 0));
  const base = Math.floor(hcp / 18);
  const rem = hcp % 18;
  const extra = strokeIndex <= rem ? 1 : 0;

  const net = strokes - (base + extra);
  const pts = 2 + (par - net);
  return Math.max(0, pts);
}

/* =======================
   Page
======================= */
export default function MobileLeaderboardsPage() {
  const params = useParams<{ id?: string }>();
  const tourId = String(params?.id ?? "");

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);

  const [kind, setKind] = useState<LeaderboardKind>("individual");

  const individualRule: IndividualRule = { mode: "ALL" };
  const pairRule: PairRule = { mode: "ALL" };
  const teamRule: TeamRule = { bestY: 2 };

  /* ---------- Load ---------- */
  useEffect(() => {
    if (!isLikelyUuid(tourId)) return;

    let alive = true;

    async function load() {
      setLoading(true);
      try {
        const { data: t } = await supabase
          .from("tours")
          .select("id,name")
          .eq("id", tourId)
          .single();
        if (!alive) return;
        setTour(t as Tour);

        const { data: r } = await supabase
          .from("rounds")
          .select("id,tour_id,name,round_no,created_at,course_id")
          .eq("tour_id", tourId)
          .order("round_no", { ascending: true });
        if (!alive) return;
        setRounds((r ?? []) as RoundRow[]);

        const { data: tp } = await supabase
          .from("tour_players")
          .select("players(id,name,gender)")
          .eq("tour_id", tourId);

        const ps =
          tp?.map((x: any) => ({
            id: x.players.id,
            name: x.players.name,
            gender: x.players.gender ? normalizeTee(x.players.gender) : null,
          })) ?? [];
        setPlayers(ps);

        const roundIds = (r ?? []).map((x: any) => x.id);
        const playerIds = ps.map((p) => p.id);

        if (roundIds.length && playerIds.length) {
          const { data: rp } = await supabase
            .from("round_players")
            .select("round_id,player_id,playing,playing_handicap")
            .in("round_id", roundIds)
            .in("player_id", playerIds);

          setRoundPlayers((rp ?? []) as RoundPlayerRow[]);

          const { data: sc } = await supabase
            .from("scores")
            .select("round_id,player_id,hole_number,strokes,pickup")
            .in("round_id", roundIds)
            .in("player_id", playerIds);

          setScores((sc ?? []) as ScoreRow[]);
        }

        const courseIds = Array.from(
          new Set((r ?? []).map((x: any) => x.course_id).filter(Boolean))
        );

        if (courseIds.length) {
          const { data: pr } = await supabase
            .from("pars")
            .select("course_id,hole_number,tee,par,stroke_index")
            .in("course_id", courseIds)
            .in("tee", ["M", "F"]);

          setPars(
            (pr ?? []).map((x: any) => ({
              course_id: x.course_id,
              hole_number: x.hole_number,
              tee: normalizeTee(x.tee),
              par: x.par,
              stroke_index: x.stroke_index,
            }))
          );
        }
      } catch (e: any) {
        setErrorMsg(e.message ?? "Failed to load leaderboards");
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [tourId]);

  /* ---------- Derived ---------- */
  const sortedRounds = useMemo(() => {
    return [...rounds].sort((a, b) => (a.round_no ?? 999) - (b.round_no ?? 999));
  }, [rounds]);

  const finalRoundId = sortedRounds.at(-1)?.id ?? "";

  const description = useMemo(() => {
    if (kind === "individual") {
      return "Individual Stableford · Total points across all rounds";
    }
    if (kind === "pairs") {
      return "Pairs Better Ball · Total points across all rounds";
    }
    return `Teams · Best ${teamRule.bestY} scores per hole · All rounds`;
  }, [kind, teamRule.bestY]);

  /* ---------- Render ---------- */
  if (!isLikelyUuid(tourId)) {
    return <div className="p-4">Invalid tour id</div>;
  }

  return (
    <div className="min-h-dvh bg-white pb-24">
      <div className="sticky top-0 z-10 border-b bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">Boards</div>
            <div className="text-xs text-gray-500">{tour?.name}</div>
          </div>
          <Link
            href={`/m/tours/${tourId}`}
            className="rounded-md border px-3 py-2 text-sm"
          >
            Overview
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["individual", "pairs", "teams"] as LeaderboardKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                kind === k ? "bg-black text-white" : "bg-white"
              }`}
            >
              {k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>

        <div className="mt-2 rounded-md bg-gray-100 px-3 py-2 text-xs">
          {description}
        </div>
      </div>

      <main className="px-4 py-4">
        {loading ? (
          <div>Loading…</div>
        ) : errorMsg ? (
          <div className="text-red-600">{errorMsg}</div>
        ) : (
          <div className="rounded-lg border overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-2 py-2 text-left">Name</th>
                  <th className="px-2 py-2 text-right">TOUR</th>
                  {sortedRounds.map((r, i) => (
                    <th key={r.id} className="px-2 py-2 text-right">
                      {roundLabel(r, i, r.id === finalRoundId)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="px-2 py-2 font-semibold">{p.name}</td>
                    <td className="px-2 py-2 text-right">—</td>
                    {sortedRounds.map((r) => (
                      <td key={r.id} className="px-2 py-2 text-right">
                        —
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
