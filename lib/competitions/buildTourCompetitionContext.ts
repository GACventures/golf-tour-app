import type { CompetitionContext } from "./types";
import { netStablefordPointsForHole } from "@/lib/stableford";

export type Tee = "M" | "F";

export type TourRoundLite = {
  id: string;
  name?: string | null;
  course_id: string | null;
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

export type TourCompetitionContextLocal = {
  scope: "tour";
  players: Array<{
    id: string;
    name: string;
    playing: boolean;
    playing_handicap: number;
  }>;
  rounds: Array<{
    roundId: string;
    roundName: string;
    holes: number[];
    parsByHole: number[];
    strokeIndexByHole: number[];
    scores: Record<string, string[]>;
    netPointsForHole: (playerId: string, holeIndex: number) => number;
    isComplete: (playerId: string) => boolean;
  }>;
};

/** "P" if pickup, "" if missing, else number as string */
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

export function buildTourCompetitionContext(params: {
  rounds: TourRoundLite[];
  players: PlayerLiteForTour[];
  roundPlayers: RoundPlayerLiteForTour[];
  scores: ScoreLiteForTour[];
  pars: ParLiteForTour[];
}): TourCompetitionContextLocal {
  const { rounds, players, roundPlayers, scores, pars } = params;

  // round|player -> rp
  const rpByRoundPlayer = new Map<string, RoundPlayerLiteForTour>();
  for (const rp of roundPlayers) rpByRoundPlayer.set(`${rp.round_id}|${rp.player_id}`, rp);

  // course -> tee -> hole -> {par, si}
  const parsByCourseTeeHole = new Map<string, Map<Tee, Map<number, { par: number; si: number }>>>();
  for (const p of pars) {
    if (!parsByCourseTeeHole.has(p.course_id)) parsByCourseTeeHole.set(p.course_id, new Map());
    const byTee = parsByCourseTeeHole.get(p.course_id)!;
    const tee = normalizeTee(p.tee);
    if (!byTee.has(tee)) byTee.set(tee, new Map());
    byTee.get(tee)!.set(Number(p.hole_number), { par: Number(p.par), si: Number(p.stroke_index) });
  }

  // round|player|hole -> score row
  const scoreByRoundPlayerHole = new Map<string, ScoreLiteForTour>();
  for (const s of scores) {
    scoreByRoundPlayerHole.set(`${s.round_id}|${s.player_id}|${Number(s.hole_number)}`, s);
  }

  const playerById = new Map(players.map((p) => [p.id, p]));
  const holes = Array.from({ length: 18 }, (_, i) => i + 1);

  // Build per-round structures used by tour competitions in catalog.ts
  const tourRounds = rounds
    .filter((r) => !!r.id)
    .map((r) => {
      const courseId = r.course_id;
      const roundId = r.id;

      // We still provide parsByHole/strokeIndexByHole arrays; use Men's tee as baseline.
      // netPointsForHole uses player gender tee for the actual points calculation.
      const mensParsMap = courseId ? parsByCourseTeeHole.get(courseId)?.get("M") : undefined;

      const parsByHole = holes.map((h) => mensParsMap?.get(h)?.par ?? 0);
      const strokeIndexByHole = holes.map((h) => mensParsMap?.get(h)?.si ?? 0);

      // Build 18-length raw-score arrays per player
      const scoresMatrix: Record<string, string[]> = {};
      for (const p of players) {
        const arr = Array(18).fill("");
        for (let hole = 1; hole <= 18; hole++) {
          const sc = scoreByRoundPlayerHole.get(`${roundId}|${p.id}|${hole}`);
          arr[hole - 1] = sc ? normalizeRawScore(sc.strokes, sc.pickup).trim().toUpperCase() : "";
        }
        scoresMatrix[p.id] = arr;
      }

      const isPlayingInRound = (playerId: string) => {
        const rp = rpByRoundPlayer.get(`${roundId}|${playerId}`);
        return rp ? rp.playing === true : false;
      };

      const isComplete = (playerId: string) => {
        // If not playing in that round, treat as complete for that round (so per-round completeness rules can skip)
        if (!isPlayingInRound(playerId)) return true;
        const arr = scoresMatrix[playerId] ?? Array(18).fill("");
        for (let i = 0; i < 18; i++) if (!String(arr[i] ?? "").trim()) return false;
        return true;
      };

      const netPointsForHole = (playerId: string, holeIndex: number) => {
        const player = playerById.get(playerId);
        if (!player) return 0;

        // Not playing? score 0
        if (!isPlayingInRound(playerId)) return 0;

        const tee: Tee = normalizeTee(player.gender);
        const holeNo = holeIndex + 1;

        const holeInfo = courseId ? parsByCourseTeeHole.get(courseId)?.get(tee)?.get(holeNo) : undefined;
        if (!holeInfo) return 0;

        const rp = rpByRoundPlayer.get(`${roundId}|${playerId}`);
        const hcp = Number.isFinite(Number(rp?.playing_handicap)) ? Number(rp?.playing_handicap) : 0;

        const raw = String(scoresMatrix[playerId]?.[holeIndex] ?? "").trim().toUpperCase();

        return netStablefordPointsForHole({
          rawScore: raw,
          par: holeInfo.par,
          strokeIndex: holeInfo.si,
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
      };
    });

  // For tour competitions, ctx.players.playing is used only by eligibility.onlyPlaying
  // We consider a player "playing" in tour scope if they are marked playing in ANY round.
  const playedAny = (playerId: string) =>
    rounds.some((r) => {
      const rp = rpByRoundPlayer.get(`${r.id}|${playerId}`);
      return rp ? rp.playing === true : false;
    });

  const ctx: TourCompetitionContextLocal = {
    scope: "tour",
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      playing: playedAny(p.id),
      playing_handicap: 0,
    })),
    rounds: tourRounds,
  };

  return ctx;
}
