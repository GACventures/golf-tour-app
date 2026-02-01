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
  BUILD_TOUR_CTX_VERSION,
} from "@/lib/competitions/buildTourCompetitionContext";

import { computeH2ZForPlayer, type H2ZLeg, buildH2ZDiagnostic } from "@/lib/competitions/h2z";

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

function fmt2(x: number) {
  if (!Number.isFinite(x)) return "0.00";
  return x.toFixed(2);
}

function fmtPct0(x: number) {
  if (!Number.isFinite(x)) return "0%";
  return `${x.toFixed(0)}%`;
}

function rankWithTies(entries: Array<{ id: string; value: number }>, lowerIsBetter: boolean) {
  const sorted = [...entries].sort((a, b) => {
    const av = Number.isFinite(a.value) ? a.value : 0;
    const bv = Number.isFinite(b.value) ? b.value : 0;
    if (av === bv) return a.id.localeCompare(b.id);
    return lowerIsBetter ? av - bv : bv - av;
  });

  const rankById = new Map<string, number>();
  let currentRank = 0;
  let lastValue: number | null = null;
  let seen = 0;

  for (const e of sorted) {
    seen += 1;
    const v = Number.isFinite(e.value) ? e.value : 0;

    if (lastValue === null || v !== lastValue) {
      currentRank = seen;
      lastValue = v;
    }
    rankById.set(e.id, currentRank);
  }

  return rankById;
}

type FixedCompKey =
  | "napoleon"
  | "bigGeorge"
  | "grandCanyon"
  | "wizard"
  | "bagelMan"
  | "eclectic"
  | "schumacher"
  | "closer"
  | "hotStreak"
  | "coldStreak";

type FixedCompMeta = {
  key: FixedCompKey;
  label: string;
  competitionId: string;
  lowerIsBetter?: boolean;
  format: (v: number) => string;
  detailFromStatsKey?: string;
  tappable?: boolean;
};

type MatrixCell = {
  value: number | null;
  rank: number | null;
  detail?: string | null;
};

type H2ZCell = {
  final: number | null;
  rank: number | null;
  best: number | null;
  bestLen: number | null;
};

function h2zHeading(leg: H2ZLeg) {
  return `H2Z: R${leg.start_round_no}–R${leg.end_round_no}`;
}

type ScoreAuditRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean | null;
};

