// lib/competitions/h2z.ts

export type H2ZLegRow = {
  tour_id: string;
  leg_no: number;
  start_round_no: number;
  end_round_no: number;
  created_at?: string;
  updated_at?: string;
};

export type H2ZResult = {
  finalScore: number; // running total at end of leg
  bestScore: number; // peak running total within the leg
  bestLen: number; // number of Par 3 holes in that best run
};

export type H2ZPar3Event = {
  round_id: string;
  round_no: number; // effective round_no used for selection
  round_order_index: number; // 0-based index in the ordered rounds list
  hole_number: number; // 1..18 within the round
  hole_index: number; // flattened index (round_order_index*18 + hole_number-1)
  par: number | null;
  strokes_raw: string | null;
  stableford_points: number;
  running_before: number;
  running_after: number;
  reset: boolean;

  // “best run” tracking at the moment of this event
  current_run_len_after: number;
  current_run_score_after: number;
  best_score_after: number;
  best_len_after: number;
};

export type H2ZDiagnostic = {
  player_id: string;
  leg: Pick<H2ZLegRow, "leg_no" | "start_round_no" | "end_round_no">;
  issues: string[];

  rounds_all_ordered: Array<{
    round_id: string;
    round_no_db: number | null;
    round_no_effective: number;
    round_order_index: number;
  }>;

  rounds_included: Array<{
    round_id: string;
    round_no_effective: number;
    round_order_index: number;
  }>;

  par3_events: H2ZPar3Event[];

  summary: {
    included_round_count: number;
    par3_count_seen: number;
  };
};

