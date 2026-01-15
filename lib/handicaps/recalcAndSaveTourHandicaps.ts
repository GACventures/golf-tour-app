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
  tee: Tee;
  hole_number: number;
  par: number;
  stroke_index: number;
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

  const g = (p as any).gender;
  const gender: Tee | null = g == null ? null : normalizeTee(g);

  return { id, name, start_handicap, gender };
}

function rawScoreString(s: ScoreRow): string {
  if ((s as any).pickup === true) return "P";
  if (s.strokes === null || s.strokes === undefined) return "";
  return String(s.strokes).trim().toUpperCase();
}

function dateKey(s: string | null): string {
  // for ordering: ISO date strings compare lexicographically
  return (s ?? "").trim();
}

export async function recalcAndSaveTourHandicaps(opts: {
  supabase: SupabaseClient;
  tourId: string;
  onlyIfRoundCompleteId?: string;
}): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const { supabase, tourId, onlyIfRoundCompleteId } = opts;

  // 0) respect tour flag
  const { data: tourRow, error: tourErr } = await supabase
    .from("tours")
    .select("id,rehandicapping_enabled")
    .eq("id", tourId)
    .maybeSingle();

  if (tourErr) return { ok: false, error: tourErr.message };
  if (tourRow && (tourRow as any).rehandicapping_enabled === false) {
    return { ok: true, updated: 0 };
  }

  // 1) load rounds (include round_no + played_on for stable ordering)
  const { data: roundsData, error: roundsErr } = await supabase
    .from("rounds")
    .select("id,tour_id,course_id,round_no,played_on,created_at")
    .eq("tour_id", tourId);

  if (roundsErr) return { ok: false, error: roundsErr.message };
  const roundsRaw = (roundsData ?? []) as Round[];
  if (roundsRaw.length === 0) return { ok: true, updated: 0 };

  // Stable sort: round_no, then played_on, then created_at
  const rounds = [...roundsRaw].sort((a, b) => {
    const an = a.round_no ?? 999999;
    const bn = b.round_no ?? 999999;
    if (an !== bn) return an - bn;

    const ap = dateKey(a.played_on);
    const bp = dateKey(b.played_on);
    if (ap !== bp) return ap.localeCompare(bp);

    const ac = dateKey(a.created_at);
    const bc = dateKey(b.created_at);
    return ac.localeCompare(bc);
  });

  const roundIds = rounds.map((r) => r.id);
  const courseIds = Array.from(new Set(rounds.map((r) => r.course_id).filter(Boolean))) as string[];

  // 2) players via tour_players join
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

      const overrideNum = Number(r.starting_handicap);
      const tour_starting_handicap = Number.isFinite(overrideNum) ? Math.max(0, Math.floor(overrideNum)) : null;

      return {
        id: pj.id,
        name: pj.name,
        gender: pj.gender ?? "M",
        global_start: pj.start_handicap ?? 0,
        tour_start: tour_starting_handicap,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    name: string;
    gender: Tee;
    global_start: number;
    tour_start: number | null;
  }>;

  if (players.length === 0) return { ok: true, updated: 0 };
  const playerIds = players.map((p) => p.id);

  // 3) pars (tee-aware)
  const { data: parsData, error: parsErr } = await supabase
    .from("pars")
    .select("course_id,tee,hole_number,par,stroke_index")
    .in("course_id", courseIds)
    .in("tee", ["M", "F"]);

  if (parsErr) return { ok: false, error: parsErr.message };
  const pars = (parsData ?? []) as any[];

  // Build course+tee hole map
  const holeMap: Record<string, Record<Tee, Record<number, { par: number; si: number }>>> = {};
  for (const row of pars) {
    const cid = String(row.course_id);
    const tee = normalizeTee(row.tee);
    const hole = Number(row.hole_number);
    const par = Number(row.par);
    const si = Number(row.stroke_index);

    if (!holeMap[cid]) holeMap[cid] = { M: {}, F: {} };
    holeMap[cid][tee][hole] = { par, si };
  }

  // 4) round_players (preserve playing flags)
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

  const rpByRoundPlayer = new Map<string, RoundPlayerRow>();
  for (const rp of roundPlayers) rpByRoundPlayer.set(`${rp.round_id}:${rp.player_id}`, rp);

  // 5) scores
  const { data: scoresData, error: scoresErr } = await supabase
    .from("scores")
    .select("round_id,player_id,hole_number,strokes,pickup")
    .in("round_id", roundIds)
    .in("player_id", playerIds);

  if (scoresErr) return { ok: false, error: scoresErr.message };
  const scores = (scoresData ?? []) as ScoreRow[];

  const playingMap: Record<string, Record<string, boolean>> = {};
  for (const rp of roundPlayers) {
    if (!playingMap[rp.round_id]) playingMap[rp.round_id] = {};
    playingMap[rp.round_id][rp.player_id] = rp.playing === true;
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

  if (onlyIfRoundCompleteId && !isRoundComplete(onlyIfRoundCompleteId)) {
    return { ok: true, updated: 0 };
  }

  // Starting handicap = tour override if set else global
  const startingHcpByPlayer: Record<string, number> = {};
  for (const p of players) {
    const sh = p.tour_start ?? p.global_start ?? 0;
    startingHcpByPlayer[p.id] = Math.max(0, Math.floor(Number(sh) || 0));
  }

  // PH by round/player
  const phByRoundPlayer: Record<string, Record<string, number>> = {};

  // Init Round 1 PH = SH
  const first = rounds[0];
  phByRoundPlayer[first.id] = {};
  for (const p of players) phByRoundPlayer[first.id][p.id] = startingHcpByPlayer[p.id];

  function stablefordTotal(roundId: string, courseId: string, playerId: string, ph: number, tee: Tee): number {
    const holes = holeMap[courseId]?.[tee];
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
  }

  // Sequential recalculation; stop at first incomplete round
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const next = rounds[i + 1] ?? null;

    // carry forward PH if missing
    if (!phByRoundPlayer[r.id]) {
      phByRoundPlayer[r.id] = {};
      const prev = rounds[i - 1];
      for (const p of players) {
        phByRoundPlayer[r.id][p.id] = phByRoundPlayer[prev.id]?.[p.id] ?? startingHcpByPlayer[p.id];
      }
    }

    if (!isRoundComplete(r.id)) break;

    // If course_id missing, we can’t compute stableford -> stop.
    if (!r.course_id) break;

    const playedScores: number[] = [];
    const scoreByPlayer: Record<string, number | null> = {};

    for (const p of players) {
      const played = playingMap[r.id]?.[p.id] === true;
      if (!played) {
        scoreByPlayer[p.id] = null;
        continue;
      }
      const ph = phByRoundPlayer[r.id][p.id];
      const sc = stablefordTotal(r.id, r.course_id, p.id, ph, p.gender);
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

  // ✅ Deterministic upsert for ALL (round, player)
  const payload = [];
  for (const r of rounds) {
    for (const p of players) {
      const key = `${r.id}:${p.id}`;
      const existing = rpByRoundPlayer.get(key);

      const playing = existing?.playing ?? false;
      const computed = phByRoundPlayer[r.id]?.[p.id];

      payload.push({
        round_id: r.id,
        player_id: p.id,
        playing,
        playing_handicap: Number.isFinite(Number(computed))
          ? Number(computed)
          : Number.isFinite(Number(existing?.playing_handicap))
          ? Number(existing?.playing_handicap)
          : startingHcpByPlayer[p.id],
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
