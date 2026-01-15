// lib/handicaps/recalcAndSaveTourHandicaps.ts
import { netStablefordPointsForHole } from "@/lib/stableford";
import type { SupabaseClient } from "@supabase/supabase-js";

type Tee = "M" | "F";

type Tour = {
  id: string;
  rehandicapping_enabled: boolean | null;
  rehandicapping_rule_key: string | null;
};

type Round = {
  id: string;
  tour_id: string;
  course_id: string | null;
  round_no: number | null;
  created_at: string | null;
};

type ParRow = {
  course_id: string;
  hole_number: number;
  par: number | null;
  stroke_index: number | null;
  tee?: Tee | null; // optional (older schema may not have)
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
  playing: boolean | null;
  playing_handicap: number | null;
};

type TourPlayerJoinRow = {
  tour_id: string;
  player_id: string;
  starting_handicap: number | null; // tour override (nullable)
  players: {
    id: string;
    name: string;
    start_handicap: number | null;
    gender?: Tee | null;
  } | null;
};

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function roundHalfUp(x: number): number {
  return x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
}

function ceilHalfStart(sh: number): number {
  return Math.ceil(sh / 2);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
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

  // 0) Tour flags (do nothing unless enabled + rule key present)
  const { data: tourData, error: tourErr } = await supabase
    .from("tours")
    .select("id,rehandicapping_enabled,rehandicapping_rule_key")
    .eq("id", tourId)
    .maybeSingle();

  if (tourErr) return { ok: false, error: tourErr.message };
  const tour = (tourData ?? null) as Tour | null;

  if (!tour) return { ok: false, error: "Tour not found." };

  const enabled = tour.rehandicapping_enabled === true;
  const ruleKey = String(tour.rehandicapping_rule_key ?? "").trim();

  // If disabled or no key, don't mutate round_players
  if (!enabled || !ruleKey) return { ok: true, updated: 0 };

  // 1) load rounds
  const { data: roundsData, error: roundsErr } = await supabase
    .from("rounds")
    .select("id,tour_id,course_id,round_no,created_at")
    .eq("tour_id", tourId)
    .order("round_no", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (roundsErr) return { ok: false, error: roundsErr.message };
  const rounds = (roundsData ?? []) as Round[];
  if (rounds.length === 0) return { ok: true, updated: 0 };

  const roundIds = rounds.map((r) => r.id);
  const courseIds = Array.from(new Set(rounds.map((r) => r.course_id).filter(Boolean))) as string[];

  // 2) load players in tour via tour_players join (GLOBAL players)
  const { data: tpData, error: tpErr } = await supabase
    .from("tour_players")
    .select("tour_id,player_id,starting_handicap, players(id,name,start_handicap,gender)")
    .eq("tour_id", tourId)
    .order("name", { ascending: true, foreignTable: "players" });

  if (tpErr) return { ok: false, error: tpErr.message };

  const tourPlayers = (tpData ?? []) as TourPlayerJoinRow[];
  const playerIds = tourPlayers
    .map((r) => String(r.players?.id ?? r.player_id ?? "").trim())
    .filter(Boolean);

  if (playerIds.length === 0) return { ok: true, updated: 0 };

  const playerNameById: Record<string, string> = {};
  const teeByPlayerId: Record<string, Tee> = {};
  const startingHcpByPlayerId: Record<string, number> = {};

  for (const row of tourPlayers) {
    const pid = String(row.players?.id ?? row.player_id ?? "").trim();
    if (!pid) continue;

    const globalStart = Number(row.players?.start_handicap);
    const tourStart = Number(row.starting_handicap);

    const sh =
      Number.isFinite(tourStart) ? Math.max(0, Math.floor(tourStart)) : Number.isFinite(globalStart) ? Math.max(0, Math.floor(globalStart)) : 0;

    startingHcpByPlayerId[pid] = sh;
    playerNameById[pid] = String(row.players?.name ?? "(unnamed)");
    teeByPlayerId[pid] = normalizeTee(row.players?.gender);
  }

  // 3) pars (support tee-based schema; if tee missing, treat as "M" and use for both)
  // We attempt to fetch tee; if your pars table doesn't have it, Supabase will error.
  let pars: ParRow[] = [];
  {
    const { data: parsData, error: parsErr } = await supabase
      .from("pars")
      .select("course_id,hole_number,par,stroke_index,tee")
      .in("course_id", courseIds);

    if (!parsErr) {
      pars = (parsData ?? []) as ParRow[];
    } else {
      // fallback for older schema without tee
      const { data: parsData2, error: parsErr2 } = await supabase
        .from("pars")
        .select("course_id,hole_number,par,stroke_index")
        .in("course_id", courseIds);

      if (parsErr2) return { ok: false, error: parsErr2.message };
      pars = ((parsData2 ?? []) as any[]).map((p) => ({ ...p, tee: null })) as ParRow[];
    }
  }

  // 4) round_players (existing rows)
  const { data: rpData, error: rpErr } = await supabase
    .from("round_players")
    .select("round_id,player_id,playing,playing_handicap")
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

  // -------------------- Build maps --------------------

  // course -> tee -> hole -> { par, si }
  const courseHoleByTee: Record<string, Record<Tee, Record<number, { par: number; si: number }>>> = {};
  for (const pr of pars) {
    const cid = String(pr.course_id ?? "").trim();
    if (!cid) continue;

    const hole = Number(pr.hole_number);
    const par = Number(pr.par);
    const si = Number(pr.stroke_index);
    if (!Number.isFinite(hole) || hole < 1 || hole > 18) continue;
    if (!Number.isFinite(par) || !Number.isFinite(si)) continue;

    const tee = pr.tee ? normalizeTee(pr.tee) : "M";

    if (!courseHoleByTee[cid]) courseHoleByTee[cid] = { M: {}, F: {} };
    courseHoleByTee[cid][tee][hole] = { par, si };

    // If tee is missing in schema (we set null -> "M"), copy to F too so women still work
    if (!pr.tee) {
      courseHoleByTee[cid]["F"][hole] = { par, si };
    }
  }

  // round -> player -> playing
  const playingMap: Record<string, Record<string, boolean>> = {};
  // round -> player -> previous stored PH (if any)
  const existingPH: Record<string, Record<string, number | null>> = {};
  for (const rp of roundPlayers) {
    const rid = String(rp.round_id);
    const pid = String(rp.player_id);
    if (!playingMap[rid]) playingMap[rid] = {};
    if (!existingPH[rid]) existingPH[rid] = {};
    playingMap[rid][pid] = rp.playing === true;
    existingPH[rid][pid] = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : null;
  }

  // round -> player -> hole -> rawScore
  const scoreMap: Record<string, Record<string, Record<number, string>>> = {};
  for (const s of scores) {
    const rid = String(s.round_id);
    const pid = String(s.player_id);
    const hole = Number(s.hole_number);
    if (!Number.isFinite(hole)) continue;

    if (!scoreMap[rid]) scoreMap[rid] = {};
    if (!scoreMap[rid][pid]) scoreMap[rid][pid] = {};
    scoreMap[rid][pid][hole] = rawScoreString(s);
  }

  // Helper: which players are "playing" in a round (based on round_players.playing)
  const playingPlayerIdsForRound = (roundId: string): string[] => {
    const m = playingMap[roundId] ?? {};
    const ids = Object.entries(m)
      .filter(([, v]) => v === true)
      .map(([pid]) => pid);
    return ids;
  };

  function isRoundComplete(roundId: string): boolean {
    const ids = playingPlayerIdsForRound(roundId);
    if (ids.length === 0) return false;

    for (const pid of ids) {
      for (let hole = 1; hole <= 18; hole++) {
        const raw = (scoreMap[roundId]?.[pid]?.[hole] ?? "").trim();
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

  // Stableford total for a player in a round using their tee + PH
  const stablefordTotal = (roundId: string, courseId: string, playerId: string, ph: number): number => {
    if (!courseId) return 0;

    const tee = teeByPlayerId[playerId] ?? "M";
    const holeInfo = courseHoleByTee[courseId]?.[tee] ?? {};
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

  // -------------------- Compute PH across rounds --------------------

  // phByRoundPlayer[roundId][playerId] = computed PH for that round
  const phByRoundPlayer: Record<string, Record<string, number>> = {};

  // Init Round 1 PH = Starting Handicap (tour starting if set, else global)
  const r1 = rounds[0];
  phByRoundPlayer[r1.id] = {};
  for (const pid of playerIds) {
    phByRoundPlayer[r1.id][pid] = startingHcpByPlayerId[pid] ?? 0;
  }

  // Sequentially compute; stop at first incomplete round (keeps PH stable beyond it)
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const next = rounds[i + 1] ?? null;

    // Ensure current PH map exists (carry forward from prev if missing)
    if (!phByRoundPlayer[r.id]) {
      phByRoundPlayer[r.id] = {};
      const prev = rounds[i - 1];
      for (const pid of playerIds) {
        phByRoundPlayer[r.id][pid] = phByRoundPlayer[prev.id]?.[pid] ?? startingHcpByPlayerId[pid] ?? 0;
      }
    }

    // If this round incomplete, stop updating beyond it
    if (!isRoundComplete(r.id)) break;

    const courseId = String(r.course_id ?? "").trim();
    if (!courseId) {
      // If no course, can't compute; stop updating beyond it
      break;
    }

    // compute stableford for players who played
    const playedIds = playingPlayerIdsForRound(r.id);
    const playedScores: number[] = [];
    const scoreByPlayer: Record<string, number | null> = {};

    for (const pid of playerIds) {
      const played = playedIds.includes(pid);
      if (!played) {
        scoreByPlayer[pid] = null;
        continue;
      }
      const ph = phByRoundPlayer[r.id][pid];
      const sc = stablefordTotal(r.id, courseId, pid, ph);
      scoreByPlayer[pid] = sc;
      playedScores.push(sc);
    }

    const avgRounded =
      playedScores.length > 0 ? roundHalfUp(playedScores.reduce((s, v) => s + v, 0) / playedScores.length) : null;

    if (next) {
      phByRoundPlayer[next.id] = {};
      for (const pid of playerIds) {
        const prevPH = phByRoundPlayer[r.id][pid];
        const playedPrev = playedIds.includes(pid);

        // If player didn't play, carry forward
        if (!playedPrev || avgRounded === null) {
          phByRoundPlayer[next.id][pid] = prevPH;
          continue;
        }

        const prevScore = scoreByPlayer[pid];
        if (prevScore === null) {
          phByRoundPlayer[next.id][pid] = prevPH;
          continue;
        }

        // Rule: PH_next = PH_prev + (avg - playerScore)/3, rounded half up
        const diff = (avgRounded - prevScore) / 3;
        const proposed = roundHalfUp(prevPH + diff);

        const sh = startingHcpByPlayerId[pid] ?? 0;
        const max = sh + 3;
        const min = ceilHalfStart(sh);

        phByRoundPlayer[next.id][pid] = clamp(proposed, min, max);
      }
    }
  }

  // -------------------- Upsert round_players for ALL round/player combos --------------------

  // Existing playing flags (preserve)
  const existingPlaying: Record<string, Record<string, boolean>> = {};
  for (const rp of roundPlayers) {
    const rid = String(rp.round_id);
    const pid = String(rp.player_id);
    if (!existingPlaying[rid]) existingPlaying[rid] = {};
    existingPlaying[rid][pid] = rp.playing === true;
  }

  const payload: Array<{ round_id: string; player_id: string; playing: boolean; playing_handicap: number }> = [];

  for (const r of rounds) {
    for (const pid of playerIds) {
      const ph =
        phByRoundPlayer[r.id]?.[pid] ??
        // if somehow missing, fall back to existing PH, else starting handicap
        existingPH[r.id]?.[pid] ??
        startingHcpByPlayerId[pid] ??
        0;

      payload.push({
        round_id: r.id,
        player_id: pid,
        playing: existingPlaying[r.id]?.[pid] ?? false,
        playing_handicap: Number.isFinite(Number(ph)) ? Number(ph) : 0,
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
