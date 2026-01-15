import { netStablefordPointsForHole } from "@/lib/stableford";
import type { SupabaseClient } from "@supabase/supabase-js";

type Tee = "M" | "F";

type Round = { id: string; tour_id: string; course_id: string; created_at: string | null };
type ParRow = { course_id: string; hole_number: number; par: number; stroke_index: number };
type ScoreRow = { round_id: string; player_id: string; hole_number: number; strokes: number | null; pickup?: boolean | null };

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number | null;
};

type PlayerJoin = {
  id: string;
  name: string;
  start_handicap: number | null;
  gender?: Tee | null;
};

type TourPlayerJoinRow = {
  tour_id: string;
  player_id: string;
  starting_handicap: number | null;
  // Supabase can return the joined row as object OR array OR null depending on query/typing
  players: PlayerJoin | PlayerJoin[] | null;
};

function roundHalfUp(x: number): number {
  return x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
}
function ceilHalfStart(sh: number): number {
  return Math.ceil(sh / 2);
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalizePlayerJoin(val: PlayerJoin | PlayerJoin[] | null | undefined): PlayerJoin | null {
  if (!val) return null;
  const p = Array.isArray(val) ? val[0] : val;
  if (!p) return null;

  const id = String((p as any).id ?? "").trim();
  if (!id) return null;

  const name = String((p as any).name ?? "").trim() || "(missing player)";
  const shNum = Number((p as any).start_handicap);
  const start_handicap = Number.isFinite(shNum) ? Math.max(0, Math.floor(shNum)) : null;

  const gRaw = String((p as any).gender ?? "").trim().toUpperCase();
  const gender: Tee | null = gRaw === "F" ? "F" : gRaw === "M" ? "M" : null;

  return { id, name, start_handicap, gender };
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

  // 0) (Optional but recommended) respect tour flag
  const { data: tourRow, error: tourErr } = await supabase
    .from("tours")
    .select("id,rehandicapping_enabled")
    .eq("id", tourId)
    .maybeSingle();

  if (tourErr) return { ok: false, error: tourErr.message };
  if (tourRow && (tourRow as any).rehandicapping_enabled === false) {
    return { ok: true, updated: 0 };
  }

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
  const courseIds = Array.from(new Set(rounds.map((r) => r.course_id).filter(Boolean)));

  // 2) load players in this tour via tour_players join (this is your current schema reality)
  const { data: tpData, error: tpErr } = await supabase
    .from("tour_players")
    .select("tour_id,player_id,starting_handicap, players(id,name,start_handicap,gender)")
    .eq("tour_id", tourId);

  if (tpErr) return { ok: false, error: tpErr.message };

  // ✅ This cast is now safe because TourPlayerJoinRow.players allows array/object/null
  const tourPlayers = (tpData ?? []) as TourPlayerJoinRow[];

  const players = tourPlayers
    .map((r) => {
      const pj = normalizePlayerJoin(r.players);
      if (!pj) return null;

      const override = Number(r.starting_handicap);
      const starting_handicap = Number.isFinite(override) ? Math.max(0, Math.floor(override)) : null;

      return {
        id: pj.id,
        name: pj.name,
        start_handicap: pj.start_handicap ?? 0,
        tour_starting_handicap: starting_handicap,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    name: string;
    start_handicap: number;
    tour_starting_handicap: number | null;
  }>;

  if (players.length === 0) return { ok: true, updated: 0 };
  const playerIds = players.map((p) => p.id);

  // 3) pars
  const { data: parsData, error: parsErr } = await supabase
    .from("pars")
    .select("course_id,hole_number,par,stroke_index")
    .in("course_id", courseIds);

  if (parsErr) return { ok: false, error: parsErr.message };
  const pars = (parsData ?? []) as ParRow[];

  // 4) round_players
  const { data: rpData, error: rpErr } = await supabase
    .from("round_players")
    .select("round_id,player_id,playing,playing_handicap")
    .in("round_id", roundIds)
    .in("player_id", playerIds);

  if (rpErr) return { ok: false, error: rpErr.message };
  const roundPlayers = (rpData ?? []).map((x: any) => ({
    round_id: String(x.round_id),
    player_id: String(x.player_id),
    playing: x.playing === true,
    playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
  })) as RoundPlayerRow[];

  // 5) scores
  const { data: scoresData, error: scoresErr } = await supabase
    .from("scores")
    .select("round_id,player_id,hole_number,strokes,pickup")
    .in("round_id", roundIds)
    .in("player_id", playerIds);

  if (scoresErr) return { ok: false, error: scoresErr.message };
  const scores = (scoresData ?? []) as ScoreRow[];

  // Build maps
  const courseHole: Record<string, Record<number, { par: number; si: number }>> = {};
  for (const p of pars) {
    const cid = String(p.course_id);
    if (!courseHole[cid]) courseHole[cid] = {};
    courseHole[cid][Number(p.hole_number)] = { par: Number(p.par), si: Number(p.stroke_index) };
  }

  const playingMap: Record<string, Record<string, boolean>> = {};
  for (const rp of roundPlayers) {
    if (!playingMap[rp.round_id]) playingMap[rp.round_id] = {};
    playingMap[rp.round_id][rp.player_id] = !!rp.playing;
  }

  const scoreMap: Record<string, Record<string, Record<number, string>>> = {};
  for (const s of scores) {
    const rid = String(s.round_id);
    const pid = String(s.player_id);
    const hole = Number(s.hole_number);
    if (!scoreMap[rid]) scoreMap[rid] = {};
    if (!scoreMap[rid][pid]) scoreMap[rid][pid] = {};
    scoreMap[rid][pid][hole] = rawScoreString(s);
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

  // Starting handicap = tour_players.starting_handicap if set else global players.start_handicap
  const startingHcpByPlayer: Record<string, number> = {};
  for (const p of players) {
    const sh = p.tour_starting_handicap ?? p.start_handicap ?? 0;
    startingHcpByPlayer[p.id] = Math.max(0, Math.floor(Number(sh) || 0));
  }

  const phByRoundPlayer: Record<string, Record<string, number>> = {};

  // init Round 1 PH = SH
  const r1 = rounds[0];
  phByRoundPlayer[r1.id] = {};
  for (const p of players) phByRoundPlayer[r1.id][p.id] = startingHcpByPlayer[p.id];

  const stablefordTotal = (roundId: string, courseId: string, playerId: string, ph: number): number => {
    let total = 0;
    const holeInfo = courseHole[String(courseId)];
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

  // sequential recalculation; stop at first incomplete round
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const next = rounds[i + 1] ?? null;

    // ensure current PH map exists (carry forward)
    if (!phByRoundPlayer[r.id]) {
      phByRoundPlayer[r.id] = {};
      const prev = rounds[i - 1];
      for (const p of players) {
        phByRoundPlayer[r.id][p.id] = phByRoundPlayer[prev.id]?.[p.id] ?? startingHcpByPlayer[p.id];
      }
    }

    if (!isRoundComplete(r.id)) break;

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

    const avgRounded =
      playedScores.length > 0 ? roundHalfUp(playedScores.reduce((s, v) => s + v, 0) / playedScores.length) : null;

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

  // Upsert playing_handicap for round_players (preserve playing flag)
  const payload = roundPlayers.map((rp) => {
    const ph = phByRoundPlayer[rp.round_id]?.[rp.player_id];
    return {
      round_id: rp.round_id,
      player_id: rp.player_id,
      playing: rp.playing,
      playing_handicap: Number.isFinite(Number(ph)) ? Number(ph) : (rp.playing_handicap ?? 0),
    };
  });

  if (payload.length === 0) return { ok: true, updated: 0 };

  const { error: upErr } = await supabase.from("round_players").upsert(payload, {
    onConflict: "round_id,player_id",
  });

  if (upErr) return { ok: false, error: upErr.message };

  return { ok: true, updated: payload.length };
}
