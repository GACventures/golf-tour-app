// lib/teeTimes/japanTourTeeTimes.ts

export type Tee = "M" | "F";

export type RoundRowLite = {
  id: string;
  round_no: number | null;
  course_id: string | null;
};

export type Pair = { a: string; b: string };

export type ParRowLite = {
  course_id: string;
  tee: Tee;
  hole_number: number;
  par: number;
  stroke_index: number;
};

export type RoundPlayerLite = {
  round_id: string;
  player_id: string;
  playing_handicap: number | null;
  tee: Tee;
};

export type ScoreLite = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean | null;
};

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildGroupSizes(nPlayers: number): number[] {
  const sizes: number[] = [];
  if (nPlayers <= 0) return sizes;

  const mod = nPlayers % 4;
  if (mod === 0) {
    for (let i = 0; i < nPlayers / 4; i++) sizes.push(4);
    return sizes;
  }
  if (mod === 3) {
    sizes.push(3);
    const remaining = nPlayers - 3;
    for (let i = 0; i < remaining / 4; i++) sizes.push(4);
    return sizes;
  }
  if (mod === 2) {
    sizes.push(3, 3);
    const remaining = nPlayers - 6;
    for (let i = 0; i < remaining / 4; i++) sizes.push(4);
    return sizes;
  }
  if (nPlayers >= 9) {
    sizes.push(3, 3, 3);
    const remaining = nPlayers - 9;
    for (let i = 0; i < remaining / 4; i++) sizes.push(4);
    return sizes;
  }
  sizes.push(3);
  let rem = nPlayers - 3;
  while (rem >= 4) {
    sizes.push(4);
    rem -= 4;
  }
  if (rem > 0) sizes.push(rem);
  return sizes;
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function coPlayCountMatrix(pastGroups: string[][]): Map<string, number> {
  const m = new Map<string, number>();
  for (const grp of pastGroups) {
    for (let i = 0; i < grp.length; i++) {
      for (let j = i + 1; j < grp.length; j++) {
        const key = pairKey(grp[i], grp[j]);
        m.set(key, (m.get(key) ?? 0) + 1);
      }
    }
  }
  return m;
}

function groupScore(group: string[], candidate: string, matrix: Map<string, number>) {
  let s = 0;
  for (const p of group) s += matrix.get(pairKey(p, candidate)) ?? 0;
  return s;
}

export function generateRound1PreferPairs(playerIds: string[], pairs: Pair[]) {
  const sizes = buildGroupSizes(playerIds.length);
  const unassigned = new Set(playerIds);
  const validPairs = pairs.filter((p) => unassigned.has(p.a) && unassigned.has(p.b));

  const groups: string[][] = [];
  while (groups.length < sizes.length) groups.push([]);

  for (const pr of validPairs) {
    if (!unassigned.has(pr.a) || !unassigned.has(pr.b)) continue;

    for (let gi = 0; gi < groups.length; gi++) {
      if (groups[gi].length + 2 <= sizes[gi]) {
        groups[gi].push(pr.a, pr.b);
        unassigned.delete(pr.a);
        unassigned.delete(pr.b);
        break;
      }
    }
  }

  const remaining = shuffle(Array.from(unassigned));
  let k = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const target = sizes[gi];
    while (groups[gi].length < target && k < remaining.length) {
      groups[gi].push(remaining[k++]);
    }
  }

  return groups;
}

export function generateFairMix(playerIds: string[], pastGroups: string[][]) {
  const sizes = buildGroupSizes(playerIds.length);
  const matrix = coPlayCountMatrix(pastGroups);

  const remaining = new Set(playerIds);
  const groups: string[][] = [];

  for (const size of sizes) {
    const seed = shuffle(Array.from(remaining))[0];
    if (!seed) break;

    const g: string[] = [seed];
    remaining.delete(seed);

    while (g.length < size) {
      const candidates = Array.from(remaining);
      if (candidates.length === 0) break;

      let best = candidates[0];
      let bestScore = groupScore(g, best, matrix);

      for (let i = 1; i < candidates.length; i++) {
        const c = candidates[i];
        const sc = groupScore(g, c, matrix);
        if (sc < bestScore) {
          bestScore = sc;
          best = c;
        }
      }

      g.push(best);
      remaining.delete(best);
    }

    groups.push(g);
  }

  return groups;
}

