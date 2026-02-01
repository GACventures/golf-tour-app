// lib/competitions/h2z.ts

/**
 * H2Z rules:
 * - Par 3 holes only
 * - Add Stableford points
 * - Reset running total when points === 0
 * - Report finalScore, bestScore, bestLen
 *
 * IMPORTANT:
 * - holeIndex MUST align with ctx.rounds order
 * - DO NOT reorder rounds for holeIndex
 */

export type H2ZLeg = {
  tour_id?: string;
  leg_no: number;
  start_round_no: number;
  end_round_no: number;
};

export type H2ZResult = {
  finalScore: number;
  bestScore: number;
  bestLen: number;
};

export type H2ZPar3Event = {
  round_id: string;
  round_index: number;
  round_no_effective: number;
  hole_number: number;
  hole_index: number;
  par: number | null;
  strokes_raw: string | null;
  stableford_points: number;
  running_before: number;
  running_after: number;
  reset: boolean;
};

export type H2ZDiagnostic = {
  player_id: string;
  leg: Pick<H2ZLeg, "leg_no" | "start_round_no" | "end_round_no">;
  issues: string[];
  rounds_included: Array<{
    round_id: string;
    round_index: number;
    round_no_effective: number;
  }>;
  par3_events: H2ZPar3Event[];
};

type AnyCompetitionContext = {
  rounds?: any[];
  scores?: any;
  netPointsForHole?: (playerId: string, holeIndex: number) => number;
  parForPlayerHole?: (playerId: string, holeIndex: number) => number | null;
};

function safeInt(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/* ============================================================================
   INTERNAL CORE IMPLEMENTATION (new API)
   ========================================================================== */

function _computeH2ZCore(
  ctx: AnyCompetitionContext,
  playerId: string,
  leg: H2ZLeg,
  diagnostic: boolean
): { result: H2ZResult; diagnostic?: H2ZDiagnostic } {
  const issues: string[] = [];

  if (!Array.isArray(ctx.rounds)) {
    issues.push("ctx.rounds missing or not array");
    return {
      result: { finalScore: 0, bestScore: 0, bestLen: 0 },
      diagnostic: diagnostic
        ? {
            player_id: playerId,
            leg,
            issues,
            rounds_included: [],
            par3_events: [],
          }
        : undefined,
    };
  }

  const rounds = ctx.rounds.map((r, idx) => ({
    round_id: r.id,
    round_index: idx,
    round_no_effective: safeInt(r.round_no) ?? idx + 1,
  }));

  const lo = Math.min(leg.start_round_no, leg.end_round_no);
  const hi = Math.max(leg.start_round_no, leg.end_round_no);

  const roundsIncluded = rounds.filter(
    (r) => r.round_no_effective >= lo && r.round_no_effective <= hi
  );

  if (roundsIncluded.length === 0) {
    issues.push(`No rounds included for leg ${leg.leg_no}`);
  }

  let running = 0;
  let bestScore = 0;
  let bestLen = 0;
  let currentLen = 0;

  const events: H2ZPar3Event[] = [];

  for (const r of roundsIncluded) {
    for (let hole = 1; hole <= 18; hole++) {
      const holeIndex = r.round_index * 18 + (hole - 1);
      const par = ctx.parForPlayerHole?.(playerId, holeIndex) ?? null;

      if (par !== 3) continue;

      const pts = ctx.netPointsForHole?.(playerId, holeIndex) ?? 0;
      const strokesRaw =
        ctx.scores?.[playerId]?.[holeIndex] != null
          ? String(ctx.scores[playerId][holeIndex])
          : null;

      const before = running;
      let reset = false;

      if (pts === 0) {
        running = 0;
        currentLen = 0;
        reset = true;
      } else {
        running += pts;
        currentLen += 1;
        if (running > bestScore) {
          bestScore = running;
          bestLen = currentLen;
        }
      }

      if (diagnostic) {
        events.push({
          round_id: r.round_id,
          round_index: r.round_index,
          round_no_effective: r.round_no_effective,
          hole_number: hole,
          hole_index: holeIndex,
          par,
          strokes_raw: strokesRaw,
          stableford_points: pts,
          running_before: before,
          running_after: running,
          reset,
        });
      }
    }
  }

  const result = { finalScore: running, bestScore, bestLen };

  if (!diagnostic) return { result };

  return {
    result,
    diagnostic: {
      player_id: playerId,
      leg,
      issues,
      rounds_included: roundsIncluded,
      par3_events: events,
    },
  };
}

/* ============================================================================
   PUBLIC API — BACKWARD + FORWARD COMPATIBLE
   ========================================================================== */

/**
 * NEW API:
 *   computeH2ZForPlayer(ctx, playerId, leg, { diagnostic })
 *
 * OLD API (used by page.tsx):
 *   computeH2ZForPlayer({ ctx, playerId, legs, diagnostic })
 */
export function computeH2ZForPlayer(
  arg1: any,
  arg2?: any,
  arg3?: any,
  arg4?: any
): { result: H2ZResult; diagnostic?: H2ZDiagnostic } {
  // OLD OBJECT-STYLE API
  if (typeof arg1 === "object" && arg1?.ctx && arg1?.playerId && arg1?.legs) {
    const { ctx, playerId, legs, diagnostic } = arg1;
    const leg = legs[0]; // page.tsx already loops legs
    return _computeH2ZCore(ctx, playerId, leg, !!diagnostic);
  }

  // NEW POSITIONAL API
  return _computeH2ZCore(arg1, arg2, arg3, !!arg4?.diagnostic);
}

export function buildH2ZDiagnostic(
  ctx: AnyCompetitionContext,
  playerId: string,
  leg: H2ZLeg
): H2ZDiagnostic {
  return _computeH2ZCore(ctx, playerId, leg, true).diagnostic!;
}
