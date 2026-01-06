// lib/competitions/catalog.ts
import type { CompetitionDefinition, CompetitionContext } from "./types";

function round2(n: number) {
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function pct2(num: number, den: number) {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0;
  return round2((num / den) * 100);
}

/**
 * ✅ Because your current CompetitionContext type no longer exposes `scope`,
 * we do runtime narrowing here. This keeps TS happy and the build unblocked.
 */
type TourLikeCtx = {
  scope?: "tour";
  players: Array<{ id: string; name: string }>;
  rounds: Array<any>;
};

type RoundLikeCtx = {
  scope?: "round";
  players: Array<{ id: string; name: string }>;
  // round contexts usually have holes/pars/scores or similar
};

function isTourContext(ctx: CompetitionContext): ctx is CompetitionContext & TourLikeCtx {
  const c = ctx as any;
  // Prefer explicit discriminator if present
  if (typeof c?.scope === "string") return c.scope === "tour";
  // Fallback: tour contexts have an array called rounds
  return Array.isArray(c?.rounds);
}

function isRoundContext(ctx: CompetitionContext): ctx is CompetitionContext & RoundLikeCtx {
  const c = ctx as any;
  if (typeof c?.scope === "string") return c.scope === "round";
  // Fallback: round contexts do NOT have rounds array
  return !Array.isArray(c?.rounds);
}

/**
 * Helper for “Napoleon-style” averages by par (3/4/5).
 * Tour scope, individual.
 */
function avgStablefordByPar(parTarget: 3 | 4 | 5, id: string, name: string): CompetitionDefinition {
  return {
    id,
    name,
    scope: "tour",
    kind: "individual",
    eligibility: {
      onlyPlaying: true,
      requireComplete: true,
    },
    compute: (ctx: CompetitionContext) => {
      if (!isTourContext(ctx)) return [];

      return ctx.players.map((p) => {
        let holesPlayed = 0;
        let totalPts = 0;

        for (const r of ctx.rounds ?? []) {
          const holes: number[] = (r as any)?.holes ?? [];
          const parsByHole: number[] = (r as any)?.parsByHole ?? [];
          const isComplete = (r as any)?.isComplete;

          if (typeof isComplete === "function" && !isComplete(p.id)) continue;

          for (let i = 0; i < holes.length; i++) {
            const par = Number(parsByHole[i] ?? 0);
            if (par !== parTarget) continue;

            holesPlayed += 1;
            const net = (r as any)?.netPointsForHole?.(p.id, i) ?? 0;
            totalPts += Number(net) || 0;
          }
        }

        const avg = holesPlayed > 0 ? totalPts / holesPlayed : 0;

        return {
          entryId: p.id,
          label: p.name,
          total: avg,
          stats: {
            holes_played: holesPlayed,
            points_total: totalPts,
            avg_points: round2(avg),
          },
        };
      });
    },
  };
}

/**
 * Bagel Man: % of holes with 0 Stableford points
 * Tour scope, individual.
 */
function bagelMan(id: string, name: string): CompetitionDefinition {
  return {
    id,
    name,
    scope: "tour",
    kind: "individual",
    eligibility: {
      onlyPlaying: true,
      requireComplete: true,
    },
    compute: (ctx: CompetitionContext) => {
      if (!isTourContext(ctx)) return [];

      return ctx.players.map((p) => {
        let holesPlayed = 0;
        let zeroCount = 0;

        for (const r of ctx.rounds ?? []) {
          const holes: number[] = (r as any)?.holes ?? [];
          const isComplete = (r as any)?.isComplete;
          if (typeof isComplete === "function" && !isComplete(p.id)) continue;

          for (let i = 0; i < holes.length; i++) {
            holesPlayed += 1;
            const pts = Number((r as any)?.netPointsForHole?.(p.id, i) ?? 0) || 0;
            if (pts === 0) zeroCount += 1;
          }
        }

        const zeroPct = pct2(zeroCount, holesPlayed);

        return {
          entryId: p.id,
          label: p.name,
          total: zeroPct,
          stats: {
            holes_played: holesPlayed,
            zero_count: zeroCount,
            zero_pct: zeroPct,
          },
        };
      });
    },
  };
}

/**
 * Wizard: % of holes with 4+ points
 * Tour scope, individual.
 */
function wizard(id: string, name: string): CompetitionDefinition {
  return {
    id,
    name,
    scope: "tour",
    kind: "individual",
    eligibility: {
      onlyPlaying: true,
      requireComplete: true,
    },
    compute: (ctx: CompetitionContext) => {
      if (!isTourContext(ctx)) return [];

      return ctx.players.map((p) => {
        let holesPlayed = 0;
        let fourPlusCount = 0;

        for (const r of ctx.rounds ?? []) {
          const holes: number[] = (r as any)?.holes ?? [];
          const isComplete = (r as any)?.isComplete;
          if (typeof isComplete === "function" && !isComplete(p.id)) continue;

          for (let i = 0; i < holes.length; i++) {
            holesPlayed += 1;
            const pts = Number((r as any)?.netPointsForHole?.(p.id, i) ?? 0) || 0;
            if (pts >= 4) fourPlusCount += 1;
          }
        }

        const pct = pct2(fourPlusCount, holesPlayed);

        return {
          entryId: p.id,
          label: p.name,
          total: pct,
          stats: {
            holes_played: holesPlayed,
            four_plus_count: fourPlusCount,
            four_plus_pct: pct,
          },
        };
      });
    },
  };
}

/**
 * Eclectic: best Stableford per hole across tour
 * Tour scope, individual.
 */
function eclectic(id: string, name: string): CompetitionDefinition {
  return {
    id,
    name,
    scope: "tour",
    kind: "individual",
    eligibility: {
      onlyPlaying: true,
      requireComplete: true,
    },
    compute: (ctx: CompetitionContext) => {
      if (!isTourContext(ctx)) return [];

      return ctx.players.map((p) => {
        const bestByHole: number[] = Array(18).fill(Number.NEGATIVE_INFINITY);
        let holesPlayed = 0;

        for (const r of ctx.rounds ?? []) {
          const holes: number[] = (r as any)?.holes ?? [];
          const isComplete = (r as any)?.isComplete;
          if (typeof isComplete === "function" && !isComplete(p.id)) continue;

          for (let i = 0; i < holes.length; i++) {
            holesPlayed += 1;
            const pts = Number((r as any)?.netPointsForHole?.(p.id, i) ?? 0) || 0;
            bestByHole[i] = Math.max(bestByHole[i], pts);
          }
        }

        // If never played a hole, treat as 0
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
}

export const competitionCatalog: CompetitionDefinition[] = [
  avgStablefordByPar(3, "tour_napoleon_par3_avg", "Napoleon (Par 3 avg)"),
  avgStablefordByPar(4, "tour_big_george_par4_avg", "Big George (Par 4 avg)"),
  avgStablefordByPar(5, "tour_grand_canyon_par5_avg", "Grand Canyon (Par 5 avg)"),

  bagelMan("tour_bagel_man_zero_pct", "Bagel Man (% zero holes)"),
  wizard("tour_wizard_four_plus_pct", "Wizard (% 4+ holes)"),
  eclectic("tour_eclectic_total", "Eclectic (best per hole)"),
];
