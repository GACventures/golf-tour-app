import { netStablefordPointsForHole } from "@/lib/stableford";
import type { SupabaseClient } from "@supabase/supabase-js";

type Tee = "M" | "F";

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
  tee: Tee; // normalized to non-null in-memory
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

export type RehandicapDebug = {
  triggerIndex: number | null;
  targetRoundsCount: number;
  roundsOrdered: Array<{ id: string; round_no: number | null; course_id: string | null }>;
  expectedScoreRows?: number;
  fetchedScoreRows?: number;
  fetchedScorePages?: number;
  warnings?: string[];
  perRound: Array<{
    round_no: number | null;
    round_id: string;
    course_id: string | null;
    playingCount: number;
    completeCount: number;
    avgRounded: number | null;
    sample: Array<{
      player_id: string;
      prevPH: number;
      holesFilled: number;
      stableford: number | null;
      nextPH: number | null;
    }>;
  }>;
};

/**
 * Rehandicap rule (UPDATED):
 * - Calculates sequential PH round-by-round.
 * - A player is "complete" if they have a (non-empty) value for all 18 holes (including "P").
 * - If a player is not complete for a round, their PH is carried forward unchanged.
 *
 * IMPORTANT CHANGE:
 * - We DO NOT stop if a round has 0 complete players.
 *   Instead avgRounded=null and ALL PHs simply carry forward to the next round, and we keep going.
 *
 * - When fromRoundId is provided, we only WRITE (upsert) PH for rounds AFTER that round.
 */
export async function recalcAndSaveTourHandicaps(opts: {
  supabase: SupabaseClient;
  tourId: string;
  fromRoundId?: string;
}): Promise<
  | { ok: true; updated: number; debug?: RehandicapDebug }
  | { ok: false; error: string; debug?: RehandicapDebug }
