import { netStablefordPointsForHole } from "@/lib/stableford";
import type { SupabaseClient } from "@supabase/supabase-js";

type Round = { id: string; tour_id: string; course_id: string; created_at: string | null };
type ParRow = { course_id: string; hole_number: number; par: number; stroke_index: number };
type ScoreRow = { round_id: string; player_id: string; hole_number: number; strokes: number | null; pickup?: boolean };
type RoundPlayerRow = { round_id: string; player_id: string; playing: boolean; playing_handicap: number | null };
type Player = { id: string; tour_id: string; name: string } & Record<string, any>;

function roundHalfUp(x: number): number {
  return x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
}
function ceilHalfStart(sh: number): number {
  return Math.ceil(sh / 2);
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function getStartingHandicapFromPlayer(p: Player): number {
  const candidates = ["starting_handicap", "start_handicap", "handicap", "initial_handicap", "hcp", "ga_handicap"];
  for (const k of candidates) {
    const v = Number((p as any)[k]);
    if (Number.isFinite(v)) return Math.max(0, Math.floor(v));
  }
  return 0;
}

function rawScoreString(s: ScoreRow): string {
  const isPickup = (s as any).pickup === true;
  if (isPickup) return "P";
  if (s.strokes === null || s.strokes === undefined) return "";
  return String(s.strokes).trim().toUpperCase();
}

export async function recalcAndSaveTourHandicaps(opts: {
  supabase: SupabaseClient;
  tourId: string;
  // optional: only run if this round is complete
  onlyIfRoundCompleteId?: string;
}): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const { supabase, tourId, onlyIfRoundCompleteId } = opts;

  // 1) load rounds
  const { data: roundsData, error: roundsErr } = await supabase
    .from("rounds")
    .select("id,tour_id,course_id,created_at")
    .eq("tour_id", tourId)
    .order("created_at", { ascending: true });

  if (roundsErr) return { ok: false, error: roundsErr.message };
  const rounds = (roundsData ?? []) as Round[];
  if (rounds.length === 0) return { ok: true, updated: 0 };

  const roundIds = rounds.map((r) => r.id);
  const courseIds = Array.from(new Set(rounds.map((r) => r.course_id)));

  // 2) load players
  const { data: playersData, error: playersErr } = await supabase.from("players").select("*").eq("tour_id", tourId);
  if (playersErr) return { ok: false, error: playersErr.message };
  const players = (playersData ?? []) as Player[];

  // 3) pars
  const { data: parsData, error: parsErr } = await supabase
    .from("pars")
    .select("course_id,hole_number,par,stroke_index")
    .in("course_id", courseIds);

  if (parsErr) return { ok: false, error: parsErr.message };
  const pars = (parsData ?? []) as ParRow[];

  // 4) round_players (must exist)
  const { data: rpData, error: rpErr } = await supabase
    .from("round_players")
    .select("round_id,player_id,playing,playing_handicap")
    .in("round_id", roundIds);

  if (rpErr) return { ok: false, error: rpErr.message };
  const roundPlayers = (rpData ?? []) as RoundPlayerRow[];

  // 5) scores
  const { data: scoresData, error: scoresErr } = await supabase
    .from("scores")
    .select("round_id,player_id,hole_number,strokes,pickup")
    .in("round_id", roundIds);

  if (scoresErr) return { ok: false, error: scoresErr.message };
  const scores = (scoresData ?? []) as ScoreRow[];

  // Build maps
  const courseHole: Record<string, Record<number, { par: number; si: number }>> = {};
  for (const p of pars) {
    if (!courseHole[p.course_id]) courseHole[p.course_id] = {};
    courseHole[p.course_id][p.hole_number] = { par: p.par, si: p.stroke_index };
  }

  const playingMap: Record<string, Record<string, boolean>> = {};
  for (const rp of roundPlayers) {
    if (!playingMap[rp.round_id]) playingMap[rp.round_id] = {};
    playingMap[rp.round_id][rp.player_id] = !!rp.playing;
  }

  const scoreMap: Record<string, Record<string, Record<number, string>>> = {};
  for (const s of scores) {
    if (!scoreMap[s.round_id]) scoreMap[s.round_id] = {};
    if (!scoreMap[s.round_id][s.player_id]) scoreMap[s.round_id][s.player_id] = {};
    scoreMap[s.round_id][s.player_id][s.hole_number] = rawScoreString(s);
  }

  function isRoundComplete(roundId: string): boolean {
    const playingPlayers = players.filter((pl) => playingMap[roundId]?.[pl.id] === true);
    if (playingPlayers.length === 0) return false;
    for (const pl of playingPlayers) {
      for (let hole = 1; hole <= 18; hole++) {
        const raw = scoreMap[roundId]?.[pl.id]?.[hole] ?? "";
        if (!raw) return false;
      }
    }
    return true;
  }

  if (onlyIfRoundCompleteId) {
    if (!isRoundComplete(onlyIfRoundCompleteId)) {
      return { ok: true, updated: 0 };
    }
  }

  // Compute sequentially; stop at first incomplete round (keeps PH stable beyond it)
  const startingHcpByPlayer: Record<string, number> = {};
  for (const p of players) startingHcpByPlayer[p.id] = getStartingHandicapFromPlayer(p);

  const phByRoundPlayer: Record<string, Record<string, number>> = {};
  // init Round 1 PH = SH
  const r1 = rounds[0];
  phByRoundPlayer[r1.id] = {};
  for (const p of players) phByRoundPlayer[r1.id][p.id] = startingHcpByPlayer[p.id];

  const stablefordTotal = (roundId: string, courseId: string, playerId: string, ph: number): number => {
    let total = 0;
    const holeInfo = courseHole[courseId];
    if (!holeInfo) return 0;

    for (let hole = 1; hole <= 18; hole++) {
      const info = holeInfo[hole];
      if (!info) continue;
      const raw = scoreMap[roundId]?.[playerId]?.[hole] ?? "";
      total += netStablefordPointsForHole({
        rawScore: raw,
        par: info.par,
        strokeIndex: info.si,
        playingHandicap: ph,
      });
    }
    return total;
  };

  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const next = rounds[i + 1] ?? null;

    // ensure current PH map exists (carry forward if missing)
    if (!phByRoundPlayer[r.id]) {
      phByRoundPlayer[r.id] = {};
      const prev = rounds[i - 1];
      for (const p of players) phByRoundPlayer[r.id][p.id] = phByRoundPlayer[prev.id]?.[p.id] ?? startingHcpByPlayer[p.id];
    }

    // if this round incomplete, stop updating beyond it
    if (!isRoundComplete(r.id)) break;

    // compute scores for players who played
    const playedScores: number[] = [];
    const scoreByPlayer: Record<string, number | null> = {};
    for (const p of players) {
      const played = playingMap[r.id]?.[p.id] === true;
      if (!played) {
        scoreByPlayer[p.id] = null;
        continue;
      }
      const ph = phByRoundPlayer[r.id][p.id];
      const sc = stablefordTotal(r.id, r.course_id, p.id, ph);
      scoreByPlayer[p.id] = sc;
      playedScores.push(sc);
    }

    const avgRounded = playedScores.length ? roundHalfUp(playedScores.reduce((s, v) => s + v, 0) / playedScores.length) : null;

    if (next) {
      phByRoundPlayer[next.id] = {};
      for (const p of players) {
        const prevPH = phByRoundPlayer[r.id][p.id];
        const playedPrev = playingMap[r.id]?.[p.id] === true;

        if (!playedPrev || avgRounded === null) {
          phByRoundPlayer[next.id][p.id] = prevPH;
          continue;
        }

        const prevScore = scoreByPlayer[p.id];
        if (prevScore === null) {
          phByRoundPlayer[next.id][p.id] = prevPH;
          continue;
        }

        const diff = (avgRounded - prevScore) / 3;
        const raw = roundHalfUp(prevPH + diff);

        const sh = startingHcpByPlayer[p.id];
        const max = sh + 3;
        const min = ceilHalfStart(sh);

        phByRoundPlayer[next.id][p.id] = clamp(raw, min, max);
      }
    }
  }

  // Build upsert payload for existing round_players rows (preserve playing flag)
  const payload = roundPlayers.map((rp) => {
    const ph = phByRoundPlayer[rp.round_id]?.[rp.player_id];
    return {
      round_id: rp.round_id,
      player_id: rp.player_id,
      playing: rp.playing,
      playing_handicap: Number.isFinite(ph as any) ? ph : (rp.playing_handicap ?? 0),
    };
  });

  if (payload.length === 0) return { ok: true, updated: 0 };

  const { error: upErr } = await supabase.from("round_players").upsert(payload, {
    onConflict: "round_id,player_id",
  });

  if (upErr) return { ok: false, error: upErr.message };

  return { ok: true, updated: payload.length };
}