type ScoreAuditState = {
  status: "idle" | "loading" | "ready" | "error";
  info: string[];
};

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

  const [h2zLegs, setH2zLegs] = useState<H2ZLegRow[]>([];

  const [openDetail, setOpenDetail] = useState<
    | { kind: "fixed"; playerId: string; key: FixedCompKey }
    | { kind: "h2z"; playerId: string; legNo: number }
    | null
  >(null);

  const [diag, setDiag] = useState<{ playerId: string; legNo: number } | null>(null);
  const [scoreAudit, setScoreAudit] = useState<ScoreAuditState>({ status: "idle", info: [] });

  const fixedComps: FixedCompMeta[] = useMemo(
    () => [
      { key: "napoleon", label: "Napoleon", competitionId: "tour_napoleon_par3_avg", format: (v) => fmt2(v) },
      { key: "bigGeorge", label: "Big George", competitionId: "tour_big_george_par4_avg", format: (v) => fmt2(v) },
      { key: "grandCanyon", label: "Grand Canyon", competitionId: "tour_grand_canyon_par5_avg", format: (v) => fmt2(v) },
      { key: "wizard", label: "Wizard", competitionId: "tour_wizard_four_plus_pct", format: (v) => fmtPct0(v) },
      { key: "bagelMan", label: "Bagel Man", competitionId: "tour_bagel_man_zero_pct", lowerIsBetter: true, format: (v) => fmtPct0(v) },
      { key: "eclectic", label: "Eclectic", competitionId: "tour_eclectic_total", format: (v) => String(Math.round(Number.isFinite(v) ? v : 0)) },
      { key: "schumacher", label: "Schumacher", competitionId: "tour_schumacher_first3_avg", format: (v) => fmt2(v) },
      { key: "closer", label: "Closer", competitionId: "tour_closer_last3_avg", format: (v) => fmt2(v) },
      { key: "hotStreak", label: "Hot Streak", competitionId: "tour_hot_streak_best_run", format: (v) => String(Math.round(Number.isFinite(v) ? v : 0)), tappable: true, detailFromStatsKey: "streak_where" },
      { key: "coldStreak", label: "Cold Streak", competitionId: "tour_cold_streak_best_run", lowerIsBetter: true, format: (v) => String(Math.round(Number.isFinite(v) ? v : 0)), tappable: true, detailFromStatsKey: "streak_where" },
    ],
    []
  );

  const definitions = useMemo(
    () => [
      { label: "Napoleon", text: "Average Stableford points on Par 3 holes" },
      { label: "Big George", text: "Average Stableford points on Par 4 holes" },
      { label: "Grand Canyon", text: "Average Stableford points on Par 5 holes" },
      { label: "Wizard", text: "Percentage of holes where Stableford points are 4+" },
      { label: "Bagel Man", text: "Percentage of holes where Stableford points are 0" },
      { label: "Eclectic", text: "Total of each player’s best Stableford points per hole" },
      { label: "Schumacher", text: "Average Stableford points on holes 1–3" },
      { label: "Closer", text: "Average Stableford points on holes 16–18" },
      { label: "Hot Streak", text: "Longest run in any round of consecutive holes where gross strokes is par or better" },
      { label: "Cold Streak", text: "Longest run in any round of consecutive holes where gross strokes is bogey or worse" },
      { label: "H2Z", text: "Cumulative Stableford score on Par 3 holes, but reset to zero whenever zero points scored on a hole" },
    ],
    []
  );

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
          .select("id,tour_id,name,round_no,created_at,course_id")
          .eq("tour_id", tourId)
          .order("round_no", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true });
        if (rErr) throw rErr;
        const rr = (rData ?? []) as RoundRow[];
        if (!alive) return;
        setRounds(rr);

        const { data: tpData, error: tpErr } = await supabase
          .from("tour_players")
          .select("tour_id,player_id,starting_handicap,players(id,name,gender)")
          .eq("tour_id", tourId)
          .order("name", { ascending: true, foreignTable: "players" });
        if (tpErr) throw tpErr;

        const ps: PlayerRow[] = (tpData ?? [])
          .map((row: any) => row.players)
          .filter(Boolean)
          .map((p: any) => ({ id: String(p.id), name: safeName(p.name, "(unnamed)"), gender: p.gender ? normalizeTee(p.gender) : null }));

        if (!alive) return;
        setPlayers(ps);

        const roundIds = rr.map((r) => r.id);
        const playerIds = ps.map((p) => p.id);

        if (roundIds.length > 0 && playerIds.length > 0) {
          const { data: rpData, error: rpErr } = await supabase
            .from("round_players")
            .select("round_id,player_id,playing,playing_handicap")
            .in("round_id", roundIds)
            .in("player_id", playerIds);
          if (rpErr) throw rpErr;

          setRoundPlayers(
            (rpData ?? []).map((x: any) => ({
              round_id: String(x.round_id),
              player_id: String(x.player_id),
              playing: x.playing === true,
              playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
            }))
          );
        } else {
          setRoundPlayers([]);
        }

        if (roundIds.length > 0 && playerIds.length > 0) {
          const { data: sData, error: sErr } = await supabase
            .from("scores")
            .select("round_id,player_id,hole_number,strokes,pickup")
            .in("round_id", roundIds)
            .in("player_id", playerIds);
          if (sErr) throw sErr;
          if (!alive) return;
          setScores((sData ?? []) as ScoreRow[]);
        } else {
          setScores([]);
        }

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

          setPars(
            (pData ?? []).map((x: any) => ({
              course_id: String(x.course_id),
              hole_number: Number(x.hole_number),
              tee: normalizeTee(x.tee),
              par: Number(x.par),
              stroke_index: Number(x.stroke_index),
            }))
          );
        } else {
          setPars([]);
        }

        const { data: lData, error: lErr } = await supabase
          .from("tour_h2z_legs")
          .select("tour_id,leg_no,start_round_no,end_round_no")
          .eq("tour_id", tourId)
          .order("leg_no", { ascending: true });
        if (lErr) throw lErr;
        if (!alive) return;
        setH2zLegs((lData ?? []) as H2ZLegRow[]);
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

  const sortedRounds = useMemo(() => {
    const arr = [...rounds];
    arr.sort((a, b) => {
      const an = a.round_no ?? 999999;
      const bn = b.round_no ?? 999999;
      if (an !== bn) return an - bn;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });
    return arr;
  }, [rounds]);

  const ctx = useMemo(() => {
    const roundsLite: TourRoundLite[] = sortedRounds.map((r) => ({ id: r.id, name: r.name, course_id: r.course_id }));

    const playersLite: PlayerLiteForTour[] = players.map((p) => ({ id: p.id, name: p.name, gender: p.gender ? normalizeTee(p.gender) : null }));

    const rpLite: RoundPlayerLiteForTour[] = roundPlayers.map((rp) => ({
      round_id: rp.round_id,
      player_id: rp.player_id,
      playing: rp.playing === true,
      playing_handicap: Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : null,
    }));

    const scoresLite: ScoreLiteForTour[] = scores.map((s) => ({
      round_id: s.round_id,
      player_id: s.player_id,
      hole_number: Number(s.hole_number),
      strokes: s.strokes === null || s.strokes === undefined ? null : Number(s.strokes),
      pickup: s.pickup === true,
    }));

    const parsLite: ParLiteForTour[] = pars.map((p) => ({
      course_id: p.course_id,
      hole_number: Number(p.hole_number),
      tee: normalizeTee(p.tee),
      par: Number(p.par),
      stroke_index: Number(p.stroke_index),
    }));

    return buildTourCompetitionContext({ rounds: roundsLite, players: playersLite, roundPlayers: rpLite, scores: scoresLite, pars: parsLite });
  }, [sortedRounds, players, roundPlayers, scores, pars]);

  const compMatrix = useMemo(() => {
    const out: Record<string, Record<FixedCompKey, MatrixCell>> = {};
    for (const p of players) {
      out[p.id] = {
        napoleon: { value: null, rank: null },
        bigGeorge: { value: null, rank: null },
        grandCanyon: { value: null, rank: null },
        wizard: { value: null, rank: null },
        bagelMan: { value: null, rank: null },
        eclectic: { value: null, rank: null },
        schumacher: { value: null, rank: null },
        closer: { value: null, rank: null },
        hotStreak: { value: null, rank: null, detail: null },
        coldStreak: { value: null, rank: null, detail: null },
      };
    }

    for (const meta of fixedComps) {
      const def = (competitionCatalog as CompetitionDefinition[]).find((c) => c.id === meta.competitionId);
      if (!def) continue;

      const result = runCompetition(def, ctx as unknown as CompetitionContext);
      const rows = (result?.rows ?? []).filter((r: any) => !!r?.entryId);

      const entries: Array<{ id: string; value: number }> = [];

      for (const r of rows as any[]) {
        const pid = String(r.entryId);
        const v = Number(r.total);
        if (!Number.isFinite(v)) continue;

        entries.push({ id: pid, value: v });

        if (out[pid]) {
          out[pid][meta.key].value = v;

          if (meta.detailFromStatsKey) {
            const detail = String((r as any)?.stats?.[meta.detailFromStatsKey] ?? "").trim();
            out[pid][meta.key].detail = detail || null;
          }
        }
      }

      const rankById = rankWithTies(entries, !!meta.lowerIsBetter);
      for (const pid of Object.keys(out)) {
        const rk = rankById.get(pid);
        out[pid][meta.key].rank = typeof rk === "number" ? rk : null;
      }
    }

    return out;
  }, [players, fixedComps, ctx]);

  const h2zLegsNorm: H2ZLeg[] = useMemo(() => {
    return (h2zLegs ?? [])
      .map((l) => ({ leg_no: Number(l.leg_no), start_round_no: Number(l.start_round_no), end_round_no: Number(l.end_round_no) }))
      .filter((l) => Number.isFinite(l.leg_no) && Number.isFinite(l.start_round_no) && Number.isFinite(l.end_round_no))
      .filter((l) => l.leg_no >= 1 && l.end_round_no >= l.start_round_no)
      .sort((a, b) => a.leg_no - b.leg_no);
  }, [h2zLegs]);

  const h2zMatrix = useMemo(() => {
    const playingSet = new Set<string>();
    for (const rp of roundPlayers) if (rp.playing === true) playingSet.add(`${rp.round_id}|${rp.player_id}`);
    const isPlayingInRound = (roundId: string, playerId: string) => playingSet.has(`${roundId}|${playerId}`);

    const roundsInOrder = sortedRounds.map((r) => ({ roundId: r.id, round_no: r.round_no }));

    const perPlayer: Record<string, Record<number, H2ZCell>> = {};
    for (const p of players) perPlayer[p.id] = {};

    for (const p of players) {
      const res = computeH2ZForPlayer({ ctx: ctx as any, legs: h2zLegsNorm, roundsInOrder, isPlayingInRound, playerId: p.id });

      for (const leg of h2zLegsNorm) {
        const r = res[leg.leg_no];
        perPlayer[p.id][leg.leg_no] = { final: r ? r.finalScore : null, rank: null, best: r ? r.bestScore : null, bestLen: r ? r.bestLen : null };
      }
    }

    for (const leg of h2zLegsNorm) {
      const entries = players.map((p) => ({ id: p.id, value: Number(perPlayer[p.id]?.[leg.leg_no]?.final ?? 0) }));
      const rankById = rankWithTies(entries, false);
      for (const p of players) {
        const rk = rankById.get(p.id);
        if (perPlayer[p.id]?.[leg.leg_no]) perPlayer[p.id][leg.leg_no].rank = typeof rk === "number" ? rk : null;
      }
    }

    return perPlayer;
  }, [players, sortedRounds, roundPlayers, ctx, h2zLegsNorm]);

  const diagLines = useMemo(() => {
    if (!diag) return null;

    const playingSet = new Set<string>();
    for (const rp of roundPlayers) if (rp.playing === true) playingSet.add(`${rp.round_id}|${rp.player_id}`);
    const isPlayingInRound = (roundId: string, playerId: string) => playingSet.has(`${roundId}|${playerId}`);

    const leg = h2zLegsNorm.find((l) => l.leg_no === diag.legNo);
    if (!leg) return ["Diagnostic: leg not found"];

    const roundsInOrder = sortedRounds.map((r) => ({ roundId: r.id, round_no: r.round_no }));

    return buildH2ZDiagnostic({
      ctx: ctx as any,
      roundsInOrder,
      isPlayingInRound,
      playerId: diag.playerId,
      start_round_no: leg.start_round_no,
      end_round_no: leg.end_round_no,
    });
  }, [diag, roundPlayers, sortedRounds, h2zLegsNorm, ctx]);

  // Unfiltered DB audit (as before)
  useEffect(() => {
    if (!diag) {
      setScoreAudit({ status: "idle", info: [] });
      return;
    }
    const diagSnap = diag;

    let alive = true;

    async function runAudit() {
      const leg = h2zLegsNorm.find((l) => l.leg_no === diagSnap.legNo);
      if (!leg) {
        setScoreAudit({ status: "error", info: ["scoreAudit: leg not found"] });
        return;
      }

      const includedRounds = sortedRounds
        .filter((r) => Number.isFinite(Number(r.round_no)) && Number(r.round_no) >= leg.start_round_no && Number(r.round_no) <= leg.end_round_no)
        .map((r) => ({ round_no: r.round_no ?? null, round_id: r.id }));

      const includedRoundIds = includedRounds.map((r) => r.round_id);
      const tourPlayerIds = new Set(players.map((p) => String(p.id)));

      const infoStart: string[] = [];
      infoStart.push("Score Audit (UNFILTERED by player_id)");
      infoStart.push(`leg=R${leg.start_round_no}..R${leg.end_round_no} (legNo=${leg.leg_no})`);
      infoStart.push(`diagPlayerId=${diagSnap.playerId}`);
      infoStart.push(`includedRounds=${includedRounds.map((r) => `R${r.round_no ?? "?"}:${r.round_id}`).join(" | ") || "(none)"}`);
      infoStart.push(`tourPlayers=${players.length}`);

      setScoreAudit({ status: "loading", info: infoStart });

      if (includedRoundIds.length === 0) {
        setScoreAudit({ status: "ready", info: [...infoStart, "No included rounds => nothing to audit (check round_no values)."] });
        return;
      }

      try {
        const { data, error } = await supabase.from("scores").select("round_id,player_id,hole_number,strokes,pickup").in("round_id", includedRoundIds).limit(5000);
        if (error) throw error;

        const rows = (data ?? []) as ScoreAuditRow[];

        const distinctScorePlayerIds = Array.from(new Set(rows.map((r) => String(r.player_id))));
        const scorePlayerIdsNotInTour = distinctScorePlayerIds.filter((pid) => !tourPlayerIds.has(pid));
        const scorePlayerIdsInTour = distinctScorePlayerIds.filter((pid) => tourPlayerIds.has(pid));
        const tourPlayersMissingFromScores = players.map((p) => String(p.id)).filter((pid) => !distinctScorePlayerIds.includes(pid));

        const byRoundForDiag = includedRounds.map((r) => {
          const count = rows.filter((x) => String(x.round_id) === String(r.round_id) && String(x.player_id) === String(diagSnap.playerId)).length;
          return { round_no: r.round_no, round_id: r.round_id, count };
        });

        const diagRows = rows
          .filter((x) => String(x.player_id) === String(diagSnap.playerId))
          .map((x) => ({ round_id: String(x.round_id), hole_number: Number(x.hole_number), strokes: x.strokes, pickup: x.pickup === true }))
          .sort((a, b) => a.hole_number - b.hole_number);

        const diagHoleNums = diagRows.map((x) => x.hole_number);

        const info: string[] = [];
        info.push(...infoStart);
        info.push(`unfilteredRows=${rows.length}`);
        info.push(`distinctScorePlayerIds=${distinctScorePlayerIds.length}`);
        info.push(`scorePlayerIdsInTour=${scorePlayerIdsInTour.length}`);
        info.push(`scorePlayerIdsNotInTour=${scorePlayerIdsNotInTour.length}`);
        info.push(`tourPlayersMissingFromScores=${tourPlayersMissingFromScores.length}`);
        info.push("diagPlayer rows per included round:");
        for (const rr of byRoundForDiag) info.push(`- R${rr.round_no ?? "?"}: ${rr.count} rows (roundId=${rr.round_id})`);

        info.push(`diagPlayer totalRowsInTheseRounds=${diagRows.length}`);
        if (diagRows.length) {
          const minH = Math.min(...diagHoleNums);
          const maxH = Math.max(...diagHoleNums);
          const anyPickup = diagRows.some((x) => x.pickup);
          info.push(`diagPlayer holeNoMin=${minH} holeNoMax=${maxH} anyPickup=${anyPickup ? "yes" : "no"}`);
          info.push(`diagPlayer holes(first 18)=${diagHoleNums.slice(0, 18).join(",")}`);
          info.push(
            `diagPlayer sample(first 10)=${diagRows
              .slice(0, 10)
              .map((x) => `H${x.hole_number} strokes=${x.strokes ?? "null"} pickup=${x.pickup ? "true" : "false"}`)
              .join(" | ")}`
          );
        } else {
          info.push("diagPlayer has 0 rows in DB for these roundId(s).");
        }

        if (!alive) return;
        setScoreAudit({ status: "ready", info });
      } catch (e: any) {
        if (!alive) return;
        setScoreAudit({ status: "error", info: [...infoStart, "Audit failed:", e?.message ?? String(e)] });
      }
    }

    void runAudit();

    return () => {
      alive = false;
    };
  }, [diag, h2zLegsNorm, sortedRounds, players]);

  function toggleFixedDetail(playerId: string, key: FixedCompKey) {
    setOpenDetail((prev) => {
      if (prev?.kind === "fixed" && prev.playerId === playerId && prev.key === key) return null;
      return { kind: "fixed", playerId, key };
    });
  }

  function toggleH2ZDetail(playerId: string, legNo: number) {
    setOpenDetail((prev) => {
      if (prev?.kind === "h2z" && prev.playerId === playerId && prev.legNo === legNo) return null;
      return { kind: "h2z", playerId, legNo };
    });
  }

  function toggleDiag(playerId: string, legNo: number) {
    setDiag((prev) => {
      if (prev?.playerId === playerId && prev?.legNo === legNo) return null;
      return { playerId, legNo };
    });
  }

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

  const thBase = "border-b border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700";
  const tdBase = "px-3 py-2 text-right text-sm text-gray-900 align-top";

  const boxBase = "inline-flex min-w-[92px] justify-end rounded-md px-2 py-1";
  const medalClass = (rank: number | null) =>
    rank === 1
      ? "border border-yellow-500 bg-yellow-300 text-gray-900"
      : rank === 2
      ? "border border-gray-400 bg-gray-200 text-gray-900"
      : rank === 3
      ? "border border-amber-700 bg-amber-400 text-gray-900"
      : "bg-transparent";

  const medalHover = (rank: number | null) => (rank === 1 || rank === 2 || rank === 3 ? "hover:brightness-95" : "hover:bg-gray-50");
  const press = "active:bg-gray-100";

  // ✅ NEW: runtime proof of ctx file + score sample
  const ctxAny = ctx as any;
  const runtimeCtxVersion = String(ctxAny?.__ctxVersion ?? "(none)");
  const diagPlayerId = diag?.playerId ?? "";
  const round0 = ctxAny?.rounds?.[0];
  const scoreSample = diagPlayerId && round0?.scores?.[diagPlayerId] ? (round0.scores[diagPlayerId] as string[]).slice(0, 5).join(",") : "(no sample)";

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      <div className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">Competitions</div>
          {tour?.name ? <div className="text-xs text-gray-600">{tour.name}</div> : null}
        </div>
      </div>

      {/* Debug banner */}
      <div className="mx-auto w-full max-w-md px-4 pt-3">
        <div className="rounded-2xl border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <div className="font-semibold">Debug Banner: H2Z-CTX-STAMP-v1</div>
          <div>buildTourCompetitionContext export={BUILD_TOUR_CTX_VERSION}</div>
          <div>ctx.__ctxVersion(runtime)={runtimeCtxVersion}</div>
          <div>ctx score sample (round1, diag player, holes 1..5)={scoreSample}</div>

          <div className="mt-1">
            diag={diag ? `playerId=${diag.playerId} legNo=${diag.legNo}` : "null"} | diagLines={diagLines ? `len=${diagLines.length}` : "null"}
          </div>

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded-lg border bg-white px-2 py-1 text-[12px] hover:bg-gray-50"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (players.length === 0 || h2zLegsNorm.length === 0) return;
                setDiag({ playerId: players[0].id, legNo: h2zLegsNorm[0].leg_no });
              }}
            >
              Force diagnostic (P1/L1)
            </button>

            <button
              type="button"
              className="rounded-lg border bg-white px-2 py-1 text-[12px] hover:bg-gray-50"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDiag(null);
              }}
            >
              Clear diagnostic
            </button>
          </div>

          {diag ? (
            <div className="mt-2 space-y-2">
              <div className="rounded-lg border border-amber-200 bg-white px-2 py-2">
                <div className="text-[11px] font-semibold text-gray-700">H2Z Diagnostic output</div>
                <pre className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-gray-900">
                  {(diagLines ?? ["(diagLines is null)"]).join("\n")}
                </pre>
              </div>

              <div className="rounded-lg border border-amber-200 bg-white px-2 py-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold text-gray-700">UNFILTERED DB score audit</div>
                  <div className="text-[11px] text-gray-500">status={scoreAudit.status}</div>
                </div>
                <pre className="mt-1 whitespace-pre-wrap text-[11px] leading-snug text-gray-900">
                  {(scoreAudit.info.length ? scoreAudit.info : ["(no audit info)"]).join("\n")}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* The rest of your existing UI (table + definitions) stays exactly as you provided */}
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
        ) : sortedRounds.length === 0 ? (
          <div className="rounded-2xl border p-4 text-sm text-gray-700">No rounds found for this tour.</div>
        ) : (
          <>
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm max-h-[70vh] overflow-auto">
              <table className="min-w-full border-collapse table-fixed">
                <thead>
                  <tr className="bg-gray-50">
                    <th className={`sticky left-0 top-0 z-50 bg-gray-50 border-r border-gray-200 ${thBase} text-left`} style={{ width: 140, minWidth: 140 }}>
                      Player
                    </th>

                    {fixedComps.map((c) => (
                      <th key={c.key} className={`sticky top-0 z-40 bg-gray-50 ${thBase} text-right`}>
                        {c.label}
                      </th>
                    ))}

                    {h2zLegsNorm.map((leg) => (
                      <th key={`h2z-${leg.leg_no}`} className={`sticky top-0 z-40 bg-gray-50 ${thBase} text-right`}>
                        {h2zHeading(leg)}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {players.map((p) => {
                    const row = compMatrix[p.id] ?? ({} as any);

                    return (
                      <tr key={p.id} className="border-b last:border-b-0">
                        <td className="sticky left-0 z-30 bg-white border-r border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap" style={{ width: 140, minWidth: 140 }}>
                          {p.name}
                        </td>

                        {fixedComps.map((c) => {
                          const cell = row?.[c.key] as MatrixCell | undefined;
                          const value = cell?.value ?? null;
                          const rank = cell?.rank ?? null;

                          const tappable = c.tappable === true;
                          const isOpen = openDetail?.kind === "fixed" && openDetail.playerId === p.id && openDetail.key === c.key;
                          const detail = (cell?.detail ?? "").trim();

                          const show =
                            value === null ? (
                              <span className="text-gray-400">—</span>
                            ) : (
                              <>
                                {c.format(value)} <span className="text-gray-500">&nbsp;({rank ?? 0})</span>
                              </>
                            );

                          if (c.key === "eclectic") {
                            return (
                              <td key={c.key} className={tdBase}>
                                {value === null ? (
                                  <span className="text-gray-400">—</span>
                                ) : (
                                  <Link href={`/m/tours/${tourId}/competitions/eclectic/${p.id}`} className={`${boxBase} ${medalClass(rank)} ${medalHover(rank)} ${press}`} aria-label="Open Eclectic breakdown">
                                    {show}
                                  </Link>
                                )}
                              </td>
                            );
                          }

                          return (
                            <td key={c.key} className={tdBase}>
                              <div className="inline-flex flex-col items-end gap-1">
                                {value === null ? (
                                  <span className="text-gray-400">—</span>
                                ) : tappable ? (
                                  <button type="button" className={`${boxBase} ${medalClass(rank)} ${medalHover(rank)} ${press}`} onClick={() => toggleFixedDetail(p.id, c.key)} aria-label={`${c.label} detail`}>
                                    {show}
                                  </button>
                                ) : (
                                  <span className={`${boxBase} ${medalClass(rank)}`}>{show}</span>
                                )}

                                {tappable && isOpen ? (
                                  <div className="max-w-[160px] whitespace-normal break-words rounded-lg border bg-gray-50 px-2 py-1 text-[11px] text-gray-700 shadow-sm text-left">
                                    {detail ? detail : <span className="text-gray-400">No streak found</span>}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          );
                        })}

                        {h2zLegsNorm.map((leg) => {
                          const cell = h2zMatrix?.[p.id]?.[leg.leg_no];
                          const final = cell?.final ?? null;
                          const rank = cell?.rank ?? null;

                          const isOpen = openDetail?.kind === "h2z" && openDetail.playerId === p.id && openDetail.legNo === leg.leg_no;
                          const best = cell?.best ?? null;
                          const bestLen = cell?.bestLen ?? null;

                          const show =
                            final === null ? (
                              <span className="text-gray-400">—</span>
                            ) : (
                              <>
                                {final} <span className="text-gray-500">&nbsp;({rank ?? 0})</span>
                              </>
                            );

                          return (
                            <td key={`h2z-${leg.leg_no}`} className={tdBase}>
                              <div className="inline-flex flex-col items-end gap-1">
                                {final === null ? (
                                  <span className="text-gray-400">—</span>
                                ) : (
                                  <button type="button" className={`${boxBase} ${medalClass(rank)} ${medalHover(rank)} ${press}`} onClick={() => toggleH2ZDetail(p.id, leg.leg_no)} aria-label={`H2Z detail leg ${leg.leg_no}`}>
                                    {show}
                                  </button>
                                )}

                                {final !== null && isOpen ? (
                                  <div className="max-w-[180px] whitespace-normal break-words rounded-lg border bg-gray-50 px-2 py-1 text-[11px] text-gray-700 shadow-sm text-left">
                                    <div>
                                      Peak: <span className="font-semibold">{best ?? 0}</span> <span className="text-gray-500">({bestLen ?? 0})</span>
                                    </div>
                                    <button type="button" className="mt-1 text-[11px] underline text-gray-700" onClick={() => toggleDiag(p.id, leg.leg_no)}>
                                      {diag?.playerId === p.id && diag?.legNo === leg.leg_no ? "Hide diagnostic" : "Show diagnostic"}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="border-t bg-gray-50 px-3 py-2 text-xs text-gray-600">
                Ranks use “equal ranks” for ties (1, 1, 3). Bagel Man ranks lower % as better. Cold Streak ranks lower as better. Tap Hot/Cold cells for the round+hole range. Tap Eclectic to see the breakdown. Tap H2Z to see peak score and (holes count). Use “Show diagnostic” to trace one player’s Par 3 H2Z.
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-700">Definitions</div>
              <div className="px-4 py-3">
                <ul className="space-y-2 text-sm text-gray-800">
                  {definitions.map((d) => (
                    <li key={d.label} className="leading-snug">
                      <span className="font-semibold text-gray-900">{d.label}</span> <span className="text-gray-600">—</span>{" "}
                      <span className="text-gray-800">{d.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
