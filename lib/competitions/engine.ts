// lib/competitions/engine.ts
import type { CompetitionContext, CompetitionDefinition } from "./types";

export type CompetitionRow = {
  entryId: string;
  label: string;
  total: number;
  stats?: Record<string, any>;
};

export type CompetitionResult = {
  rows: CompetitionRow[];
};

function isTourContext(ctx: CompetitionContext): boolean {
  const c = ctx as any;
  if (typeof c?.scope === "string") return c.scope === "tour";
  return Array.isArray(c?.rounds);
}

function isRoundContext(ctx: CompetitionContext): boolean {
  const c = ctx as any;
  if (typeof c?.scope === "string") return c.scope === "round";
  return !Array.isArray(c?.rounds);
}

function safeNumber(n: any): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Decide if a player is "complete" for ROUND scope.
 * For TOUR scope, we intentionally DO NOT enforce completeness here,
 * because tour competitions already handle completeness per-round
 * (via r.isComplete(playerId) inside the competition compute).
 */
function isPlayerCompleteForRoundScope(ctx: any, playerId: string): boolean {
  // Common patterns:
  // - ctx.isComplete(playerId)
  // - ctx.round.isComplete(playerId)
  if (typeof ctx?.isComplete === "function") return !!ctx.isComplete(playerId);
  if (typeof ctx?.round?.isComplete === "function") return !!ctx.round.isComplete(playerId);

  // If no completeness fn exists, be permissive.
  return true;
}

export function runCompetition(def: CompetitionDefinition, ctx: CompetitionContext): CompetitionResult {
  // 1) Eligibility filtering (players)
  const rawPlayers = ((ctx as any)?.players ?? []) as Array<any>;
  let players = rawPlayers;

  // onlyPlaying: keep those marked playing === true
  if (def.eligibility?.onlyPlaying) {
    players = players.filter((p) => p?.playing === true);
  }

  // requireComplete:
  // ✅ Apply only for ROUND scope. For TOUR scope, competitions already skip incomplete rounds themselves.
  if (def.eligibility?.requireComplete) {
    if (isRoundContext(ctx)) {
      players = players.filter((p) => isPlayerCompleteForRoundScope(ctx as any, p.id));
    }
    // If tour context: do NOT filter here.
  }

  // 2) Run compute with the filtered players injected
  const ctxForCompute = { ...(ctx as any), players };
  const rowsRaw = (def.compute(ctxForCompute as CompetitionContext) ?? []) as any[];

  const rows: CompetitionRow[] = rowsRaw
    .map((r) => ({
      entryId: String(r.entryId ?? ""),
      label: String(r.label ?? ""),
      total: safeNumber(r.total),
      stats: r.stats ?? undefined,
    }))
    .filter((r) => r.entryId && r.label);

  // 3) Sort: highest score first, then label
  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.label.localeCompare(b.label);
  });

  return { rows };
}
