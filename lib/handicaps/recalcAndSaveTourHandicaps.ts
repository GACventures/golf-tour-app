import { netStablefordPointsForHole } from "@/lib/stableford";
import type { SupabaseClient } from "@supabase/supabase-js";

type Tee = "M" | "F";

type Round = {
  id: string;
  tour_id: string;
  course_id: string | null;
  round_no: number | null;
  created_at: string | null;
  played_on?: string | null;
};

type ParRow = {
  course_id: string;
  hole_number: number;
  par: number;
  stroke_index: number;
  tee?: Tee | string | null;
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

function normalizePlayerJoin(val: any): PlayerJoin | null {
  if (!val) return null;
  const p = Array.isArray(val) ? val[0] : val;
  if (!p) return null;

  const id = String(p.id ?? "").trim();
  if (!id) return null;

  const name = String(p.name ?? "").trim() || "(missing player)";
  const shNum = Number(p.start_handicap);
  const start_handicap = Number.isFinite(shNum) ? Math.max(0, Math.floor(shNum)) : null;

  const gRaw = String(p.gender ?? "").trim().toUpperCase();
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

  // 0) Respect tour flag (if present)
  const { data: tourRow, error: tourErr } = await supabase
    .from("tours")
    .select("id,rehandicapping_enabled")
    .eq("id", tourId)
    .maybeSingle();

  if (tourErr) return { ok: false, error: tourErr.message };
  if (tourRow && (tourRow as any).rehandicapping_enabled === false) {
    return { ok: true, updated: 0 };
  }

  // 1) Load rounds (order by round_no first if present)
  const { data: roundsData, error: roundsErr } = await supabase
    .from("rounds")
    .select("id,tour_id,course_id,round_no,created_at,played_on")
    .eq("tour_id", tourId)
    .order("round_no", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (roundsErr) return { ok: false, error: roundsErr.message };
  const rounds = (roundsData ?? []) as Round[];
  if (rounds.length === 0) return { ok: true, updated: 0 };

  const roundIds = rounds.map((r) => r.id);
  const courseIds = Array.from(new Set(rounds.map((r) => r.course_id).filter(Boolean))) as string[];

  // 2) Load tour players via tour_players join
  const { data: tpData, error: tpErr } = await supabase
    .from("tour_players")
    .select("tour_id,player_id,starting_handicap, players(id,name,start_handicap,gender)")
    .eq("tour_id", tourId);

  if (tpErr) return { ok: false, error: tpErr.message };

  // Normalize safely (avoid TS build error)
  const players = (tpData ?? [])
    .map((row: any) => {
      const pj = normalizePlayerJoin(row.players);
      if (!pj) return null;

      const ov = Number(row.starting_handicap);
      const tour_starting_handicap = Number.isFinite(ov) ? Math.max(0, Math.floor(ov)) : null;

      return {
        id: pj.id,
        name: pj.name,
        gender: pj.gender ?? null,
        global_start: pj.start_handicap ?? 0,
        tour_override_start: tour_starting_handicap,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    name: string;
    gender: Tee | null;
    global_start: number;
    tour_override_start: number | null;
  }>;

  if (players.length === 0) return { ok: true, updated: 0 };
  const playerIds = players.map((p) => p.id);

  // 3) Pars — include tee if your schema has it (yours does)
  // If for some reason tee isn’t present, Supabase will still return it as null/undefined (safe).
  const { data: parsData, error: parsErr } = await supabase
    .from("pars")
    .select("course_id,hole_number,par,stroke_index,tee")
    .in("course_id", courseIds);

  if (parsErr) return { ok: false, error: parsErr.message };
  const pars = (parsData ?? []) as ParRow[];

  // Build course->tee->hole map
  const courseTeeHole: Record<string, Record<Tee, Record<number, { par: number; si: number }>>> = {};
  for (const p of pars) {
    const cid = String(p.course_id);
    const tee: Tee = normalizeTee((p as any).tee);
    const hole = Number(p.hole_number);
    if (!courseTeeHole[cid]) courseTeeHole[cid] = { M: {}, F: {} };
    courseTeeHole[cid][tee][hole] = { par: Number(p.par), si: Number(p.stroke_index) };
  }

  // 4) round_players (may be missing some rows; we’ll upsert all combos later)
  const { data: rpData, error: rpErr } = await supabase
    .from("round_players")
    .select("round_id,player_id,playing,playing_handicap")
    .in("round_id", roundIds)
    .in("player_id", playerIds);

  if (rpErr) return { ok: false, error: rpErr.message };

  const roundPlayersExisting = (rpData ?? []).map((x: any) => ({
    round_id: String(x.round_id),
    player_id: String(x.player_id),
    playing: x.playing === true,
    playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
  })) as RoundPlayerRow[];

  const rpKey = (rid: string, pid: string) => `${rid}:${pid}`;

  const rpByKey = new Map<string, RoundPlayerRow>();
  for (const rp of roundPlayersExisting) rpByKey.set(rpKey(rp.round_id, rp.player_id), rp);

  // 5) scores
  const { data: scoresData, error: scoresErr } = await supabase
    .from("scores")
    .select("round_id,player_id,hole_number,strokes,pickup")
    .in("round_id", roundIds)
    .in("player_id", playerIds);

  if (scoresErr) return { ok: false, error: scoresErr.message };
  const scores = (scoresData ?? []) as ScoreRow[];

  // scoreMap[round][player][hole] = "P" | "4" | ""
  const scoreMap: Record<string, Record<string, Record<number, string>>> = {};
  for (const s of scores) {
    const rid = String(s.round_id);
    const pid = String(s.player_id);
    const hole = Number(s.hole_number);
    if (!scoreMap[rid]) scoreMap[rid] = {};
    if (!scoreMap[rid][pid]) scoreMap[rid][pid] = {};
    scoreMap[rid][pid][hole] = rawScoreString(s);
  }

  // playingMap[round][player] = boolean (default false if missing)
  const playingMap: Record<string, Record<string, boolean>> = {};
  for (const r of rounds) playingMap[r.id] = {};
  for (const rp of roundPlayersExisting) {
    if (!playingMap[rp.round_id]) playingMap[rp.round_id] = {};
    playingMap[rp.round_id][rp.player_id] = rp.playing === true;
  }
  // ensure every player has an entry (default false)
  for (const r of rounds) {
    for (const p of players) {
      if (playingMap[r.id]?.[p.id] == null) playingMap[r.id][p.id] = false;
    }
  }

  function isRoundComplete(roundId: string): boolean {
    const playingPlayers = players.filter((pl) => playingMap[roundId]?.[pl.id] === true);
    if (playingPlayers.length === 0) return false;

    for (const pl of playingPlayers) {
      for (let hole = 1; hole <= 18; hole++) {
        const raw = scoreMap[roundId]?.[pl.id]?.[hole] ?? "";
        if (!raw) return false; // missing hole row or empty -> not complete
      }
    }
    return true;
  }

  if (onlyIfRoundCompleteId) {
    if (!isRoundComplete(onlyIfRoundCompleteId)) {
      return { ok: true, updated: 0 };
    }
  }

  // Starting handicap: tour override else global
  const startingHcpByPlayer: Record<string, number> = {};
  const teeByPlayer: Record<string, Tee> = {};
  for (const p of players) {
    const sh = p.tour_override_start ?? p.global_start ?? 0;
    startingHcpByPlayer[p.id] = Math.max(0, Math.floor(Number(sh) || 0));
    teeByPlayer[p.id] = p.gender ? normalizeTee(p.gender) : "M";
  }

  // PH per (round,player)
  const phByRoundPlayer: Record<string, Record<string, number>> = {};

  // init Round 1 PH = SH
  const r1 = rounds[0];
  phByRoundPlayer[r1.id] = {};
  for (const p of players) phByRoundPlayer[r1.id][p.id] = startingHcpByPlayer[p.id];

  const stablefordTotal = (roundId: string, courseId: string, playerId: string, ph: number): number => {
    const cid = String(courseId ?? "");
    if (!cid) return 0;

    const tee = teeByPlayer[playerId] ?? "M";
    const holeInfo = courseTeeHole[cid]?.[tee] ?? null;
    if (!holeInfo) return 0;

    let total = 0;
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

  // ✅ Upsert for ALL (round,player), preserving playing from existing rows
  const payload: Array<{ round_id: string; player_id: string; playing: boolean; playing_handicap: number }> = [];

  for (const r of rounds) {
    for (const p of players) {
      const key = rpKey(r.id, p.id);
      const existing = rpByKey.get(key);

      const playing = existing?.playing === true;
      const computed = phByRoundPlayer[r.id]?.[p.id];

      // If we computed it, use it. Else keep existing if present. Else default to starting.
      const ph =
        Number.isFinite(Number(computed)) ? Number(computed)
        : Number.isFinite(Number(existing?.playing_handicap)) ? Number(existing?.playing_handicap)
        : startingHcpByPlayer[p.id];

      payload.push({
        round_id: r.id,
        player_id: p.id,
        playing,
        playing_handicap: Math.max(0, Math.floor(ph)),
      });
    }
  }

  if (payload.length === 0) return { ok: true, updated: 0 };

  const { error: upErr } = await supabase.from("round_players").upsert(payload, {
    onConflict: "round_id,player_id",
  });

  if (upErr) return { ok: false, error: upErr.message };

  return { ok: true, updated: payload.length };
}
