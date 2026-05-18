import type { CompetitionContext } from "./types";
import { netStablefordPointsForHole } from "@/lib/stableford";

export const BUILD_TOUR_CTX_VERSION = "BTC-v8-exclude-non-playing-rounds";

export type Tee = "M" | "F";

const SWING_IN_SPRING_TOUR_ID = "a2d8ba33-e0e8-48a6-aff4-37a71bf29988";
const SWING_IN_SPRING_SPECIAL_ROUND_NO = 3;
const SWING_IN_SPRING_SPECIAL_MIN_HOLES = 9;

export type TourRoundLite = {
  id: string;
  name?: string | null;
  course_id: string | null;
  tour_id?: string | null;
  round_no?: number | null;
};

export type PlayerLiteForTour = {
  id: string;
  name: string;
  gender?: Tee | null;
};

export type RoundPlayerLiteForTour = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number | null;
};

export type ScoreLiteForTour = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean | null;
};

export type ParLiteForTour = {
  course_id: string;
  hole_number: number;
  tee: Tee;
  par: number;
  stroke_index: number;
};

export type TourRoundContextLocal = {
  roundId: string;
  roundName: string;
  holes: number[];
  parsByHole: number[];
  strokeIndexByHole: number[];
  scores: Record<string, string[]>;
  netPointsForHole: (playerId: string, holeIndex: number) => number;
  isComplete: (playerId: string) => boolean;
  parForPlayerHole: (playerId: string, holeIndex: number) => number;

  isSwingInSpringRound3: boolean;
  isHolePlayed: (playerId: string, holeIndex: number) => boolean;
  playedHoleIndexes: (playerId: string) => number[];
};

export type TourCompetitionContextLocal = {
  scope: "tour";
  players: Array<{
    id: string;
    name: string;
    playing: boolean;
    playing_handicap: number;
  }>;
  rounds: TourRoundContextLocal[];
};

function normalizeRawScore(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  const n = Number(strokes);
  return Number.isFinite(n) ? String(n) : "";
}

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function clampHoleTo1to18(h: any): number | null {
  const n = Number(h);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 18) return null;
  return n;
}

function countCompletedHoles(arr: string[]) {
  let count = 0;
  for (let i = 0; i < 18; i++) {
    if (String(arr[i] ?? "").trim()) count += 1;
  }
  return count;
}

