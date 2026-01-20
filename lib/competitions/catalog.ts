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
 * ✅ Runtime narrowing because your current CompetitionContext typing may not expose scope.
 */
type TourLikeCtx = {
  scope?: "tour";
  players: Array<{ id: string; name: string; playing?: boolean }>;
  rounds: Array<any>;

  // Optional entity support for pair/team comps
  entities?: Array<{ entityId: string; label?: string; memberPlayerIds: string[] }>;
  entityMembersById?: Record<string, string[]>;
  entityLabelsById?: Record<string, string>;
  team_best_m?: number;
};

function isTourContext(ctx: CompetitionContext): ctx is CompetitionContext & TourLikeCtx {
  const c = ctx as any;
  if (typeof c?.scope === "string") return c.scope === "tour";
  return Array.isArray(c?.rounds);
}

function memberNamesLabel(ctx: TourLikeCtx, memberIds: string[]) {
  const byId = new Map(ctx.players.map((p) => [p.id, p.name]));
  return memberIds.map((id) => byId.get(id) ?? id).join(" / ");
}

function getEntitiesForKind(ctx: TourLikeCtx, kind: "pair" | "team") {
  const out: Array<{ entityId: string; label: string; memberPlayerIds: string[] }> = [];

  // Prefer explicit entities list if present
  if (Array.isArray(ctx.entities) && ctx.entities.length) {
    for (const e of ctx.entities) {
      const ids = (e as any)?.memberPlayerIds ?? [];
      if (!Array.isArray(ids) || ids.length === 0) continue;
      const label = String(
        (e as any)?.label ?? (ctx.entityLabelsById?.[(e as any)?.entityId] ?? (e as any)?.entityId)
      );
      out.push({ entityId: String((e as any)?.entityId), label, memberPlayerIds: ids.map(String) });
    }
    return out;
  }

  // Fallback to maps if present
  const membersById = ctx.entityMembersById ?? {};
  const labelsById = ctx.entityLabelsById ?? {};
  for (const entityId of Object.keys(membersById)) {
    const ids = membersById[entityId] ?? [];
    if (!Array.isArray(ids) || ids.length === 0) continue;
    out.push({
      entityId,
      label: String(labelsById[entityId] ?? entityId),
      memberPlayerIds: ids.map(String),
    });
  }
  return out;
}