> {
  const { supabase, tourId, fromRoundId } = opts;

  const debug: RehandicapDebug = {
    triggerIndex: null,
    targetRoundsCount: 0,
    roundsOrdered: [],
    perRound: [],
    warnings: [],
  };

  // 0) Read tour flag
  const { data: tourRow, error: tourErr } = await supabase
    .from("tours")
    .select("id,rehandicapping_enabled")
    .eq("id", tourId)
    .maybeSingle();

  if (tourErr) return { ok: false, error: tourErr.message, debug };

  const rehandicappingEnabled = (tourRow as any)?.rehandicapping_enabled === true;

  // 1) load rounds
  const { data: roundsData, error: roundsErr } = await supabase
    .from("rounds")
    .select("id,tour_id,course_id,round_no,played_on,created_at")
    .eq("tour_id", tourId);

  if (roundsErr) return { ok: false, error: roundsErr.message, debug };

  const roundsRaw = (roundsData ?? []) as Round[];
  if (roundsRaw.length === 0) return { ok: true, updated: 0, debug };

  // Stable ordering: round_no → played_on → created_at
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

  debug.roundsOrdered = rounds.map((r) => ({ id: r.id, round_no: r.round_no ?? null, course_id: r.course_id ?? null }));

  // trigger index
  let triggerIndex: number | null = null;
  if (fromRoundId) {
    const idx = rounds.findIndex((r) => String(r.id) === String(fromRoundId));
    triggerIndex = idx >= 0 ? idx : null;
  }
  debug.triggerIndex = triggerIndex;

  // only write future rounds after trigger
  const targetRounds = triggerIndex == null ? rounds : rounds.slice(triggerIndex + 1);
  debug.targetRoundsCount = targetRounds.length;

  if (triggerIndex != null && targetRounds.length === 0) return { ok: true, updated: 0, debug };

  const roundIds = rounds.map((r) => r.id);
  const courseIds = Array.from(new Set(rounds.map((r) => r.course_id).filter(Boolean))) as string[];

  // 2) load players
  const { data: tpData, error: tpErr } = await supabase
    .from("tour_players")
    .select("tour_id,player_id,starting_handicap, players(id,name,start_handicap,gender)")
    .eq("tour_id", tourId);

  if (tpErr) return { ok: false, error: tpErr.message, debug };

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

  if (players.length === 0) return { ok: true, updated: 0, debug };
  const playerIds = players.map((p) => p.id);

  // 3) round_players
  const { data: rpData, error: rpErr } = await supabase
    .from("round_players")
    .select("round_id,player_id,playing,playing_handicap,tee")
    .in("round_id", roundIds)
    .in("player_id", playerIds);

  if (rpErr) return { ok: false, error: rpErr.message, debug };

  const roundPlayers = (rpData ?? []).map((x: any) => {
    const tee = normalizeTee(x.tee);
    return {
      round_id: String(x.round_id),
      player_id: String(x.player_id),
      playing: x.playing === true,
      playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
      tee,
    } as RoundPlayerRow;
  });

  const rpKey = (rid: string, pid: string) => `${rid}::${pid}`;
  const rpByKey = new Map<string, RoundPlayerRow>();
  for (const rp of roundPlayers) rpByKey.set(rpKey(rp.round_id, rp.player_id), rp);

  // starting hcp and default tee
  const startingHcpByPlayer: Record<string, number> = {};
  const defaultTeeByPlayer: Record<string, Tee> = {};
  for (const p of players) {
    const sh = p.tour_start ?? p.global_start ?? 0;
    startingHcpByPlayer[p.id] = Math.max(0, Math.floor(Number(sh) || 0));
    defaultTeeByPlayer[p.id] = p.gender ? normalizeTee(p.gender) : "M";
  }

  // If OFF: reset PHs to starting for target rounds
  if (!rehandicappingEnabled) {
    const payload: Array<{
      round_id: string;
      player_id: string;
      playing: boolean;
      playing_handicap: number;
      tee: Tee;
    }> = [];

    for (const r of targetRounds) {
      for (const p of players) {
        const existing = rpByKey.get(rpKey(r.id, p.id));
        const playing = existing?.playing === true;
        const tee = existing?.tee ? normalizeTee(existing.tee) : defaultTeeByPlayer[p.id] ?? "M";
        const sh = startingHcpByPlayer[p.id];

        payload.push({
          round_id: r.id,
          player_id: p.id,
          playing,
          playing_handicap: sh,
          tee,
        });
      }
    }

    if (payload.length === 0) return { ok: true, updated: 0, debug };

    const { error: upErr } = await supabase.from("round_players").upsert(payload, {
      onConflict: "round_id,player_id",
    });

    if (upErr) return { ok: false, error: upErr.message, debug };
    return { ok: true, updated: payload.length, debug };
  }

  // 4) pars
  const { data: parsData, error: parsErr } = await supabase
    .from("pars")
    .select("course_id,hole_number,par,stroke_index,tee")
    .in("course_id", courseIds);

  if (parsErr) return { ok: false, error: parsErr.message, debug };
  const pars = (parsData ?? []) as ParRow[];

  const parsByCourseTee: Record<string, Record<Tee, Record<number, { par: number; si: number }>>> = {};
  for (const row of pars) {
    const cid = String(row.course_id);
    const tee = normalizeTee(row.tee);
    const hole = Number(row.hole_number);
    if (!parsByCourseTee[cid]) parsByCourseTee[cid] = { M: {}, F: {} };
    parsByCourseTee[cid][tee][hole] = { par: Number(row.par), si: Number(row.stroke_index) };
  }

  // 5) scores (PAGINATED to avoid 1000 row cap)
  const expectedScoreRows = rounds.length * players.length * 18;
  debug.expectedScoreRows = expectedScoreRows;

  async function fetchAllScoresPaged(): Promise<ScoreRow[]> {
    const pageSize = 1000;
    let from = 0;
    let page = 0;
    const out: ScoreRow[] = [];

    while (true) {
      page += 1;

      const { data, error } = await supabase
        .from("scores")
        .select("round_id,player_id,hole_number,strokes,pickup")
        .in("round_id", roundIds)
        .in("player_id", playerIds)
        .order("round_id", { ascending: true })
        .order("player_id", { ascending: true })
        .order("hole_number", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) throw error;

      const rows = (data ?? []) as ScoreRow[];
      out.push(...rows);

      if (rows.length < pageSize) {
        debug.fetchedScorePages = page;
        return out;
      }

      from += pageSize;

      // safety guard (should never hit)
      if (page > 50_000) {
        debug.warnings?.push("Score pagination safety guard triggered (unexpected).");
        debug.fetchedScorePages = page;
        return out;
      }
    }
  }

  let scores: ScoreRow[] = [];
  try {
    scores = await fetchAllScoresPaged();
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Failed to fetch scores (paged).", debug };
  }

  debug.fetchedScoreRows = scores.length;

  if (scores.length < expectedScoreRows) {
    debug.warnings?.push(
      `Fetched fewer score rows than expected (${scores.length} < ${expectedScoreRows}). This can occur if some score rows do not exist in DB for some players/rounds.`
    );
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

  // playing map
  const playingMap: Record<string, Record<string, boolean>> = {};
  for (const r of rounds) {
    playingMap[r.id] = {};
    for (const p of players) {
      const existing = rpByKey.get(rpKey(r.id, p.id));
      playingMap[r.id][p.id] = existing?.playing === true;
    }
  }

  const teeForRoundPlayer = (roundId: string, playerId: string): Tee => {
    const existing = rpByKey.get(rpKey(roundId, playerId));
    if (existing?.tee) return normalizeTee(existing.tee);
    return defaultTeeByPlayer[playerId] ?? "M";
  };

  const holesFilledCount = (roundId: string, playerId: string): number => {
    let c = 0;
    for (let hole = 1; hole <= 18; hole++) {
      const raw = scoreMap[roundId]?.[playerId]?.[hole] ?? "";
      if (raw) c += 1;
    }
    return c;
  };

  const isPlayerComplete = (roundId: string, playerId: string): boolean => holesFilledCount(roundId, playerId) === 18;

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

  // sequential PH map
  const phByRoundPlayer: Record<string, Record<string, number>> = {};

  // init first round PHs = starting
  const r1 = rounds[0];
  phByRoundPlayer[r1.id] = {};
  for (const p of players) phByRoundPlayer[r1.id][p.id] = startingHcpByPlayer[p.id];

  // MAIN LOOP (NO EARLY STOP)
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const next = rounds[i + 1] ?? null;

    // ensure current round PH map exists (carry forward from previous round if needed)
    if (!phByRoundPlayer[r.id]) {
      phByRoundPlayer[r.id] = {};
      const prev = rounds[i - 1];
      for (const p of players) {
        phByRoundPlayer[r.id][p.id] = phByRoundPlayer[prev.id]?.[p.id] ?? startingHcpByPlayer[p.id];
      }
    }

    const playedPlayers = players.filter((pl) => playingMap[r.id]?.[pl.id] === true);
    const completePlayers = playedPlayers.filter((pl) => isPlayerComplete(r.id, pl.id));
    const playedCount = playedPlayers.length;
    const completeCount = completePlayers.length;

    // If no course_id OR no pars for course, we cannot calculate stableford; carry forward.
    const canScore =
      !!r.course_id && !!parsByCourseTee[String(r.course_id)] && (Object.keys(parsByCourseTee[String(r.course_id)]?.M ?? {}).length > 0);

    if (!canScore) {
      if (!r.course_id) debug.warnings?.push(`Round ${r.round_no ?? "?"} has no course_id; PH carried forward.`);
      else debug.warnings?.push(`Round ${r.round_no ?? "?"} missing pars for its course; PH carried forward.`);

      debug.perRound.push({
        round_no: r.round_no ?? null,
        round_id: r.id,
        course_id: r.course_id ?? null,
        playingCount: playedCount,
        completeCount,
        avgRounded: null,
        sample: completePlayers.slice(0, 6).map((pl) => ({
          player_id: pl.id,
          prevPH: phByRoundPlayer[r.id][pl.id],
          holesFilled: holesFilledCount(r.id, pl.id),
          stableford: null,
          nextPH: null,
        })),
      });

      if (next) {
        phByRoundPlayer[next.id] = {};
        for (const p of players) {
          phByRoundPlayer[next.id][p.id] = phByRoundPlayer[r.id][p.id];
        }
      }
      continue;
    }

    // compute stableford totals for complete players only
    const scoreByPlayer: Record<string, number | null> = {};
    const playedScores: number[] = [];

    for (const p of players) {
      const isPlaying = playingMap[r.id]?.[p.id] === true;
      const isComplete = isPlaying && isPlayerComplete(r.id, p.id);

      if (!isComplete) {
        scoreByPlayer[p.id] = null;
        continue;
      }

      const ph = phByRoundPlayer[r.id][p.id];
      const sc = stablefordTotal(r.id, String(r.course_id), p.id, ph);
      scoreByPlayer[p.id] = sc;
      playedScores.push(sc);
    }

    // If no complete players, avgRounded=null, carry forward (but DO NOT STOP)
    const avgRounded =
      playedScores.length > 0 ? roundHalfUp(playedScores.reduce((s, v) => s + v, 0) / playedScores.length) : null;

    // debug sample (use up to 6 players from the tour list, not only completes, so you can see holesFilled)
    const samplePlayers = players.slice(0, 6);
    const sample = samplePlayers.map((pl) => {
      const hf = holesFilledCount(r.id, pl.id);
      const prevPH = phByRoundPlayer[r.id][pl.id];
      const isPlaying = playingMap[r.id]?.[pl.id] === true;
      const isComplete = isPlaying && hf === 18;
      const st = isComplete ? (scoreByPlayer[pl.id] ?? null) : null;
      return {
        player_id: pl.id,
        prevPH,
        holesFilled: hf,
        stableford: st,
        nextPH: null as number | null,
      };
    });

    debug.perRound.push({
      round_no: r.round_no ?? null,
      round_id: r.id,
      course_id: r.course_id ?? null,
      playingCount: playedCount,
      completeCount,
      avgRounded,
      sample,
    });

    if (next) {
      phByRoundPlayer[next.id] = {};

      for (const p of players) {
        const prevPH = phByRoundPlayer[r.id][p.id];

        const isPlaying = playingMap[r.id]?.[p.id] === true;
        const isComplete = isPlaying && isPlayerComplete(r.id, p.id);

        // carry forward unless complete and avg exists
        if (!isComplete || avgRounded === null) {
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

        const nextPH = clamp(raw, min, max);
        phByRoundPlayer[next.id][p.id] = nextPH;

        // fill debug sample nextPH if present
        const d = debug.perRound[debug.perRound.length - 1];
        const s = d?.sample?.find((x) => x.player_id === p.id);
        if (s) s.nextPH = nextPH;
      }
    }
  }

  // Upsert PH only for targetRounds
  const payload: Array<{
    round_id: string;
    player_id: string;
    playing: boolean;
    playing_handicap: number | null;
    tee: Tee;
  }> = [];

  for (const r of targetRounds) {
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

  if (payload.length === 0) return { ok: true, updated: 0, debug };

  const { error: upErr } = await supabase.from("round_players").upsert(payload, {
    onConflict: "round_id,player_id",
  });

  if (upErr) return { ok: false, error: upErr.message, debug };

  return { ok: true, updated: payload.length, debug };
}
