import { netStablefordPointsForHole } from "@/lib/stableford";

// Keep this file framework-agnostic: pure data in, context out.

export type Tee = "M" | "F";

export type TourRoundInput = {
  id: string;
  name: string | null;
  course_id: string | null;
  round_no?: number | null;
  created_at?: string | null;
};

export type PlayerInput = {
  id: string;
  name: string;
  gender?: Tee | null;
  start_handicap?: number | null; // tour starting handicap (fallback)
};

export type RoundPlayerInput = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number | null;
};

export type ScoreInput = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean | null;
};

export type ParInput = {
  course_id: string;
  hole_number: number;
  tee: Tee;
  par: number;
  stroke_index: number;
};

export type EntityInput = {
  entityId: string;
  label: string;
  memberPlayerIds: string[];
};

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function rawScoreFor(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  const n = Number(strokes);
  return Number.isFinite(n) ? String(n) : "";
}

function roundSort(a: TourRoundInput, b: TourRoundInput) {
  const an = a.round_no ?? 999999;
  const bn = b.round_no ?? 999999;
  if (an !== bn) return an - bn;
  return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
}

export function buildTourCompetitionContext(params: {
  rounds: TourRoundInput[];
  players: PlayerInput[];
  roundPlayers: RoundPlayerInput[];
  scores: ScoreInput[];
  pars: ParInput[];

  // Optional entity support for pair/team comps
  entities?: EntityInput[];
  entityMembersById?: Record<string, string[]>;
  entityLabelsById?: Record<string, string>;
  team_best_m?: number;
}) {
  const roundsSorted = [...(params.rounds ?? [])].sort(roundSort);
  const players = params.players ?? [];

  // round|player => {playing,hcp}
  const rpByRoundPlayer = new Map<string, { playing: boolean; hcp: number }>();
  for (const rp of params.roundPlayers ?? []) {
    const rid = String(rp.round_id);
    const pid = String(rp.player_id);
    rpByRoundPlayer.set(`${rid}|${pid}`, {
      playing: rp.playing === true,
      hcp: Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0,
    });
  }
  const anyRoundPlayersData = (params.roundPlayers ?? []).length > 0;

  // round|player|hole => raw ("", "P", "7")
  const rawByRoundPlayerHole = new Map<string, string>();
  for (const s of params.scores ?? []) {
    const rid = String(s.round_id);
    const pid = String(s.player_id);
    const hole = Number(s.hole_number);
    const raw = rawScoreFor(s.strokes, s.pickup).trim().toUpperCase();
    rawByRoundPlayerHole.set(`${rid}|${pid}|${hole}`, raw);
  }

  // course -> tee -> hole -> {par,si}
  const courseTeeHole = new Map<string, Map<Tee, Map<number, { par: number; si: number }>>>();
  for (const p of params.pars ?? []) {
    const courseId = String(p.course_id);
    const tee = normalizeTee(p.tee);
    const hole = Number(p.hole_number);
    const par = Number(p.par);
    const si = Number(p.stroke_index);

    if (!courseTeeHole.has(courseId)) courseTeeHole.set(courseId, new Map());
    const byTee = courseTeeHole.get(courseId)!;
    if (!byTee.has(tee)) byTee.set(tee, new Map());
    byTee.get(tee)!.set(hole, { par, si });
  }

  // Helper: determine "playing" if rp rows exist, otherwise permissive
  const playedAnyRound = (playerId: string) => {
    for (const r of roundsSorted) {
      const rp = rpByRoundPlayer.get(`${r.id}|${playerId}`);
      if (rp?.playing) return true;
    }
    return false;
  };

  // Canonical pars/si arrays for a course:
  // Your engine’s tour competitions use r.parsByHole to classify par 3/4/5 holes.
  // With M/F tees, pars should usually match, but to stay consistent we choose:
  // - Prefer M tee if available
  // - Else fallback to F tee
  const canonicalCourseArrays = (courseId: string | null) => {
    const empty = {
      parsByHole: Array(18).fill(0) as number[],
      strokeIndexByHole: Array(18).fill(0) as number[],
    };
    if (!courseId) return empty;

    const byTee = courseTeeHole.get(String(courseId));
    if (!byTee) return empty;

    const chosenTee: Tee = byTee.has("M") ? "M" : byTee.has("F") ? "F" : "M";
    const holesMap = byTee.get(chosenTee);
    if (!holesMap) return empty;

    const parsByHole = Array.from({ length: 18 }, (_, i) => holesMap.get(i + 1)?.par ?? 0);
    const strokeIndexByHole = Array.from({ length: 18 }, (_, i) => holesMap.get(i + 1)?.si ?? 0);
    return { parsByHole, strokeIndexByHole };
  };

  // Build tourRounds expected by catalog.ts (as used in your leaderboard page)
  const tourRounds = roundsSorted.map((r) => {
    const rid = String(r.id);
    const courseId = r.course_id ? String(r.course_id) : null;

    const { parsByHole, strokeIndexByHole } = canonicalCourseArrays(courseId);

    // Build 18-length raw arrays per player (""|"P"|number string)
    const scoresMatrix: Record<string, string[]> = {};
    for (const pl of players) {
      const arr = Array(18).fill("");
      for (let hole = 1; hole <= 18; hole++) {
        arr[hole - 1] = (rawByRoundPlayerHole.get(`${rid}|${pl.id}|${hole}`) ?? "").trim().toUpperCase();
      }
      scoresMatrix[pl.id] = arr;
    }

    const playedInThisRound = (playerId: string) => {
      const rp = rpByRoundPlayer.get(`${rid}|${playerId}`);
      // If we have round_players data, respect it.
      if (anyRoundPlayersData) return rp ? rp.playing : false;

      // If we don't have round_players rows, be permissive: if they have any score row, treat as "played".
      for (let hole = 1; hole <= 18; hole++) {
        const raw = (rawByRoundPlayerHole.get(`${rid}|${playerId}|${hole}`) ?? "").trim();
        if (raw) return true;
      }
      return false;
    };

    const isComplete = (playerId: string) => {
      if (!playedInThisRound(playerId)) return true;
      const arr = scoresMatrix[playerId] ?? Array(18).fill("");
      for (let i = 0; i < 18; i++) if (!String(arr[i] ?? "").trim()) return false;
      return true;
    };

    const netPointsForHoleFn = (playerId: string, holeIndex: number) => {
      if (!playedInThisRound(playerId)) return 0;

      const rp = rpByRoundPlayer.get(`${rid}|${playerId}`);
      const fallbackHcp = Number.isFinite(Number(players.find((p) => p.id === playerId)?.start_handicap))
        ? Number(players.find((p) => p.id === playerId)?.start_handicap)
        : 0;
      const hcp = rp?.hcp ?? fallbackHcp;

      // Use player tee for net points (if available)
      const playerTee: Tee = normalizeTee(players.find((p) => p.id === playerId)?.gender);
      const perTee = courseId ? courseTeeHole.get(String(courseId))?.get(playerTee) : undefined;

      const holeNo = holeIndex + 1;

      const par = perTee?.get(holeNo)?.par ?? parsByHole[holeIndex] ?? 0;
      const si = perTee?.get(holeNo)?.si ?? strokeIndexByHole[holeIndex] ?? 0;

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
      roundId: rid,
      roundName: r.name ?? rid,
      holes: Array.from({ length: 18 }, (_, i) => i + 1),
      parsByHole,
      strokeIndexByHole,
      scores: scoresMatrix,
      netPointsForHole: netPointsForHoleFn,
      isComplete,
    };
  });

  // Build ctx.players
  const ctxPlayers = players.map((p) => ({
    id: p.id,
    name: p.name,
    playing: anyRoundPlayersData ? playedAnyRound(p.id) : true,
    playing_handicap: 0, // not used by tour comps (they use rp.hcp per round)
  }));

  const ctx: any = {
    scope: "tour",
    players: ctxPlayers,
    rounds: tourRounds,
    entities: params.entities,
    entityMembersById: params.entityMembersById,
    entityLabelsById: params.entityLabelsById,
    team_best_m: params.team_best_m,
  };

  return ctx;
}
