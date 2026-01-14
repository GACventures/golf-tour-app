import { netStablefordPointsForHole } from "@/lib/stableford";
import type { SupabaseClient } from "@supabase/supabase-js";

type Round = { id: string; tour_id: string; course_id: string | null; created_at: string | null };

type ParRow = {
  course_id: string;
  hole_number: number;
  par: number;
  stroke_index: number;
  tee: string; // "M" | "F" (or other values if you ever add them)
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
  tee: string; // NOT NULL in your schema
};

type TourPlayerRow = {
  player_id: string;
  starting_handicap: number;
  players?: { gender: string | null; name?: string | null } | null;
};

function roundHalfUp(x: number): number {
  // .5 rounds up (works for negatives too)
  return x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
}

function ceilHalfStart(sh: number): number {
  // MIN = ceil(SH/2)
  return Math.ceil(sh / 2);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function normalizeTeeFromGender(gender: string | null | undefined): "M" | "F" {
  const g = String(gender ?? "").trim().toLowerCase();
  if (!g) return "M"; // safe default
  if (g === "f" || g === "female" || g.startsWith("f")) return "F";
  return "M";
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

  // 1) Load rounds
  const { data: roundsData, error: roundsErr } = await supabase
    .from("rounds")
    .select("id,tour_id,course_id,created_at")
    .eq("tour_id", tourId)
    .order("created_at", { ascending: true });

  if (roundsErr) return { ok: false, error: roundsErr.message };

  const rounds = (roundsData ?? []) as Round[];
  if (rounds.length === 0) return { ok: true, updated: 0 };

  const roundIds = rounds.map((r) => r.id);
  const courseIds = Array.from(new Set(rounds.map((r) => r.course_id).filter(Boolean))) as string[];

  // 2) Load tour players (starting handicap comes from tour_players) + gender from players
  const { data: tpData, error: tpErr } = await supabase
    .from("tour_players")
    .select("player_id, starting_handicap, players(gender,name)")
    .eq("tour_id", tourId);

  if (tpErr) return { ok: false, error: tpErr.message };

  const tourPlayers = (tpData ?? []) as any as TourPlayerRow[];
  const playerIds = tourPlayers.map((x) => String(x.player_id)).filter(Boolean);

  if (playerIds.length === 0) return { ok: true, updated: 0 };

  const startingHcpByPlayer: Record<string, number> = {};
  const teeByPlayer: Record<string, "M" | "F"> = {};
  for (const row of tourPlayers) {
    const pid = String(row.player_id);
    const sh = Number.isFinite(Number(row.starting_handicap)) ? Number(row.starting_handicap) : 0;
    startingHcpByPlayer[pid] = Math.max(0, Math.floor(sh));

    const gender = row.players?.gender ?? null;
    teeByPlayer[pid] = normalizeTeeFromGender(gender);
  }

  // 3) Load pars (tee-specific)
  const { data: parsData, error: parsErr } = await supabase
    .from("pars")
    .select("course_id,hole_number,par,stroke_index,tee")
    .in("course_id", courseIds);

  if (parsErr) return { ok: false, error: parsErr.message };
  const pars = (parsData ?? []) as ParRow[];

  // course -> tee -> hole -> {par, si}
  const courseTeeHole: Record<string, Record<string, Record<number, { par: number; si: number }>>> = {};
  for (const p of pars) {
    const cid = String(p.course_id);
    const tee = String(p.tee);
    const hole = Number(p.hole_number);
    if (!courseTeeHole[cid]) courseTeeHole[cid] = {};
    if (!courseTeeHole[cid][tee]) courseTeeHole[cid][tee] = {};
    courseTeeHole[cid][tee][hole] = { par: Number(p.par), si: Number(p.stroke_index) };
  }

  // 4) Load round_players (include tee because NOT NULL)
  const { data: rpData, error: rpErr } = await supabase
    .from("round_players")
    .select("round_id,player_id,playing,playing_handicap,tee")
    .in("round_id", roundIds)
    .in("player_id", playerIds);

  if (rpErr) return { ok: false, error: rpErr.message };
  const roundPlayers = (rpData ?? []) as any as RoundPlayerRow[];

  // 5) Load scores
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

  // Compute sequentially; stop at first incomplete round (keeps PH stable beyond it)
  const phByRoundPlayer: Record<string, Record<string, number>> = {};

  // init Round 1 PH = tour_players.starting_handicap
  const r1 = rounds[0];
  phByRoundPlayer[r1.id] = {};
  for (const pid of playerIds) phByRoundPlayer[r1.id][pid] = startingHcpByPlayer[pid] ?? 0;

  function stablefordTotal(roundId: string, courseId: string, playerId: string, ph: number): number {
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
  }

  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const next = rounds[i + 1] ?? null;

    if (!r.course_id) {
      // If no course, we can't calculate stableford; just carry forward
      if (next) {
        phByRoundPlayer[next.id] = {};
        for (const pid of playerIds) {
          const prevPH = phByRoundPlayer[r.id]?.[pid] ?? startingHcpByPlayer[pid] ?? 0;
          phByRoundPlayer[next.id][pid] = prevPH;
        }
      }
      continue;
    }

    // ensure current PH map exists (carry forward if missing)
    if (!phByRoundPlayer[r.id]) {
      phByRoundPlayer[r.id] = {};
      const prev = rounds[i - 1];
      for (const pid of playerIds) {
        phByRoundPlayer[r.id][pid] = phByRoundPlayer[prev.id]?.[pid] ?? startingHcpByPlayer[pid] ?? 0;
      }
    }

    // if this round incomplete, stop updating beyond it
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
      const ph = phByRoundPlayer[r.id][pid] ?? (startingHcpByPlayer[pid] ?? 0);
      const sc = stablefordTotal(r.id, String(r.course_id), pid, ph);
      scoreByPlayer[pid] = sc;
      playedScores.push(sc);
    }

    const avgRounded =
      playedScores.length > 0 ? roundHalfUp(playedScores.reduce((s, v) => s + v, 0) / playedScores.length) : null;

    if (next) {
      phByRoundPlayer[next.id] = {};

      for (const pid of playerIds) {
        const prevPH = phByRoundPlayer[r.id][pid] ?? (startingHcpByPlayer[pid] ?? 0);
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

        // Rehandicap rule
        const diff = (avgRounded - prevScore) / 3;
        const raw = roundHalfUp(prevPH + diff);

        const sh = startingHcpByPlayer[pid] ?? 0;
        const max = sh + 3;
        const min = ceilHalfStart(sh);

        phByRoundPlayer[next.id][pid] = clamp(raw, min, max);
      }
    }
  }

  // Upsert payload for round_players (preserve playing flag, and ALWAYS include tee because NOT NULL)
  // If a row is missing tee for any reason, we derive it from player gender.
  const payload = roundPlayers.map((rp) => {
    const ph = phByRoundPlayer[rp.round_id]?.[rp.player_id];
    const tee = (rp.tee && String(rp.tee).trim()) || teeByPlayer[rp.player_id] || "M";

    return {
      round_id: rp.round_id,
      player_id: rp.player_id,
      playing: rp.playing,
      playing_handicap: Number.isFinite(ph as any) ? (ph as number) : rp.playing_handicap ?? 0,
      tee,
    };
  });

  if (payload.length === 0) return { ok: true, updated: 0 };

  const { error: upErr } = await supabase.from("round_players").upsert(payload, {
    onConflict: "round_id,player_id",
  });

  if (upErr) return { ok: false, error: upErr.message };

  return { ok: true, updated: payload.length };
}
