// lib/competitions/h2z.ts

/**
 * H2Z rules:
 * - Consider Par 3 holes only
 * - Add Stableford points on each Par 3
 * - Reset running total to 0 whenever Stableford points === 0 on a Par 3
 * - Report per-leg:
 *   finalScore (running total at end of leg)
 *   bestScore (peak running total within the leg)
 *   bestLen (count of Par 3 holes in that best run)
 *
 * IMPORTANT (from mobile page contract):
 * - computeH2ZForPlayer is called with an object arg:
 *   { ctx, legs, roundsInOrder, isPlayingInRound, playerId }
 *   and must return Record<leg_no, H2ZResult>
 * - buildH2ZDiagnostic is called with an object arg:
 *   { ctx, roundsInOrder, isPlayingInRound, playerId, start_round_no, end_round_no }
 *   and must return string[] lines (so UI can .join("\n"))
 *
 * CRITICAL ALIGNMENT:
 * - The competition context flattens holes by ctx.rounds order (which in this page is sortedRounds).
 * - roundsInOrder is built from sortedRounds, so we use it as the canonical ordering.
 * - holeIndex = roundIndex*18 + (hole-1)
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

export type H2ZPerLegMap = Record<number, H2ZResult>;

type RoundInOrder = { roundId: string; round_no: number | null };

type AnyCompetitionContext = {
  // These are provided by buildTourCompetitionContext
  scores?: Record<string, any[]>;
  netPointsForHole?: (playerId: string, holeIndex: number) => number;
  parForPlayerHole?: (playerId: string, holeIndex: number) => number | null;
};

type IsPlayingInRoundFn = (roundId: string, playerId: string) => boolean;

function safeInt(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function normalizeRoundsInOrder(
  roundsInOrder: RoundInOrder[] | undefined,
  issues: string[]
): Array<{ roundId: string; roundIndex: number; roundNo: number }> {
  if (!Array.isArray(roundsInOrder) || roundsInOrder.length === 0) {
    issues.push("roundsInOrder missing/empty");
    return [];
  }

  const out: Array<{ roundId: string; roundIndex: number; roundNo: number }> = [];

  for (let i = 0; i < roundsInOrder.length; i++) {
    const r = roundsInOrder[i];
    const rid = String(r?.roundId ?? "").trim();
    if (!rid) {
      issues.push(`roundsInOrder[${i}] missing roundId (ignored)`);
      continue;
    }

    const rn = safeInt(r?.round_no);
    const roundNo = rn ?? i + 1; // infer if null
    if (rn == null) {
      issues.push(`roundId=${rid} has null round_no; inferred roundNo=${roundNo} from order`);
    }

    out.push({ roundId: rid, roundIndex: i, roundNo });
  }

  return out;
}

function computeH2ZForOneLeg(params: {
  ctx: AnyCompetitionContext;
  playerId: string;
  leg: { leg_no: number; start_round_no: number; end_round_no: number };
  roundsInOrder: RoundInOrder[];
  isPlayingInRound: IsPlayingInRoundFn;
}): {
  result: H2ZResult;
  diag: {
    issues: string[];
    includedRounds: Array<{ roundId: string; roundIndex: number; roundNo: number; playing: boolean }>;
    par3Events: Array<{
      roundNo: number;
      hole: number;
      holeIndex: number;
      par: number | null;
      strokesRaw: string | null;
      pts: number;
      runningBefore: number;
      runningAfter: number;
      reset: boolean;
    }>;
  };
} {
  const { ctx, playerId, leg, roundsInOrder, isPlayingInRound } = params;

  const issues: string[] = [];

  if (typeof ctx.netPointsForHole !== "function") issues.push("ctx.netPointsForHole missing");
  if (typeof ctx.parForPlayerHole !== "function") issues.push("ctx.parForPlayerHole missing");

  const rounds = normalizeRoundsInOrder(roundsInOrder, issues);
  if (rounds.length === 0) {
    const empty: H2ZResult = { finalScore: 0, bestScore: 0, bestLen: 0 };
    return { result: empty, diag: { issues, includedRounds: [], par3Events: [] } };
  }

  const start = safeInt(leg.start_round_no);
  const end = safeInt(leg.end_round_no);

  if (start == null || end == null) {
    issues.push(`Invalid leg bounds: start_round_no=${String(leg.start_round_no)} end_round_no=${String(leg.end_round_no)}`);
    const empty: H2ZResult = { finalScore: 0, bestScore: 0, bestLen: 0 };
    return { result: empty, diag: { issues, includedRounds: [], par3Events: [] } };
  }

  const lo = Math.min(start, end);
  const hi = Math.max(start, end);

  const includedRounds: Array<{ roundId: string; roundIndex: number; roundNo: number; playing: boolean }> = [];
  for (const r of rounds) {
    const within = r.roundNo >= lo && r.roundNo <= hi;
    if (!within) continue;

    const playing = !!isPlayingInRound(r.roundId, playerId);
    includedRounds.push({ ...r, playing });
  }

  const playableRounds = includedRounds.filter((r) => r.playing);

  if (includedRounds.length === 0) {
    issues.push(`Leg ${leg.leg_no} selected zero rounds using bounds [${lo}..${hi}]`);
  } else if (playableRounds.length === 0) {
    issues.push(`Leg ${leg.leg_no} rounds exist, but player is not marked playing in any included round (round_players.playing=false)`);
  }

  let running = 0;
  let bestScore = 0;
  let bestLen = 0;

  let currentRunLen = 0;
  let currentRunScore = 0;

  const par3Events: Array<{
    roundNo: number;
    hole: number;
    holeIndex: number;
    par: number | null;
    strokesRaw: string | null;
    pts: number;
    runningBefore: number;
    runningAfter: number;
    reset: boolean;
  }> = [];

  for (const r of playableRounds) {
    for (let hole = 1; hole <= 18; hole++) {
      const holeIndex = r.roundIndex * 18 + (hole - 1);

      const par = ctx.parForPlayerHole ? ctx.parForPlayerHole(playerId, holeIndex) : null;
      if (par !== 3) continue;

      const strokesRaw =
        ctx.scores?.[playerId]?.[holeIndex] != null ? String(ctx.scores[playerId][holeIndex]) : null;

      let pts = 0;
      if (ctx.netPointsForHole) {
        const rawPts = ctx.netPointsForHole(playerId, holeIndex);
        pts = isFiniteNumber(rawPts) ? rawPts : 0;
        if (!isFiniteNumber(rawPts)) issues.push(`Non-numeric points at holeIndex=${holeIndex}; treating as 0`);
      }

      const runningBefore = running;

      let reset = false;
      if (pts === 0) {
        running = 0;
        currentRunLen = 0;
        currentRunScore = 0;
        reset = true;
      } else {
        running += pts;
        currentRunLen += 1;
        currentRunScore += pts;

        if (running > bestScore) {
          bestScore = running;
          bestLen = currentRunLen;
        }
      }

      par3Events.push({
        roundNo: r.roundNo,
        hole,
        holeIndex,
        par,
        strokesRaw,
        pts,
        runningBefore,
        runningAfter: running,
        reset,
      });
    }
  }

  const result: H2ZResult = {
    finalScore: running,
    bestScore,
    bestLen,
  };

  return { result, diag: { issues, includedRounds, par3Events } };
}

/**
 * Legacy compute API used by page.tsx
 */
