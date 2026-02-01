// lib/competitions/h2z.ts

export type H2ZLeg = {
  leg_no: number;
  start_round_no: number;
  end_round_no: number;
};

export type H2ZResult = {
  finalScore: number;
  bestScore: number;
  bestLen: number;
};

export type H2ZDiagnostic = string[];

type RoundsInOrderItem = { roundId: string; round_no: number | null };

type RoundCtxLike = {
  roundId: string;
  scores: Record<string, string[]>;
  netPointsForHole: (playerId: string, holeIndex: number) => number;
  parForPlayerHole: (playerId: string, holeIndex: number) => number;
};

type TourCtxLike = {
  rounds?: RoundCtxLike[];
};

function n(x: any, fallback = 0): number {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function normScoreCell(v: any): string {
  return String(v ?? "").trim().toUpperCase();
}

function getRoundCtx(ctx: any, roundId: string): RoundCtxLike | null {
  const rounds = (ctx as TourCtxLike)?.rounds;
  if (!Array.isArray(rounds)) return null;
  const rid = String(roundId);
  const found = rounds.find((r) => String((r as any)?.roundId) === rid);
  if (!found) return null;

  const ok =
    typeof found === "object" &&
    found !== null &&
    typeof (found as any).scores === "object" &&
    typeof (found as any).netPointsForHole === "function" &&
    typeof (found as any).parForPlayerHole === "function";

  return ok ? (found as RoundCtxLike) : null;
}

function roundsForLeg(roundsInOrder: RoundsInOrderItem[], startRoundNo: number, endRoundNo: number) {
  const start = n(startRoundNo, 0);
  const end = n(endRoundNo, 0);

  return roundsInOrder.filter((r) => {
    const rn = r.round_no;
    if (!Number.isFinite(Number(rn))) return false;
    return Number(rn) >= start && Number(rn) <= end;
  });
}

function computeH2ZForPlayerInLeg(args: {
  ctx: any;
  roundsInOrder: RoundsInOrderItem[];
  isPlayingInRound: (roundId: string, playerId: string) => boolean;
  playerId: string;
  start_round_no: number;
  end_round_no: number;
}): {
  result: H2ZResult;
  diagEvents: Array<{
    roundNo: number;
    roundId: string;
    holeNo: number;
    raw: string;
    par: number;
    pts: number;
    runAfter: number;
    didReset: boolean;
  }>;
  issues: string[];
  includedRoundNos: number[];
  includedRoundIds: string[];
} {
  const { ctx, roundsInOrder, isPlayingInRound, playerId, start_round_no, end_round_no } = args;

  const issues: string[] = [];

  const legRounds = roundsForLeg(roundsInOrder, start_round_no, end_round_no);
  const includedRoundNos = legRounds.map((r) => n(r.round_no, 0));
  const includedRoundIds = legRounds.map((r) => String(r.roundId));

  if (legRounds.length === 0) {
    issues.push("No rounds matched leg bounds (check round_no on rounds)");
    return {
      result: { finalScore: 0, bestScore: 0, bestLen: 0 },
      diagEvents: [],
      issues,
      includedRoundNos,
      includedRoundIds,
    };
  }

  let running = 0;
  let best = 0;
  let bestLen = 0;
  let curLen = 0;

  const diagEvents: Array<{
    roundNo: number;
    roundId: string;
    holeNo: number;
    raw: string;
    par: number;
    pts: number;
    runAfter: number;
    didReset: boolean;
  }> = [];

  for (const r of legRounds) {
    const roundId = String(r.roundId);
    const roundNo = n(r.round_no, 0);

    if (!isPlayingInRound(roundId, playerId)) {
      continue;
    }

    const roundCtx = getRoundCtx(ctx, roundId);
    if (!roundCtx) {
      issues.push(`Round ctx missing/invalid for roundId=${roundId}`);
      continue;
    }

    const scoreArr = roundCtx.scores?.[String(playerId)];
    if (!Array.isArray(scoreArr) || scoreArr.length < 18) {
      issues.push(`scores missing for player in roundId=${roundId}`);
      continue;
    }

    for (let holeIndex = 0; holeIndex < 18; holeIndex++) {
      const holeNo = holeIndex + 1;
      const raw = normScoreCell(scoreArr[holeIndex]);

      // "" => not entered; do not affect streak
      if (raw === "") continue;

      const par = n(roundCtx.parForPlayerHole(playerId, holeIndex), 0);

      // only Par 3 holes
      if (par !== 3) continue;

      // Pickup = 0 points and DOES reset
      const pts = raw === "P" ? 0 : n(roundCtx.netPointsForHole(playerId, holeIndex), 0);

      let didReset = false;
      if (pts === 0) {
        running = 0;
        curLen = 0;
        didReset = true;
      } else {
        running += pts;
        curLen += 1;
        if (running > best) {
          best = running;
          bestLen = curLen;
        } else if (running === best && curLen > bestLen) {
          bestLen = curLen;
        }
      }

      diagEvents.push({
        roundNo,
        roundId,
        holeNo,
        raw,
        par,
        pts,
        runAfter: running,
        didReset,
      });
    }
  }

  return {
    result: { finalScore: running, bestScore: best, bestLen },
    diagEvents,
    issues,
    includedRoundNos,
    includedRoundIds,
  };
}

export function computeH2ZForPlayer(args: {
  ctx: any;
  legs: H2ZLeg[];
  roundsInOrder: RoundsInOrderItem[];
  isPlayingInRound: (roundId: string, playerId: string) => boolean;
  playerId: string;
}): Record<number, H2ZResult> {
  const { ctx, legs, roundsInOrder, isPlayingInRound, playerId } = args;

  const out: Record<number, H2ZResult> = {};

  for (const leg of legs ?? []) {
    const legNo = n(leg?.leg_no, 0);
    if (!Number.isFinite(legNo) || legNo <= 0) continue;

    const { result } = computeH2ZForPlayerInLeg({
      ctx,
      roundsInOrder,
      isPlayingInRound,
      playerId,
      start_round_no: n(leg.start_round_no, 0),
      end_round_no: n(leg.end_round_no, 0),
    });

    out[legNo] = result;
  }

  return out;
}

function pushRoundSnapshot(lines: string[], args: { ctx: any; roundId: string; roundNo: number; playerId: string }) {
  const { ctx, roundId, roundNo, playerId } = args;

  const roundCtx = getRoundCtx(ctx, roundId);
  if (!roundCtx) {
    lines.push(`roundSnapshot R${roundNo}: roundCtx NOT FOUND for roundId=${roundId}`);
    return;
  }

  const scoreArr = roundCtx.scores?.[String(playerId)];
  if (!Array.isArray(scoreArr) || scoreArr.length < 18) {
    lines.push(`roundSnapshot R${roundNo}: scores NOT FOUND for player`);
    return;
  }

  const entered: Array<{ holeNo: number; raw: string; par: number; pts: number }> = [];
  const par3Holes: number[] = [];

  for (let holeIndex = 0; holeIndex < 18; holeIndex++) {
    const holeNo = holeIndex + 1;
    const raw = normScoreCell(scoreArr[holeIndex]);
    const par = n(roundCtx.parForPlayerHole(playerId, holeIndex), 0);

    if (par === 3) par3Holes.push(holeNo);

    if (raw !== "") {
      const pts = raw === "P" ? 0 : n(roundCtx.netPointsForHole(playerId, holeIndex), 0);
      entered.push({ holeNo, raw, par, pts });
    }
  }

  lines.push(`roundSnapshot R${roundNo}: roundId=${roundId}`);
  lines.push(`- par3Holes=${par3Holes.length ? par3Holes.join(",") : "(none)"}`);
  lines.push(`- enteredHoles=${entered.length}`);

  if (entered.length) {
    // show up to 18 (usually fine)
    for (const e of entered) {
      lines.push(`  - H${e.holeNo} raw=${e.raw} par=${e.par} pts=${e.pts}`);
    }
  }

  if (par3Holes.length) {
    lines.push(`- par3Detail (even if blank):`);
    for (const holeNo of par3Holes) {
      const idx = holeNo - 1;
      const raw = normScoreCell(scoreArr[idx]);
      const pts = raw === "" ? "(n/a blank)" : raw === "P" ? "0" : String(n(roundCtx.netPointsForHole(playerId, idx), 0));
      lines.push(`  - H${holeNo} raw=${raw === "" ? "(blank)" : raw} pts=${pts}`);
    }
  }
}

export function buildH2ZDiagnostic(args: {
  ctx: any;
  roundsInOrder: RoundsInOrderItem[];
  isPlayingInRound: (roundId: string, playerId: string) => boolean;
  playerId: string;
  start_round_no: number;
  end_round_no: number;
}): H2ZDiagnostic {
  const { ctx, roundsInOrder, isPlayingInRound, playerId, start_round_no, end_round_no } = args;

  const computed = computeH2ZForPlayerInLeg({
    ctx,
    roundsInOrder,
    isPlayingInRound,
    playerId,
    start_round_no,
    end_round_no,
  });

  const lines: string[] = [];
  lines.push("H2Z diagnostic");
  lines.push(`player=${String(playerId)}`);
  lines.push(`legRounds=${n(start_round_no, 0)}..${n(end_round_no, 0)}`);
  lines.push(`includedRounds=${computed.includedRoundNos.length ? computed.includedRoundNos.join(",") : "(none)"}`);
  lines.push(`result final=${computed.result.finalScore} best=${computed.result.bestScore} bestLen=${computed.result.bestLen}`);

  if (computed.issues.length) {
    lines.push(`issues (${computed.issues.length}):`);
    for (const it of computed.issues) lines.push(`- ${it}`);
  } else {
    lines.push("issues (0)");
  }

  lines.push(`par3Events=${computed.diagEvents.length}`);

  // NEW: round snapshot to explain why par3Events may be 0
  const legRounds = roundsForLeg(roundsInOrder, start_round_no, end_round_no);
  for (const r of legRounds) {
    const roundId = String(r.roundId);
    const roundNo = n(r.round_no, 0);
    const playing = isPlayingInRound(roundId, playerId) ? "yes" : "no";
    lines.push(`includedRound: R${roundNo} playing=${playing} roundId=${roundId}`);
    if (playing === "yes") {
      pushRoundSnapshot(lines, { ctx, roundId, roundNo, playerId });
    }
  }

  // existing event list (only Par 3 entered scores)
  for (const ev of computed.diagEvents) {
    const resetTag = ev.didReset ? "RESET" : "";
    lines.push(`- R${ev.roundNo} H${ev.holeNo} raw=${ev.raw} par=${ev.par} pts=${ev.pts} run=${ev.runAfter} ${resetTag}`.trim());
  }

  return lines;
}
