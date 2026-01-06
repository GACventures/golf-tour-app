import type {
  CompetitionContext,
  CompetitionDefinition,
  CompetitionResult,
  LeaderboardRow,
} from "./types";

function defaultSort(a: LeaderboardRow, b: LeaderboardRow) {
  // Desc total, then back9, then front9, then label
  if (b.total !== a.total) return b.total - a.total;
  if ((b.back9 ?? 0) !== (a.back9 ?? 0)) return (b.back9 ?? 0) - (a.back9 ?? 0);
  if ((b.front9 ?? 0) !== (a.front9 ?? 0)) return (b.front9 ?? 0) - (a.front9 ?? 0);
  return a.label.localeCompare(b.label);
}

type Entity = {
  entityId: string;
  label: string;
  memberPlayerIds: string[];
};

/**
 * For individual competitions, entities are just the players.
 * For pair/team, we expect the caller (TourLeaderboardPage) to attach:
 *   (ctx as any).entityMembersById: Record<entityId, string[]>
 *   (ctx as any).entityLabelsById:  Record<entityId, string>
 */
function getEntities(def: CompetitionDefinition, ctx: CompetitionContext): Entity[] {
  if (def.kind === "individual") {
    return ctx.players.map((p) => ({
      entityId: p.id,
      label: p.name,
      memberPlayerIds: [p.id],
    }));
  }

  const membersById = ((ctx as any).entityMembersById ?? {}) as Record<string, string[]>;
  const labelsById = ((ctx as any).entityLabelsById ?? {}) as Record<string, string>;

  const ids = Object.keys(membersById);
  return ids.map((id) => ({
    entityId: id,
    label: labelsById[id] ?? id,
    memberPlayerIds: membersById[id] ?? [],
  }));
}

function passesEligibilityForEntity(
  def: CompetitionDefinition,
  ctx: CompetitionContext,
  entity: Entity,
  playerPlayingById: Record<string, boolean>
) {
  const e = def.eligibility ?? {};

  // onlyPlaying: for groups, require ALL members to be "playing" at the tour/round context level
  if (e.onlyPlaying) {
    for (const pid of entity.memberPlayerIds) {
      if (!playerPlayingById[pid]) return false;
    }
  }

  if (e.requireComplete) {
    if (ctx.scope === "round") {
      // Round scope: must be complete for all members
      for (const pid of entity.memberPlayerIds) {
        if (!ctx.isComplete(pid)) return false;
      }
    } else {
      // Tour scope: must be complete in ALL included rounds for all members
      for (const r of ctx.rounds) {
        for (const pid of entity.memberPlayerIds) {
          if (!r.isComplete(pid)) return false;
        }
      }
    }
  }

  return true;
}

export function runCompetition(def: CompetitionDefinition, ctx: CompetitionContext): CompetitionResult {
  // 1) Build a "playing" map for eligibility (works for individual + group)
  const playerPlayingById: Record<string, boolean> = {};
  for (const p of ctx.players) playerPlayingById[p.id] = !!p.playing;

  // 2) Resolve entities for this competition
  const entities = getEntities(def, ctx);

  // 3) Apply eligibility at the entity level
  const eligibleEntities = entities.filter((ent) =>
    passesEligibilityForEntity(def, ctx, ent, playerPlayingById)
  );

  // 4) For individual competitions, we keep your existing behavior: filter ctx.players.
  //    For pair/team, we DO NOT mutate ctx.players (it remains the base player list),
  //    but we attach eligible entities for the competition compute() to use.
  const filteredCtx: CompetitionContext =
    def.kind === "individual"
      ? ctx.scope === "round"
        ? { ...ctx, players: ctx.players.filter((p) => eligibleEntities.some((e) => e.entityId === p.id)) }
        : { ...ctx, players: ctx.players.filter((p) => eligibleEntities.some((e) => e.entityId === p.id)) }
      : ctx;

  // Attach entities for compute() to use (backwards-compatible: existing comps ignore it)
  (filteredCtx as any).entities = eligibleEntities;

  const rows = def.compute(filteredCtx).slice().sort(defaultSort);

  return {
    competitionId: def.id,
    competitionName: def.name,
    kind: def.kind,
    scope: def.scope,
    rows,
  };
}
