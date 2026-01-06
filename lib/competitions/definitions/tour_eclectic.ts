import type { CompetitionDefinition, TourCompetitionContext } from "../types";

export const tourEclectic: CompetitionDefinition = {
  id: "tour_eclectic",
  name: "The Eclectic",
  kind: "individual",
  scope: "tour",

  // Eligibility intent:
  // - onlyPlaying: must have played at least one included round (your leaderboard already sets this)
  // - requireComplete: NOT required (eclectic can work with partial data)
  eligibility: {
    onlyPlaying: true,
    requireComplete: false,
  },

  // Main scoring
  run: (ctx: TourCompetitionContext) => {
    const holes = Array.from({ length: 18 }, (_, i) => i); // holeIndex 0..17

    const rows = ctx.players
      .filter((p) => (ctx.players?.length ? p.playing : true))
      .map((p) => {
        // For each hole, best net points across all included rounds
        const bestByHole: number[] = holes.map((holeIndex) => {
          let best = 0;

          for (const r of ctx.rounds) {
            // If the player did not play the round, your tour context netPointsForHole returns 0
            const pts = r.netPointsForHole(p.id, holeIndex);

            // guard: only consider finite values
            if (Number.isFinite(pts)) best = Math.max(best, pts);
          }

          return best;
        });

        const total = bestByHole.reduce((sum, v) => sum + v, 0);

        // Useful stats for debugging / display
        const holesContributed = bestByHole.filter((v) => v > 0).length;
        const bestTotal = total;

        return {
          entryId: p.id,
          label: p.name,
          total: bestTotal,
          stats: {
            holes_contributed: holesContributed,
            eclectic_total: bestTotal,
          },
        };
      })
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));

    return { rows };
  },
};
