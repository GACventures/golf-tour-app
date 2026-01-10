"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

import { runCompetition } from "@/lib/competitions/engine";
import { competitionCatalog } from "@/lib/competitions/catalog";
import type { CompetitionContext } from "@/lib/competitions/types";

import { resolveEntities, type LeaderboardEntity } from "@/lib/competitions/entities/resolveEntities";

/**
 * Local tour-round context shape used by this page.
 */
type TourRoundContextLocal = {
  roundId: string;
  roundName: string;
  holes: number[];
  parsByHole: number[];
  strokeIndexByHole: number[];
  scores: Record<string, string[]>; // playerId -> 18 raw scores
  netPointsForHole: (playerId: string, holeIndex: number) => number;
  isComplete: (playerId: string) => boolean;
};

/**
 * Local tour competition context shape used by this page.
 */
type TourCompetitionContextLocal = {
  scope: "tour";
  players: Array<{
    id: string;
    name: string;
    playing: boolean;
    playing_handicap: number;
  }>;
  rounds: TourRoundContextLocal[];
  entities?: Array<{ entityId: string; label: string; memberPlayerIds: string[] }>;
  entityMembersById?: Record<string, string[]>;
  entityLabelsById?: Record<string, string>;
  team_best_m?: number;
};

type UiCompRow = {
  entryId: string;
  label: string;
  total: number;
  stats?: Record<string, any>;
};

type Tour = { id: string; name: string };

type Round = {
  id: string;
  tour_id: string;
  name?: string | null;
  round_no?: number | null;
  course_id: string | null;
  created_at: string | null;
};

// ✅ Global player library row (we will display “players in this tour” via tour_players join)
type Player = { id: string; name: string; start_handicap?: number | null };

// Join result row for tour_players
type TourPlayerRow = {
  tour_id: string;
  player_id: string;
  starting_handicap: number | null;
  players: { id: string; name: string; start_handicap: number | null } | null;
};

type ParRow = { course_id: string; hole_number: number; par: number; stroke_index: number };

type RoundPlayer = {
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

type LeaderRow = {
  playerId: string;
  playerName: string;
  perRound: Record<string, number | null>;
  total: number;
};

type EntityLeaderRow = {
  entityId: string;
  label: string;
  membersLabel: string;
  perRound: Record<string, number | null>;
  total: number;
};

function round2(n: number) {
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function isPercentStatKey(k: string) {
  return k.endsWith("_pct") || k.endsWith("_percent");
}

function formatStatValue(key: string, val: number | string) {
  if (typeof val === "number") {
    if (isPercentStatKey(key)) return `${round2(val)}%`;
    if (key.includes("avg") || key.includes("average")) return round2(val).toFixed(2);
    if (Number.isInteger(val)) return String(val);
    return round2(val).toFixed(2);
  }
  return String(val);
}

function titleCaseKey(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/\bPct\b/i, "%");
}

function sumBestN(values: Array<number | null | undefined>, n: number): number {
  const k = Math.max(0, Math.floor(n));
  if (k === 0) return 0;
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  nums.sort((a, b) => b - a);
  return nums.slice(0, k).reduce((s, v) => s + v, 0);
}

function bestNWithOptionalFinal(opts: {
  perRoundById: Record<string, number | null>;
  roundIdsInOrder: string[];
  n: number;
  mustIncludeFinal: boolean;
}): number {
  const n = Math.max(1, Math.floor(opts.n || 1));
  const ids = opts.roundIdsInOrder;
  const finalId = ids.length ? ids[ids.length - 1] : null;
  if (!finalId) return 0;

  const per = opts.perRoundById;

  if (!opts.mustIncludeFinal) {
    return sumBestN(ids.map((id) => per[id]), n);
  }

  const rest = Math.max(0, n - 1);
  const finalVal = per[finalId];
  const others = ids.filter((id) => id !== finalId).map((id) => per[id]);

  // If final not played, use best N−1
  if (finalVal === null) return sumBestN(others, rest);

  return finalVal + sumBestN(others, rest);
}

function fmtTs(ts?: string | null) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString();
}

function rawScoreFor(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  return String(strokes);
}

