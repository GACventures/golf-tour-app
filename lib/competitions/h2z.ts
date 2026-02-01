// lib/competitions/h2z.ts

/**
 * H2Z rules:
 * - Par 3 holes only
 * - Add Stableford points
 * - Reset running total when points === 0
 * - Report finalScore, bestScore, bestLen
 *
 * CRITICAL:
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

  current_run_len_after: number;
  current_run_score_after: number;
  best_score_after: number;
  best_len_after: number;
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

  summary: {
    included_round_count: number;
    par3_count_seen: number;
  };
};

export type H2ZPerLegMap = Record<number, H2ZResult>;

type AnyCompetitionContext = {
  rounds?: any[];
  scores?: Record<string, any[]>;
  netPointsForHole?: (playerId: string, holeIndex: number) => number;
  parForPlayerHole?: (playerId: string, holeIndex: number) => number | null;
};

function safeInt(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/* ============================================================================
   INTERNAL CORE (single leg -> structured diagnostic object)
   ========================================================================== */

function computeSingleLeg(
  ctx: AnyCompetitionContext,
  playerId: string,
  leg: H2ZLeg,
  diagnostic: boolean
): { result: H2ZResult; diagnostic?: H2ZDiagnostic } {
  const issues: string[] = [];

  if (!Array.isArray(ctx.rounds)) {
    issues.push("ctx.rounds missing or not array");
    const empty: H2ZResult = { finalScore: 0, bestScore: 0, bestLen: 0 };
    return {
      result: empty,
      diagnostic: diagnostic
        ? {
            player_id: playerId,
            leg: { leg_no: leg.leg_no, start_round_no: leg.start_round_no, end_round_no: leg.end_round_no },
            issues,
            rounds_included: [],
            par3_events: [],
            summary: { included_round_count: 0, par3_count_seen: 0 },
          }
        : undefined,
    };
  }

  const roundsAll = ctx.rounds
    .map((r: any, idx: number) => ({
      round_id: r?.id as string,
      round_index: idx,
      round_no_effective: safeInt(r?.round_no) ?? idx + 1,
    }))
    .filter((r) => !!r.round_id);

  const lo = Math.min(leg.start_round_no, leg.end_round_no);
  const hi = Math.max(leg.start_round_no, leg.end_round_no);

  const roundsIncluded = roundsAll.filter(
    (r) => r.round_no_effective >= lo && r.round_no_effective <= hi
  );

  if (roundsIncluded.length === 0) {
    issues.push(`No rounds included for leg ${leg.leg_no} with bounds [${lo}..${hi}]`);
  }

  let running = 0;
  let bestScore = 0;

  let currentRunScore = 0;
  let currentRunLen = 0;
  let bestLen = 0;

  const events: H2ZPar3Event[] = [];

  for (const r of roundsIncluded) {
    for (let hole = 1; hole <= 18; hole++) {
      const holeIndex = r.round_index * 18 + (hole - 1);

      const par = ctx.parForPlayerHole ? ctx.parForPlayerHole(playerId, holeIndex) : null;
      if (par !== 3) continue;

      const strokesRaw =
        ctx.scores?.[playerId]?.[holeIndex] != null ? String(ctx.scores[playerId][holeIndex]) : null;

      let pts = 0;
      if (ctx.netPointsForHole) {
        const rawPts = ctx.netPointsForHole(playerId, holeIndex);
        pts = isFiniteNumber(rawPts) ? rawPts : 0;
        if (!isFiniteNumber(rawPts)) {
          issues.push(`Non-numeric points at holeIndex=${holeIndex}; treating as 0`);
        }
      } else {
        issues.push("ctx.netPointsForHole missing; treating all points as 0");
      }

      const runningBefore = running;

      let reset = false;
      if (pts === 0) {
        running = 0;
        currentRunScore = 0;
        currentRunLen = 0;
        reset = true;
      } else {
        running += pts;
        currentRunScore += pts;
        currentRunLen += 1;

        if (running > bestScore) {
          bestScore = running;
          bestLen = currentRunLen;
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
          running_before: runningBefore,
          running_after: running,
          reset,
          current_run_len_after: currentRunLen,
          current_run_score_after: currentRunScore,
          best_score_after: bestScore,
          best_len_after: bestLen,
        });
      }
    }
  }

  const result: H2ZResult = { finalScore: running, bestScore, bestLen };

  if (!diagnostic) return { result };

  return {
    result,
    diagnostic: {
      player_id: playerId,
      leg: { leg_no: leg.leg_no, start_round_no: leg.start_round_no, end_round_no: leg.end_round_no },
      issues,
      rounds_included: roundsIncluded,
      par3_events: events,
      summary: { included_round_count: roundsIncluded.length, par3_count_seen: events.length },
    },
  };
}

/* ============================================================================
   PUBLIC API — compute supports legacy object-style call
   ========================================================================== */

// Legacy object-style API for compute (used by page.tsx)
export type LegacyComputeArgs = {
  ctx: AnyCompetitionContext;
  playerId: string;
  legs: H2ZLeg[];
  diagnostic?: boolean;
  [k: string]: any;
};

