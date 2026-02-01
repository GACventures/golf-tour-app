// lib/competitions/h2z.ts

export type H2ZLeg = {
  leg_no: number;
  start_round_no: number;
  end_round_no: number;
};

export type H2ZLegResult = {
  finalScore: number;
  bestScore: number;
  bestLen: number;
};

type RoundInOrder = { roundId: string; round_no: number | null };

type RoundCtxLike = {
  roundId: string;
  // scores[playerId][holeIndex] is a string like "5", "P", ""
  scores: Record<string, string[]>;
  parForPlayerHole: (playerId: string, holeIndex: number) => number;
  netPointsForHole: (playerId: string, holeIndex: number) => number;
};

type TourCtxLike = {
  rounds: RoundCtxLike[];
};

function asInt(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function rawToStrokes(raw: string | undefined | null): number | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s || s === "P") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function legIncludesRound(leg: H2ZLeg, roundNo: number | null) {
  const rn = Number(roundNo);
  if (!Number.isFinite(rn)) return false;
  return rn >= leg.start_round_no && rn <= leg.end_round_no;
}

export function computeH2ZForPlayer(params: {
  ctx: TourCtxLike; // IMPORTANT: expects ctx.rounds to exist at runtime
  legs: H2ZLeg[];
  roundsInOrder: RoundInOrder[];
  isPlayingInRound: (roundId: string, playerId: string) => boolean;
  playerId: string;
}): Record<number, H2ZLegResult> {
  const { ctx, legs, roundsInOrder, isPlayingInRound, playerId } = params;

  const out: Record<number, H2ZLegResult> = {};

  // Index rounds by id for fast lookup
  const roundCtxById = new Map<string, RoundCtxLike>();
  for (const r of ctx.rounds ?? []) roundCtxById.set(String(r.roundId), r);

  for (const leg of legs) {
    let running = 0;
    let best = 0;
    let currentRunLen = 0;
    let bestLen = 0;

    // iterate rounds in order and include only those in the leg
    for (const r of roundsInOrder) {
      if (!legIncludesRound(leg, r.round_no)) continue;

      const roundCtx = roundCtxById.get(String(r.roundId));
      if (!roundCtx) continue;

      // If player not playing in this round, skip entire round
      if (!isPlayingInRound(String(r.roundId), playerId)) continue;

      for (let holeIndex = 0; holeIndex < 18; holeIndex++) {
        const par = Number(roundCtx.parForPlayerHole(playerId, holeIndex) ?? 0);
        if (par !== 3) continue; // H2Z is Par 3 only

        // ✅ IMPORTANT: scores are indexed by holeIndex (0..17), NOT holeNo (1..18)
        const raw = roundCtx.scores?.[playerId]?.[holeIndex] ?? "";
        const pts = Number(roundCtx.netPointsForHole(playerId, holeIndex) ?? 0);

        // If no score entered, treat as not contributing (skip)
        // (You can change this behavior if you want blanks to count as 0/reset,
        // but for diagnostics we want to show it clearly.)
        if (!String(raw).trim()) {
          continue;
        }

        if (pts <= 0) {
          running = 0;
          currentRunLen = 0;
        } else {
          running += pts;
          currentRunLen += 1;
          if (running > best) {
            best = running;
            bestLen = currentRunLen;
          } else if (running === best) {
            // keep the longest run length if tied on score
            if (currentRunLen > bestLen) bestLen = currentRunLen;
          }
        }
      }
    }

    out[leg.leg_no] = {
      finalScore: running,
      bestScore: best,
      bestLen: bestLen,
    };
  }

  return out;
}

/**
 * Diagnostic trace for ONE player.
 * Shows Par 3 holes only: hole number, strokes, stableford points, running H2Z after that hole.
 */
export function buildH2ZDiagnostic(params: {
  ctx: TourCtxLike;
  roundsInOrder: RoundInOrder[];
  isPlayingInRound: (roundId: string, playerId: string) => boolean;
  playerId: string;
  start_round_no: number;
  end_round_no: number;
}): string[] {
  const { ctx, roundsInOrder, isPlayingInRound, playerId, start_round_no, end_round_no } = params;

  const roundCtxById = new Map<string, RoundCtxLike>();
  for (const r of ctx.rounds ?? []) roundCtxById.set(String(r.roundId), r);

  let running = 0;
  const lines: string[] = [];

  lines.push(`H2Z DIAGNOSTIC player=${playerId} rounds R${start_round_no}–R${end_round_no}`);

  for (const r of roundsInOrder) {
    const rn = asInt(r.round_no);
    if (rn == null) continue;
    if (rn < start_round_no || rn > end_round_no) continue;

    const roundId = String(r.roundId);
    const roundCtx = roundCtxById.get(roundId);
    if (!roundCtx) continue;

    if (!isPlayingInRound(roundId, playerId)) {
      lines.push(`R${rn}: not playing → skipped`);
      continue;
    }

    lines.push(`R${rn}:`);

    for (let holeIndex = 0; holeIndex < 18; holeIndex++) {
      const holeNo = holeIndex + 1;

      const par = Number(roundCtx.parForPlayerHole(playerId, holeIndex) ?? 0);
      if (par !== 3) continue;

      const raw = roundCtx.scores?.[playerId]?.[holeIndex] ?? "";
      const strokes = rawToStrokes(raw);
      const pts = Number(roundCtx.netPointsForHole(playerId, holeIndex) ?? 0);

      if (!String(raw).trim()) {
        lines.push(`  H${holeNo} Par3: strokes=— pts=— running=${running}`);
        continue;
      }

      if (pts <= 0) {
        running = 0;
        lines.push(`  H${holeNo} Par3: strokes=${strokes ?? "P"} pts=${pts} RESET running=${running}`);
      } else {
        running += pts;
        lines.push(`  H${holeNo} Par3: strokes=${strokes ?? "P"} pts=${pts} running=${running}`);
      }
    }
  }

  return lines;
}
