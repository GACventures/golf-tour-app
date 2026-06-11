import { supabase } from "@/lib/supabaseClient";

/**
 * Applies daily groupings to the round_groups and round_group_players tables
 * for display in the Daily Tee Times screen.
 * 
 * Preserves existing tee_time and start_hole values when they exist.
 */
export async function applyDailyGroupingsToTeeTimes(
  roundId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // 1. Fetch all daily_groupings for this round
    const { data: dailyGroupings, error: fetchError } = await supabase
      .from("daily_groupings")
      .select("*")
      .eq("round_id", roundId)
      .order("group_number", { ascending: true });

    if (fetchError) {
      return { success: false, error: fetchError.message };
    }

    if (!dailyGroupings || dailyGroupings.length === 0) {
      return { success: false, error: "No daily groupings found for this round" };
    }

    // 2. Fetch existing round_groups to preserve tee_time and start_hole
    const { data: existingGroups, error: existingError } = await supabase
      .from("round_groups")
      .select("group_no, tee_time, start_hole")
      .eq("round_id", roundId);

    if (existingError) {
      console.warn("Could not fetch existing groups:", existingError.message);
    }

    // Create a map of group_no -> {tee_time, start_hole}
    const preservedData: Record<number, { tee_time: string | null; start_hole: number | null }> = {};
    (existingGroups || []).forEach((g: any) => {
      preservedData[g.group_no] = {
        tee_time: g.tee_time,
        start_hole: g.start_hole,
      };
    });

    // 3. Delete existing round_group_players for this round
    // First get all group IDs for this round
    const { data: groupsToDelete, error: groupsFetchError } = await supabase
      .from("round_groups")
      .select("id")
      .eq("round_id", roundId);

    if (groupsFetchError) {
      return { success: false, error: groupsFetchError.message };
    }

    if (groupsToDelete && groupsToDelete.length > 0) {
      const groupIds = groupsToDelete.map((g: any) => g.id);

      const { error: deletePlayersError } = await supabase
        .from("round_group_players")
        .delete()
        .in("group_id", groupIds);

      if (deletePlayersError) {
        return { success: false, error: deletePlayersError.message };
      }
    }

    // 4. Delete existing round_groups for this round
    const { error: deleteGroupsError } = await supabase
      .from("round_groups")
      .delete()
      .eq("round_id", roundId);

    if (deleteGroupsError) {
      return { success: false, error: deleteGroupsError.message };
    }

    // 5. Create new round_groups and round_group_players from daily_groupings
    for (const grouping of dailyGroupings) {
      const groupNo = grouping.group_number;
      const players = grouping.players || [];

      // Get preserved tee_time and start_hole if they exist
      const preserved = preservedData[groupNo] || { tee_time: null, start_hole: null };

      // Create the round_group
      const { data: newGroup, error: createGroupError } = await supabase
        .from("round_groups")
        .insert({
          round_id: roundId,
          group_no: groupNo,
          tee_time: preserved.tee_time,
          start_hole: preserved.start_hole,
        })
        .select("id")
        .single();

      if (createGroupError) {
        return { success: false, error: createGroupError.message };
      }

      if (!newGroup) {
        return { success: false, error: `Failed to create group ${groupNo}` };
      }

      // Create round_group_players for each player in the group
      const groupPlayers = players.map((playerId: string, index: number) => ({
        group_id: newGroup.id,
        player_id: playerId,
        seat: index + 1, // 1-based seat numbering
      }));

      if (groupPlayers.length > 0) {
        const { error: createPlayersError } = await supabase
          .from("round_group_players")
          .insert(groupPlayers);

        if (createPlayersError) {
          return { success: false, error: createPlayersError.message };
        }
      }
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || "Unknown error occurred" };
  }
}
