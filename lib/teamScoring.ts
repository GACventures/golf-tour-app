// lib/teamScoring.ts

/**
 * Tour-specific deduction applied for each zero Stableford score
 * in the Teams leaderboard.
 *
 * Change the value in ZERO_STABLEFORD_DEDUCTION_BY_TOUR to alter a
 * particular tour. Tours not listed use DEFAULT_ZERO_STABLEFORD_DEDUCTION.
 */

const DEFAULT_ZERO_STABLEFORD_DEDUCTION = 1.0;

const ZERO_STABLEFORD_DEDUCTION_BY_TOUR: Record<string, number> = {
  // HDT5
  "3cdeb1ea-381e-41e0-8b91-aaadb5a4d0c3": 0.5,
};

export function getZeroStablefordDeduction(tourId: string): number {
  const configured = ZERO_STABLEFORD_DEDUCTION_BY_TOUR[tourId];

  if (Number.isFinite(configured) && configured >= 0) {
    return configured;
  }

  return DEFAULT_ZERO_STABLEFORD_DEDUCTION;
}