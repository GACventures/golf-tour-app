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
      if (ctx.scope !== "tour") return [];

      return ctx.players.map((p) => {
        let holesPlayed = 0;
        let points = 0;

        for (const r of ctx.rounds) {
          for (let i = 0; i < 18; i++) {
            if (r.parsByHole[i] !== parTarget) continue;

            const raw = (r.scores[p.id]?.[i] ?? "").toString().trim().toUpperCase();
            const played = raw !== ""; // includes "P"
            if (!played) continue;

            holesPlayed += 1;
            points += r.netPointsForHole(p.id, i);
          }
        }

        const avg = holesPlayed > 0 ? points / holesPlayed : 0;

        return {
          entryId: p.id,
          label: p.name,
          total: avg,
          stats: {
            holes_played: holesPlayed,
            points_total: points,
            avg_points: round2(avg),
            par: String(parTarget),
          },
        };
      });
    },
    tieBreak: "none",
  };
}

/**
 * Helper for “percentage of played holes meeting condition”
 * e.g. Bagel Man (0 pts), Wizard (>=4 pts)
 */
function pctOfPlayedHoles(
  id: string,
  name: string,
  predicate: (pts: number) => boolean,
  statPrefix: string
): CompetitionDefinition {
  return {
    id,
    name,
    scope: "tour",
    kind: "individual",
    eligibility: {
      onlyPlaying: true,
      requireComplete: false,
    },
    compute: (ctx: CompetitionContext) => {
      if (ctx.scope !== "tour") return [];

      return ctx.players.map((p) => {
        let holesPlayed = 0;
        let matchCount = 0;

        for (const r of ctx.rounds) {
          for (let i = 0; i < 18; i++) {
            const raw = (r.scores[p.id]?.[i] ?? "").toString().trim().toUpperCase();
            const played = raw !== ""; // includes "P"
            if (!played) continue;

            holesPlayed += 1;

            const pts = r.netPointsForHole(p.id, i);
            if (predicate(pts)) matchCount += 1;
          }
        }

        const percent = pct2(matchCount, holesPlayed);

        return {
          entryId: p.id,
          label: p.name,
          total: percent,
          stats: {
            holes_played: holesPlayed,
            [`${statPrefix}_count`]: matchCount,
            [`${statPrefix}_pct`]: percent,
          },
        };
      });
    },
    tieBreak: "none",
  };
}

/**
 * The Eclectic (Tour):
 * For each hole 1..18, take the BEST net Stableford points the player achieved
 * on that hole across ALL included rounds, then sum the 18 best-hole values.
 */
function tourEclectic(id: string, name: string): CompetitionDefinition {
  return {
    id,
    name,
    scope: "tour",
    kind: "individual",
    eligibility: {
      onlyPlaying: true,
      requireComplete: false,
    },
    compute: (ctx: CompetitionContext) => {
      if (ctx.scope !== "tour") return [];

      return ctx.players.map((p) => {
        const bestByHole: number[] = Array(18).fill(0);
        const playedByHole: boolean[] = Array(18).fill(false);

        for (const r of ctx.rounds) {
          const arr = r.scores[p.id] ?? Array(18).fill("");

          for (let i = 0; i < 18; i++) {
            const raw = (arr[i] ?? "").toString().trim().toUpperCase();
            const played = raw !== "";
            if (!played) continue;

            playedByHole[i] = true;

            const pts = r.netPointsForHole(p.id, i);
            if (Number.isFinite(pts)) bestByHole[i] = Math.max(bestByHole[i], pts);
          }
        }

        const total = bestByHole.reduce((sum, v) => sum + v, 0);
        const holesPlayedUnique = playedByHole.filter(Boolean).length;
        const holesContributed = bestByHole.filter((v) => v > 0).length;

        return {
          entryId: p.id,
          label: p.name,
          total,
          stats: {
            holes_played: holesPlayedUnique,
            holes_contributed: holesContributed,
            eclectic_total: total,
          },
        };
      });
    },
    tieBreak: "none",
  };
}

