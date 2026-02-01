// lib/competitions/h2z.ts
import type { CompetitionContext } from "./types";

/**
 * A H2Z "leg" is a range of rounds (by round_no) over which we compute
 * the H2Z score and peak run for each player.
 */
export type H2ZLeg = {
  leg_no: number;
  start_round_no: number;
  end_round_no: number;
};

export type H2ZLegResult = {
  finalScore: number;
  bestScore: number;
  bestLen: number;

  /**
   * Peak segment "where" markers. These can span multiple rounds.
   * Round numbers here are round_no, not round_id.
   */
  bestStartRoundNo: number | null;
  bestStartHoleNo: number | null;
  bestEndRoundNo: number | null;
  bestEndHoleNo: number | null;

  /**
   * Human friendly string (used by UI)
   * e.g. "R2 H4 → R2 H12" or "R2 H4 → R3 H7"
   */
  bestWhere: string | null;
};

function safeInt(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function fmtWhere(
  sR: number | null,
  sH: number | null,
  eR: number | null,
  eH: number | null
): string | null {
  if (!sR || !sH || !eR || !eH) return null;
  if (sR === eR) return `R${sR} H${sH}–H${eH}`;
  return `R${sR} H${sH} → R${eR} H${eH}`;
}

/**
 * Compute H2Z per leg for a single player.
 *
 * Rules (as implemented):
 * - Consider only Par 3 holes for that player (tee-specific par via ctx.rounds[].parForPlayerHole).
 * - Iterate rounds chronologically using roundsInOrder (round_no order) and hole 1..18.
 * - Maintain a running total ("current") and length ("currentLen") counting only Par 3 holes.
 * - If Stableford points on a Par 3 hole is 0, reset current + currentLen to 0.
 * - Otherwise, add points and increment currentLen.
 * - Track bestScore + bestLen + where (start/end round_no & hole_no).
 */
export function computeH2ZForPlayer(params: {
  ctx: CompetitionContext;
  legs: H2ZLeg[];
  roundsInOrder: Array<{ roundId: string; round_no: number | null }>;
  isPlayingInRound: (roundId: string, playerId: string) => boolean;
  playerId: string;
}): Record<number, H2ZLegResult> {
  const { ctx, legs, roundsInOrder, isPlayingInRound, playerId } = params;

  const out: Record<number, H2ZLegResult> = {};

  for (const leg of legs) {
    const startNo = safeInt(leg.start_round_no, 0);
    const endNo = safeInt(leg.end_round_no, 0);

    // default result
    let current = 0;
    let currentLen = 0;

    let bestScore = 0;
    let bestLen = 0;

    // Track current segment start
    let segStartRoundNo: number | null = null;
    let segStartHoleNo: number | null = null;

    // Track best segment boundaries
    let bestStartRoundNo: number | null = null;
    let bestStartHoleNo: number | null = null;
    let bestEndRoundNo: number | null = null;
    let bestEndHoleNo: number | null = null;

    const roundsForLeg = roundsInOrder.filter((r) => {
      const rn = safeInt(r.round_no, 0);
      return rn >= startNo && rn <= endNo;
    });

    for (const r of roundsForLeg) {
      const rn = safeInt(r.round_no, 0);
      if (!r.roundId) continue;

      // If not playing, skip the entire round (does not reset).
      if (!isPlayingInRound(r.roundId, playerId)) continue;

      const roundCtx = (ctx as any)?.rounds?.find((x: any) => x.roundId === r.roundId);
      if (!roundCtx) continue;

      for (let holeIndex = 0; holeIndex < 18; holeIndex++) {
        const holeNo = holeIndex + 1;

        // Tee-specific par for this player/hole
        const par = Number(roundCtx?.parForPlayerHole?.(playerId, holeIndex) ?? 0);
        if (par !== 3) continue;

        const pts = Number(roundCtx?.netPointsForHole?.(playerId, holeIndex) ?? 0);

        if (!Number.isFinite(pts) || pts <= 0) {
          // Reset on 0 points for Par 3
          current = 0;
          currentLen = 0;
          segStartRoundNo = null;
          segStartHoleNo = null;
          continue;
        }

        // Start segment if needed
        if (currentLen === 0) {
          segStartRoundNo = rn;
          segStartHoleNo = holeNo;
        }

        current += pts;
        currentLen += 1;

        // Update best peak
        if (current > bestScore) {
          bestScore = current;
          bestLen = currentLen;

          bestStartRoundNo = segStartRoundNo;
          bestStartHoleNo = segStartHoleNo;
          bestEndRoundNo = rn;
          bestEndHoleNo = holeNo;
        }
      }
    }

    const bestWhere = fmtWhere(bestStartRoundNo, bestStartHoleNo, bestEndRoundNo, bestEndHoleNo);

    out[leg.leg_no] = {
      finalScore: current,
      bestScore,
      bestLen,
      bestStartRoundNo,
      bestStartHoleNo,
      bestEndRoundNo,
      bestEndHoleNo,
      bestWhere,
    };
  }

  return out;
}