/**
 * Japan helper: build 2M2F groups with fairness objective (min co-play counts).
 * Expects groups of 4 (best effort if not).
 */
export function generateMixed2M2F_Fair(maleIds: string[], femaleIds: string[], pastGroups: string[][]) {
  const matrix = coPlayCountMatrix(pastGroups);

  const males = new Set(maleIds);
  const females = new Set(femaleIds);

  const groups: string[][] = [];
  const groupCount = Math.min(Math.floor(maleIds.length / 2), Math.floor(femaleIds.length / 2));

  function pickBest(from: Set<string>, current: string[]) {
    const cand = Array.from(from);
    if (cand.length === 0) return null;
    let best = cand[0];
    let bestScore = groupScore(current, best, matrix);
    for (let i = 1; i < cand.length; i++) {
      const c = cand[i];
      const sc = groupScore(current, c, matrix);
      if (sc < bestScore) {
        bestScore = sc;
        best = c;
      }
    }
    return best;
  }

  for (let gi = 0; gi < groupCount; gi++) {
    const mSeed = shuffle(Array.from(males))[0];
    if (!mSeed) break;

    const g: string[] = [mSeed];
    males.delete(mSeed);

    const m2 = pickBest(males, g);
    if (m2) {
      g.push(m2);
      males.delete(m2);
    }

    const f1 = pickBest(females, g);
    if (f1) {
      g.push(f1);
      females.delete(f1);
    }

    const f2 = pickBest(females, g);
    if (f2) {
      g.push(f2);
      females.delete(f2);
    }

    if (g.length < 4) {
      const backfill = shuffle([...Array.from(males), ...Array.from(females)]);
      while (g.length < 4 && backfill.length) {
        const pid = backfill.shift()!;
        if (males.has(pid)) males.delete(pid);
        if (females.has(pid)) females.delete(pid);
        g.push(pid);
      }
    }

    groups.push(g);
  }

  const rem = shuffle([...Array.from(males), ...Array.from(females)]);
  let idx = 0;
  while (idx < rem.length) {
    if (groups.length === 0) groups.push([]);
    const target = groups[groups.length - 1];
    if (target.length < 4) target.push(rem[idx++]);
    else groups.push([rem[idx++]]);
  }

  return groups;
}

/**
 * Japan helper for rounds 2/4/6:
 * - 2 all-M groups (4 each)
 * - 2 all-F groups (4 each)
 * - 1 mixed group (2M2F)
 * constraint: mixed participants must not repeat across rounds 2/4/6.
 *
 * Best-effort; if the expected structure isn't possible, returns fallback fair-mix.
 */