/** ---------- Entity helpers (pair/team) ---------- */

type EntityLite = {
  entityId: string;
  label: string;
  memberPlayerIds: string[];
};

function getEntitiesFromCtx(ctx: CompetitionContext): EntityLite[] {
  // Option A: engine/leaderboard attached a resolved list already
  const direct = (ctx as any).entities as EntityLite[] | undefined;
  if (Array.isArray(direct) && direct.length > 0) return direct;

  // Option B: leaderboard page attached maps
  const membersById = (ctx as any).entityMembersById as Record<string, string[]> | undefined;
  const labelsById = (ctx as any).entityLabelsById as Record<string, string> | undefined;

  if (membersById && Object.keys(membersById).length > 0) {
    return Object.keys(membersById).map((entityId) => ({
      entityId,
      label: labelsById?.[entityId] ?? entityId,
      memberPlayerIds: membersById[entityId] ?? [],
    }));
  }

  return [];
}

function buildMembersLabel(ctx: CompetitionContext, memberIds: string[]) {
  const nameById: Record<string, string> = {};
  for (const p of ctx.players) nameById[p.id] = p.name;
  return memberIds.map((pid) => nameById[pid] ?? pid).join(" / ");
}

function allMembersEligible(ctx: CompetitionContext, memberIds: string[]) {
  // ctx.players has already been filtered by engine eligibility (onlyPlaying/requireComplete)
  // requiring presence here enforces those rules at the entity level.
  const eligibleIdSet = new Set(ctx.players.map((p) => p.id));
  return memberIds.every((pid) => eligibleIdSet.has(pid));
}

/** ---------- NEW: Pair Best Ball (Tour) ---------- */

function tourPairBestBallStableford(id: string, name: string): CompetitionDefinition {
  return {
    id,
    name,
    scope: "tour",
    kind: "pair",
    eligibility: {
      onlyPlaying: true,
      requireComplete: true,
    },
    compute: (ctx: CompetitionContext) => {
      if (ctx.scope !== "tour") return [];

      const entities = getEntitiesFromCtx(ctx);

      return entities
        .filter((e) => e.memberPlayerIds.length === 2)
        .filter((e) => allMembersEligible(ctx, e.memberPlayerIds))
        .map((e) => {
          const [a, b] = e.memberPlayerIds;

          let holesPlayed = 0;
          let pointsTotal = 0;

          for (const r of ctx.rounds) {
            for (let i = 0; i < 18; i++) {
              const rawA = (r.scores[a]?.[i] ?? "").toString().trim().toUpperCase();
              const rawB = (r.scores[b]?.[i] ?? "").toString().trim().toUpperCase();

              const playedA = rawA !== "";
              const playedB = rawB !== "";

              if (!playedA && !playedB) continue;

              holesPlayed += 1;

              const ptsA = playedA ? r.netPointsForHole(a, i) : 0;
              const ptsB = playedB ? r.netPointsForHole(b, i) : 0;

              pointsTotal += Math.max(ptsA, ptsB);
            }
          }

          const avg = holesPlayed > 0 ? pointsTotal / holesPlayed : 0;

          return {
            entryId: e.entityId,
            label: e.label,
            total: pointsTotal,
            stats: {
              members: buildMembersLabel(ctx, e.memberPlayerIds),
              holes_played: holesPlayed,
              points_total: pointsTotal,
              avg_points: round2(avg),
              method: "best_ball",
            },
          };
        });
    },
    tieBreak: "none",
  };
}

/** ---------- NEW: Team “Top M minus zeros” (Tour) ---------- */