export function computeH2ZForPlayer(args: LegacyComputeArgs): H2ZPerLegMap;
export function computeH2ZForPlayer(
  ctx: AnyCompetitionContext,
  playerId: string,
  leg: H2ZLeg,
  opts?: { diagnostic?: boolean }
): { result: H2ZResult; diagnostic?: H2ZDiagnostic };

export function computeH2ZForPlayer(arg1: any, arg2?: any, arg3?: any, arg4?: any): any {
  // Legacy object call: returns map keyed by leg_no
  if (typeof arg1 === "object" && arg1?.ctx && arg1?.playerId && Array.isArray(arg1?.legs)) {
    const args = arg1 as LegacyComputeArgs;
    const out: H2ZPerLegMap = {};
    for (const leg of args.legs) {
      out[leg.leg_no] = computeSingleLeg(args.ctx, args.playerId, leg, false).result;
    }
    return out;
  }

  // New positional call
  const ctx = arg1 as AnyCompetitionContext;
  const playerId = arg2 as string;
  const leg = arg3 as H2ZLeg;
  const diagnostic = !!arg4?.diagnostic;
  return computeSingleLeg(ctx, playerId, leg, diagnostic);
}

/* ============================================================================
   PUBLIC API — Diagnostic
   ========================================================================== */

/**
 * NEW helper: return structured object (not used by page.tsx)
 */
export function buildH2ZDiagnosticObject(ctx: AnyCompetitionContext, playerId: string, leg: H2ZLeg): H2ZDiagnostic {
  return computeSingleLeg(ctx, playerId, leg, true).diagnostic!;
}

/**
 * LEGACY helper expected by page.tsx:
 * buildH2ZDiagnostic(...) MUST return string[] (lines) so the page can do .join("\n")
 *
 * We support two forms:
 *  1) buildH2ZDiagnostic({ ctx, playerId, leg, ... })
 *  2) buildH2ZDiagnostic(ctx, playerId, leg)
 */
export type LegacyBuildDiagnosticArgs = {
  ctx: AnyCompetitionContext;

  // Most likely passed:
  playerId?: string;
  leg?: H2ZLeg;

  // Sometimes:
  selectedPlayerId?: string;
  selectedLeg?: H2ZLeg;

  // If not provided, we’ll emit an error lines list:
  [k: string]: any;
};

export function buildH2ZDiagnostic(args: LegacyBuildDiagnosticArgs): string[];
export function buildH2ZDiagnostic(ctx: AnyCompetitionContext, playerId: string, leg: H2ZLeg): string[];

export function buildH2ZDiagnostic(arg1: any, arg2?: any, arg3?: any): string[] {
  // Legacy object call
  if (typeof arg1 === "object" && arg1?.ctx) {
    const args = arg1 as LegacyBuildDiagnosticArgs;
    const ctx = args.ctx;
    const playerId = (args.playerId ?? args.selectedPlayerId) as string | undefined;
    const leg = (args.leg ?? args.selectedLeg) as H2ZLeg | undefined;

    if (!playerId || !leg) {
      return [
        "H2Z diagnostic: missing playerId or leg in legacy call.",
        `playerId=${String(playerId)}`,
        `leg=${leg ? JSON.stringify(leg) : "null"}`,
      ];
    }

    const diag = buildH2ZDiagnosticObject(ctx, playerId, leg);
    return diagnosticObjectToLines(diag);
  }

  // New positional call
  const ctx = arg1 as AnyCompetitionContext;
  const playerId = arg2 as string;
  const leg = arg3 as H2ZLeg;

  const diag = buildH2ZDiagnosticObject(ctx, playerId, leg);
  return diagnosticObjectToLines(diag);
}

function diagnosticObjectToLines(diag: H2ZDiagnostic): string[] {
  const lines: string[] = [];

  lines.push(`player=${diag.player_id}`);
  lines.push(`leg=${diag.leg.leg_no} rounds ${diag.leg.start_round_no}..${diag.leg.end_round_no}`);

  if (diag.issues.length) {
    lines.push("issues:");
    for (const i of diag.issues) lines.push(`- ${i}`);
  }

  lines.push(`includedRounds=${diag.rounds_included.length}`);
  for (const r of diag.rounds_included) {
    lines.push(`- round_index=${r.round_index} round_no_effective=${r.round_no_effective} round_id=${r.round_id}`);
  }

  lines.push(`par3_events=${diag.par3_events.length}`);
  for (const e of diag.par3_events) {
    lines.push(
      `R${e.round_no_effective} h${e.hole_number} idx=${e.hole_index} par=${e.par} strokes=${e.strokes_raw ?? "null"} pts=${e.stableford_points} ` +
        `run ${e.running_before}->${e.running_after}${e.reset ? " RESET" : ""}`
    );
  }

  lines.push(
    `summary: included_round_count=${diag.summary.included_round_count} par3_count_seen=${diag.summary.par3_count_seen}`
  );

  return lines;
}
