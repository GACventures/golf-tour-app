// lib/competitions/definitions/tour_eclectic.ts
import type { CompetitionDefinition, CompetitionContext } from "../types";

type TourLikeCtx = {
  players: Array<{ id: string; name: string }>;
  rounds: Array<{
    holes: number[];
    netPointsForHole?: (playerId: string, holeIndex: number) => number;
    isComplete?: (playerId: string) => boolean;
  }>;
};

function isTourContext(ctx: CompetitionContext): ctx is CompetitionContext & TourLikeCtx {
  const c = ctx as any;
  // If there is an explicit scope discriminator, respect it.
  if (typeof c?.scope === "string") return c.scope === "tour";
  // Fallback: tour contexts have "rounds" array.
  return Array.isArray(c?.rounds);
}

export const tourEclectic: CompetitionDefinition = {
  id: "tour_eclectic",
  name: "Eclectic (best per hole)",
  scope: "tour",
  kind: "individual",
  eligibility: { onlyPlaying: true, requireComplete: true },

  compute: (ctx: CompetitionContext) => {
    if (!isTourContext(ctx)) return [];

    return ctx.players.map((p) => {
      const bestByHole: number[] = Array(18).fill(Number.NEGATIVE_INFINITY);
      let holesPlayed = 0;

      for (const r of ctx.rounds ?? []) {
        const holes = r.holes ?? [];
        if (typeof r.isComplete === "function" && !r.isComplete(p.id)) continue;

        for (let i = 0; i < holes.length; i++) {
          holesPlayed += 1;
          const pts = Number(r.netPointsForHole?.(p.id, i) ?? 0) || 0;
          bestByHole[i] = Math.max(bestByHole[i], pts);
        }
      }

      const total = bestByHole.reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);

      return {
        entryId: p.id,
        label: p.name,
        total,
        stats: {
          holes_played: holesPlayed,
          eclectic_total: total,
        },
      };
    });
  },
};