export default function TourLeaderboardPage() {
  const params = useParams<{ id: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>("");

  const [tourName, setTourName] = useState<string>("");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayer[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);

  const [excludeIncomplete, setExcludeIncomplete] = useState(true);

  // Individual best N rounds
  const [useBestN, setUseBestN] = useState(false);
  const [bestN, setBestN] = useState(3);
  const [bestNMustIncludeFinal, setBestNMustIncludeFinal] = useState(false);

  // Pair best N rounds
  const [useBestNForPairs, setUseBestNForPairs] = useState(false);
  const [bestNPairs, setBestNPairs] = useState(3);
  const [bestNPairsMustIncludeFinal, setBestNPairsMustIncludeFinal] = useState(false);

  // Team setting: M
  const [teamBestM, setTeamBestM] = useState<number>(2);
  const [savingTeamBestM, setSavingTeamBestM] = useState(false);
  const [teamBestMMsg, setTeamBestMMsg] = useState<string>("");

  // Competition selection + diagnostics
  const tourCompetitions = useMemo(() => {
    const list = (competitionCatalog ?? []).filter((c: any) => c?.scope === "tour");
    return list;
  }, []);

  const [selectedCompId, setSelectedCompId] = useState<string>(() => {
    const first = (competitionCatalog ?? []).find((c: any) => c?.scope === "tour");
    return first?.id ?? "tour_napoleon_par3_avg";
  });

  const [entities, setEntities] = useState<LeaderboardEntity[]>([]);
  const [entityMembersById, setEntityMembersById] = useState<Record<string, string[]>>({});
  const [entityLabelsById, setEntityLabelsById] = useState<Record<string, string>>({});
  const [entitiesError, setEntitiesError] = useState<string>("");

  const [competitionError, setCompetitionError] = useState<string>("");

  // ---------- LOAD ----------
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError("");

      try {
        // Tour
        const { data: tour, error: tourErr } = await supabase.from("tours").select("id,name").eq("id", tourId).single();

        if (cancelled) return;
        if (tourErr) throw tourErr;
        setTourName(String((tour as Tour).name ?? ""));

        // team settings (M) - optional
        {
          const { data: sData, error: sErr } = await supabase
            .from("tour_grouping_settings")
            .select("default_team_best_m")
            .eq("tour_id", tourId)
            .maybeSingle();

          if (!cancelled && !sErr) {
            const m = Number((sData as any)?.default_team_best_m);
            if (Number.isFinite(m) && m >= 1 && m <= 10) setTeamBestM(m);
          }
        }

        // Rounds
        const { data: roundData, error: roundsErr } = await supabase
          .from("rounds")
          .select("id,tour_id,name,round_no,course_id,created_at")
          .eq("tour_id", tourId)
          .order("round_no", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true });

        if (cancelled) return;
        if (roundsErr) throw roundsErr;

        const roundList = (roundData ?? []) as Round[];
        setRounds(roundList);

        // ✅ Players in THIS TOUR via tour_players join
        const { data: tpData, error: tpErr } = await supabase
          .from("tour_players")
          .select("tour_id,player_id,starting_handicap, players(id,name,start_handicap)")
          .eq("tour_id", tourId)
          .order("name", { ascending: true, foreignTable: "players" });

        if (cancelled) return;
        if (tpErr) throw tpErr;

        const playersInTour: Player[] = (tpData ?? [])
          .map((r: any) => ({
            id: String(r.players?.id ?? r.player_id),
            name: String(r.players?.name ?? "(missing name)"),
            // important: for fallback handicap usage we use TOUR starting handicap (not global)
            start_handicap: Number.isFinite(Number(r.starting_handicap)) ? Number(r.starting_handicap) : 0,
          }))
          .filter((p) => !!p.id);

        setPlayers(playersInTour);

        const roundIds = roundList.map((r) => r.id);
        const courseIds = Array.from(new Set(roundList.map((r) => r.course_id).filter(Boolean))) as string[];

        if (roundIds.length === 0) {
          setPars([]);
          setRoundPlayers([]);
          setScores([]);
          setLoading(false);
          return;
        }

        // Pars
        if (courseIds.length) {
          const { data: parsData, error: parsErr } = await supabase.from("pars").select("course_id,hole_number,par,stroke_index").in("course_id", courseIds);

          if (cancelled) return;
          if (parsErr) throw parsErr;
          setPars((parsData ?? []) as ParRow[]);
        } else {
          setPars([]);
        }

        // Round players (ALL rows for these rounds)
        const { data: rpData, error: rpErr } = await supabase
          .from("round_players")
          .select("round_id,player_id,playing,playing_handicap")
          .in("round_id", roundIds);

        if (cancelled) return;
        if (rpErr) throw rpErr;

        setRoundPlayers(
          (rpData ?? []).map((x: any) => ({
            round_id: String(x.round_id),
            player_id: String(x.player_id),
            playing: x.playing === true,
            playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
          }))
        );

        // Scores
        const { data: scoreData, error: scoreErr } = await supabase.from("scores").select("round_id,player_id,hole_number,strokes,pickup").in("round_id", roundIds);

        if (cancelled) return;
        if (scoreErr) throw scoreErr;

        setScores(
          (scoreData ?? []).map((s: any) => ({
            round_id: String(s.round_id),
            player_id: String(s.player_id),
            hole_number: Number(s.hole_number),
            strokes: s.strokes === null || s.strokes === undefined ? null : Number(s.strokes),
            pickup: s.pickup === true,
          }))
        );
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message ?? "Failed to load leaderboard.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (tourId) load();
    return () => {
      cancelled = true;
    };
  }, [tourId]);

  // ---------- SELECTED COMP DEF ----------
  const selectedDef = useMemo(() => {
    const list = (competitionCatalog ?? []).filter((c: any) => c?.scope === "tour");
    return list.find((c: any) => c.id === selectedCompId) ?? null;
  }, [selectedCompId]);

  // ---------- ENTITY RESOLUTION (PAIR/TEAM) ----------
  useEffect(() => {
    let cancelled = false;

    async function loadEntities() {
      setEntitiesError("");

      const kind = (selectedDef?.kind ?? "individual") as "individual" | "pair" | "team";
      if (kind === "individual") {
        setEntities([]);
        setEntityMembersById({});
        setEntityLabelsById({});
        return;
      }

      try {
        const res = await resolveEntities({ tourId, scope: "tour", kind });
        if (cancelled) return;

        const list = res.entities ?? [];
        setEntities(list);

        const membersById: Record<string, string[]> = {};
        const labelsById: Record<string, string> = {};
        for (const e of list) {
          membersById[e.entityId] = e.memberPlayerIds;
          labelsById[e.entityId] = e.name;
        }
        setEntityMembersById(membersById);
        setEntityLabelsById(labelsById);
      } catch (e: any) {
        if (!cancelled) {
          setEntities([]);
          setEntityMembersById({});
          setEntityLabelsById({});
          setEntitiesError(e?.message ?? "Failed to resolve pairs/teams.");
        }
      }
    }

    loadEntities();
    return () => {
      cancelled = true;
    };
  }, [tourId, selectedDef]);

  // ---------- DERIVED MAPS + COMPLETENESS ----------
  const derived = useMemo(() => {
    // course -> hole -> {par,si}
    const courseHole: Record<string, Record<number, { par: number; si: number }>> = {};
    for (const p of pars) {
      const cid = String(p.course_id);
      if (!courseHole[cid]) courseHole[cid] = {};
      courseHole[cid][Number(p.hole_number)] = { par: Number(p.par), si: Number(p.stroke_index) };
    }

    // round -> player -> { playing, hcp }
    const rpByRound: Record<string, Record<string, { playing: boolean; hcp: number }>> = {};
    for (const rp of roundPlayers) {
      const rid = String(rp.round_id);
      const pid = String(rp.player_id);
      if (!rpByRound[rid]) rpByRound[rid] = {};
      rpByRound[rid][pid] = {
        playing: rp.playing === true,
        hcp: Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0,
      };
    }

    // round -> player -> hole -> rawScore
    const scoreMap: Record<string, Record<string, Record<number, string>>> = {};
    for (const s of scores) {
      const rid = String(s.round_id);
      const pid = String(s.player_id);
      const hole = Number(s.hole_number);
      const raw = rawScoreFor(s.strokes, s.pickup).trim().toUpperCase();

      if (!scoreMap[rid]) scoreMap[rid] = {};
      if (!scoreMap[rid][pid]) scoreMap[rid][pid] = {};
      scoreMap[rid][pid][hole] = raw; // "P" or "12" or ""
    }

    // Determine "playing player ids" for a round:
    // 1) if round_players rows exist -> use those with playing=true
    // 2) else fallback to "anyone with any score rows"
    // 3) else fallback to "all tour players" (dev-friendly)
    const playingIdsForRound = (roundId: string): string[] => {
      const rp = rpByRound[roundId];
      if (rp && Object.keys(rp).length > 0) {
        const ids = Object.entries(rp)
          .filter(([, v]) => v.playing)
          .map(([pid]) => pid);
        if (ids.length > 0) return ids;
      }

      const byPlayer = scoreMap[roundId] ?? {};
      const fromScores = Object.keys(byPlayer);
      if (fromScores.length > 0) return fromScores;

      return players.map((p) => p.id);
    };

    // Completeness reason helper (for debugging UI)
    const completenessForRound = (round: Round) => {
      const rid = round.id;
      const ids = playingIdsForRound(rid);

      if (ids.length === 0) {
        return { complete: false, reason: "No playing players resolved for this round.", playingCount: 0, missing: 18 };
      }

      let missingCount = 0;
      for (const pid of ids) {
        for (let hole = 1; hole <= 18; hole++) {
          const raw = (scoreMap[rid]?.[pid]?.[hole] ?? "").trim();
          if (!raw) missingCount++;
        }
      }

      const complete = missingCount === 0;
      return {
        complete,
        reason: complete ? "" : `Missing ${missingCount} hole entries across ${ids.length} playing player(s).`,
        playingCount: ids.length,
        missing: missingCount,
      };
    };

    return { courseHole, rpByRound, scoreMap, playingIdsForRound, completenessForRound };
  }, [pars, roundPlayers, scores, players]);

  // Eligible rounds after excludeIncomplete
  const { eligibleRounds, roundHeaders, roundIdsInOrder } = useMemo(() => {
    const sorted = [...rounds].sort((a, b) => {
      const an = a.round_no ?? 999999;
      const bn = b.round_no ?? 999999;
      if (an !== bn) return an - bn;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });

    const elig = excludeIncomplete ? sorted.filter((r) => derived.completenessForRound(r).complete) : sorted;

    const headers = elig.map((r, idx) => ({
      id: r.id,
      label: r.round_no ? `R${r.round_no}` : `R${idx + 1}`,
      courseId: r.course_id ?? "",
      name: r.name ?? r.id,
      createdAt: r.created_at,
    }));

    return { eligibleRounds: elig, roundHeaders: headers, roundIdsInOrder: headers.map((h) => h.id) };
  }, [rounds, excludeIncomplete, derived]);

  // ---------- MAIN INDIVIDUAL LEADERBOARD ----------
  const leaderboardRows = useMemo((): LeaderRow[] => {
    const { courseHole, rpByRound, scoreMap, playingIdsForRound } = derived;

    const rows: LeaderRow[] = players.map((pl) => {
      const perRound: Record<string, number | null> = {};
      let totalAllRounds = 0;

      for (const rh of roundHeaders) {
        const roundId = rh.id;
        const courseId = rh.courseId;

        const rp = rpByRound[roundId]?.[pl.id];
        const playingIds = playingIdsForRound(roundId);
        const isPlaying = rp ? rp.playing : playingIds.includes(pl.id);

        if (!isPlaying) {
          perRound[roundId] = null;
          continue;
        }

        const hcp = rp ? rp.hcp : Number.isFinite(Number(pl.start_handicap)) ? Number(pl.start_handicap) : 0;

        const holeInfo = courseHole[String(courseId)] ?? {};
        let roundTotal = 0;

        for (let hole = 1; hole <= 18; hole++) {
          const info = holeInfo[hole];
          if (!info) continue;

          const raw = (scoreMap[roundId]?.[pl.id]?.[hole] ?? "").trim().toUpperCase();
          roundTotal += netStablefordPointsForHole({
            rawScore: raw,
            par: info.par,
            strokeIndex: info.si,
            playingHandicap: hcp,
          });
        }

        perRound[roundId] = roundTotal;
        totalAllRounds += roundTotal;
      }

      let finalTotal = totalAllRounds;
      if (useBestN) {
        finalTotal = bestNWithOptionalFinal({
          perRoundById: perRound,
          roundIdsInOrder,
          n: bestN,
          mustIncludeFinal: bestNMustIncludeFinal,
        });
      }

      return { playerId: pl.id, playerName: pl.name, perRound, total: finalTotal };
    });

    rows.sort((a, b) => (b.total !== a.total ? b.total - a.total : a.playerName.localeCompare(b.playerName)));
    return rows;
  }, [players, roundHeaders, derived, useBestN, bestN, bestNMustIncludeFinal, roundIdsInOrder]);

  // ---------- ENTITY LEADERBOARD (PAIR/TEAM) ----------
  const isGroupComp = selectedDef?.kind === "pair" || selectedDef?.kind === "team";

  const entityLeaderboard = useMemo((): { rows: EntityLeaderRow[]; hasAny: boolean } => {
    if (!isGroupComp || !selectedDef) return { rows: [], hasAny: false };

    const { courseHole, rpByRound, scoreMap, playingIdsForRound } = derived;

    const playerNameById: Record<string, string> = {};
    const playerStartHcpById: Record<string, number> = {};
    for (const p of players) {
      playerNameById[p.id] = p.name;
      playerStartHcpById[p.id] = Number.isFinite(Number(p.start_handicap)) ? Number(p.start_handicap) : 0;
    }

    const netPts = (roundId: string, courseId: string, playerId: string, hole: number) => {
      const rp = rpByRound[roundId]?.[playerId];
      const playingIds = playingIdsForRound(roundId);
      const isPlaying = rp ? rp.playing : playingIds.includes(playerId);
      if (!isPlaying) return 0;

      const hcp = rp ? rp.hcp : playerStartHcpById[playerId] ?? 0;

      const info = courseHole[String(courseId)]?.[hole];
      if (!info) return 0;

      const raw = (scoreMap[roundId]?.[playerId]?.[hole] ?? "").trim().toUpperCase();
      return netStablefordPointsForHole({
        rawScore: raw,
        par: info.par,
        strokeIndex: info.si,
        playingHandicap: hcp,
      });
    };

    const compId = String(selectedDef.id ?? "");
    const isBestBall = compId === "tour_pair_best_ball_stableford" || compId.includes("pair_best_ball");
    const isTeamCustom = compId === "tour_team_best_m_minus_zeros" || compId.includes("team_best_m_minus_zeros");
    const m = Math.max(1, Math.floor(teamBestM || 1));

    const computeEntityRoundTotal = (entity: LeaderboardEntity, roundId: string, courseId: string): number | null => {
      const anyPlayed =
        entity.memberPlayerIds.some((pid) => {
          const rp = derived.rpByRound[roundId]?.[pid];
          const playingIds = derived.playingIdsForRound(roundId);
          return rp ? rp.playing : playingIds.includes(pid);
        }) || entity.memberPlayerIds.some((pid) => Object.keys(derived.scoreMap[roundId]?.[pid] ?? {}).length > 0);

      if (!anyPlayed) return null;

      let roundTotal = 0;

      for (let hole = 1; hole <= 18; hole++) {
        const ptsByMember = entity.memberPlayerIds.map((pid) => netPts(roundId, courseId, pid, hole));

        if (selectedDef.kind === "pair" && isBestBall) {
          roundTotal += ptsByMember.length ? Math.max(...ptsByMember) : 0;
          continue;
        }

        if (selectedDef.kind === "team" && isTeamCustom) {
          const zeros = ptsByMember.filter((p) => p === 0).length;
          const topM = ptsByMember
            .slice()
            .sort((a, b) => b - a)
            .slice(0, Math.min(m, ptsByMember.length))
            .reduce((s, v) => s + v, 0);

          roundTotal += topM - zeros;
          continue;
        }

        // Default: aggregate
        roundTotal += ptsByMember.reduce((s, v) => s + v, 0);
      }

      return roundTotal;
    };

    const rows: EntityLeaderRow[] = (entities ?? []).map((e) => {
      const perRound: Record<string, number | null> = {};
      let totalAllRounds = 0;

      for (const rh of roundHeaders) {
        const v = computeEntityRoundTotal(e, rh.id, rh.courseId);
        perRound[rh.id] = v;
        totalAllRounds += v ?? 0;
      }

      let total = totalAllRounds;

      // Best-N for pairs (optional)
      if (selectedDef.kind === "pair" && useBestNForPairs) {
        total = bestNWithOptionalFinal({
          perRoundById: perRound,
          roundIdsInOrder,
          n: bestNPairs,
          mustIncludeFinal: bestNPairsMustIncludeFinal,
        });
      }

      const membersLabel = e.memberPlayerIds.map((pid) => playerNameById[pid] ?? pid).join(" / ");
      return { entityId: e.entityId, label: e.name, membersLabel, perRound, total };
    });

    rows.sort((a, b) => (b.total !== a.total ? b.total - a.total : a.label.localeCompare(b.label)));
    return { rows, hasAny: rows.length > 0 };
  }, [
    isGroupComp,
    selectedDef,
    derived,
    players,
    entities,
    roundHeaders,
    teamBestM,
    roundIdsInOrder,
    useBestNForPairs,
    bestNPairs,
    bestNPairsMustIncludeFinal,
  ]);

  // ---------- COMPETITION ENGINE RESULT (INDIVIDUAL TOUR COMPS) ----------
  const { compResult, compColumns } = useMemo(() => {
    setCompetitionError("");

    const def = selectedDef;
    if (!def) return { compResult: null as any, compColumns: [] as string[] };

    try {
      const { courseHole, rpByRound, scoreMap, playingIdsForRound } = derived;

      const tourRounds: TourRoundContextLocal[] = eligibleRounds.map((r) => {
        const holeInfo = courseHole[String(r.course_id ?? "")] ?? {};
        const parsByHole = Array.from({ length: 18 }, (_, i) => holeInfo[i + 1]?.par ?? 0);
        const strokeIndexByHole = Array.from({ length: 18 }, (_, i) => holeInfo[i + 1]?.si ?? 0);

        // Build 18-length arrays per player
        const scoresMatrix: Record<string, string[]> = {};
        for (const pl of players) {
          const arr = Array(18).fill("");
          for (let hole = 1; hole <= 18; hole++) {
            arr[hole - 1] = (scoreMap[r.id]?.[pl.id]?.[hole] ?? "").trim().toUpperCase();
          }
          scoresMatrix[pl.id] = arr;
        }

        const playedInThisRound = (playerId: string) => {
          const rp = rpByRound[r.id]?.[playerId];
          const fallback = playingIdsForRound(r.id);
          return rp ? rp.playing : fallback.includes(playerId);
        };

        const isComplete = (playerId: string) => {
          if (!playedInThisRound(playerId)) return true;
          const arr = scoresMatrix[playerId] ?? Array(18).fill("");
          for (let i = 0; i < 18; i++) if (!String(arr[i] ?? "").trim()) return false;
          return true;
        };

        const netPointsForHoleFn = (playerId: string, holeIndex: number) => {
          const rp = rpByRound[r.id]?.[playerId];
          if (!rp) {
            if (!playedInThisRound(playerId)) return 0;
          }

          const fallbackHcp = Number.isFinite(Number(players.find((p) => p.id === playerId)?.start_handicap))
            ? Number(players.find((p) => p.id === playerId)?.start_handicap)
            : 0;

          const hcp = rp?.hcp ?? fallbackHcp;

          const par = parsByHole[holeIndex];
          const si = strokeIndexByHole[holeIndex];
          const raw = (scoresMatrix[playerId]?.[holeIndex] ?? "").toString();
          if (!par || !si) return 0;

          return netStablefordPointsForHole({
            rawScore: raw,
            par,
            strokeIndex: si,
            playingHandicap: hcp,
          });
        };

        return {
          roundId: r.id,
          roundName: r.name ?? r.id,
          holes: Array.from({ length: 18 }, (_, i) => i + 1),
          parsByHole,
          strokeIndexByHole,
          scores: scoresMatrix,
          netPointsForHole: netPointsForHoleFn,
          isComplete,
        };
      });

      const playedAny = (playerId: string) => tourRounds.some((tr) => derived.playingIdsForRound(tr.roundId).includes(playerId));
      const anyRoundPlayersData = Object.keys(derived.rpByRound ?? {}).length > 0;

      const ctx: TourCompetitionContextLocal = {
        scope: "tour",
        players: players.map((p) => ({
          id: p.id,
          name: p.name,
          // If round_players is missing/empty, don’t filter everyone out
          playing: anyRoundPlayersData ? playedAny(p.id) : true,
          playing_handicap: 0,
        })),
        rounds: tourRounds,
        entityMembersById,
        entityLabelsById,
        entities: (entities ?? []).map((e) => ({
          entityId: e.entityId,
          label: e.name,
          memberPlayerIds: e.memberPlayerIds,
        })),
        team_best_m: Math.max(1, Math.floor(teamBestM || 1)),
      };

      const result = runCompetition(def, ctx as unknown as CompetitionContext);
      const rowsForUi = ((result as any)?.rows ?? []) as UiCompRow[];

      const keySet = new Set<string>();
      for (const row of rowsForUi) {
        const stats = row?.stats ?? {};
        for (const k of Object.keys(stats)) keySet.add(k);
      }

      const preferred = ["members", "holes_played", "points_total", "avg_points", "zero_count", "zero_pct", "four_plus_count", "four_plus_pct", "eclectic_total"];
      const keys = Array.from(keySet);
      keys.sort((a, b) => {
        const ia = preferred.indexOf(a);
        const ib = preferred.indexOf(b);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        return a.localeCompare(b);
      });

      return { compResult: result as any, compColumns: keys };
    } catch (e: any) {
      setCompetitionError(e?.message ?? "Competition engine failed.");
      return { compResult: null as any, compColumns: [] as string[] };
    }
  }, [selectedDef, eligibleRounds, players, derived, entityMembersById, entityLabelsById, entities, teamBestM]);

  async function saveTeamBestM(next: number) {
    setTeamBestMMsg("");
    setSavingTeamBestM(true);

    const payload: any = { tour_id: tourId, default_team_best_m: next, updated_at: new Date().toISOString() };
    const { error: upErr } = await supabase.from("tour_grouping_settings").upsert(payload, { onConflict: "tour_id" });

    setSavingTeamBestM(false);
    if (upErr) {
      setTeamBestMMsg(`Save failed: ${upErr.message}`);
      return;
    }
    setTeamBestMMsg("Saved ✓");
    setTimeout(() => setTeamBestMMsg(""), 1500);
  }

  // ---------- RENDER ----------
  if (loading) return <div style={{ padding: 16 }}>Loading leaderboard…</div>;

  if (loadError) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: "crimson", fontWeight: 800 }}>Load error</div>
        <div style={{ marginTop: 8 }}>{loadError}</div>
        <div style={{ marginTop: 10 }}>
          <Link href="/tours">← Back to Tours</Link>
        </div>
      </div>
    );
  }

  const needsEntities = selectedDef?.kind === "pair" || selectedDef?.kind === "team";
  const hasAnyEntities = (entities ?? []).length > 0;
  const entityHeaderLabel = selectedDef?.kind === "pair" ? "Pair" : selectedDef?.kind === "team" ? "Team" : "Player";

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Tour Leaderboard</h1>
      <div style={{ marginTop: 6, color: "#555" }}>{tourName} — Net Stableford</div>

      {/* Diagnostics panel */}
      <div style={{ marginTop: 10, marginBottom: 14, padding: 12, border: "1px solid #eee", borderRadius: 10 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Diagnostics</div>
        <div style={{ fontSize: 13, color: "#555" }}>
          Rounds: <b>{rounds.length}</b> · Players: <b>{players.length}</b> · Scores rows: <b>{scores.length}</b> · round_players rows:{" "}
          <b>{roundPlayers.length}</b>
        </div>
        <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>If “Exclude incomplete rounds” hides everything, check the per-round completeness below.</div>

        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 760, width: "100%" }}>
            <thead>
              <tr>
                <th style={thLeft}>Round</th>
                <th style={thRight}>Playing</th>
                <th style={thRight}>Missing holes</th>
                <th style={thLeft}>Status</th>
              </tr>
            </thead>
            <tbody>
              {[...rounds]
                .sort((a, b) => {
                  const an = a.round_no ?? 999999;
                  const bn = b.round_no ?? 999999;
                  if (an !== bn) return an - bn;
                  return (a.created_at ?? "").localeCompare(b.created_at ?? "");
                })
                .map((r) => {
                  const c = derived.completenessForRound(r);
                  return (
                    <tr key={r.id}>
                      <td style={tdLeft}>
                        <div style={{ fontWeight: 700 }}>
                          {r.round_no ? `Round ${r.round_no}` : "Round"}: {r.name ?? r.id}
                        </div>
                        <div style={{ fontSize: 12, color: "#666" }}>
                          {fmtTs(r.created_at)} · {r.id}
                        </div>
                      </td>
                      <td style={tdRight}>{c.playingCount}</td>
                      <td style={tdRight}>{c.missing}</td>
                      <td style={tdLeft}>
                        {c.complete ? <span style={{ color: "#2e7d32", fontWeight: 700 }}>Complete</span> : <span style={{ color: "#b23c17", fontWeight: 700 }}>Incomplete</span>}
                        {!c.complete ? <div style={{ fontSize: 12, color: "#666" }}>{c.reason}</div> : null}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: 10, marginBottom: 10 }}>
        <label style={{ fontSize: 14 }}>
          <input type="checkbox" checked={excludeIncomplete} onChange={(e) => setExcludeIncomplete(e.target.checked)} style={{ marginRight: 6 }} />
          Exclude incomplete rounds
        </label>
      </div>

      {/* Individual best-N */}
      <div style={{ marginBottom: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 14 }}>
          <input type="checkbox" checked={useBestN} onChange={(e) => setUseBestN(e.target.checked)} style={{ marginRight: 6 }} />
          Individual: use best N rounds
        </label>

        {useBestN && (
          <>
            <label style={{ fontSize: 14 }}>
              N:&nbsp;
              <input type="number" min={1} max={50} value={bestN} onChange={(e) => setBestN(Math.max(1, Number(e.target.value) || 1))} style={{ width: 70, padding: 4 }} />
            </label>

            <label style={{ fontSize: 14 }}>
              <input type="checkbox" checked={bestNMustIncludeFinal} onChange={(e) => setBestNMustIncludeFinal(e.target.checked)} style={{ marginRight: 6 }} />
              Must include final (if not played, uses best N−1)
            </label>
          </>
        )}
      </div>

      {/* Competitions */}
      <div style={{ marginTop: 14, marginBottom: 16, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Competitions</div>

          <select value={selectedCompId} onChange={(e) => setSelectedCompId(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ccc" }}>
            {tourCompetitions.length === 0 ? (
              <option value="(none)">No tour competitions found</option>
            ) : (
              tourCompetitions.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))
            )}
          </select>
        </div>

        {competitionError ? (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 8, border: "1px solid #f3c1c1", background: "#fff2f2", color: "#8a1f1f" }}>
            <div style={{ fontWeight: 800 }}>Competition error</div>
            <div style={{ marginTop: 6, fontSize: 13 }}>{competitionError}</div>
          </div>
        ) : null}

        {entitiesError ? (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 8, border: "1px solid #f3c1c1", background: "#fff2f2", color: "#8a1f1f" }}>
            <div style={{ fontWeight: 800 }}>Pairs/teams error</div>
            <div style={{ marginTop: 6, fontSize: 13 }}>{entitiesError}</div>
          </div>
        ) : null}

        {/* Pair best-N options */}
        {selectedDef?.kind === "pair" && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #eee" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Pair settings</div>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 13 }}>
                <input type="checkbox" checked={useBestNForPairs} onChange={(e) => setUseBestNForPairs(e.target.checked)} style={{ marginRight: 6 }} />
                Use best N rounds for pairs
              </label>

              {useBestNForPairs && (
                <>
                  <label style={{ fontSize: 13 }}>
                    N:&nbsp;
                    <input type="number" min={1} max={50} value={bestNPairs} onChange={(e) => setBestNPairs(Math.max(1, Number(e.target.value) || 1))} style={{ width: 70, padding: 4 }} />
                  </label>

                  <label style={{ fontSize: 13 }}>
                    <input type="checkbox" checked={bestNPairsMustIncludeFinal} onChange={(e) => setBestNPairsMustIncludeFinal(e.target.checked)} style={{ marginRight: 6 }} />
                    Must include final (if not played, uses best N−1)
                  </label>
                </>
              )}
            </div>
          </div>
        )}

        {/* Team setting M */}
        {selectedDef?.kind === "team" && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #eee" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Team settings</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 13 }}>
                Best M per hole:&nbsp;
                <input type="number" min={1} max={10} value={teamBestM} onChange={(e) => setTeamBestM(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} style={{ width: 70, padding: 4 }} />
              </label>

              <button
                type="button"
                onClick={() => saveTeamBestM(teamBestM)}
                disabled={savingTeamBestM}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ccc", background: savingTeamBestM ? "#f7f7f7" : "white" }}
              >
                {savingTeamBestM ? "Saving…" : "Save"}
              </button>

              {teamBestMMsg && <div style={{ fontSize: 12, color: teamBestMMsg.startsWith("Save failed") ? "crimson" : "#2e7d32" }}>{teamBestMMsg}</div>}
            </div>
          </div>
        )}

        {/* Competition rendering */}
        {needsEntities && !hasAnyEntities ? (
          <div style={{ marginTop: 10, color: "#666" }}>No {selectedDef?.kind === "pair" ? "pairs" : "teams"} found yet.</div>
        ) : isGroupComp ? (
          entityLeaderboard.rows.length === 0 ? (
            <div style={{ marginTop: 10, color: "#666" }}>No eligible entries yet.</div>
          ) : (
            <div style={{ marginTop: 10, overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", minWidth: 820, width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thLeft}>{entityHeaderLabel}</th>
                    {roundHeaders.map((r) => (
                      <th key={r.id} style={thRight}>
                        {r.label}
                      </th>
                    ))}
                    <th style={thRight}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {entityLeaderboard.rows.map((row) => (
                    <tr key={row.entityId}>
                      <td style={tdLeft}>
                        <div style={{ fontWeight: 700 }}>{row.label}</div>
                        <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{row.membersLabel}</div>
                      </td>
                      {roundHeaders.map((r) => (
                        <td key={r.id} style={tdRight}>
                          {row.perRound[r.id] === null ? "—" : row.perRound[r.id]}
                        </td>
                      ))}
                      <td style={{ ...tdRight, fontWeight: 800 }}>{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", minWidth: 700, width: "100%" }}>
              <thead>
                <tr>
                  <th style={thLeft}>Player</th>
                  {compColumns.map((k) => (
                    <th key={k} style={thRight}>
                      {titleCaseKey(k)}
                    </th>
                  ))}
                  <th style={thRight}>Score</th>
                </tr>
              </thead>
              <tbody>
                {((compResult as any)?.rows ?? []).map((r: UiCompRow) => {
                  const stats = r.stats ?? {};
                  return (
                    <tr key={r.entryId}>
                      <td style={tdLeft}>{r.label}</td>
                      {compColumns.map((k) => (
                        <td key={k} style={tdRight}>
                          {formatStatValue(k, (stats as any)[k] ?? "")}
                        </td>
                      ))}
                      <td style={{ ...tdRight, fontWeight: 800 }}>{round2(r.total).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Main leaderboard */}
      {roundHeaders.length === 0 ? (
        <div>No rounds yet for this tour{excludeIncomplete ? " (or none complete yet)." : "."}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 700, width: "100%" }}>
            <thead>
              <tr>
                <th style={thLeft}>Player</th>
                {roundHeaders.map((r) => (
                  <th key={r.id} style={thRight}>
                    {r.label}
                  </th>
                ))}
                <th style={thRight}>Total</th>
              </tr>
            </thead>
            <tbody>
              {leaderboardRows.map((row) => (
                <tr key={row.playerId}>
                  <td style={tdLeft}>{row.playerName}</td>
                  {roundHeaders.map((r) => (
                    <td key={r.id} style={tdRight}>
                      {row.perRound[r.id] === null ? "—" : row.perRound[r.id]}
                    </td>
                  ))}
                  <td style={{ ...tdRight, fontWeight: 700 }}>{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 12, color: "#666", fontSize: 13 }}>“—” means the player wasn’t selected (playing) for that round.</div>
    </div>
  );
}

const thLeft: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #ddd",
  position: "sticky",
  left: 0,
  background: "white",
  zIndex: 1,
};

const thRight: React.CSSProperties = {
  textAlign: "right",
  padding: "10px 8px",
  borderBottom: "1px solid #ddd",
  whiteSpace: "nowrap",
};

const tdLeft: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #eee",
  position: "sticky",
  left: 0,
  background: "white",
};

const tdRight: React.CSSProperties = {
  textAlign: "right",
  padding: "10px 8px",
  borderBottom: "1px solid #eee",
};
