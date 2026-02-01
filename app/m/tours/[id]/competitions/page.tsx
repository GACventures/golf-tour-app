// app/m/tours/[id]/competitions/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import MobileNav from "../_components/MobileNav";

import { competitionCatalog } from "@/lib/competitions/catalog";
import { runCompetition } from "@/lib/competitions/engine";
import type { CompetitionDefinition, CompetitionContext } from "@/lib/competitions/types";

import {
  buildTourCompetitionContext,
  type Tee,
  type TourRoundLite,
  type PlayerLiteForTour,
  type RoundPlayerLiteForTour,
  type ScoreLiteForTour,
  type ParLiteForTour,
} from "@/lib/competitions/buildTourCompetitionContext";

import { computeH2ZForPlayer, type H2ZLeg, buildH2ZDiagnostic } from "@/lib/competitions/h2z";

/* ---------- types (unchanged) ---------- */

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

type H2ZLegRow = {
  tour_id: string;
  leg_no: number;
  start_round_no: number;
  end_round_no: number;
};

/* ---------- helpers ---------- */

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

/* ---------- component ---------- */

export default function MobileCompetitionsPage() {
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
  const [h2zLegs, setH2zLegs] = useState<H2ZLegRow[]>([]);

  // 🔍 simple debug: rows fetched per round
  const [scoreFetchLog, setScoreFetchLog] = useState<string[]>([]);

  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    let alive = true;

    async function loadAll() {
      setLoading(true);
      setErrorMsg("");
      setScoreFetchLog([]);

      try {
        /* --- tour --- */
        const { data: tData, error: tErr } = await supabase
          .from("tours")
          .select("id,name")
          .eq("id", tourId)
          .single();
        if (tErr) throw tErr;
        if (!alive) return;
        setTour(tData as Tour);

        /* --- rounds --- */
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,tour_id,name,round_no,created_at,course_id")
          .eq("tour_id", tourId)
          .order("round_no", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true });
        if (rErr) throw rErr;
        if (!alive) return;
        setRounds(rData as RoundRow[]);

        /* --- players --- */
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

        const roundIds = (rData ?? []).map((r: any) => r.id);
        const playerIds = ps.map((p) => p.id);

        /* --- round_players --- */
        if (roundIds.length && playerIds.length) {
          const { data: rpData, error: rpErr } = await supabase
            .from("round_players")
            .select("round_id,player_id,playing,playing_handicap")
            .in("round_id", roundIds)
            .in("player_id", playerIds);
          if (rpErr) throw rpErr;
          if (!alive) return;
          setRoundPlayers(rpData as RoundPlayerRow[]);
        }

        /* =====================================================
           ✅ SCORES — FETCH ONE ROUND AT A TIME
           ===================================================== */
        const allScores: ScoreRow[] = [];
        const fetchLog: string[] = [];

        for (const r of rData ?? []) {
          const { data: sData, error: sErr } = await supabase
            .from("scores")
            .select("round_id,player_id,hole_number,strokes,pickup")
            .eq("round_id", r.id);

          if (sErr) throw sErr;

          const rows = (sData ?? []) as ScoreRow[];
          fetchLog.push(`Round ${r.round_no ?? "?"}: ${rows.length} rows`);
          allScores.push(...rows);
        }

        if (!alive) return;
        setScores(allScores);
        setScoreFetchLog(fetchLog);

        /* --- pars --- */
        const courseIds = Array.from(new Set((rData ?? []).map((r: any) => r.course_id).filter(Boolean)));
        if (courseIds.length) {
          const { data: pData, error: pErr } = await supabase
            .from("pars")
            .select("course_id,hole_number,tee,par,stroke_index")
            .in("course_id", courseIds)
            .in("tee", ["M", "F"]);
          if (pErr) throw pErr;
          if (!alive) return;
          setPars(pData as ParRow[]);
        }

        /* --- H2Z legs --- */
        const { data: lData, error: lErr } = await supabase
          .from("tour_h2z_legs")
          .select("tour_id,leg_no,start_round_no,end_round_no")
          .eq("tour_id", tourId)
          .order("leg_no", { ascending: true });
        if (lErr) throw lErr;
        if (!alive) return;
        setH2zLegs(lData as H2ZLegRow[]);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load competitions.");
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

  /* ---------- build ctx (unchanged) ---------- */

  const sortedRounds = useMemo(() => {
    const arr = [...rounds];
    arr.sort((a, b) => (a.round_no ?? 999999) - (b.round_no ?? 999999));
    return arr;
  }, [rounds]);

  const ctx = useMemo(() => {
    return buildTourCompetitionContext({
      rounds: sortedRounds.map((r) => ({ id: r.id, name: r.name, course_id: r.course_id })),
      players: players.map((p) => ({ id: p.id, name: p.name, gender: p.gender })),
      roundPlayers,
      scores,
      pars,
    });
  }, [sortedRounds, players, roundPlayers, scores, pars]);

  /* ---------- render (trimmed to essentials) ---------- */

  if (!tourId || !isLikelyUuid(tourId)) {
    return <div>Invalid tour</div>;
  }

  return (
    <div className="min-h-dvh bg-white pb-24">
      {/* 🔍 score fetch debug */}
      <div className="mx-auto max-w-md px-4 pt-3">
        <div className="rounded-lg border bg-gray-50 p-2 text-[11px] text-gray-800">
          <div className="font-semibold">Score fetch (per round)</div>
          {scoreFetchLog.length === 0 ? <div>(none)</div> : scoreFetchLog.map((l) => <div key={l}>{l}</div>)}
          <div className="mt-1 font-semibold">TOTAL rows: {scores.length}</div>
        </div>
      </div>

      <MobileNav />
    </div>
  );
}
