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

function clampHoleTo1to18(h: any): number | null {
  const n = Number(h);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 18) return null;
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
  for (const rp of roundPlayers) rpByRoundPlayer.set(`${String(rp.round_id)}|${String(rp.player_id)}`, rp);

  // course -> tee -> hole -> {par, si}
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

  /**
   * ✅ Robust score grouping:
   * round|player -> hole(1..18) -> raw string ("", "P", "5", etc)
   *
   * This avoids brittle “composed key lookup per cell”.
   */
  const scoresByRoundPlayer = new Map<string, Map<number, string>>();
  for (const s of scores) {
    const roundId = String(s.round_id);
    const playerId = String(s.player_id);
    const holeNo = clampHoleTo1to18(s.hole_number);
    if (!holeNo) continue;

    const key = `${roundId}|${playerId}`;
    if (!scoresByRoundPlayer.has(key)) scoresByRoundPlayer.set(key, new Map());

    const raw = normalizeRawScore(s.strokes, s.pickup).trim().toUpperCase();
    scoresByRoundPlayer.get(key)!.set(holeNo, raw);
  }

  const playerById = new Map(players.map((p) => [String(p.id), p]));
  const holes = Array.from({ length: 18 }, (_, i) => i + 1);

  const tourRounds: TourRoundContextLocal[] = rounds
    .filter((r) => !!r.id)
    .map((r) => {
      const courseId = r.course_id ? String(r.course_id) : null;
      const roundId = String(r.id);

      const byTee = courseId ? parsByCourseTeeHole.get(courseId) : undefined;

      // Baseline arrays are still provided for compatibility.
      // Use Men's if present, else Women's, else zeros.
      const baselineTee: Tee = byTee?.has("M") ? "M" : "F";
      const baselineMap = byTee?.get(baselineTee);

      const parsByHole = holes.map((h) => baselineMap?.get(h)?.par ?? 0);
      const strokeIndexByHole = holes.map((h) => baselineMap?.get(h)?.si ?? 0);

      // Build 18-length raw-score arrays per player from grouped scores
      const scoresMatrix: Record<string, string[]> = {};
      for (const p of players) {
        const pid = String(p.id);
        const arr = Array(18).fill("");

        const key = `${roundId}|${pid}`;
        const byHole = scoresByRoundPlayer.get(key);

        if (byHole) {
          for (let hole = 1; hole <= 18; hole++) {
            const v = byHole.get(hole);
            if (typeof v === "string") arr[hole - 1] = v;
          }
        }

        scoresMatrix[pid] = arr;
      }

      const isPlayingInRound = (playerId: string) => {
        const rp = rpByRoundPlayer.get(`${roundId}|${String(playerId)}`);
        return rp ? rp.playing === true : false;
      };

      const isComplete = (playerId: string) => {
        // If not playing in that round, treat as complete (lets comps skip/ignore)
        if (!isPlayingInRound(playerId)) return true;
        const arr = scoresMatrix[String(playerId)] ?? Array(18).fill("");
        for (let i = 0; i < 18; i++) if (!String(arr[i] ?? "").trim()) return false;
        return true;
      };

      // ✅ Tee-specific par (used for bucketing Par 3/4/5 comps)
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

        // Not playing? score 0
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
      };
    });

  // For tour competitions, ctx.players.playing is used only by eligibility.onlyPlaying.
  // Consider a player "playing" in tour scope if they are marked playing in ANY round.
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

  return ctx;
}
