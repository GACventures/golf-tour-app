// lib/stats/playerTourStats.ts
import { netStablefordPointsForHole } from "@/lib/stableford";

export type HoleParSI = {
  course_id: string;
  hole_number: number; // 1..18
  par: number | null;
  stroke_index: number | null; // 1..18
};

export type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number; // 1..18
  strokes: number | string | null;
  pickup?: boolean | string | null;
};

export type RoundRow = {
  id: string;
  tour_id: string;
  course_id: string | null;
  name?: string | null;
  created_at?: string | null;
};

export type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing_handicap: number | string | null;
};

export type OutcomeBucket =
  | "eagleOrBetter"
  | "birdie"
  | "par"
  | "bogey"
  | "doubleOrWorse";

export type OutcomeCounts = Record<OutcomeBucket, number>;

export type RoundStablefordSummary = {
  round_id: string;
  course_id: string;
  stableford_total: number;
  holes_scored: number;
  is_complete: boolean;
};

export type PlayerTourStats = {
  rounds: {
    roundsPlayedCompleted: number;
    bestStableford: number | null;
    worstStableford: number | null;
    avgStableford: number | null;
    stdDevStableford: number | null;
    completedRoundTotals: number[];
    roundSummaries: RoundStablefordSummary[];
  };
  holes: {
    holesPlayedAll: number;
    grossOutcomes: OutcomeCounts;
    netOutcomes: OutcomeCounts;
  };
  debug: {
    roundsFetched: number;
    parsFetched: number;
    scoresFetched: number;
    roundPlayersFetched: number;
    parsMissingForScoredHoles: number;
    holesCountedAsPickup: number;
    holesCountedAsNumeric: number;
    stablefordAdapterMode: string;
  };
};

function emptyOutcomeCounts(): OutcomeCounts {
  return {
    eagleOrBetter: 0,
    birdie: 0,
    par: 0,
    bogey: 0,
    doubleOrWorse: 0,
  };
}