// Minimal shape of what we need from CompetitionContext.
// We intentionally keep this loose to avoid assuming ctx.rounds exists.
type AnyCompetitionContext = {
  rounds?: any;
  scores?: any;
  netPointsForHole?: (playerId: string, holeIndex: number) => number;
  parForPlayerHole?: (playerId: string, holeIndex: number) => number | null;
};

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function safeInt(n: unknown): number | null {
  if (typeof n === "number" && Number.isFinite(n)) return Math.trunc(n);
  if (typeof n === "string" && n.trim() !== "") {
    const parsed = Number(n);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function getOrderedRounds(ctx: AnyCompetitionContext, issues: string[]) {
  const raw = (ctx as any)?.rounds;

  if (!Array.isArray(raw)) {
    issues.push("ctx.rounds is missing or not an array; H2Z cannot select rounds for legs.");
    return [] as Array<{
      round_id: string;
      round_no_db: number | null;
      round_no_effective: number;
      round_order_index: number;
    }>;
  }

  // Normalize
  const normalized = raw
    .map((r: any, idx: number) => {
      const id = typeof r?.id === "string" ? r.id : null;
      const roundNoDb = safeInt(r?.round_no);
      return {
        id,
        roundNoDb,
        originalIndex: idx,
      };
    })
    .filter((r: any) => {
      if (!r.id) issues.push("A round row is missing id; it will be ignored for H2Z.");
      return !!r.id;
    });

  // If we have usable round_no for most rounds, sort by it; else keep original order.
  const usableCount = normalized.filter((r: any) => isFiniteNumber(r.roundNoDb)).length;
  const useRoundNoSort = usableCount >= Math.max(1, Math.floor(normalized.length * 0.6));

  const sorted = [...normalized].sort((a: any, b: any) => {
    if (useRoundNoSort) {
      // Nulls go last, otherwise numeric sort
      const an = a.roundNoDb;
      const bn = b.roundNoDb;
      if (an == null && bn == null) return a.originalIndex - b.originalIndex;
      if (an == null) return 1;
      if (bn == null) return -1;
      if (an !== bn) return an - bn;
      return a.originalIndex - b.originalIndex;
    }
    return a.originalIndex - b.originalIndex;
  });

  // Assign effective round_no (fallback to orderIndex+1)
  const ordered = sorted.map((r: any, orderIndex: number) => {
    const effective = r.roundNoDb ?? orderIndex + 1;
    if (r.roundNoDb == null) {
      issues.push(
        `round_id=${r.id} has null round_no; using inferred round_no_effective=${effective} based on ordering.`
      );
    }
    return {
      round_id: r.id as string,
      round_no_db: r.roundNoDb as number | null,
      round_no_effective: effective,
      round_order_index: orderIndex,
    };
  });

  // Detect duplicates in effective round_no (can cause weird leg selection)
  const seen = new Map<number, string[]>();
  for (const r of ordered) {
    const arr = seen.get(r.round_no_effective) ?? [];
    arr.push(r.round_id);
    seen.set(r.round_no_effective, arr);
  }
  for (const [rn, ids] of seen.entries()) {
    if (ids.length > 1) {
      issues.push(
        `Duplicate effective round_no=${rn} across rounds: ${ids.join(
          ", "
        )}. Leg selection may be ambiguous; fix rounds.round_no for this tour.`
      );
    }
  }

  return ordered;
}

function selectRoundsForLeg(
  orderedRounds: ReturnType<typeof getOrderedRounds>,
  leg: Pick<H2ZLegRow, "start_round_no" | "end_round_no" | "leg_no">,
  issues: string[]
) {
  const start = safeInt(leg.start_round_no);
  const end = safeInt(leg.end_round_no);

  if (start == null || end == null) {
    issues.push(
      `Leg ${leg.leg_no} has invalid start_round_no/end_round_no (start=${String(
        leg.start_round_no
      )}, end=${String(leg.end_round_no)}).`
    );
    return [];
  }

  const lo = Math.min(start, end);
  const hi = Math.max(start, end);

  const included = orderedRounds.filter(
    (r) => r.round_no_effective >= lo && r.round_no_effective <= hi
  );

  if (included.length === 0) {
    issues.push(
      `Leg ${leg.leg_no} selected zero rounds using inclusive bounds [${lo}..${hi}]. ` +
        `Check that rounds.round_no is populated correctly for this tour and that ctx.rounds is ordered/complete.`
    );
  }

  return included;
}

export function computeH2ZForPlayer(
  ctx: AnyCompetitionContext,
  playerId: string,
  leg: H2ZLegRow,
  opts?: { diagnostic?: boolean }
): { result: H2ZResult; diagnostic?: H2ZDiagnostic } {
  const issues: string[] = [];

  const netPointsForHole = (ctx as any)?.netPointsForHole;
  const parForPlayerHole = (ctx as any)?.parForPlayerHole;

  if (typeof netPointsForHole !== "function") {
    issues.push("ctx.netPointsForHole is missing; cannot compute Stableford points for H2Z.");
  }
  if (typeof parForPlayerHole !== "function") {
    issues.push("ctx.parForPlayerHole is missing; cannot identify Par 3 holes for H2Z.");
  }

  const orderedRounds = getOrderedRounds(ctx, issues);
  const includedRounds = selectRoundsForLeg(orderedRounds, leg, issues);

  let running = 0;
  let bestScore = 0;

  // Track current run (since last reset)
  let currentRunScore = 0;
  let currentRunLen = 0;
  let bestLen = 0;

  const par3Events: H2ZPar3Event[] = [];

  for (const r of includedRounds) {
    for (let holeNumber = 1; holeNumber <= 18; holeNumber++) {
      const holeIndex = r.round_order_index * 18 + (holeNumber - 1);

      const par = typeof parForPlayerHole === "function" ? parForPlayerHole(playerId, holeIndex) : null;

      if (par !== 3) continue;

      const strokesRaw =
        (ctx as any)?.scores?.[playerId]?.[holeIndex] != null
          ? String((ctx as any)?.scores?.[playerId]?.[holeIndex])
          : null;

      let pts = 0;
      if (typeof netPointsForHole === "function") {
        const rawPts = netPointsForHole(playerId, holeIndex);
        pts = isFiniteNumber(rawPts) ? rawPts : 0;
        if (!isFiniteNumber(rawPts)) {
          issues.push(
            `Non-numeric Stableford points for player=${playerId} hole_index=${holeIndex}; treating as 0.`
          );
        }
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

      if (opts?.diagnostic) {
        par3Events.push({
          round_id: r.round_id,
          round_no: r.round_no_effective,
          round_order_index: r.round_order_index,
          hole_number: holeNumber,
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

  const result: H2ZResult = {
    finalScore: running,
    bestScore,
    bestLen,
  };

  if (!opts?.diagnostic) return { result };

  const diagnostic: H2ZDiagnostic = {
    player_id: playerId,
    leg: {
      leg_no: leg.leg_no,
      start_round_no: leg.start_round_no,
      end_round_no: leg.end_round_no,
    },
    issues,
    rounds_all_ordered: orderedRounds.map((r) => ({
      round_id: r.round_id,
      round_no_db: r.round_no_db,
      round_no_effective: r.round_no_effective,
      round_order_index: r.round_order_index,
    })),
    rounds_included: includedRounds.map((r) => ({
      round_id: r.round_id,
      round_no_effective: r.round_no_effective,
      round_order_index: r.round_order_index,
    })),
    par3_events: par3Events,
    summary: {
      included_round_count: includedRounds.length,
      par3_count_seen: par3Events.length,
    },
  };

  return { result, diagnostic };
}

/**
 * Convenience helper: compute for multiple players for a given leg.
 * (Useful if the UI expects a function like this.)
 */
export function computeH2ZForLeg(
  ctx: AnyCompetitionContext,
  playerIds: string[],
  leg: H2ZLegRow,
  opts?: { diagnosticPlayerId?: string | null }
): {
  byPlayer: Record<string, H2ZResult>;
  diagnostic?: H2ZDiagnostic | null;
} {
  const byPlayer: Record<string, H2ZResult> = {};
  let diagnostic: H2ZDiagnostic | null = null;

  for (const pid of playerIds) {
    const wantDiag = !!opts?.diagnosticPlayerId && opts.diagnosticPlayerId === pid;
    const computed = computeH2ZForPlayer(ctx, pid, leg, { diagnostic: wantDiag });
    byPlayer[pid] = computed.result;
    if (wantDiag) diagnostic = computed.diagnostic ?? null;
  }

  return { byPlayer, diagnostic };
}
