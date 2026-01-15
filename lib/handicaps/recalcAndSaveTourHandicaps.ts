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

  // 0) Respect tour flag
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
    .select("id,tour_id,course_id,round_no,played_on,created_at")
    .eq("tour_id", tourId);

  if (roundsErr) return { ok: false, error: roundsErr.message };

  const roundsRaw = (roundsData ?? []) as Round[];
  if (roundsRaw.length === 0) return { ok: true, updated: 0 };

  // ✅ Stable ordering: round_no → played_on → created_at
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
  const courseIds = Array.from(new Set(rounds.map((r) => r.course_id).filter(Boolean))) as string[];

  // 2) load players in this tour via tour_players join
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

  // 3) pars (both tees; we’ll pick by player gender at runtime)
  const { data: parsData, error: parsErr } = await supabase
    .from("pars")
    .select("course_id,hole_number,par,stroke_index,tee")
    .in("course_id", courseIds);

  if (parsErr) return { ok: false, error: parsErr.message };
  const pars = (parsData ?? []) as ParRow[];

  // Build pars by course + tee + hole
  const parsByCourseTee: Record<string, Record<Tee, Record<number, { par: number; si: number }>>> = {};
  for (const row of pars) {
    const cid = String(row.course_id);
    const tee = normalizeTee(row.tee);
    const hole = Number(row.hole_number);
    if (!parsByCourseTee[cid]) parsByCourseTee[cid] = { M: {}, F: {} };
    parsByCourseTee[cid][tee][hole] = { par: Number(row.par), si: Number(row.stroke_index) };
  }

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

  const rpKey = (rid: string, pid: string) => `${rid}::${pid}`;
  const rpByKey = new Map<string, RoundPlayerRow>();
  for (const rp of roundPlayers) rpByKey.set(rpKey(rp.round_id, rp.player_id), rp);

  // 5) scores
  const { data: scoresData, error: scoresErr } = await supabase
    .from("scores")
    .select("round_id,player_id,hole_number,strokes,pickup")
    .in("round_id", roundIds)
    .in("player_id", playerIds);

  if (scoresErr) return { ok: false, error: scoresErr.message };
  const scores = (scoresData ?? []) as ScoreRow[];

  // Build score map
  const scoreMap: Record<string, Record<string, Record<number, string>>> = {};
  for (const s of scores) {
    const rid = String(s.round_id);
    const pid = String(s.player_id);
    const hole = Number(s.hole_number);
    if (!scoreMap[rid]) scoreMap[rid] = {};
    if (!scoreMap[rid][pid]) scoreMap[rid][pid] = {};
    scoreMap[rid][pid][hole] = rawScoreString(s);
  }

  // playing map (defaults false if no round_players row)
  const playingMap: Record<string, Record<string, boolean>> = {};
  for (const r of rounds) {
    playingMap[r.id] = {};
    for (const p of players) {
      const existing = rpByKey.get(rpKey(r.id, p.id));
      playingMap[r.id][p.id] = existing?.playing === true;
    }
  }

  // ✅ Per-player completion: we only require that THIS player has 18 holes, not the whole field.
  function isPlayerComplete(roundId: string, playerId: string): boolean {
    for (let hole = 1; hole <= 18; hole++) {
      const raw = scoreMap[roundId]?.[playerId]?.[hole] ?? "";
      if (!raw) return false;
    }
    return true;
  }

  // Starting handicap = tour_players.starting_handicap if set else global start_handicap
  const startingHcpByPlayer: Record<string, number> = {};
  const teeByPlayer: Record<string, Tee> = {};
  for (const p of players) {
    const sh = p.tour_start ?? p.global_start ?? 0;
    startingHcpByPlayer[p.id] = Math.max(0, Math.floor(Number(sh) || 0));
    teeByPlayer[p.id] = p.gender ? normalizeTee(p.gender) : "M";
  }

  // Compute PH per round/player
  const phByRoundPlayer: Record<string, Record<string, number>> = {};

  // init Round 1 PH = SH
  const r1 = rounds[0];
  phByRoundPlayer[r1.id] = {};
  for (const p of players) phByRoundPlayer[r1.id][p.id] = startingHcpByPlayer[p.id];

  const stablefordTotal = (roundId: string, courseId: string, playerId: string, ph: number): number => {
    const cid = String(courseId);
    const tee = teeByPlayer[playerId] ?? "M";
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

  // ✅ sequential recalculation, but never “break” just because others haven’t finished.
  // We adjust only players who have completed cards in that round.
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const next = rounds[i + 1] ?? null;

    // ensure current PH exists (carry forward)
    if (!phByRoundPlayer[r.id]) {
      phByRoundPlayer[r.id] = {};
      const prev = rounds[i - 1];
      for (const p of players) {
        phByRoundPlayer[r.id][p.id] = phByRoundPlayer[prev.id]?.[p.id] ?? startingHcpByPlayer[p.id];
      }
    }

    // if no next round, nothing to compute forward
    if (!next) continue;

    // always initialize next with carry-forward
    phByRoundPlayer[next.id] = phByRoundPlayer[next.id] ?? {};
    for (const p of players) {
      phByRoundPlayer[next.id][p.id] = phByRoundPlayer[r.id][p.id];
    }

    // If no course for this round, we can’t compute scores -> just carry forward
    if (!r.course_id) continue;

    // build list of completed players who are marked playing
    const completed: string[] = [];
    for (const p of players) {
      const played = playingMap[r.id]?.[p.id] === true;
      if (!played) continue;
      if (isPlayerComplete(r.id, p.id)) completed.push(p.id);
    }

    // if nobody complete, no adjustment yet
    if (completed.length === 0) continue;

    // compute stableford scores for completed players using THEIR PH for this round
    const scoresByPlayer: Record<string, number> = {};
    const playedScores: number[] = [];

    for (const pid of completed) {
      const ph = phByRoundPlayer[r.id][pid];
      const sc = stablefordTotal(r.id, r.course_id, pid, ph);
      scoresByPlayer[pid] = sc;
      playedScores.push(sc);
    }

    const avgRounded = roundHalfUp(playedScores.reduce((s, v) => s + v, 0) / playedScores.length);

    // adjust next PH for completed players only; others stay carry-forward
    for (const pid of completed) {
      const prevPH = phByRoundPlayer[r.id][pid];
      const prevScore = scoresByPlayer[pid];

      const diff = (avgRounded - prevScore) / 3;
      const raw = roundHalfUp(prevPH + diff);

      const sh = startingHcpByPlayer[pid];
      const max = sh + 3;
      const min = ceilHalfStart(sh);

      phByRoundPlayer[next.id][pid] = clamp(raw, min, max);
    }
  }

  // Upsert PH for ALL (round,player) combinations we know about (preserve playing where present)
  const payload: Array<{ round_id: string; player_id: string; playing: boolean; playing_handicap: number | null }> = [];

  for (const r of rounds) {
    for (const p of players) {
      const existing = rpByKey.get(rpKey(r.id, p.id));
      const playing = existing?.playing === true;

      const computed = phByRoundPlayer[r.id]?.[p.id];
      const fallback = existing?.playing_handicap ?? startingHcpByPlayer[p.id];

      payload.push({
        round_id: r.id,
        player_id: p.id,
        playing,
        playing_handicap: Number.isFinite(Number(computed)) ? Number(computed) : fallback,
      });
    }
  }

  const { error: upErr } = await supabase.from("round_players").upsert(payload, {
    onConflict: "round_id,player_id",
  });

  if (upErr) return { ok: false, error: upErr.message };

  return { ok: true, updated: payload.length };
}
