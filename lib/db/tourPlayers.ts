// lib/db/tourPlayers.ts
import { supabase } from "@/lib/supabaseClient";

export type TourPlayer = {
  id: string;
  name: string;
  // Add other global columns here if you need them later
};

export async function fetchTourPlayers(tourId: string) {
  const { data, error } = await supabase
    .from("tour_players")
    .select("player_id, players:players(id,name)")
    .eq("tour_id", tourId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const players: TourPlayer[] = (data ?? [])
    .map((row: any) => row.players)
    .filter(Boolean);

  return players;
}
