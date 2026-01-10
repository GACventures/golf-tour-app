import { supabase } from "@/lib/supabaseClient";
import { getGroupingSettings, getTourGroups, GroupScope, GroupType } from "@/lib/db/groups";
import { makeImplicitPairs, makeImplicitTeams, PairingMode, TeamMode } from "./implicitGrouping";

export type CompetitionKind = "individual" | "pair" | "team";

export type LeaderboardEntity = {
  entityType: CompetitionKind;
  entityId: string; // playerId OR tour_groups.id OR implicit:* id
  name: string; // display label
  memberPlayerIds: string[]; // 1 for individual, 2 for pair, N for team
};

type PlayerRow = {
  id: string;
  tour_id: string;
  name: string;
  created_at?: string | null;
};

function stablePlayerSort(a: PlayerRow, b: PlayerRow) {
  const ca = a.created_at ?? "";
  const cb = b.created_at ?? "";
  if (ca && cb && ca !== cb) return ca.localeCompare(cb);

  const na = (a.name ?? "").toLowerCase();
  const nb = (b.name ?? "").toLowerCase();
  if (na !== nb) return na.localeCompare(nb);

  return a.id.localeCompare(b.id);
}

function asPairingMode(x: any): PairingMode {
  const v = String(x ?? "").toUpperCase();
  // Accept known modes only; fallback safely.
  if (v === "SEQUENTIAL" || v === "RANDOM" || v === "BALANCED") return v as PairingMode;
  return "SEQUENTIAL";
}

function asTeamMode(x: any): TeamMode {
  const v = String(x ?? "").toUpperCase();
  if (v === "ROUND_ROBIN" || v === "SEQUENTIAL" || v === "RANDOM") return v as TeamMode;
  return "ROUND_ROBIN";
}

function asPositiveInt(x: any, fallback: number) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  const k = Math.floor(n);
  return k >= 1 ? k : fallback;
}

export async function resolveEntities(params: {
  tourId: string;
  scope: GroupScope; // "tour" | "round"
  kind: CompetitionKind;
  roundId?: string;
}): Promise<{ entities: LeaderboardEntity[]; error?: string }> {
  const { tourId, scope, kind, roundId } = params;

  try {
    // 1) Load players (needed for individual + implicit grouping)
    const { data: playerData, error: playersErr } = await supabase
      .from("players")
      .select("id,tour_id,name,created_at")
      .eq("tour_id", tourId);

    if (playersErr) return { entities: [], error: playersErr.message };

    const players = ((playerData ?? []) as PlayerRow[]).slice().sort(stablePlayerSort);

    // INDIVIDUAL
    if (kind === "individual") {
      return {
        entities: players.map((p) => ({
          entityType: "individual",
          entityId: p.id,
          name: p.name,
          memberPlayerIds: [p.id],
        })),
      };
    }

    // PAIR / TEAM — try explicit DB groups first
    const groupType: GroupType = kind === "pair" ? "pair" : "team";

    const explicit = await getTourGroups({
      tourId,
      scope,
      type: groupType,
      roundId,
    });

    if (!explicit.error && explicit.groups.length > 0) {
      return {
        entities: explicit.groups.map((g) => ({
          entityType: kind,
          entityId: g.id,
          name: g.name,
          memberPlayerIds: (g.members ?? []).map((m) => m.player_id).filter(Boolean),
        })),
      };
    }

    // IMPLICIT FALLBACK
    // IMPORTANT: getGroupingSettings may fail; we must default safely.
    let settings: any = {};
    try {
      const res = await getGroupingSettings(tourId);
      settings = (res as any)?.settings ?? {};
    } catch {
      settings = {};
    }

    const playersForGrouping = players.map((p) => ({ id: p.id, name: p.name }));

    if (kind === "pair") {
      const pairs = makeImplicitPairs({
        players: playersForGrouping,
        mode: asPairingMode(settings.default_pairing_mode),
      });

      return {
        entities: pairs.map((p) => ({
          entityType: "pair",
          entityId: p.id,
          name: p.name,
          memberPlayerIds: p.memberPlayerIds,
        })),
        // If explicit failed, optionally surface that as info (but don't block results)
        error: explicit.error ? `Explicit pairs not available: ${explicit.error}` : undefined,
      };
    }

    // kind === "team"
    const teamCount = asPositiveInt(settings.default_team_count, 2);

    const teams = makeImplicitTeams({
      players: playersForGrouping,
      teamCount,
      mode: asTeamMode(settings.default_team_mode),
    });

    return {
      entities: teams.map((t) => ({
        entityType: "team",
        entityId: t.id,
        name: t.name,
        memberPlayerIds: t.memberPlayerIds,
      })),
      error: explicit.error ? `Explicit teams not available: ${explicit.error}` : undefined,
    };
  } catch (e: any) {
    return { entities: [], error: e?.message ?? "resolveEntities failed" };
  }
}