/**
 * Helper for “Napoleon-style” averages by par (3/4/5).
 * Tour scope, individual.
 *
 * ✅ UPDATED: par classification is tee-specific if round context provides parForPlayerHole().
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
          const parForPlayerHole: ((playerId: string, holeIndex: number) => number) | undefined = (r as any)
            ?.parForPlayerHole;

          // requireComplete for this player in this round
          if (typeof isComplete === "function" && !isComplete(p.id)) continue;

          for (let i = 0; i < holes.length; i++) {
            const par = Number(
              typeof parForPlayerHole === "function" ? parForPlayerHole(p.id, i) : Number(parsByHole[i] ?? 0)
            );

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

// ----- Pair/Team comps unchanged -----

function tourPairBestBallStableford(id: string, name: string): CompetitionDefinition {
  return {
    id,
    name,
    scope: "tour",
    kind: "pair",
    eligibility: {
      onlyPlaying: false,
      requireComplete: true,
    },
    compute: (ctx: CompetitionContext) => {
      if (!isTourContext(ctx)) return [];

      const entities = getEntitiesForKind(ctx, "pair");
      if (entities.length === 0) return [];

      return entities.map((e) => {
        const members = e.memberPlayerIds.slice(0, 2);
        let holesPlayed = 0;
        let totalPts = 0;

        for (const r of ctx.rounds ?? []) {
          const holes: number[] = (r as any)?.holes ?? [];
          const isComplete = (r as any)?.isComplete;

          if (typeof isComplete === "function") {
            const ok = members.every((pid) => isComplete(pid));
            if (!ok) continue;
          }

          for (let i = 0; i < holes.length; i++) {
            holesPlayed += 1;
            const ptsA = Number((r as any)?.netPointsForHole?.(members[0], i) ?? 0) || 0;
            const ptsB = Number((r as any)?.netPointsForHole?.(members[1], i) ?? 0) || 0;
            totalPts += Math.max(ptsA, ptsB);
          }
        }

        return {
          entryId: e.entityId,
          label: e.label,
          total: totalPts,
          stats: {
            members: memberNamesLabel(ctx, members),
            holes_played: holesPlayed,
            points_total: totalPts,
          },
        };
      });
    },
  };
}

function tourPairAggregateStableford(id: string, name: string): CompetitionDefinition {
  return {
    id,
    name,
    scope: "tour",
    kind: "pair",
    eligibility: {
      onlyPlaying: false,
      requireComplete: true,
    },
    compute: (ctx: CompetitionContext) => {
      if (!isTourContext(ctx)) return [];

      const entities = getEntitiesForKind(ctx, "pair");
      if (entities.length === 0) return [];

      return entities.map((e) => {
        const members = e.memberPlayerIds.slice(0, 2);
        let holesPlayed = 0;
        let totalPts = 0;

        for (const r of ctx.rounds ?? []) {
          const holes: number[] = (r as any)?.holes ?? [];
          const isComplete = (r as any)?.isComplete;

          if (typeof isComplete === "function") {
            const ok = members.every((pid) => isComplete(pid));
            if (!ok) continue;
          }

          for (let i = 0; i < holes.length; i++) {
            holesPlayed += 1;
            const ptsA = Number((r as any)?.netPointsForHole?.(members[0], i) ?? 0) || 0;
            const ptsB = Number((r as any)?.netPointsForHole?.(members[1], i) ?? 0) || 0;
            totalPts += ptsA + ptsB;
          }
        }

        return {
          entryId: e.entityId,
          label: e.label,
          total: totalPts,
          stats: {
            members: memberNamesLabel(ctx, members),
            holes_played: holesPlayed,
            points_total: totalPts,
          },
        };
      });
    },
  };
}

function tourTeamBestMMinusZeros(id: string, name: string): CompetitionDefinition {
  return {
    id,
    name,
    scope: "tour",
    kind: "team",
    eligibility: {
      onlyPlaying: false,
      requireComplete: true,
    },
    compute: (ctx: CompetitionContext) => {
      if (!isTourContext(ctx)) return [];

      const entities = getEntitiesForKind(ctx, "team");
      if (entities.length === 0) return [];

      const m = Math.max(1, Math.floor(Number((ctx as any)?.team_best_m ?? 2)));

      return entities.map((e) => {
        const members = e.memberPlayerIds;
        let holesPlayed = 0;
        let totalPts = 0;
        let zeroCountTotal = 0;

        for (const r of ctx.rounds ?? []) {
          const holes: number[] = (r as any)?.holes ?? [];
          const isComplete = (r as any)?.isComplete;

          if (typeof isComplete === "function") {
            const ok = members.every((pid) => isComplete(pid));
            if (!ok) continue;
          }

          for (let i = 0; i < holes.length; i++) {
            holesPlayed += 1;

            const pts = members.map((pid) => Number((r as any)?.netPointsForHole?.(pid, i) ?? 0) || 0);
            const zeros = pts.filter((x) => x === 0).length;
            zeroCountTotal += zeros;

            const topM = pts
              .slice()
              .sort((a, b) => b - a)
              .slice(0, Math.min(m, pts.length))
              .reduce((s, v) => s + v, 0);

            totalPts += topM - zeros;
          }
        }

        return {
          entryId: e.entityId,
          label: e.label,
          total: totalPts,
          stats: {
            members: memberNamesLabel(ctx, members),
            holes_played: holesPlayed,
            points_total: totalPts,
            team_best_m: m,
            zero_count: zeroCountTotal,
          },
        };
      });
    },
  };
}

function tourTeamAggregateStableford(id: string, name: string): CompetitionDefinition {
  return {
    id,
    name,
    scope: "tour",
    kind: "team",
    eligibility: {
      onlyPlaying: false,
      requireComplete: true,
    },
    compute: (ctx: CompetitionContext) => {
      if (!isTourContext(ctx)) return [];

      const entities = getEntitiesForKind(ctx, "team");
      if (entities.length === 0) return [];

      return entities.map((e) => {
        const members = e.memberPlayerIds;
        let holesPlayed = 0;
        let totalPts = 0;

        for (const r of ctx.rounds ?? []) {
          const holes: number[] = (r as any)?.holes ?? [];
          const isComplete = (r as any)?.isComplete;

          if (typeof isComplete === "function") {
            const ok = members.every((pid) => isComplete(pid));
            if (!ok) continue;
          }

          for (let i = 0; i < holes.length; i++) {
            holesPlayed += 1;
            for (const pid of members) {
              totalPts += Number((r as any)?.netPointsForHole?.(pid, i) ?? 0) || 0;
            }
          }
        }

        return {
          entryId: e.entityId,
          label: e.label,
          total: totalPts,
          stats: {
            members: memberNamesLabel(ctx, members),
            holes_played: holesPlayed,
            points_total: totalPts,
          },
        };
      });
    },
  };
}

export const competitionCatalog: CompetitionDefinition[] = [
  // Individual tour comps
  avgStablefordByPar(3, "tour_napoleon_par3_avg", "Napoleon (Par 3 avg)"),
  avgStablefordByPar(4, "tour_big_george_par4_avg", "Big George (Par 4 avg)"),
  avgStablefordByPar(5, "tour_grand_canyon_par5_avg", "Grand Canyon (Par 5 avg)"),

  bagelMan("tour_bagel_man_zero_pct", "Bagel Man (% zero holes)"),
  wizard("tour_wizard_four_plus_pct", "Wizard (% 4+ holes)"),
  eclectic("tour_eclectic_total", "Eclectic (best per hole)"),

  // Pair tour comps
  tourPairBestBallStableford("tour_pair_best_ball_stableford", "Pairs: Best Ball (Stableford)"),
  tourPairAggregateStableford("tour_pair_aggregate_stableford", "Pairs: Aggregate (Stableford)"),

  // Team tour comps
  tourTeamBestMMinusZeros("tour_team_best_m_minus_zeros", "Teams: Best M per hole − zeros"),
  tourTeamAggregateStableford("tour_team_aggregate_stableford", "Teams: Aggregate (Stableford)"),
];