export function buildTourCompetitionContext(params: {
  rounds: TourRoundLite[];
  players: PlayerLiteForTour[];
  roundPlayers: RoundPlayerLiteForTour[];
  scores: ScoreLiteForTour[];
  pars: ParLiteForTour[];
}): TourCompetitionContextLocal {
  const { rounds, players, roundPlayers, scores, pars } = params;

  const rpByRoundPlayer = new Map<string, RoundPlayerLiteForTour>();
  for (const rp of roundPlayers) rpByRoundPlayer.set(`${String(rp.round_id)}|${String(rp.player_id)}`, rp);

  const parsByCourseTeeHole = new Map<string, Map<Tee, Map<number, { par: number; si: number }>>>();
  for (const p of pars) {
    const courseId = String(p.course_id);
    if (!parsByCourseTeeHole.has(courseId)) parsByCourseTeeHole.set(courseId, new Map());
    const byTee = parsByCourseTeeHole.get(courseId)!;

    const tee = normalizeTee(p.tee);
    if (!byTee.has(tee)) byTee.set(tee, new Map());

    const holeNo = clampHoleTo1to18(p.hole_number);
    if (!holeNo) continue;

    byTee.get(tee)!.set(holeNo, { par: Number(p.par), si: Number(p.stroke_index) });
  }

  const holes = Array.from({ length: 18 }, (_, i) => i + 1);

  const scoresByRoundId = new Map<string, Record<string, string[]>>();
  for (const r of rounds) {
    const rid = String(r.id);
    const byPlayer: Record<string, string[]> = {};
    for (const p of players) byPlayer[String(p.id)] = Array(18).fill("");
    scoresByRoundId.set(rid, byPlayer);
  }

  const debug = {
    version: BUILD_TOUR_CTX_VERSION,
    roundsIn: rounds.length,
    playersIn: players.length,
    scoresIn: scores.length,
    seen: 0,
    written: 0,
    skipNoRound: 0,
    skipNoPlayer: 0,
    skipBadHole: 0,
    skipOverwriteBlank: 0,
    sampleSeen: [] as string[],
    sampleWritten: [] as string[],
    sampleSkip: [] as string[],
  };

  for (const s of scores) {
    debug.seen += 1;

    const roundId = String((s as any).round_id);
    const playerId = String((s as any).player_id);

    if (debug.sampleSeen.length < 8) {
      debug.sampleSeen.push(
        `seen: round_id=${roundId} player_id=${playerId} hole_number=${String((s as any).hole_number)} strokes=${String(
          (s as any).strokes
        )} pickup=${String((s as any).pickup)}`
      );
    }

    const byPlayer = scoresByRoundId.get(roundId);
    if (!byPlayer) {
      debug.skipNoRound += 1;
      if (debug.sampleSkip.length < 8) debug.sampleSkip.push(`skipNoRound: round_id=${roundId}`);
      continue;
    }

    const arr = byPlayer[playerId];
    if (!arr) {
      debug.skipNoPlayer += 1;
      if (debug.sampleSkip.length < 8) debug.sampleSkip.push(`skipNoPlayer: round_id=${roundId} player_id=${playerId}`);
      continue;
    }

    const holeNo = clampHoleTo1to18((s as any).hole_number);
    if (!holeNo) {
      debug.skipBadHole += 1;
      if (debug.sampleSkip.length < 8) debug.sampleSkip.push(`skipBadHole: hole_number=${String((s as any).hole_number)}`);
      continue;
    }

    const raw = normalizeRawScore((s as any).strokes, (s as any).pickup).trim().toUpperCase();
    const idx = holeNo - 1;

    if (raw === "" && String(arr[idx] ?? "").trim() !== "") {
      debug.skipOverwriteBlank += 1;
      continue;
    }

    arr[idx] = raw;
    debug.written += 1;

    if (debug.sampleWritten.length < 8) {
      debug.sampleWritten.push(`write: round_id=${roundId} player_id=${playerId} H${holeNo} raw=${raw || "(blank)"}`);
    }
  }

  const playerById = new Map(players.map((p) => [String(p.id), p]));

  const tourRounds: TourRoundContextLocal[] = rounds
    .filter((r) => !!r.id)
    .map((r) => {
      const courseId = r.course_id ? String(r.course_id) : null;
      const roundId = String(r.id);
      const roundTourId = String(r.tour_id ?? "");
      const roundNo = Number.isFinite(Number(r.round_no)) ? Number(r.round_no) : null;

      const isSwingInSpringRound3 =
        roundTourId === SWING_IN_SPRING_TOUR_ID && roundNo === SWING_IN_SPRING_SPECIAL_ROUND_NO;

      const byTee = courseId ? parsByCourseTeeHole.get(courseId) : undefined;

      const baselineTee: Tee = byTee?.has("M") ? "M" : "F";
      const baselineMap = byTee?.get(baselineTee);

      const parsByHole = holes.map((h) => baselineMap?.get(h)?.par ?? 0);
      const strokeIndexByHole = holes.map((h) => baselineMap?.get(h)?.si ?? 0);

      const scoresMatrix: Record<string, string[]> = scoresByRoundId.get(roundId) ?? {};

      const isPlayingInRound = (playerId: string) => {
        const rp = rpByRoundPlayer.get(`${roundId}|${String(playerId)}`);
        return rp ? rp.playing === true : false;
      };

      const isHolePlayed = (playerId: string, holeIndex: number) => {
        if (!isPlayingInRound(playerId)) return false;
        const idx = Math.floor(Number(holeIndex));
        if (!Number.isFinite(idx) || idx < 0 || idx > 17) return false;
        return !!String(scoresMatrix[String(playerId)]?.[idx] ?? "").trim();
      };

      const playedHoleIndexes = (playerId: string) => {
        const out: number[] = [];
        for (let i = 0; i < 18; i++) {
          if (isHolePlayed(playerId, i)) out.push(i);
        }
        return out;
      };

      const isComplete = (playerId: string) => {
        // Important:
        // A player who is not playing in a round must NOT be treated as complete.
        // Otherwise future/unplayed rounds can be included in tour averages with
        // zero points, inflating denominators for events such as Napoleon,
        // Big George, and Grand Canyon.
        if (!isPlayingInRound(playerId)) return false;

        const arr = scoresMatrix[String(playerId)] ?? Array(18).fill("");
        const completedHoles = countCompletedHoles(arr);

        if (isSwingInSpringRound3) {
          return completedHoles >= SWING_IN_SPRING_SPECIAL_MIN_HOLES;
        }

        return completedHoles >= 18;
      };

      const parForPlayerHole = (playerId: string, holeIndex: number) => {
        const player = playerById.get(String(playerId));
        const tee: Tee = normalizeTee(player?.gender);
        const holeNo = holeIndex + 1;

        const map = byTee?.get(tee) ?? byTee?.get("M") ?? byTee?.get("F");
        const parVal = Number(map?.get(holeNo)?.par ?? 0);
        return Number.isFinite(parVal) ? parVal : 0;
      };

      const netPointsForHole = (playerId: string, holeIndex: number) => {
        const player = playerById.get(String(playerId));
        if (!player) return 0;

        if (!isPlayingInRound(playerId)) return 0;

        const tee: Tee = normalizeTee(player.gender);
        const holeNo = holeIndex + 1;

        const map = byTee?.get(tee) ?? byTee?.get("M") ?? byTee?.get("F");
        const info = map?.get(holeNo);
        if (!info) return 0;

        const rp = rpByRoundPlayer.get(`${roundId}|${String(playerId)}`);
        const hcp = Number.isFinite(Number(rp?.playing_handicap)) ? Number(rp?.playing_handicap) : 0;

        const raw = String(scoresMatrix[String(playerId)]?.[holeIndex] ?? "").trim().toUpperCase();

        return netStablefordPointsForHole({
          rawScore: raw,
          par: info.par,
          strokeIndex: info.si,
          playingHandicap: hcp,
        });
      };

      return {
        roundId,
        roundName: String(r.name ?? r.id),
        holes,
        parsByHole,
        strokeIndexByHole,
        scores: scoresMatrix,
        netPointsForHole,
        isComplete,
        parForPlayerHole,
        isSwingInSpringRound3,
        isHolePlayed,
        playedHoleIndexes,
      };
    });

  const playedAny = (playerId: string) =>
    rounds.some((r) => {
      const rp = rpByRoundPlayer.get(`${String(r.id)}|${String(playerId)}`);
      return rp ? rp.playing === true : false;
    });

  const ctx: TourCompetitionContextLocal = {
    scope: "tour",
    players: players.map((p) => ({
      id: String(p.id),
      name: p.name,
      playing: playedAny(String(p.id)),
      playing_handicap: 0,
    })),
    rounds: tourRounds,
  };

  (ctx as any).__ctxVersion = BUILD_TOUR_CTX_VERSION;
  (ctx as any).__debugScoreFill = debug;

  return ctx;
}