function tourTeamTopMMinusZeros(id: string, name: string): CompetitionDefinition {
  return {
    id,
    name,
    scope: "tour",
    kind: "team",
    eligibility: {
      onlyPlaying: true,
      requireComplete: true,
    },
    compute: (ctx: CompetitionContext) => {
      if (ctx.scope !== "tour") return [];

      const entities = getEntitiesFromCtx(ctx);

      // M comes from context (leaderboard page attaches ctx.team_best_m)
      const mFromCtx = Number((ctx as any).team_best_m ?? (ctx as any).teamBestM ?? 2);
      const M = Number.isFinite(mFromCtx) ? Math.max(1, Math.floor(mFromCtx)) : 2;

      return entities
        .filter((e) => e.memberPlayerIds.length >= 2)
        .filter((e) => allMembersEligible(ctx, e.memberPlayerIds))
        .map((e) => {
          let holesPlayed = 0;
          let pointsTotal = 0;
          let zeroPenaltyTotal = 0;

          for (const r of ctx.rounds) {
            for (let i = 0; i < 18; i++) {
              const pts: number[] = [];
              let zerosOnHole = 0;
              let anyonePlayed = false;

              for (const pid of e.memberPlayerIds) {
                const raw = (r.scores[pid]?.[i] ?? "").toString().trim().toUpperCase();
                const played = raw !== ""; // includes "P"
                if (!played) continue;

                anyonePlayed = true;

                const p = r.netPointsForHole(pid, i);
                pts.push(p);
                if (p === 0) zerosOnHole += 1;
              }

              if (!anyonePlayed) continue;

              holesPlayed += 1;

              pts.sort((a, b) => b - a);
              const mUsed = Math.min(M, pts.length);
              const topM = pts.slice(0, mUsed).reduce((s, v) => s + v, 0);

              pointsTotal += topM - zerosOnHole;
              zeroPenaltyTotal += zerosOnHole;
            }
          }

          const avg = holesPlayed > 0 ? pointsTotal / holesPlayed : 0;

          return {
            entryId: e.entityId,
            label: e.label,
            total: pointsTotal,
            stats: {
              members: buildMembersLabel(ctx, e.memberPlayerIds),
              holes_played: holesPlayed,
              points_total: pointsTotal,
              avg_points: round2(avg),
              team_best_m: M,
              zero_penalty_total: zeroPenaltyTotal,
              method: "top_m_minus_zeros",
            },
          };
        });
    },
    tieBreak: "none",
  };
}

export const competitionCatalog: CompetitionDefinition[] = [
  // Existing individual tour competitions
  avgStablefordByPar(3, "tour_napoleon_par3_avg", "Napoleon (Tour) – Avg Stableford on Par 3s"),
  avgStablefordByPar(4, "tour_big_george_par4_avg", "The Big George (Tour) – Avg Stableford on Par 4s"),
  avgStablefordByPar(5, "tour_grand_canyon_par5_avg", "The Grand Canyon (Tour) – Avg Stableford on Par 5s"),

  pctOfPlayedHoles(
    "tour_bagel_man_zero_pct",
    "The Bagel Man (Tour) – % Holes with 0 Points",
    (pts) => pts === 0,
    "zero"
  ),

  pctOfPlayedHoles(
    "tour_wizard_four_plus_pct",
    "The Wizard (Tour) – % Holes with 4+ Points",
    (pts) => pts >= 4,
    "four_plus"
  ),

  tourEclectic("tour_eclectic", "The Eclectic (Tour) – Best Stableford per Hole"),

  // ✅ NEW: Pairs — Best Ball Stableford
  tourPairBestBallStableford("tour_pair_best_ball_stableford", "Pairs (Tour) – Best Ball Stableford"),

  // ✅ NEW: Teams — Top M minus zeros
  // IMPORTANT: id matches the leaderboard page display detection: "tour_team_best_m_minus_zeros"
  tourTeamTopMMinusZeros("tour_team_best_m_minus_zeros", "Teams (Tour) – Top M Stableford minus zeros"),
];
