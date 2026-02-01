import type { CompetitionContext } from "./types";

export type H2ZLeg = {
  leg_no: number;
  start_round_no: number;
  end_round_no: number;
};

export type H2ZLegResult = {
  finalScore: number; // running score at end of leg
  bestScore: number; // peak running score (max)
  bestLen: number; // number of par-3 holes in that peak run (since last reset)
};

export type H2ZTraceRow = {
  leg_no: number;
  round_no: number;
  hole_no: number; // 1..18
  par: number;
  raw: string; // strokes or "P" or ""
  stableford: number; // points on that hole (net stableford)
  h2z_after: number; // running total after processing this hole
};

type CompetitionContextWithRounds = CompetitionContext & {
  // TourCompetitionContextLocal has this; CompetitionContext base type doesn't.
  rounds?: any[];
};

function safeNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * H2Z scoring rule:
 * - Only Par 3 holes are counted
 * - Add net stableford points for each Par 3 hole
 * - Reset running total to 0 whenever stableford points on a Par 3 hole == 0
 */
export function computeH2ZForPlayer(params: {
  ctx: CompetitionContextWithRounds;
  legs: H2ZLeg[];
  roundsInOrder: Array<{ roundId: string; round_no: number | null }>;
  isPlayingInRound: (roundId: string, playerId: string) => boolean;
  playerId: string;
}): Record<number, H2ZLegResult> {
  const { ctx, legs, roundsInOrder, isPlayingInRound, playerId } = params;

  const results: Record<number, H2ZLegResult> = {};

  for (const leg of legs) {
    // Filter rounds within leg range (inclusive)
    const legRounds = roundsInOrder.filter((r) => {
      const rn = safeNum(r.round_no, NaN);
      return Number.isFinite(rn) && rn >= leg.start_round_no && rn <= leg.end_round_no;
    });

    let running = 0;
    let best = 0;
    let currentRunLen = 0;
    let bestLen = 0;

    for (const r of legRounds) {
      if (!isPlayingInRound(r.roundId, playerId)) continue;

      // Find round context in ctx
      const roundCtx = (ctx.rounds ?? []).find((x: any) => String(x.roundId) === String(r.roundId));
      if (!roundCtx) continue;

      for (let holeIndex = 0; holeIndex < 18; holeIndex++) {
        const par = safeNum(roundCtx?.parForPlayerHole?.(playerId, holeIndex), 0);
        if (par !== 3) continue;

        const pts = safeNum(roundCtx?.netPointsForHole?.(playerId, holeIndex), 0);

        if (pts === 0) {
          running = 0;
          currentRunLen = 0;
        } else {
          running += pts;
          currentRunLen += 1;

          if (running > best) {
            best = running;
            bestLen = currentRunLen;
          }
        }
      }
    }

    results[leg.leg_no] = {
      finalScore: running,
      bestScore: best,
      bestLen: bestLen,
    };
  }

  return results;
}

/**
 * Diagnostic trace:
 * For a given leg, returns every Par 3 "event" encountered in order with:
 * round_no, hole_no, raw strokes, stableford points, and H2Z running total after that hole.
 */
export function traceH2ZForPlayerLeg(params: {
  ctx: CompetitionContextWithRounds;
  leg: H2ZLeg;
  roundsInOrder: Array<{ roundId: string; round_no: number | null }>;
  isPlayingInRound: (roundId: string, playerId: string) => boolean;
  playerId: string;
}): H2ZTraceRow[] {
  const { ctx, leg, roundsInOrder, isPlayingInRound, playerId } = params;

  const rows: H2ZTraceRow[] = [];

  const legRounds = roundsInOrder.filter((r) => {
    const rn = safeNum(r.round_no, NaN);
    return Number.isFinite(rn) && rn >= leg.start_round_no && rn <= leg.end_round_no;
  });

  let running = 0;

  for (const r of legRounds) {
    const roundNo = safeNum(r.round_no, 0);
    if (!isPlayingInRound(r.roundId, playerId)) continue;

    const roundCtx = (ctx.rounds ?? []).find((x: any) => String(x.roundId) === String(r.roundId));
    if (!roundCtx) continue;

    for (let holeIndex = 0; holeIndex < 18; holeIndex++) {
      const holeNo = holeIndex + 1;

      const par = safeNum(roundCtx?.parForPlayerHole?.(playerId, holeIndex), 0);
      if (par !== 3) continue;

      const raw = String(roundCtx?.scores?.[playerId]?.[holeIndex] ?? "").trim().toUpperCase();
      const pts = safeNum(roundCtx?.netPointsForHole?.(playerId, holeIndex), 0);

      if (pts === 0) {
        running = 0;
      } else {
        running += pts;
      }

      rows.push({
        leg_no: leg.leg_no,
        round_no: roundNo,
        hole_no: holeNo,
        par,
        raw,
        stableford: pts,
        h2z_after: running,
      });
    }
  }

  return rows;
}