export type LegacyComputeArgs = {
  ctx: AnyCompetitionContext;
  legs: H2ZLeg[];
  roundsInOrder: RoundInOrder[];
  isPlayingInRound: IsPlayingInRoundFn;
  playerId: string;
};

export function computeH2ZForPlayer(args: LegacyComputeArgs): H2ZPerLegMap {
  const out: H2ZPerLegMap = {};

  const legs = Array.isArray(args.legs) ? args.legs : [];
  for (const leg of legs) {
    const computed = computeH2ZForOneLeg({
      ctx: args.ctx,
      playerId: args.playerId,
      leg,
      roundsInOrder: args.roundsInOrder,
      isPlayingInRound: args.isPlayingInRound,
    });
    out[leg.leg_no] = computed.result;
  }

  return out;
}

/**
 * Legacy diagnostic API used by page.tsx.
 * Must return string[] so UI can do .join("\n")
 */
export type LegacyBuildDiagnosticArgs = {
  ctx: AnyCompetitionContext;
  roundsInOrder: RoundInOrder[];
  isPlayingInRound: IsPlayingInRoundFn;
  playerId: string;
  start_round_no: number;
  end_round_no: number;
};

export function buildH2ZDiagnostic(args: LegacyBuildDiagnosticArgs): string[] {
  const leg = {
    leg_no: 0,
    start_round_no: args.start_round_no,
    end_round_no: args.end_round_no,
  };

  const computed = computeH2ZForOneLeg({
    ctx: args.ctx,
    playerId: args.playerId,
    leg,
    roundsInOrder: args.roundsInOrder,
    isPlayingInRound: args.isPlayingInRound,
  });

  return diagnosticToLines({
    playerId: args.playerId,
    leg,
    issues: computed.diag.issues,
    includedRounds: computed.diag.includedRounds,
    par3Events: computed.diag.par3Events,
    result: computed.result,
  });
}

function diagnosticToLines(input: {
  playerId: string;
  leg: { leg_no: number; start_round_no: number; end_round_no: number };
  issues: string[];
  includedRounds: Array<{ roundId: string; roundIndex: number; roundNo: number; playing: boolean }>;
  par3Events: Array<{
    roundNo: number;
    hole: number;
    holeIndex: number;
    par: number | null;
    strokesRaw: string | null;
    pts: number;
    runningBefore: number;
    runningAfter: number;
    reset: boolean;
  }>;
  result: H2ZResult;
}): string[] {
  const lines: string[] = [];

  lines.push(`H2Z diagnostic`);
  lines.push(`player=${input.playerId}`);
  lines.push(`legRounds=${input.leg.start_round_no}..${input.leg.end_round_no}`);
  lines.push(`result final=${input.result.finalScore} best=${input.result.bestScore} bestLen=${input.result.bestLen}`);

  if (input.issues.length) {
    lines.push(`issues (${input.issues.length}):`);
    for (const i of input.issues) lines.push(`- ${i}`);
  } else {
    lines.push(`issues: none`);
  }

  lines.push(`includedRounds=${input.includedRounds.length}`);
  for (const r of input.includedRounds) {
    lines.push(
      `- R${r.roundNo} roundIndex=${r.roundIndex} playing=${r.playing ? "yes" : "no"} roundId=${r.roundId}`
    );
  }

  lines.push(`par3Events=${input.par3Events.length}`);
  for (const e of input.par3Events) {
    lines.push(
      `R${e.roundNo} h${e.hole} idx=${e.holeIndex} par=${e.par} strokes=${e.strokesRaw ?? "null"} pts=${e.pts} run ${e.runningBefore}->${e.runningAfter}${e.reset ? " RESET" : ""}`
    );
  }

  return lines;
}