function bucketFromDiff(diff: number): OutcomeBucket {
  if (diff <= -2) return "eagleOrBetter";
  if (diff === -1) return "birdie";
  if (diff === 0) return "par";
  if (diff === 1) return "bogey";
  return "doubleOrWorse";
}

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stdDevSample(nums: number[]): number | null {
  if (nums.length < 2) return null;
  const m = mean(nums)!;
  const variance = nums.reduce((acc, x) => acc + (x - m) * (x - m), 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

function normalizePickup(pickup: ScoreRow["pickup"], strokes: ScoreRow["strokes"]): boolean {
  if (pickup === true) return true;
  if (pickup === false) return false;
  if (typeof pickup === "string") {
    const s = pickup.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "p") return true;
  }
  if (typeof strokes === "string" && strokes.trim().toUpperCase() === "P") return true;
  return false;
}

function normalizeStrokes(strokes: ScoreRow["strokes"]): number | null {
  if (typeof strokes === "number" && Number.isFinite(strokes)) return strokes;
  if (typeof strokes === "string") {
    const t = strokes.trim();
    if (!t) return null;
    if (t.toUpperCase() === "P") return null;
    const n = Number(t);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeNumber(n: number | string | null | undefined): number | null {
  if (typeof n === "number" && Number.isFinite(n)) return n;
  if (typeof n === "string") {
    const t = n.trim();
    if (!t) return null;
    const v = Number(t);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function isHoleScored(pickup: boolean, strokes: number | null): boolean {
  return pickup || strokes != null;
}

/**
 * Standard handicap stroke allocation per hole.
 */
export function strokesReceivedOnHole(playingHandicap: number, strokeIndex: number): number {
  const hcp = Math.max(0, Math.floor(playingHandicap));
  const base = Math.floor(hcp / 18);
  const rem = hcp % 18;
  const extra = strokeIndex <= rem ? 1 : 0;
  return base + extra;
}

export function pct(count: number, total: number): number {
  if (!total) return 0;
  return (count / total) * 100;
}

/**
 * Fallback Stableford formula:
 * points = max(0, 2 + (par - netStrokes))
 * pickup => 0
 */
function stablefordFallback(par: number, si: number, hcp: number, strokes: number | null, pickup: boolean): number {
  if (pickup || strokes == null) return 0;
  const recv = strokesReceivedOnHole(hcp, si);
  const netStrokes = strokes - recv;
  const pts = 2 + (par - netStrokes);
  // clamp to sane range
  return Math.max(0, Math.min(8, pts));
}

/**
 * Auto-detect adapter for netStablefordPointsForHole argument order.
 * We test a "par" hole: par=4, si=18, hcp=0, strokes=4, pickup=false => should return 2.
 */
type StablefordMode =
  | "par,si,hcp,strokes,pickup"
  | "par,si,strokes,hcp,pickup"
  | "par,strokes,si,hcp,pickup"
  | "par,strokes,hcp,si,pickup"
  | "fallback";

let _mode: StablefordMode | null = null;

function callLib(mode: Exclude<StablefordMode, "fallback">, par: number, si: number, hcp: number, strokes: number | null, pickup: boolean): any {
  switch (mode) {
    case "par,si,hcp,strokes,pickup":
      return (netStablefordPointsForHole as any)(par, si, hcp, strokes, pickup);
    case "par,si,strokes,hcp,pickup":
      return (netStablefordPointsForHole as any)(par, si, strokes, hcp, pickup);
    case "par,strokes,si,hcp,pickup":
      return (netStablefordPointsForHole as any)(par, strokes, si, hcp, pickup);
    case "par,strokes,hcp,si,pickup":
      return (netStablefordPointsForHole as any)(par, strokes, hcp, si, pickup);
  }
}

function detectMode(): StablefordMode {
  const par = 4;
  const si = 18;
  const hcp = 0;
  const strokes = 4;
  const pickup = false;

  const candidates: Exclude<StablefordMode, "fallback">[] = [
    "par,si,hcp,strokes,pickup",
    "par,si,strokes,hcp,pickup",
    "par,strokes,si,hcp,pickup",
    "par,strokes,hcp,si,pickup",
  ];

  for (const m of candidates) {
    const v = callLib(m, par, si, hcp, strokes, pickup);
    if (typeof v === "number" && Number.isFinite(v) && v === 2) return m;
  }
  return "fallback";
}

function stablefordPoints(par: number, si: number, hcp: number, strokes: number | null, pickup: boolean): { pts: number; mode: StablefordMode } {
  if (_mode == null) _mode = detectMode();

  if (_mode === "fallback") {
    return { pts: stablefordFallback(par, si, hcp, strokes, pickup), mode: _mode };
  }

  const v = callLib(_mode, par, si, hcp, strokes, pickup);
  if (typeof v === "number" && Number.isFinite(v)) {
    // keep within a sane range
    const pts = Math.max(0, Math.min(8, v));
    return { pts, mode: _mode };
  }

  // safety fallback if lib returns unexpected type
  return { pts: stablefordFallback(par, si, hcp, strokes, pickup), mode: "fallback" };
}

export function computePlayerTourStats(input: {
  rounds: RoundRow[];
  pars: HoleParSI[];
  scores: ScoreRow[];
  roundPlayers: RoundPlayerRow[];
  playerId: string;
}): PlayerTourStats {
  const { rounds, pars, scores, roundPlayers, playerId } = input;

  const parByCourseHole = new Map<string, { par: number; si: number }>();
  for (const p of pars) {
    const parN = normalizeNumber(p.par);
    const siN = normalizeNumber(p.stroke_index);
    if (!p.course_id || !p.hole_number || parN == null || siN == null) continue;
    parByCourseHole.set(`${p.course_id}:${p.hole_number}`, { par: parN, si: siN });
  }

  const scoreByRoundHole = new Map<string, ScoreRow>();
  for (const s of scores) {
    if (s.player_id !== playerId) continue;
    scoreByRoundHole.set(`${s.round_id}:${s.hole_number}`, s);
  }

  const hcpByRound = new Map<string, number>();
  for (const rp of roundPlayers) {
    if (rp.player_id !== playerId) continue;
    const h = normalizeNumber(rp.playing_handicap);
    if (h != null) hcpByRound.set(rp.round_id, h);
  }

  const grossOutcomes = emptyOutcomeCounts();
  const netOutcomes = emptyOutcomeCounts();
  let holesPlayedAll = 0;

  let parsMissingForScoredHoles = 0;
  let holesCountedAsPickup = 0;
  let holesCountedAsNumeric = 0;

  const roundSummaries: RoundStablefordSummary[] = [];

  // ensure mode detected once (and included in debug)
  if (_mode == null) _mode = detectMode();

  for (const r of rounds) {
    if (!r.course_id) continue;

    const playingHandicap = hcpByRound.get(r.id) ?? 0;

    let stablefordTotal = 0;
    let holesScoredThisRound = 0;

    for (let hole = 1; hole <= 18; hole++) {
      const parSI = parByCourseHole.get(`${r.course_id}:${hole}`);

      const raw = scoreByRoundHole.get(`${r.id}:${hole}`);
      if (!raw) continue;

      const pickup = normalizePickup(raw.pickup, raw.strokes);
      const strokes = normalizeStrokes(raw.strokes);

      if (!isHoleScored(pickup, strokes)) continue;

      if (!parSI) {
        parsMissingForScoredHoles += 1;
        continue;
      }

      holesPlayedAll += 1;
      holesScoredThisRound += 1;

      if (pickup) holesCountedAsPickup += 1;
      else holesCountedAsNumeric += 1;

      // Gross outcomes
      if (pickup || strokes == null) {
        grossOutcomes.doubleOrWorse += 1;
      } else {
        grossOutcomes[bucketFromDiff(strokes - parSI.par)] += 1;
      }

      // Net outcomes
      if (pickup || strokes == null) {
        netOutcomes.doubleOrWorse += 1;
      } else {
        const recv = strokesReceivedOnHole(playingHandicap, parSI.si);
        const netStrokes = strokes - recv;
        netOutcomes[bucketFromDiff(netStrokes - parSI.par)] += 1;
      }

      // Stableford (signature-safe)
      stablefordTotal += stablefordPoints(parSI.par, parSI.si, playingHandicap, strokes, pickup).pts;
    }

    const isComplete = holesScoredThisRound === 18;

    roundSummaries.push({
      round_id: r.id,
      course_id: r.course_id,
      stableford_total: stablefordTotal,
      holes_scored: holesScoredThisRound,
      is_complete: isComplete,
    });
  }

  const completed = roundSummaries.filter((x) => x.is_complete);
  const completedTotals = completed.map((x) => x.stableford_total);

  return {
    rounds: {
      roundsPlayedCompleted: completed.length,
      bestStableford: completedTotals.length ? Math.max(...completedTotals) : null,
      worstStableford: completedTotals.length ? Math.min(...completedTotals) : null,
      avgStableford: mean(completedTotals),
      stdDevStableford: stdDevSample(completedTotals),
      completedRoundTotals: completedTotals,
      roundSummaries,
    },
    holes: {
      holesPlayedAll,
      grossOutcomes,
      netOutcomes,
    },
    debug: {
      roundsFetched: rounds.length,
      parsFetched: pars.length,
      scoresFetched: scores.length,
      roundPlayersFetched: roundPlayers.length,
      parsMissingForScoredHoles,
      holesCountedAsPickup,
      holesCountedAsNumeric,
      stablefordAdapterMode: _mode ?? "fallback",
    },
  };
}
