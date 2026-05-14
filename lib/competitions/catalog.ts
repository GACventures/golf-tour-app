// lib/competitions/catalog.ts
import type { CompetitionDefinition, CompetitionContext } from "./types";

function round2(n: number) {
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function pct2(num: number, den: number) {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0;
  return round2((num / den) * 100);
}

type TourLikeCtx = {
  scope?: "tour";
  players: Array<{ id: string; name: string; playing?: boolean }>;
  rounds: Array<any>;
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

  if (Array.isArray(ctx.entities) && ctx.entities.length) {
    for (const e of ctx.entities) {
      const ids = (e as any)?.memberPlayerIds ?? [];
      if (!Array.isArray(ids) || ids.length === 0) continue;
      const label = String((e as any)?.label ?? (ctx.entityLabelsById?.[(e as any)?.entityId] ?? (e as any)?.entityId));
      out.push({ entityId: String((e as any)?.entityId), label, memberPlayerIds: ids.map(String) });
    }
    return out;
  }

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

function shouldCountHole(r: any, playerId: string, holeIndex: number) {
  if (r?.isSwingInSpringRound3 === true && typeof r?.isHolePlayed === "function") {
    return r.isHolePlayed(playerId, holeIndex);
  }
  return true;
}

function memberPlayedHole(r: any, memberIds: string[], holeIndex: number) {
  if (r?.isSwingInSpringRound3 === true && typeof r?.isHolePlayed === "function") {
    return memberIds.some((pid) => r.isHolePlayed(pid, holeIndex));
  }
  return true;
}

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
          const isComplete = (r as any)?.isComplete;
          const parForPlayerHole: ((playerId: string, holeIndex: number) => number) | undefined = (r as any)?.parForPlayerHole;

          if (typeof isComplete === "function" && !isComplete(p.id)) continue;

          for (let i = 0; i < holes.length; i++) {
            if (!shouldCountHole(r, p.id, i)) continue;

            const par = Number(
              typeof parForPlayerHole === "function" ? parForPlayerHole(p.id, i) : Number((r as any)?.parsByHole?.[i] ?? 0)
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

function avgSumStablefordForHoleRange(params: {
  id: string;
  name: string;
  startHole: number;
  endHole: number;
}): CompetitionDefinition {
  const { id, name, startHole, endHole } = params;

  const startIdx = Math.max(0, Math.min(17, Math.floor(startHole - 1)));
  const endIdx = Math.max(0, Math.min(17, Math.floor(endHole - 1)));

  const lo = Math.min(startIdx, endIdx);
  const hi = Math.max(startIdx, endIdx);

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
        let roundsCount = 0;
        let sumOfRoundSums = 0;

        for (const r of ctx.rounds ?? []) {
          const isComplete = (r as any)?.isComplete;
          if (typeof isComplete === "function" && !isComplete(p.id)) continue;

          let roundSum = 0;
          let countedAnyHole = false;

          for (let i = lo; i <= hi; i++) {
            if (!shouldCountHole(r, p.id, i)) continue;

            countedAnyHole = true;
            const pts = Number((r as any)?.netPointsForHole?.(p.id, i) ?? 0) || 0;
            roundSum += pts;
          }

          if (!countedAnyHole) continue;

          roundsCount += 1;
          sumOfRoundSums += roundSum;
        }

        const avg = roundsCount > 0 ? sumOfRoundSums / roundsCount : 0;

        return {
          entryId: p.id,
          label: p.name,
          total: avg,
          stats: {
            rounds_count: roundsCount,
            sum_of_round_sums: sumOfRoundSums,
            avg_round_sum: round2(avg),
            holes_range: `${startHole}-${endHole}`,
          },
        };
      });
    },
  };
}

