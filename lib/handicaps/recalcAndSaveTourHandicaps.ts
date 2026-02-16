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

function round1dp(x: number): number {
  return Math.round(x * 10) / 10;
}

function ceilHalfStart(shInt: number): number {
  return Math.ceil(shInt / 2);
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

  // ✅ CHANGE: keep global start handicap as 1dp (not floored)
  const shNum = Number((p as any).start_handicap);
  const start_handicap = Number.isFinite(shNum) ? Math.max(0, round1dp(shNum)) : null;

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

  scoredRoundsDetected: number;
  lastScoredRoundIndex: number;

  stopReason?: string;
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
    scoredRoundsDetected: 0,
    lastScoredRoundIndex: -1,
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

      // ✅ CHANGE: keep tour override as 1dp (not floored)
      const overrideRaw = Number((r as any).starting_handicap);
      const tour_starting_handicap = Number.isFinite(overrideRaw) ? Math.max(0, round1dp(overrideRaw)) : null;

      return {
        id: pj.id,
        name: pj.name,
        gender: pj.gender ?? null,
        global_start: pj.start_handicap ?? 0, // 1dp
        tour_start: tour_starting_handicap, // 1dp or null
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

  // ✅ NEW: store decimal starts (1dp) + integer seed for round PH
  const startDecimalByPlayer: Record<string, number> = {};
  const startIntByPlayer: Record<string, number> = {};
  const defaultTeeByPlayer: Record<string, Tee> = {};

  for (const p of players) {
    const shDec = p.tour_start ?? p.global_start ?? 0; // 1dp
    const shDecNorm = Math.max(0, round1dp(Number(shDec) || 0));

    // round 1 playing handicap seed must be whole number
    const shInt = roundHalfUp(shDecNorm);

    startDecimalByPlayer[p.id] = shDecNorm;
    startIntByPlayer[p.id] = Math.max(0, shInt);
    defaultTeeByPlayer[p.id] = p.gender ? normalizeTee(p.gender) : "M";
  }

  // If OFF: reset PHs to starting for target rounds (whole numbers)
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
        const sh = startIntByPlayer[p.id];

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

  // 5) scores (pagination-safe)
  const PAGE_SIZE = 1000;
  const scores: ScoreRow[] = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;

    const { data: page, error: pageErr } = await supabase
      .from("scores")
      .select("round_id,player_id,hole_number,strokes,pickup")
      .in("round_id", roundIds)
      .in("player_id", playerIds)
      .range(from, to);

    if (pageErr) return { ok: false, error: pageErr.message, debug };

    const rows = (page ?? []) as ScoreRow[];
    scores.push(...rows);

    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const scoreMap: Record<string, Record<string, Record<number, string>>> = {};
  const scoredRoundIdSet = new Set<string>();

  for (const s of scores) {
    const rid = String(s.round_id);
    const pid = String(s.player_id);
    const hole = Number(s.hole_number);

    scoredRoundIdSet.add(rid);

    if (!scoreMap[rid]) scoreMap[rid] = {};
    if (!scoreMap[rid][pid]) scoreMap[rid][pid] = {};
    scoreMap[rid][pid][hole] = rawScoreString(s);
  }

  debug.scoredRoundsDetected = scoredRoundIdSet.size;

  let lastScoredIdx = -1;
  for (let i = 0; i < rounds.length; i++) {
    if (scoredRoundIdSet.has(String(rounds[i].id))) lastScoredIdx = i;
  }
  debug.lastScoredRoundIndex = lastScoredIdx;

  const playingMap: Record<string, Record<string, boolean>> = {};
  for (const p of players) {
    for (const r of rounds) {
      if (!playingMap[r.id]) playingMap[r.id] = {};
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
    let n = 0;
    for (let hole = 1; hole <= 18; hole++) {
      const raw = scoreMap[roundId]?.[playerId]?.[hole] ?? "";
      if (raw) n++;
    }
    return n;
  };

  const isPlayerComplete = (roundId: string, playerId: string): boolean => {
    return holesFilledCount(roundId, playerId) === 18;
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

  // sequential PH map (whole numbers)
  const phByRoundPlayer: Record<string, Record<string, number>> = {};

  // init round 1
  const r1 = rounds[0];
  phByRoundPlayer[r1.id] = {};
  for (const p of players) phByRoundPlayer[r1.id][p.id] = startIntByPlayer[p.id];

  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const next = rounds[i + 1] ?? null;

    if (!phByRoundPlayer[r.id]) {
      phByRoundPlayer[r.id] = {};
      const prev = rounds[i - 1];
      for (const p of players) {
        phByRoundPlayer[r.id][p.id] = phByRoundPlayer[prev.id]?.[p.id] ?? startIntByPlayer[p.id];
      }
    }

    if (!r.course_id) {
      debug.stopReason = `Stop: round ${r.round_no ?? "?"} has no course_id`;
      break;
    }

    if (lastScoredIdx >= 0 && i > lastScoredIdx) {
      const playedPlayers = players.filter((pl) => playingMap[r.id]?.[pl.id] === true);
      debug.perRound.push({
        round_no: r.round_no ?? null,
        round_id: r.id,
        course_id: r.course_id ?? null,
        playingCount: playedPlayers.length,
        completeCount: 0,
        avgRounded: null,
        sample: playedPlayers.slice(0, 6).map((pl) => ({
          player_id: pl.id,
          prevPH: phByRoundPlayer[r.id][pl.id],
          holesFilled: 0,
          stableford: null,
          nextPH: null,
        })),
      });

      if (next) {
        phByRoundPlayer[next.id] = {};
        for (const p of players) phByRoundPlayer[next.id][p.id] = phByRoundPlayer[r.id][p.id];
      }
      continue;
    }

    const playedPlayers = players.filter((pl) => playingMap[r.id]?.[pl.id] === true);
    const completePlayers = playedPlayers.filter((pl) => isPlayerComplete(r.id, pl.id));

    const playedCount = playedPlayers.length;
    const completeCount = completePlayers.length;

    if (completeCount === 0) {
      debug.stopReason = `Stop: round ${r.round_no ?? "?"} has 0 complete players (of ${playedCount} playing)`;
      debug.perRound.push({
        round_no: r.round_no ?? null,
        round_id: r.id,
        course_id: r.course_id ?? null,
        playingCount: playedCount,
        completeCount,
        avgRounded: null,
        sample: playedPlayers.slice(0, 6).map((pl) => ({
          player_id: pl.id,
          prevPH: phByRoundPlayer[r.id][pl.id],
          holesFilled: holesFilledCount(r.id, pl.id),
          stableford: null,
          nextPH: null,
        })),
      });
      break;
    }

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
      const sc = stablefordTotal(r.id, r.course_id, p.id, ph);
      scoreByPlayer[p.id] = sc;
      playedScores.push(sc);
    }

    const avgRounded =
      playedScores.length > 0 ? roundHalfUp(playedScores.reduce((s, v) => s + v, 0) / playedScores.length) : null;

    const sample = completePlayers.slice(0, 6).map((pl) => ({
      player_id: pl.id,
      prevPH: phByRoundPlayer[r.id][pl.id],
      holesFilled: 18,
      stableford: scoreByPlayer[pl.id],
      nextPH: null as number | null,
    }));

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

        // ✅ IMPORTANT: min/max are based on the integer seed start (whole-number handicap rules)
        const sh = startIntByPlayer[p.id];
        const max = sh + 3;
        const min = ceilHalfStart(sh);

        const nextPH = clamp(raw, min, max);
        phByRoundPlayer[next.id][p.id] = nextPH;

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
      const fallback = existing?.playing_handicap ?? startIntByPlayer[p.id];
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

  debug.warnings = (debug.warnings ?? []).filter(Boolean);

  return { ok: true, updated: payload.length, debug };
}
