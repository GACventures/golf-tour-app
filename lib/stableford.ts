// lib/stableford.ts

/**
 * Stableford points from (gross or net) strokes and par.
 *
 * Key rule:
 * - We allow strokes to be 0 or negative (can happen for NET strokes when
 *   a player receives more strokes than their gross score).
 * - We DO NOT force 0 points for strokes <= 0 here. That decision belongs
 *   to the caller (e.g. blank input / pickup).
 *
 * Formula:
 *   Par = 2 points
 *   Birdie = 3, Eagle = 4, etc.
 *   points = 2 + (par - strokes)
 *   and never below 0.
 */
export function stablefordPoints(strokes: number, par: number): number {
  if (!Number.isFinite(strokes) || !Number.isFinite(par) || par <= 0) return 0;

  const pts = 2 + (par - strokes);

  // Stableford points cannot be negative.
  // Use Math.floor to keep integer results if strokes is ever non-integer.
  return Math.max(0, Math.floor(pts));
}

/**
 * Net Stableford points for a hole.
 * - rawScore: "", "P", or a number string
 * - returns 0 only for blank/invalid/P (pickup)
 * - otherwise computes strokes received from playing handicap + stroke index
 * - then stableford on net strokes (which can be 0 or negative)
 */
export function netStablefordPointsForHole(args: {
  rawScore: string;          // "5", "P", ""
  par: number;               // hole par
  strokeIndex: number;       // 1..18 (1 hardest)
  playingHandicap: number;   // per-round handicap
}): number {
  const raw = (args.rawScore ?? '').toString().trim().toUpperCase();
  const par = args.par;
  const strokeIndex = args.strokeIndex;

  if (!Number.isFinite(par) || par <= 0) return 0;

  // Only return 0 when gross score is missing/invalid/pickup
  if (!raw) return 0;
  if (raw === 'P') return 0;

  const strokes = Number(raw);
  if (!Number.isFinite(strokes) || strokes <= 0) return 0;

  // Handicap strokes received
  const hcp = Math.max(0, Math.floor(args.playingHandicap ?? 0));

  const base = Math.floor(hcp / 18);
  const rem = hcp % 18;

  // Defensive: if stroke index is missing/bad, treat as no "extra" stroke.
  const extra =
    Number.isFinite(strokeIndex) && strokeIndex > 0 && strokeIndex <= rem ? 1 : 0;

  const received = base + extra;

  // Net strokes can be 0 or negative; Stableford still applies.
  const netStrokes = strokes - received;

  return stablefordPoints(netStrokes, par);
}