function parseGrossStrokes(raw: any): number | null {
  const s = String(raw ?? "").trim().toUpperCase();
  if (!s) return null;
  if (s === "P") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function roundLabel(idx: number) {
  return `R${idx + 1}`;
}

function fmtWhere(rIdx: number, startHole: number, endHole: number) {
  const a = Math.max(1, Math.min(18, Math.floor(startHole)));
  const b = Math.max(1, Math.min(18, Math.floor(endHole)));
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return `${roundLabel(rIdx)}: H${lo}\u2013H${hi}`;
}

type StreakResult = {
  len: number;
  roundIdx: number;
  startHole: number;
  endHole: number;
};

function betterStreakDisplay(a: StreakResult | null, b: StreakResult): StreakResult {
  if (!a) return b;
  if (b.len > a.len) return b;
  if (b.len < a.len) return a;
  if (b.roundIdx < a.roundIdx) return b;
  if (b.roundIdx > a.roundIdx) return a;
  if (b.startHole < a.startHole) return b;
  return a;
}

function streakCompetition(params: {
  id: string;
  name: string;
  qualifies: (gross: number, par: number) => boolean;
}): CompetitionDefinition {
  const { id, name, qualifies } = params;
  const isColdStreak = id === "tour_cold_streak_best_run";

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
        let best: StreakResult | null = null;

        for (let rIdx = 0; rIdx < (ctx.rounds ?? []).length; rIdx++) {
          const r = (ctx.rounds ?? [])[rIdx];

          const isComplete = (r as any)?.isComplete;
          if (typeof isComplete === "function" && !isComplete(p.id)) continue;

          const scoresMatrix: Record<string, string[]> = (r as any)?.scores ?? {};
          const parForPlayerHole: ((playerId: string, holeIndex: number) => number) | undefined = (r as any)?.parForPlayerHole;

          if (typeof parForPlayerHole !== "function") {
            continue;
          }

          const arr = scoresMatrix?.[p.id] ?? [];
          let curLen = 0;
          let curStart = 1;

          let roundBestLen = 0;
          let roundBestStart = 1;
          let roundBestEnd = 1;

          for (let i = 0; i < 18; i++) {
            if (!shouldCountHole(r, p.id, i)) {
              curLen = 0;
              continue;
            }

            const raw = String(arr[i] ?? "").trim().toUpperCase();
            const gross = parseGrossStrokes(raw);
            const par = Number(parForPlayerHole(p.id, i) ?? 0);

            const pickupCountsForColdStreak = isColdStreak && raw === "P";
            const normalQualifies = gross !== null && Number.isFinite(par) && par > 0 && qualifies(gross, par);

            const ok = pickupCountsForColdStreak || normalQualifies;

            if (ok) {
              if (curLen === 0) curStart = i + 1;
              curLen += 1;

              if (curLen > roundBestLen) {
                roundBestLen = curLen;
                roundBestStart = curStart;
                roundBestEnd = i + 1;
              }
            } else {
              curLen = 0;
            }
          }

          if (roundBestLen > 0) {
            best = betterStreakDisplay(best, {
              len: roundBestLen,
              roundIdx: rIdx,
              startHole: roundBestStart,
              endHole: roundBestEnd,
            });
          }
        }

        const len = best?.len ?? 0;

        return {
          entryId: p.id,
          label: p.name,
          total: len,
          stats: {
            streak_len: len,
            streak_round: best ? roundLabel(best.roundIdx) : "",
            streak_start_hole: best ? best.startHole : null,
            streak_end_hole: best ? best.endHole : null,
            streak_where: best ? fmtWhere(best.roundIdx, best.startHole, best.endHole) : "",
          },
        };
      });
    },
  };
}

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
            if (!shouldCountHole(r, p.id, i)) continue;

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
            if (!shouldCountHole(r, p.id, i)) continue;

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
            if (!shouldCountHole(r, p.id, i)) continue;

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
            if (!memberPlayedHole(r, members, i)) continue;

            holesPlayed += 1;
            const ptsA = shouldCountHole(r, members[0], i) ? Number((r as any)?.netPointsForHole?.(members[0], i) ?? 0) || 0 : 0;
            const ptsB = shouldCountHole(r, members[1], i) ? Number((r as any)?.netPointsForHole?.(members[1], i) ?? 0) || 0 : 0;
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
            if (!memberPlayedHole(r, members, i)) continue;

            holesPlayed += 1;
            const ptsA = shouldCountHole(r, members[0], i) ? Number((r as any)?.netPointsForHole?.(members[0], i) ?? 0) || 0 : 0;
            const ptsB = shouldCountHole(r, members[1], i) ? Number((r as any)?.netPointsForHole?.(members[1], i) ?? 0) || 0 : 0;
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
            if (!memberPlayedHole(r, members, i)) continue;

            holesPlayed += 1;

            const pts = members
              .filter((pid) => shouldCountHole(r, pid, i))
              .map((pid) => Number((r as any)?.netPointsForHole?.(pid, i) ?? 0) || 0);

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
            if (!memberPlayedHole(r, members, i)) continue;

            holesPlayed += 1;
            for (const pid of members) {
              if (!shouldCountHole(r, pid, i)) continue;
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
  avgStablefordByPar(3, "tour_napoleon_par3_avg", "Napoleon (Par 3 avg)"),
  avgStablefordByPar(4, "tour_big_george_par4_avg", "Big George (Par 4 avg)"),
  avgStablefordByPar(5, "tour_grand_canyon_par5_avg", "Grand Canyon (Par 5 avg)"),

  bagelMan("tour_bagel_man_zero_pct", "Bagel Man (% zero holes)"),
  wizard("tour_wizard_four_plus_pct", "Wizard (% 4+ holes)"),
  eclectic("tour_eclectic_total", "Eclectic (best per hole)"),

  avgSumStablefordForHoleRange({
    id: "tour_schumacher_first3_avg",
    name: "Schumacher (Avg Stableford holes 1–3)",
    startHole: 1,
    endHole: 3,
  }),
  avgSumStablefordForHoleRange({
    id: "tour_closer_last3_avg",
    name: "Closer (Avg Stableford holes 16–18)",
    startHole: 16,
    endHole: 18,
  }),

  streakCompetition({
    id: "tour_hot_streak_best_run",
    name: "Hot Streak (Best par-or-better run)",
    qualifies: (gross, par) => gross <= par,
  }),
  streakCompetition({
    id: "tour_cold_streak_best_run",
    name: "Cold Streak (Best bogey-or-worse run)",
    qualifies: (gross, par) => gross >= par + 1,
  }),

  tourPairBestBallStableford("tour_pair_best_ball_stableford", "Pairs: Best Ball (Stableford)"),
  tourPairAggregateStableford("tour_pair_aggregate_stableford", "Pairs: Aggregate (Stableford)"),

  tourTeamBestMMinusZeros("tour_team_best_m_minus_zeros", "Teams: Best M per hole − zeros"),
  tourTeamAggregateStableford("tour_team_aggregate_stableford", "Teams: Aggregate (Stableford)"),
];