export function generateJapanR246(
  allPlayerIds: string[],
  genderById: Map<string, Tee>,
  pastGroups: string[][],
  usedMixedM: Set<string>,
  usedMixedF: Set<string>
): { groups: string[][]; mixedM: string[]; mixedF: string[]; warning?: string } {
  const matrix = coPlayCountMatrix(pastGroups);

  const malesAll = allPlayerIds.filter((pid) => (genderById.get(pid) ?? "M") === "M");
  const femalesAll = allPlayerIds.filter((pid) => (genderById.get(pid) ?? "M") === "F");

  const sizes = buildGroupSizes(allPlayerIds.length);
  const allFour = sizes.length > 0 && sizes.every((s) => s === 4);

  if (!allFour) {
    return {
      groups: generateFairMix(allPlayerIds, pastGroups),
      mixedM: [],
      mixedF: [],
      warning: "Expected 4-balls; fell back to fair mix.",
    };
  }

  if (malesAll.length < 10 || femalesAll.length < 10 || allPlayerIds.length !== 20) {
    return {
      groups: generateFairMix(allPlayerIds, pastGroups),
      mixedM: [],
      mixedF: [],
      warning: "Expected 20 players (10M/10F) for exact composition; fell back to fair mix.",
    };
  }

  const eligibleM = malesAll.filter((m) => !usedMixedM.has(m));
  const eligibleF = femalesAll.filter((f) => !usedMixedF.has(f));

  const pickTwoFair = (pool: string[], against: string[]) => {
    const rem = new Set(pool);
    const chosen: string[] = [];
    const seed = shuffle(Array.from(rem))[0];
    if (seed) {
      chosen.push(seed);
      rem.delete(seed);
    }
    while (chosen.length < 2) {
      const candidates = Array.from(rem);
      if (!candidates.length) break;

      let best = candidates[0];
      let bestScore = groupScore([...against, ...chosen], best, matrix);
      for (let i = 1; i < candidates.length; i++) {
        const c = candidates[i];
        const sc = groupScore([...against, ...chosen], c, matrix);
        if (sc < bestScore) {
          bestScore = sc;
          best = c;
        }
      }
      chosen.push(best);
      rem.delete(best);
    }
    return chosen;
  };

  let warn = "";
  const mixedM = pickTwoFair(eligibleM.length >= 2 ? eligibleM : malesAll, []);
  const mixedF = pickTwoFair(eligibleF.length >= 2 ? eligibleF : femalesAll, mixedM);

  if (eligibleM.length < 2) warn += "Not enough unused M for mixed ‘no repeat’; allowed repeats. ";
  if (eligibleF.length < 2) warn += "Not enough unused F for mixed ‘no repeat’; allowed repeats. ";

  mixedM.forEach((m) => usedMixedM.add(m));
  mixedF.forEach((f) => usedMixedF.add(f));

  const remainingM = malesAll.filter((m) => !mixedM.includes(m));
  const remainingF = femalesAll.filter((f) => !mixedF.includes(f));

  const buildSameGenderGroups = (ids: string[], count: number) => {
    const rem = new Set(ids);
    const out: string[][] = [];
    for (let gi = 0; gi < count; gi++) {
      const g: string[] = [];
      const seed = shuffle(Array.from(rem))[0];
      if (!seed) break;
      g.push(seed);
      rem.delete(seed);
      while (g.length < 4) {
        const cand = Array.from(rem);
        if (!cand.length) break;
        let best = cand[0];
        let bestScore = groupScore(g, best, matrix);
        for (let i = 1; i < cand.length; i++) {
          const c = cand[i];
          const sc = groupScore(g, c, matrix);
          if (sc < bestScore) {
            bestScore = sc;
            best = c;
          }
        }
        g.push(best);
        rem.delete(best);
      }
      out.push(g);
    }
    return out;
  };

  const mGroups = buildSameGenderGroups(remainingM, 2);
  const fGroups = buildSameGenderGroups(remainingF, 2);
  const mixedGroup = [...mixedM, ...mixedF];

  return { groups: [...mGroups, ...fGroups, mixedGroup], mixedM, mixedF, warning: warn.trim() || undefined };
}

/**
 * Round 7 groups: 2M2F with BEST in final group.
 * Input totals is map pid -> stableford total (higher is better).
 */
export function generateJapanRound7Seeded(
  playerIds: string[],
  genderById: Map<string, Tee>,
  totals: Map<string, number>
) {
  const sizes = buildGroupSizes(playerIds.length);
  const allFour = sizes.length > 0 && sizes.every((s) => s === 4);

  const males = playerIds.filter((pid) => (genderById.get(pid) ?? "M") === "M");
  const females = playerIds.filter((pid) => (genderById.get(pid) ?? "M") === "F");

  if (!allFour || males.length !== females.length) {
    // caller can decide fallback
    return null;
  }

  // WORST -> BEST so BEST land in the last group.
  const malesAsc = [...males].sort((a, b) => (totals.get(a) ?? 0) - (totals.get(b) ?? 0) || a.localeCompare(b));
  const femalesAsc = [...females].sort((a, b) => (totals.get(a) ?? 0) - (totals.get(b) ?? 0) || a.localeCompare(b));

  const groupCount = sizes.length;
  const groups: string[][] = [];
  let mi = 0;
  let fi = 0;

  for (let gi = 0; gi < groupCount; gi++) {
    groups.push([malesAsc[mi++], malesAsc[mi++], femalesAsc[fi++], femalesAsc[fi++]].filter(Boolean));
  }

  return groups;
}
