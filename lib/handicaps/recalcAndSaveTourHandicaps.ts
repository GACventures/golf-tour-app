import { netStablefordPointsForHole } from "@/lib/stableford";
import type { SupabaseClient } from "@supabase/supabase-js";

type Round = {
  id: string;
  tour_id: string;
  course_id: string;
  created_at: string | null;
};

type ParRow = {
  course_id: string;
  hole_number: number;
  par: number;
  stroke_index: number;
  tee: string; // "M" | "F"
};

type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number | null;
  tee: string; // NOT NULL in your schema
};

type TourPlayerJoinRow = {
  tour_id: string;
  player_id: string;
  starting_handicap: number | null; // from tour_players
  players: {
    id: string;
    name: string;
    gender: string | null; // players.gender
    start_handicap: number | null; // players.start_handicap
  } | null;
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

function toTeeFromGender(gender: string | null | undefined): "M" | "F" {
  const g = String(gender ?? "").trim().toUpperCase();
  // Treat anything starting with F as F, otherwise default M
  return g.startsWith("F") ? "F" : "M";
}

function numOrNull(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

  // 2) load tour players (global players) + starting handicap sources + gender
  const { data: tpData, error: tpErr } = await supabase
    .from("tour_players")
    .select("tour_id,player_id,starting_handicap,players(id,name,gender,start_handicap)")
    .eq("tour_id", tourId);

  if (tpErr) return { ok: false, error: tpErr.message };

  const tp = (tpData ?? []) as TourPlayerJoinRow[];

  const playerIds: string[] = [];
  const playerTeeById = new Map<string, "M" | "F">();
  const startingHcpById = new Map<string, number>();

  for (const row of tp) {
    const pid = String(row.players?.id ?? row.player_id);
    if (!pid) continue;

    playerIds.push(pid);

    const tee = toTeeFromGender(row.players?.gender ?? null);
    playerTeeById.set(pid, tee);

    // ✅ IMPORTANT: prefer tour_players.starting_handicap, else players.start_handicap
    const fromTourPlayers = numOrNull(row.starting_handicap);
    const fromPlayers = numOrNull(row.players?.start_handicap);

    const sh = (fromTourPlayers ?? fromPlayers ?? 0);
    // keep integer, non-negative
    startingHcpById.set(pid, Math.max(0, Math.floor(sh)));
  }

  // If no tour_players rows, nothing to do
  if (playerIds.length === 0) return { ok: true, updated: 0 };

  // 3) pars (tee-specific)
  const { data: parsData, error: parsErr } = await supabase
    .from("pars")
    .select("course_id,hole_number,par,stroke_index,tee")
    .in("course_id", courseIds);

  if (parsErr) return { ok: false, error: parsErr.message };
  const pars = (parsData ?? []) as ParRow[];

  // Build course -> tee -> hole -> {par, si}
  const courseTeeHole: Record<string, Record<string, Record<number, { par: number; si: number }>>> = {};
  for (const p of pars) {
    const cid = String(p.course_id);
    const tee = String(p.tee).trim().toUpperCase() || "M";
    if (!courseTeeHole[cid]) courseTeeHole[cid] = {};
    if (!courseTeeHole[cid][tee]) courseTeeHole[cid][tee] = {};
    courseTeeHole[cid][tee][p.hole_number] = { par: p.par, si: p.stroke_index };
  }

  // 4) round_players
  const { data: rpData, error: rpErr } = await supabase
    .from("round_players")
    .select("round_id,player_id,playing,playing_handicap,tee")
    .in("round_id", roundIds)
    .in("player_id", playerIds);

  if (rpErr) return { ok: false, error: rpErr.message };
  const roundPlayers = (rpData ?? []) as RoundPlayerRow[];

  // 5) scores
  const { data: scoresData, error: scoresErr } = await supabase
    .from("scores")
    .select("round_id,player_id,hole_number,strokes,pickup")
    .in("round_id", roundIds)
    .in("player_id", playerIds);

  if (scoresErr) return { ok: false, error: scoresErr.message };
  const scores = (scoresData ?? []) as ScoreRow[];

  // Build maps
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

  // init Round 1 PH = Starting Handicap
  const r1 = rounds[0];
  phByRoundPlayer[r1.id] = {};
  for (const pid of playerIds) phByRoundPlayer[r1.id][pid] = startingHcpById.get(pid) ?? 0;

  const stablefordTotal = (roundId: string, courseId: string, playerId: string, ph: number): number => {
    let total = 0;

    const tee = playerTeeById.get(playerId) ?? "M";
    const holeInfo = courseTeeHole[courseId]?.[tee];

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

    // carry forward if missing
    if (!phByRoundPlayer[r.id]) {
      phByRoundPlayer[r.id] = {};
      const prev = rounds[i - 1];
      for (const pid of playerIds) {
        phByRoundPlayer[r.id][pid] = phByRoundPlayer[prev.id]?.[pid] ?? (startingHcpById.get(pid) ?? 0);
      }
    }

    // stop at first incomplete round
    if (!isRoundComplete(r.id)) break;

    // scores for players who played
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

        const sh = startingHcpById.get(pid) ?? 0;
        const max = sh + 3;
        const min = ceilHalfStart(sh);

        phByRoundPlayer[next.id][pid] = clamp(raw, min, max);
      }
    }
  }

  // ✅ Upsert payload for existing round_players rows:
  //    - preserve playing
  //    - set playing_handicap
  //    - ensure tee is populated (NOT NULL)
  const payload = roundPlayers.map((rp) => {
    const tee = (rp.tee ?? "").trim().toUpperCase() || (playerTeeById.get(rp.player_id) ?? "M");
    const ph = phByRoundPlayer[rp.round_id]?.[rp.player_id];

    return {
      round_id: rp.round_id,
      player_id: rp.player_id,
      playing: rp.playing,
      tee,
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
