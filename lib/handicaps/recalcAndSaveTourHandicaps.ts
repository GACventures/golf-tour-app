// lib/handicaps/recalcAndSaveTourHandicaps.ts
import { netStablefordPointsForHole } from "@/lib/stableford";
import type { SupabaseClient } from "@supabase/supabase-js";

type Tee = "M" | "F";

type Round = { id: string; tour_id: string; course_id: string; created_at: string | null };

type ParRow = {
  course_id: string;
  hole_number: number;
  par: number;
  stroke_index: number;
  tee: Tee;
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
  tee: Tee;
};

type PlayerRow = {
  id: string;
  name: string;
  gender: string | null;
  start_handicap: number | null;
};

type TourPlayerJoinRow = {
  tour_id: string;
  player_id: string;
  starting_handicap: number | null; // exists in tour_players, but may be 0 / not what you want
  players: PlayerRow | PlayerRow[] | null;
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

function teeFromGender(gender: string | null | undefined): Tee {
  const g = String(gender ?? "").trim().toUpperCase();
  return g === "F" ? "F" : "M";
}

function startingHandicapFromPlayerRow(p: PlayerRow): number {
  // ✅ Use players.start_handicap as the source of truth (your Kiwi Madness issue)
  const v = Number((p as any).start_handicap);
  if (Number.isFinite(v)) return Math.max(0, Math.floor(v));
  return 0;
}

function rawScoreString(s: ScoreRow): string {
  const isPickup = (s as any).pickup === true;
  if (isPickup) return "P";
  if (s.strokes === null || s.strokes === undefined) return "";
  return String(s.strokes).trim().toUpperCase();
}

function onePlayer(row: TourPlayerJoinRow): PlayerRow | null {
  const rel: any = row.players;
  if (!rel) return null;
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel as PlayerRow;
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
  const courseIds = Array.from(new Set(rounds.map((r) => r.course_id).filter(Boolean)));

  // 2) load tour players (and their global player fields)
  // IMPORTANT: players(...) may come back as object OR array, so type allows both.
  const { data: tpData, error: tpErr } = await supabase
    .from("tour_players")
    .select("tour_id,player_id,starting_handicap,players(id,name,gender,start_handicap)")
    .eq("tour_id", tourId);

  if (tpErr) return { ok: false, error: tpErr.message };

  const tp = (tpData ?? []) as unknown as TourPlayerJoinRow[];

  const players: PlayerRow[] = [];
  for (const row of tp) {
    const p = onePlayer(row);
    if (!p?.id) continue;
    players.push({
      id: String(p.id),
      name: String(p.name ?? ""),
      gender: p.gender === null || p.gender === undefined ? null : String(p.gender),
      start_handicap: Number.isFinite(Number((p as any).start_handicap)) ? Number((p as any).start_handicap) : null,
    });
  }

  // Fallback: if tour_players join yields nothing (shouldn’t happen), we stop safely.
  if (players.length === 0) return { ok: true, updated: 0 };

  const playerIds = players.map((p) => p.id);

  // Maps
  const startingHcpByPlayer: Record<string, number> = {};
  const teeByPlayer: Record<string, Tee> = {};
  for (const p of players) {
    startingHcpByPlayer[p.id] = startingHandicapFromPlayerRow(p);
    teeByPlayer[p.id] = teeFromGender(p.gender);
  }

  // 3) pars (now tee-specific)
  const { data: parsData, error: parsErr } = await supabase
    .from("pars")
    .select("course_id,hole_number,par,stroke_index,tee")
    .in("course_id", courseIds);

  if (parsErr) return { ok: false, error: parsErr.message };

  const pars = (parsData ?? []) as any[];

  // course -> tee -> hole -> {par, si}
  const courseTeeHole: Record<string, Record<Tee, Record<number, { par: number; si: number }>>> = {};
  for (const row of pars) {
    const cid = String(row.course_id);
    const tee = String(row.tee).toUpperCase() === "F" ? ("F" as Tee) : ("M" as Tee);
    const hole = Number(row.hole_number);
    const par = Number(row.par);
    const si = Number(row.stroke_index);

    if (!courseTeeHole[cid]) courseTeeHole[cid] = { M: {}, F: {} };
    courseTeeHole[cid][tee][hole] = { par, si };
  }

  // 4) round_players (must exist; includes tee which is NOT NULL)
  const { data: rpData, error: rpErr } = await supabase
    .from("round_players")
    .select("round_id,player_id,playing,playing_handicap,tee")
    .in("round_id", roundIds)
    .in("player_id", playerIds);

  if (rpErr) return { ok: false, error: rpErr.message };

  const roundPlayers = (rpData ?? []) as any[];

  // 5) scores
  const { data: scoresData, error: scoresErr } = await supabase
    .from("scores")
    .select("round_id,player_id,hole_number,strokes,pickup")
    .in("round_id", roundIds)
    .in("player_id", playerIds);

  if (scoresErr) return { ok: false, error: scoresErr.message };

  const scores = (scoresData ?? []) as any[];

  // Build maps
  const playingMap: Record<string, Record<string, boolean>> = {};
  for (const rp of roundPlayers) {
    const rid = String(rp.round_id);
    const pid = String(rp.player_id);
    if (!playingMap[rid]) playingMap[rid] = {};
    playingMap[rid][pid] = rp.playing === true;
  }

  const scoreMap: Record<string, Record<string, Record<number, string>>> = {};
  for (const s of scores) {
    const rid = String(s.round_id);
    const pid = String(s.player_id);
    const hole = Number(s.hole_number);
    if (!scoreMap[rid]) scoreMap[rid] = {};
    if (!scoreMap[rid][pid]) scoreMap[rid][pid] = {};
    scoreMap[rid][pid][hole] = rawScoreString(s as ScoreRow);
  }

  function isRoundComplete(roundId: string): boolean {
    const playingPlayers = playerIds.filter((pid) => playingMap[roundId]?.[pid] === true);
    if (playingPlayers.length === 0) return false;

    for (const pid of playingPlayers) {
      for (let hole = 1; hole <= 18; hole++) {
        const raw = scoreMap[roundId]?.[pid]?.[hole] ?? "";
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

  // Compute sequentially; stop at first incomplete round
  const phByRoundPlayer: Record<string, Record<string, number>> = {};

  // Round 1 PH = SH
  const r1 = rounds[0];
  phByRoundPlayer[r1.id] = {};
  for (const pid of playerIds) phByRoundPlayer[r1.id][pid] = startingHcpByPlayer[pid] ?? 0;

  const stablefordTotal = (roundId: string, courseId: string, playerId: string, ph: number): number => {
    const tee = teeByPlayer[playerId] ?? "M";
    const holeInfo = courseTeeHole[courseId]?.[tee];

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

  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const next = rounds[i + 1] ?? null;

    // Ensure current PH map exists (carry forward)
    if (!phByRoundPlayer[r.id]) {
      phByRoundPlayer[r.id] = {};
      const prev = rounds[i - 1];
      for (const pid of playerIds) {
        phByRoundPlayer[r.id][pid] = phByRoundPlayer[prev.id]?.[pid] ?? (startingHcpByPlayer[pid] ?? 0);
      }
    }

    // If this round incomplete, stop updating beyond it
    if (!isRoundComplete(r.id)) break;

    // compute scores for players who played
    const playedScores: number[] = [];
    const scoreByPlayer: Record<string, number | null> = {};

    for (const pid of playerIds) {
      const played = playingMap[r.id]?.[pid] === true;
      if (!played) {
        scoreByPlayer[pid] = null;
        continue;
      }
      const ph = phByRoundPlayer[r.id][pid];
      const sc = stablefordTotal(r.id, r.course_id, pid, ph);
      scoreByPlayer[pid] = sc;
      playedScores.push(sc);
    }

    const avgRounded =
      playedScores.length > 0
        ? roundHalfUp(playedScores.reduce((s, v) => s + v, 0) / playedScores.length)
        : null;

    if (next) {
      phByRoundPlayer[next.id] = {};
      for (const pid of playerIds) {
        const prevPH = phByRoundPlayer[r.id][pid];
        const playedPrev = playingMap[r.id]?.[pid] === true;

        if (!playedPrev || avgRounded === null) {
          phByRoundPlayer[next.id][pid] = prevPH;
          continue;
        }

        const prevScore = scoreByPlayer[pid];
        if (prevScore === null) {
          phByRoundPlayer[next.id][pid] = prevPH;
          continue;
        }

        const diff = (avgRounded - prevScore) / 3;
        const raw = roundHalfUp(prevPH + diff);

        const sh = startingHcpByPlayer[pid] ?? 0;
        const max = sh + 3;
        const min = ceilHalfStart(sh);

        phByRoundPlayer[next.id][pid] = clamp(raw, min, max);
      }
    }
  }

  // Upsert payload for existing round_players rows (preserve playing flag)
  // ✅ Must include tee because round_players.tee is NOT NULL
  const payload = (roundPlayers ?? []).map((rp: any) => {
    const rid = String(rp.round_id);
    const pid = String(rp.player_id);
    const ph = phByRoundPlayer[rid]?.[pid];

    return {
      round_id: rid,
      player_id: pid,
      playing: rp.playing === true,
      tee: teeByPlayer[pid] ?? "M",
      playing_handicap: Number.isFinite(Number(ph)) ? Number(ph) : Number(rp.playing_handicap ?? 0),
    };
  });

  if (payload.length === 0) return { ok: true, updated: 0 };

  const { error: upErr } = await supabase.from("round_players").upsert(payload, {
    onConflict: "round_id,player_id",
  });

  if (upErr) return { ok: false, error: upErr.message };

  return { ok: true, updated: payload.length };
}
