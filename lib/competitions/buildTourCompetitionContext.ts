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

export type TourRoundContextLocal = {
  roundId: string;
  roundName: string;
  holes: number[];
  parsByHole: number[]; // baseline only (kept for backwards compatibility)
  strokeIndexByHole: number[]; // baseline only
  scores: Record<string, string[]>;
  netPointsForHole: (playerId: string, holeIndex: number) => number;
  isComplete: (playerId: string) => boolean;

  // ✅ tee-specific par for bucketing (Napoleon/Big George/Grand Canyon)
  parForPlayerHole: (playerId: string, holeIndex: number) => number;
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

/**
 * Scores.hole_number in DB might be stored as:
 * - 1..18  (most common)
 * - 0..17  (also common in some schemas)
 * Normalize to 1..18 so the rest of the app uses consistent keys.
 */
function normalizeHoleNumberTo1to18(holeNumberRaw: any): number {
  const n = Number(holeNumberRaw);
  if (!Number.isFinite(n)) return NaN;

  // If stored 0..17, shift to 1..18
  if (n >= 0 && n <= 17) return n + 1;

  // If stored 1..18, keep
  return n;
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
  // ✅ Normalize hole_number to 1..18 so lookups work regardless of DB convention.
  const scoreByRoundPlayerHole = new Map<string, ScoreLiteForTour>();
  for (const s of scores) {
    const hn = normalizeHoleNumberTo1to18(s.hole_number);
    if (!Number.isFinite(hn)) continue;
    scoreByRoundPlayerHole.set(`${s.round_id}|${s.player_id}|${hn}`, s);
  }

  const playerById = new Map(players.map((p) => [p.id, p]));
  const holes = Array.from({ length: 18 }, (_, i) => i + 1);

  const tourRounds: TourRoundContextLocal[] = rounds
    .filter((r) => !!r.id)
    .map((r) => {
      const courseId = r.course_id;
      const roundId = r.id;

      const byTee = courseId ? parsByCourseTeeHole.get(courseId) : undefined;

      // Baseline arrays are still provided for compatibility.
      // Use Men's if present, else Women's, else zeros.
      const baselineTee: Tee = byTee?.has("M") ? "M" : "F";
      const baselineMap = byTee?.get(baselineTee);

      const parsByHole = holes.map((h) => baselineMap?.get(h)?.par ?? 0);
      const strokeIndexByHole = holes.map((h) => baselineMap?.get(h)?.si ?? 0);

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
        // If not playing in that round, treat as complete (lets comps skip/ignore)
        if (!isPlayingInRound(playerId)) return true;
        const arr = scoresMatrix[playerId] ?? Array(18).fill("");
        for (let i = 0; i < 18; i++) if (!String(arr[i] ?? "").trim()) return false;
        return true;
      };

      // ✅ Tee-specific par (used for bucketing Par 3/4/5 comps)
      const parForPlayerHole = (playerId: string, holeIndex: number) => {
        const player = playerById.get(playerId);
        const tee: Tee = normalizeTee(player?.gender);
        const holeNo = holeIndex + 1;

        const map = byTee?.get(tee) ?? byTee?.get("M") ?? byTee?.get("F");
        const parVal = Number(map?.get(holeNo)?.par ?? 0);
        return Number.isFinite(parVal) ? parVal : 0;
      };

      const netPointsForHole = (playerId: string, holeIndex: number) => {
        const player = playerById.get(playerId);
        if (!player) return 0;

        // Not playing? score 0
        if (!isPlayingInRound(playerId)) return 0;

        const tee: Tee = normalizeTee(player.gender);
        const holeNo = holeIndex + 1;

        const map = byTee?.get(tee) ?? byTee?.get("M") ?? byTee?.get("F");
        const info = map?.get(holeNo);
        if (!info) return 0;

        const rp = rpByRoundPlayer.get(`${roundId}|${playerId}`);
        const hcp = Number.isFinite(Number(rp?.playing_handicap)) ? Number(rp?.playing_handicap) : 0;

        const raw = String(scoresMatrix[playerId]?.[holeIndex] ?? "").trim().toUpperCase();

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
      };
    });

  // For tour competitions, ctx.players.playing is used only by eligibility.onlyPlaying.
  // Consider a player "playing" in tour scope if they are marked playing in ANY round.
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
