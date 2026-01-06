// lib/db/groups.ts
import { supabase } from "@/lib/supabaseClient";

export type GroupScope = "tour" | "round";
export type GroupType = "pair" | "team";

export type TourGroupRow = {
  id: string;
  tour_id: string;
  scope: GroupScope;
  round_id: string | null;
  type: GroupType;
  name: string;
  team_index: number | null;
  created_at: string;
};

export type TourGroupMemberRow = {
  group_id: string;
  player_id: string;
  position: number | null;
};

export type TourGroupingSettingsRow = {
  tour_id: string;

  default_pairing_mode: "SEQUENTIAL" | "SNAKE";
  default_team_mode: "ROUND_ROBIN" | "SNAKE_TEAMS";
  default_team_count: number | null;

  // ✅ NEW: for team scoring rules like "top M"
  default_team_best_m: number | null;

  lock_generated: boolean;
  updated_at: string;
};

export type TourGroupWithMembers = TourGroupRow & {
  members: TourGroupMemberRow[];
};

export async function getTourGroups(params: {
  tourId: string;
  scope: GroupScope;
  type: GroupType;
  roundId?: string;
}): Promise<{ groups: TourGroupWithMembers[]; error?: string }> {
  const { tourId, scope, type, roundId } = params;

  let q = supabase
    .from("tour_groups")
    .select(
      `
        id,
        tour_id,
        scope,
        round_id,
        type,
        name,
        team_index,
        created_at,
        tour_group_members (
          group_id,
          player_id,
          position
        )
      `
    )
    .eq("tour_id", tourId)
    .eq("scope", scope)
    .eq("type", type);

  if (scope === "round") {
    if (!roundId) return { groups: [], error: "roundId is required when scope='round'" };
    q = q.eq("round_id", roundId);
  } else {
    q = q.is("round_id", null);
  }

  const { data, error } = await q;

  if (error) return { groups: [], error: error.message };

  const rows = (data ?? []) as any[];

  const groups: TourGroupWithMembers[] = rows.map((g) => {
    const members = (g.tour_group_members ?? []) as TourGroupMemberRow[];
    members.sort((a, b) => {
      const pa = a.position ?? 999;
      const pb = b.position ?? 999;
      if (pa !== pb) return pa - pb;
      return a.player_id.localeCompare(b.player_id);
    });

    return {
      id: g.id,
      tour_id: g.tour_id,
      scope: g.scope,
      round_id: g.round_id,
      type: g.type,
      name: g.name,
      team_index: g.team_index,
      created_at: g.created_at,
      members,
    };
  });

  // Deterministic ordering for groups:
  // - by team_index if present
  // - else by name
  // - else by id
  groups.sort((a, b) => {
    const ia = a.team_index ?? 999;
    const ib = b.team_index ?? 999;
    if (ia !== ib) return ia - ib;
    const na = (a.name ?? "").toLowerCase();
    const nb = (b.name ?? "").toLowerCase();
    if (na !== nb) return na.localeCompare(nb);
    return a.id.localeCompare(b.id);
  });

  return { groups };
}

export async function getGroupingSettings(
  tourId: string
): Promise<{ settings: TourGroupingSettingsRow; error?: string }> {
  const { data, error } = await supabase
    .from("tour_grouping_settings")
    .select(
      // ✅ includes default_team_best_m
      "tour_id,default_pairing_mode,default_team_mode,default_team_count,default_team_best_m,lock_generated,updated_at"
    )
    .eq("tour_id", tourId)
    .maybeSingle();

  // If the SELECT fails (e.g., column not added yet), fall back gracefully.
  if (error) {
    return {
      settings: {
        tour_id: tourId,
        default_pairing_mode: "SEQUENTIAL",
        default_team_mode: "ROUND_ROBIN",
        default_team_count: 2,
        default_team_best_m: 2,
        lock_generated: false,
        updated_at: new Date().toISOString(),
      },
      error: error.message,
    };
  }

  const s = (data ?? null) as Partial<TourGroupingSettingsRow> | null;

  const bestM =
    typeof (s as any)?.default_team_best_m === "number"
      ? Math.max(1, Math.floor((s as any).default_team_best_m as number))
      : 2;

  return {
    settings: {
      tour_id: tourId,
      default_pairing_mode: (s?.default_pairing_mode as any) ?? "SEQUENTIAL",
      default_team_mode: (s?.default_team_mode as any) ?? "ROUND_ROBIN",
      default_team_count: typeof s?.default_team_count === "number" ? s.default_team_count : 2,
      default_team_best_m: bestM,
      lock_generated: !!s?.lock_generated,
      updated_at: (s?.updated_at as any) ?? new Date().toISOString(),
    },
  };
}
