// lib/handicaps/recalcAndSaveTourHandicaps.ts
import { netStablefordPointsForHole } from "@/lib/stableford";
import type { SupabaseClient } from "@supabase/supabase-js";

type Tee = "M" | "F";

type TourRow = {
  id: string;
  rehandicapping_enabled: boolean | null;
};

type Round = {
  id: string;
  tour_id: string;
  course_id: string | null;
  round_no: number | null;
  played_on: string | null;
  created_at: string | null;
};

type ParRow = {
  course_id: string;
  hole_number: number;
  par: number;
  stroke_index: number;
  tee: Tee | string | null;
};

type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean | null;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number | null;
  tee: Tee; // non-null in our in-memory model
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

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
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

  const gender = (p as any).gender == null ? null : normalizeTee((p as any).gender);

  return { id, name, start_handicap, gender };
}

function rawScoreString(s: ScoreRow): string {
  const isPickup = (s as any).pickup === true;
  if (isPickup) return "P";
  if (s.strokes === null || s.strokes === undefined) return "";
  return String(s.strokes).trim().toUpperCase();
}

function cmpNullableNum(a: number | null, b: number | null) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

export async function recalcAndSaveTourHandicaps(opts: {
  supabase: SupabaseClient;
  tourId: string;
}): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const { supabase, tourId } = opts;

  // --- Helpers used by both paths ---
  const rpKey = (rid: string, pid: string) => `${rid}::${pid}`;

  // 0) Load tour flag
  const { data: tourRow, error: tourErr } = await supabase
    .from("tours")
    .select("id,rehandicapping_enabled")
    .eq("id", tourId)
    .maybeSingle();

  if (tourErr) return { ok: false, error: tourErr.message };
  const enabled = (tourRow as TourRow | null)?.rehandicapping_enabled === true;

  // 1) Load rounds
  const { data: roundsData, error: roundsErr } = await supabase
    .from("rounds")
    .select("id,tour_id,course_id,round_no,played_on,created_at")
    .eq("tour_id", tourId);

  if (roundsErr) return { ok: false, error: roundsErr.message };

  const roundsRaw = (roundsData ?? []) as Round[];
  if (roundsRaw.length === 0) return { ok: true, updated: 0 };

  // Stable ordering: round_no → played_on → created_at → id
  const rounds = [...roundsRaw].sort((a, b) => {
    const c1 = cmpNullableNum(a.round_no, b.round_no);
    if (c1 !== 0) return c1;

    const pa = a.played_on ?? "";
    const pb = b.played_on ?? "";
    if (pa && pb && pa !== pb) return pa < pb ? -1 : 1;
    if (pa && !pb) return -1;
    if (!pa && pb) return 1;

    const ca = a.created_at ?? "";
    const cb = b.created_at ?? "";
    if (ca && cb && ca !== cb) return ca < cb ? -1 : 1;
    if (ca && !cb) return -1;
    if (!ca && cb) return 1;

    return String(a.id).localeCompare(String(b.id));
  });

  const roundIds = rounds.map((r) => r.id);

  // 2) Load tour players (and global player join)
  const { data: tpData, error: tpErr } = await supabase
    .from("tour_players")
    .select("tour_id,player_id,starting_handicap, players(id,name,start_handicap,gender)")
    .eq("tour_id", tourId);

  if (tpErr) return { ok: false, error: tpErr.message };

  const tourPlayers = (tpData ?? []) as unknown as TourPlayerJoinRow[];

  const players = tourPlayers
    .map((r) => {
      const pj = normalizePlayerJoin(r.players);
      if (!pj) return null;

      const overrideRaw = Number((r as any).starting_handicap);
      const tour_starting_handicap = Number.isFinite(overrideRaw) ? Math.max(0, Math.floor(overrideRaw)) : null;

      return {
        id: pj.id,
        name: pj.name,
        gender: pj.gender ?? null,
        global_start: pj.start_handicap ?? 0,
        tour_start: tour_starting_handicap, // may be null
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    name: string;
    gender: Tee | null;
    global_start: number;
    tour_start: number | null;
  }>;

  if (players.length === 0) return { ok: true, updated: 0 };
  const playerIds = players.map((p) => p.id);

  // 3) Load existing round_players for playing + tee preservation
  const { data: rpData, error: rpErr } = await supabase
    .from("round_players")
    .select("round_id,player_id,playing,playing_handicap,tee")
    .in("round_id", roundIds)
    .in("player_id", playerIds);

  if (rpErr) return { ok: false, error: rpErr.message };

  const existingRoundPlayers: RoundPlayerRow[] = (rpData ?? []).map((x: any) => ({
    round_id: String(x.round_id),
    player_id: String(x.player_id),
    playing: x.playing === true,
    playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
    tee: normalizeTee(x.tee),
  }));

  const rpByKey = new Map<string, RoundPlayerRow>();
  for (const rp of existingRoundPlayers) rpByKey.set(rpKey(rp.round_id, rp.player_id), rp);

  // Starting handicap = tour_players.starting_handicap if set else global start_handicap
  const startingHcpByPlayer: Record<string, number> = {};
  const defaultTeeByPlayer: Record<string, Tee> = {};
  for (const p of players) {
    const sh = p.tour_start ?? p.global_start ?? 0;
    startingHcpByPlayer[p.id] = Math.max(0, Math.floor(Number(sh) || 0));
    defaultTeeByPlayer[p.id] = p.gender ? normalizeTee(p.gender) : "M";
  }

  // === PATH A: Rehandicapping DISABLED ===
  // Snap EVERY round_players.playing_handicap back to starting handicap (tour override if set else global).
  if (!enabled) {
    const payload: Array<{
      round_id: string;
      player_id: string;
      playing: boolean;
      playing_handicap: number | null;
      tee: Tee;
    }> = [];

    for (const r of rounds) {
      for (const p of players) {
        const existing = rpByKey.get(rpKey(r.id, p.id));

        const playing = existing?.playing === true;
        const tee = existing?.tee ? normalizeTee(existing.tee) : defaultTeeByPlayer[p.id] ?? "M";
        const sh = startingHcpByPlayer[p.id];

        payload.push({
          round_id: r.id,
          player_id: p.id,
          playing,
          playing_handicap: Number.isFinite(Number(sh)) ? Number(sh) : null,
          tee,
        });
      }
    }

    const { error: upErr } = await supabase.from("round_players").upsert(payload, {
      onConflict: "round_id,player_id",
    });

    if (upErr) return { ok: false, error: upErr.message };
    return { ok: true, updated: payload.length };
  }

  // === PATH B: Rehandicapping ENABLED (existing behaviour, but uses same loaded rounds/players/rp rows) ===

  const courseIds = Array.from(new Set(rounds.map((r) => r.course_id).filter(Boolean))) as string[];

  // pars (both tees)
  const { data: parsData, error: parsErr } = await supabase
    .from("pars")
    .select("course_id,hole_number,par,stroke_index,tee")
    .in("course_id", courseIds);

  if (parsErr) return { ok: false, error: parsErr.message };
  const pars = (parsData ?? []) as ParRow[];

  const parsByCourseTee: Record<string, Record<Tee, Record<number, { par: number; si: number }>>> = {};
  for (const row of pars) {
    const cid = String(row.course_id);
    const tee = normalizeTee(row.tee);
    const hole = Number(row.hole_number);
    if (!parsByCourseTee[cid]) parsByCourseTee[cid] = { M: {}, F: {} };
    parsByCourseTee[cid][tee][hole] = { par: Number(row.par), si: Number(row.stroke_index) };
  }

  // scores
  const { data: scoresData, error: scoresErr } = await supabase
    .from("scores")
    .select("round_id,player_id,hole_number,strokes,pickup")
    .in("round_id", roundIds)
    .in("player_id", playerIds);

  if (scoresErr) return { ok: false, error: scoresErr.message };
  const scores = (scoresData ?? []) as ScoreRow[];

  const scoreMap: Record<string, Record<string, Record<number, string>>> = {};
  for (const s of scores) {
    const rid = String(s.round_id);
    const pid = String(s.player_id);
    const hole = Number(s.hole_number);
    if (!scoreMap[rid]) scoreMap[rid] = {};
    if (!scoreMap[rid][pid]) scoreMap[rid][pid] = {};
    scoreMap[rid][pid][hole] = rawScoreString(s);
  }

  // playingMap: default false unless round_players says playing=true
  const playingMap: Record<string, Record<string, boolean>> = {};
  for (const p of players) {
    for (const r of rounds) {
      if (!playingMap[r.id]) playingMap[r.id] = {};
      const existing = rpByKey.get(rpKey(r.id, p.id));
      playingMap[r.id][p.id] = existing?.playing === true;
    }
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

  const teeForRoundPlayer = (roundId: string, playerId: string): Tee => {
    const existing = rpByKey.get(rpKey(roundId, playerId));
    if (existing?.tee) return normalizeTee(existing.tee);
    return defaultTeeByPlayer[playerId] ?? "M";
  };

  const stablefordTotal = (roundId: string, courseId: string, playerId: string, ph: number): number => {
    const cid = String(courseId);
    const tee = teeForRoundPlayer(roundId, playerId);
    const holes = parsByCourseTee[cid]?.[tee] ?? parsByCourseTee[cid]?.M ?? null;
    if (!holes) return 0;

    let total = 0;
    for (let hole = 1; hole <= 18; hole++) {
      const info = holes[hole];
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

  // Compute PH per round/player
  const phByRoundPlayer: Record<string, Record<string, number>> = {};

  // init Round 1 PH = SH
  const r1 = rounds[0];
  phByRoundPlayer[r1.id] = {};
  for (const p of players) phByRoundPlayer[r1.id][p.id] = startingHcpByPlayer[p.id];

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

    // If no course, we can't compute stableford reliably → stop forward calc
    if (!r.course_id) break;

    // Only advance handicaps if the round is complete (for all playing players)
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

  // Upsert PH for ALL (round,player) combinations, preserving playing, ALWAYS writing tee (NOT NULL)
  const payload: Array<{
    round_id: string;
    player_id: string;
    playing: boolean;
    playing_handicap: number | null;
    tee: Tee;
  }> = [];

  for (const r of rounds) {
    for (const p of players) {
      const existing = rpByKey.get(rpKey(r.id, p.id));
      const playing = existing?.playing === true;

      const computed = phByRoundPlayer[r.id]?.[p.id];
      const fallback = existing?.playing_handicap ?? startingHcpByPlayer[p.id];

      const tee = existing?.tee ? normalizeTee(existing.tee) : defaultTeeByPlayer[p.id] ?? "M";

      payload.push({
        round_id: r.id,
        player_id: p.id,
        playing,
        playing_handicap: Number.isFinite(Number(computed)) ? Number(computed) : fallback,
        tee,
      });
    }
  }

  const { error: upErr } = await supabase.from("round_players").upsert(payload, {
    onConflict: "round_id,player_id",
  });

  if (upErr) return { ok: false, error: upErr.message };

  return { ok: true, updated: payload.length };
}
