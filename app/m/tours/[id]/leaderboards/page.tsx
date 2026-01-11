// app/m/tours/[id]/leaderboards/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import MobileNav from "../_components/MobileNav";
import { supabase } from "@/lib/supabaseClient";

/* =============================
   Types
============================= */
type Tee = "M" | "F";
type LeaderboardKind = "individual" | "pairs" | "teams";

type Tour = { id: string; name: string };

type RoundRow = {
  id: string;
  tour_id: string;
  name: string | null;
  round_no: number | null;
  created_at: string | null;
  is_final: boolean | null;
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
  playing: boolean | null;
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

/* =============================
   Helpers
============================= */
function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
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
  if (strokes == null) return "";
  return String(strokes);
}

function netStablefordPointsForHole({
  rawScore,
  par,
  strokeIndex,
  playingHandicap,
}: {
  rawScore: string;
  par: number;
  strokeIndex: number;
  playingHandicap: number;
}) {
  if (!rawScore || rawScore === "P") return 0;

  const strokes = Number(rawScore);
  if (!Number.isFinite(strokes)) return 0;

  const hcp = Math.max(0, Math.floor(playingHandicap));
  const base = Math.floor(hcp / 18);
  const rem = hcp % 18;
  const shots = base + (strokeIndex <= rem ? 1 : 0);

  const net = strokes - shots;
  return Math.max(0, 2 + (par - net));
}

/* =============================
   Page
============================= */
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

  // 🔒 Mobile read-only rules
  const individualRule: IndividualRule = { mode: "ALL" };
  const pairRule: PairRule = { mode: "ALL" };
  const teamRule: TeamRule = { bestY: 2 };

  /* =============================
     Load
  ============================= */
  useEffect(() => {
    if (!isLikelyUuid(tourId)) return;

    let alive = true;

    async function load() {
      setLoading(true);
      try {
        const { data: t } = await supabase.from("tours").select("id,name").eq("id", tourId).single();
        if (!alive) return;
        setTour(t);

        const { data: r } = await supabase
          .from("rounds")
          .select("id,tour_id,name,round_no,created_at,is_final,course_id")
          .eq("tour_id", tourId)
          .order("round_no");
        if (!alive) return;
        setRounds(r ?? []);

        const { data: tp } = await supabase
          .from("tour_players")
          .select("players(id,name,gender)")
          .eq("tour_id", tourId);

        setPlayers(
          (tp ?? [])
            .map((x: any) => x.players)
            .filter(Boolean)
            .map((p: any) => ({
              id: p.id,
              name: p.name,
              gender: p.gender ? normalizeTee(p.gender) : null,
            }))
        );

        const roundIds = (r ?? []).map((x) => x.id);
        const playerIds = (tp ?? []).map((x: any) => x.players?.id).filter(Boolean);

        if (roundIds.length && playerIds.length) {
          const { data: rp } = await supabase
            .from("round_players")
            .select("round_id,player_id,playing_handicap")
            .in("round_id", roundIds)
            .in("player_id", playerIds);
          setRoundPlayers(rp ?? []);

          const { data: sc } = await supabase
            .from("scores")
            .select("round_id,player_id,hole_number,strokes,pickup")
            .in("round_id", roundIds)
            .in("player_id", playerIds);
          setScores(sc ?? []);
        }

        const courseIds = Array.from(new Set((r ?? []).map((x) => x.course_id).filter(Boolean)));
        if (courseIds.length) {
          const { data: p } = await supabase
            .from("pars")
            .select("course_id,hole_number,tee,par,stroke_index")
            .in("course_id", courseIds);
          setPars(
            (p ?? []).map((x: any) => ({
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

  /* =============================
     Description (FIXED)
  ============================= */
  const description = useMemo(() => {
    if (kind === "individual") {
      switch (individualRule.mode) {
        case "ALL":
          return "Individual Stableford · Total points across all rounds";
        case "BEST_N":
          return individualRule.finalRequired
            ? `Individual Stableford · Best ${individualRule.n} rounds (Final required)`
            : `Individual Stableford · Best ${individualRule.n} rounds`;
      }
    }

    if (kind === "pairs") {
      switch (pairRule.mode) {
        case "ALL":
          return "Pairs Better Ball · Total points across all rounds";
        case "BEST_Q":
          return pairRule.finalRequired
            ? `Pairs Better Ball · Best ${pairRule.q} rounds (Final required)`
            : `Pairs Better Ball · Best ${pairRule.q} rounds`;
      }
    }

    return `Teams · Best ${teamRule.bestY} scores per hole, minus 1 per zero · All rounds`;
  }, [kind, individualRule, pairRule, teamRule.bestY]);

  /* =============================
     UI
  ============================= */
  if (!isLikelyUuid(tourId)) {
    return <div className="p-4">Invalid tour</div>;
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      <div className="sticky top-0 border-b bg-white px-4 py-3">
        <div className="flex justify-between">
          <div>
            <div className="font-semibold">Boards</div>
            <div className="text-sm text-gray-500">{tour?.name}</div>
          </div>
          <Link href={`/m/tours/${tourId}`} className="text-sm font-semibold">
            Overview
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["individual", "pairs", "teams"] as LeaderboardKind[]).map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                kind === k ? "bg-black text-white" : "border"
              }`}
            >
              {k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>

        <div className="mt-3 rounded-lg bg-gray-100 px-3 py-2 text-xs">{description}</div>
      </div>

      <main className="px-4 py-4">
        {loading ? <div>Loading…</div> : errorMsg ? <div>{errorMsg}</div> : <div>Leaderboard table unchanged</div>}
      </main>

      <MobileNav />
    </div>
  );
}
