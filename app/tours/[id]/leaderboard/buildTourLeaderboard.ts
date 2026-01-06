import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

type RoundRow = { id: string; tour_id: string; course_id: string; created_at: string | null };
type PlayerRow = { id: string; tour_id: string; name: string };

// ✅ pars uses hole_number
type ParRow = { course_id: string; hole_number: number; par: number; stroke_index: number };

// ✅ scores uses hole_number and has NO is_pickup
type ScoreRow = { round_id: string; player_id: string; hole_number: number; strokes: number | string | null };

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number;
};

export async function buildTourLeaderboard(tourId: string) {
  // 1) Tour name
  const { data: tour, error: tourErr } = await supabase
    .from("tours")
    .select("id,name")
    .eq("id", tourId)
    .single();

  if (tourErr) throw new Error(tourErr.message);

  // 2) Rounds in tour
  const { data: rounds, error: roundsErr } = await supabase
    .from("rounds")
    .select("id,tour_id,course_id,created_at")
    .eq("tour_id", tourId)
    .order("created_at", { ascending: true });

  if (roundsErr) throw new Error(roundsErr.message);

  const roundList = (rounds ?? []) as RoundRow[];
  const roundIds = roundList.map((r) => r.id);
  const courseIds = Array.from(new Set(roundList.map((r) => r.course_id)));

  if (roundIds.length === 0) {
    return {
      tourName: (tour as any).name as string,
      rounds: [],
      rows: [],
    };
  }

  // 3) Players in tour
  const { data: players, error: playersErr } = await supabase
    .from("players")
    .select("id,tour_id,name")
    .eq("tour_id", tourId)
    .order("name", { ascending: true });

  if (playersErr) throw new Error(playersErr.message);

  const playerList = (players ?? []) as PlayerRow[];

  // 4) Pars + stroke index for all courses in the rounds ✅ hole_number
  const { data: pars, error: parsErr } = await supabase
    .from("pars")
    .select("course_id,hole_number,par,stroke_index")
    .in("course_id", courseIds);

  if (parsErr) throw new Error(parsErr.message);

  const parRows = (pars ?? []) as ParRow[];

  // course -> hole_number -> {par, si}
  const courseHole: Record<string, Record<number, { par: number; si: number }>> = {};
  for (const p of parRows) {
    if (!courseHole[p.course_id]) courseHole[p.course_id] = {};
    courseHole[p.course_id][p.hole_number] = { par: p.par, si: p.stroke_index };
  }

  // 5) round_players (playing only)
  const { data: rps, error: rpErr } = await supabase
    .from("round_players")
    .select("round_id,player_id,playing,playing_handicap")
    .in("round_id", roundIds)
    .eq("playing", true);

  if (rpErr) throw new Error(rpErr.message);

  const rpRows = (rps ?? []) as RoundPlayerRow[];

  // round -> player -> handicap
  const rpMap: Record<string, Record<string, number>> = {};
  for (const rp of rpRows) {
    if (!rpMap[rp.round_id]) rpMap[rp.round_id] = {};
    rpMap[rp.round_id][rp.player_id] = rp.playing_handicap ?? 0;
  }

  // 6) scores ✅ hole_number, NO is_pickup
  const { data: scores, error: scoreErr } = await supabase
    .from("scores")
    .select("round_id,player_id,hole_number,strokes")
    .in("round_id", roundIds);

  if (scoreErr) throw new Error(scoreErr.message);

  const scoreRows = (scores ?? []) as ScoreRow[];

  // round -> player -> hole_number -> rawScore ("5", "P", "")
  const scoreMap: Record<string, Record<string, Record<number, string>>> = {};
  for (const s of scoreRows) {
    const rawScore =
      s.strokes === null || s.strokes === undefined ? "" : String(s.strokes);

    if (!scoreMap[s.round_id]) scoreMap[s.round_id] = {};
    if (!scoreMap[s.round_id][s.player_id]) scoreMap[s.round_id][s.player_id] = {};
    scoreMap[s.round_id][s.player_id][s.hole_number] = rawScore;
  }

  // Round headers: R1, R2...
  const roundHeaders = roundList.map((r, idx) => ({
    id: r.id,
    label: `R${idx + 1}`,
    courseId: r.course_id,
  }));

  // Compute totals
  const rows = playerList.map((pl) => {
    const perRound: Record<string, number | null> = {};
    let total = 0;

    for (const r of roundHeaders) {
      const hcp = rpMap[r.id]?.[pl.id];
      if (hcp === undefined) {
        perRound[r.id] = null; // not playing
        continue;
      }

      const holeInfo = courseHole[r.courseId];
      if (!holeInfo) {
        perRound[r.id] = 0;
        continue;
      }

      let roundTotal = 0;
      for (let hole = 1; hole <= 18; hole++) {
        const info = holeInfo[hole];
        if (!info) continue;

        const raw = scoreMap[r.id]?.[pl.id]?.[hole] ?? "";

        // pickup stored as "P" in strokes; your lib function handles "P"
        roundTotal += netStablefordPointsForHole({
          rawScore: raw,
          par: info.par,
          strokeIndex: info.si,
          playingHandicap: hcp,
        });
      }

      perRound[r.id] = roundTotal;
      total += roundTotal;
    }

    return {
      playerId: pl.id,
      playerName: pl.name,
      perRound,
      total,
    };
  });

  // sort by total desc, then name
  rows.sort((a, b) =>
    b.total !== a.total ? b.total - a.total : a.playerName.localeCompare(b.playerName)
  );

  return {
    tourName: (tour as any).name as string,
    rounds: roundHeaders.map((r) => ({ id: r.id, label: r.label })),
    rows,
  };
}
