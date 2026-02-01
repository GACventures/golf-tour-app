// lib/competitions/h2z.ts
import type { CompetitionContext } from "./types";

export type H2ZLeg = {
  leg_no: number; // 1..N
  start_round_no: number; // inclusive
  end_round_no: number; // inclusive
};

export type H2ZLegResult = {
  leg: H2ZLeg;
  finalScore: number; // score at end of leg
  bestScore: number; // highest score reached during the leg
  bestLen: number; // number of consecutive par-3 holes used for bestScore
};

export type H2ZPlayerResults = Record<number, H2ZLegResult>; // keyed by leg_no

function safeInt(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}

function isPar3ForPlayer(roundCtx: any, playerId: string, holeIndex: number) {
  const fn = (roundCtx as any)?.parForPlayerHole;
  if (typeof fn !== "function") return false;
  return Number(fn(playerId, holeIndex) ?? 0) === 3;
}

function ptsForHole(roundCtx: any, playerId: string, holeIndex: number) {
  const fn = (roundCtx as any)?.netPointsForHole;
  if (typeof fn !== "function") return 0;
  const v = Number(fn(playerId, holeIndex) ?? 0);
  return Number.isFinite(v) ? v : 0;
}

export function computeH2ZForPlayer(params: {
  ctx: CompetitionContext; // tour context built by buildTourCompetitionContext
  legs: H2ZLeg[];
  // rounds in display/order with round_no so we can slice by legs
  roundsInOrder: Array<{ roundId: string; round_no: number | null }>;
  // IMPORTANT: only treat a "0 points" as reset if player was actually playing that round
  isPlayingInRound: (roundId: string, playerId: string) => boolean;
  playerId: string;
}): H2ZPlayerResults {
  const { ctx, legs, roundsInOrder, isPlayingInRound, playerId } = params;

  const tourRounds: any[] = (ctx as any)?.rounds ?? [];
  const roundCtxById = new Map<string, any>();
  for (const r of tourRounds) roundCtxById.set(String((r as any).roundId), r);

  // Pre-normalize legs
  const normLegs = (legs ?? [])
    .map((l) => ({
      leg_no: safeInt(l.leg_no, 0),
      start_round_no: Math.max(1, safeInt(l.start_round_no, 1)),
      end_round_no: Math.max(1, safeInt(l.end_round_no, 1)),
    }))
    .filter((l) => l.leg_no >= 1 && l.end_round_no >= l.start_round_no)
    .sort((a, b) => a.leg_no - b.leg_no);

  const out: H2ZPlayerResults = {};

  for (const leg of normLegs) {
    let cur = 0;
    let best = 0;
    let curLen = 0;
    let bestLen = 0;

    for (const r of roundsInOrder) {
      const rn = safeInt(r.round_no, -1);
      if (rn < leg.start_round_no || rn > leg.end_round_no) continue;

      const roundId = String(r.roundId);
      const roundCtx = roundCtxById.get(roundId);
      if (!roundCtx) continue;

      // If not playing this round, skip entirely (do NOT reset)
      if (!isPlayingInRound(roundId, playerId)) continue;

      for (let i = 0; i < 18; i++) {
        if (!isPar3ForPlayer(roundCtx, playerId, i)) continue;

        const pts = ptsForHole(roundCtx, playerId, i);

        if (pts === 0) {
          cur = 0;
          curLen = 0;
        } else {
          cur += pts;
          curLen += 1;
          if (cur > best) {
            best = cur;
            bestLen = curLen;
          }
        }
      }
    }

    out[leg.leg_no] = {
      leg,
      finalScore: cur,
      bestScore: best,
      bestLen,
    };
  }

  return out;
}
