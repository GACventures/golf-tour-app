// lib/competitions/engine.ts
import type { CompetitionContext, CompetitionDefinition } from "./types";

export type CompetitionResultRow = {
  entryId: string;
  label: string;
  total: number;
  stats?: Record<string, any>;
};

export type CompetitionResult = {
  competitionId: string;
  rows: CompetitionResultRow[];
};

// ---- Context narrowing (scope-free) -----------------------------------------

type RoundLikeCtx = {
  players: Array<{ id: string; name: string; playing?: boolean }>;
  isComplete: (playerId: string) => boolean;
  // optional group support
  entityMembersById?: Record<string, string[]>;
  entityLabelsById?: Record<string, string>;
  entities?: Array<{ entityId: string; label: string; memberPlayerIds: string[] }>;
};

type TourLikeCtx = {
  players: Array<{ id: string; name: string; playing?: boolean }>;
  rounds: Array<{ isComplete?: (playerId: string) => boolean }>;
  // optional group support
  entityMembersById?: Record<string, string[]>;
  entityLabelsById?: Record<string, string>;
  entities?: Array<{ entityId: string; label: string; memberPlayerIds: string[] }>;
};

function isRoundContext(ctx: CompetitionContext): ctx is CompetitionContext & RoundLikeCtx {
  const c = ctx as any;
  // If you still sometimes carry scope, respect it.
  if (typeof c?.scope === "string") return c.scope === "round";
  // Round contexts have an isComplete(playerId) function and no rounds array
  return typeof c?.isComplete === "function" && !Array.isArray(c?.rounds);
}

function isTourContext(ctx: CompetitionContext): ctx is CompetitionContext & TourLikeCtx {
  const c = ctx as any;
  if (typeof c?.scope === "string") return c.scope === "tour";
  return Array.isArray(c?.rounds);
}

// ---- Entities ---------------------------------------------------------------

type Entity = { entityId: string; label: string; memberPlayerIds: string[] };

function getEntities(def: CompetitionDefinition, ctx: CompetitionContext): Entity[] {
  const kind = def.kind;

  if (kind === "individual") {
    const players = (ctx as any)?.players ?? [];
    return players.map((p: any) => ({
      entityId: String(p.id),
      label: String(p.name ?? p.id),
      memberPlayerIds: [String(p.id)],
    }));
  }

  // pair/team
  const anyCtx = ctx as any;

  if (Array.isArray(anyCtx?.entities) && anyCtx.entities.length > 0) {
    return anyCtx.entities.map((e: any) => ({
      entityId: String(e.entityId),
      label: String(e.label ?? e.name ?? e.entityId),
      memberPlayerIds: Array.isArray(e.memberPlayerIds) ? e.memberPlayerIds.map(String) : [],
    }));
  }

  // Fallback to entityMembersById + entityLabelsById
  const membersById: Record<string, string[]> = anyCtx?.entityMembersById ?? {};
  const labelsById: Record<string, string> = anyCtx?.entityLabelsById ?? {};

  return Object.keys(membersById).map((id) => ({
    entityId: id,
    label: labelsById[id] ?? id,
    memberPlayerIds: (membersById[id] ?? []).map(String),
  }));
}

// ---- Eligibility ------------------------------------------------------------

function isEntityEligible(def: CompetitionDefinition, ctx: CompetitionContext, entity: Entity): boolean {
  const e = def.eligibility;
  if (!e) return true;

  // onlyPlaying: entity members must be "playing" (where available)
  if (e.onlyPlaying) {
    const playersArr: any[] = (ctx as any)?.players ?? [];
    const playingById: Record<string, boolean> = {};
    for (const p of playersArr) playingById[String(p.id)] = p.playing !== false; // default true

    for (const pid of entity.memberPlayerIds) {
      if (playingById[String(pid)] === false) return false;
    }
  }

  // requireComplete:
  // - round: must be complete for all members using ctx.isComplete
  // - tour: must be complete for all members across all rounds that expose isComplete
  if (e.requireComplete) {
    if (isRoundContext(ctx)) {
      for (const pid of entity.memberPlayerIds) {
        if (!ctx.isComplete(pid)) return false;
      }
    } else if (isTourContext(ctx)) {
      for (const r of ctx.rounds ?? []) {
        const isComplete = (r as any)?.isComplete;
        if (typeof isComplete !== "function") continue;
        for (const pid of entity.memberPlayerIds) {
          if (!isComplete(pid)) return false;
        }
      }
    } else {
      // unknown ctx shape: be conservative
      return false;
    }
  }

  return true;
}

// ---- Runner ----------------------------------------------------------------

export function runCompetition(def: CompetitionDefinition, ctx: CompetitionContext): CompetitionResult {
  // Compute rows. Each competition compute returns the rows it wants to show.
  // We keep the return type loose because different definitions attach different stats.
  const computed = def.compute(ctx) as any[];

  // Build entity map for eligibility / label normalization
  const entities = getEntities(def, ctx);
  const entityById: Record<string, Entity> = {};
  for (const e of entities) entityById[e.entityId] = e;

  // Filter by eligibility
  const rows: CompetitionResultRow[] = [];
  for (const row of computed ?? []) {
    const entryId = String(row?.entryId ?? row?.playerId ?? "");
    if (!entryId) continue;

    const entity = entityById[entryId] ?? {
      entityId: entryId,
      label: String(row?.label ?? entryId),
      memberPlayerIds: [entryId],
    };

    if (!isEntityEligible(def, ctx, entity)) continue;

    rows.push({
      entryId,
      label: String(row?.label ?? entity.label ?? entryId),
      total: Number(row?.total ?? 0) || 0,
      stats: row?.stats ?? undefined,
    });
  }

  // Default sort: total desc then label asc
  rows.sort((a, b) => (b.total !== a.total ? b.total - a.total : a.label.localeCompare(b.label)));

  return { competitionId: def.id, rows };
}
