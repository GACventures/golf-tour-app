// lib/competitions/buildTourCompetitionContext.ts
import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

import { resolveEntities, type LeaderboardEntity } from "@/lib/competitions/entities/resolveEntities";

// Keep tee consistent with your schema
type Tee = "M" | "F";

type Tour = { id: string; name: string };

type RoundRow = {
  id: string;
  tour_id: string;
  name: string | null;
  round_no: number | null;
  created_at: string | null;
  course_id: string | null;
};

type PlayerRow = {
  id: string;
  name: string;
  gender?: Tee | null;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number | null;
};

type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean | null;
};

type ParRow = {
  course_id: string;
  hole_number: number;
  tee: Tee;
  par: number;
  stroke_index: number;
};

export type TourRoundContext = {
  roundId: string;
  roundName: string;

  holes: number[]; // [1..18]

  // Baseline arrays (kept for compatibility)
  parsByHole: number[]; // length 18 (baseline; not used for tee-specific bucketing anymore)
  strokeIndexByHole: number[]; // length 18 (baseline)

  scores: Record<string, string[]>; // playerId -> 18 raw strings
  netPointsForHole: (playerId: string, holeIndex: number) => number;
  isComplete: (playerId: string) => boolean;

  // ✅ NEW: tee-specific par for bucketing (Napoleon/Big George/Grand Canyon)
  parForPlayerHole: (playerId: string, holeIndex: number) => number;
};

export type TourCompetitionContext = {
  scope: "tour";
  players: Array<{
    id: string;
    name: string;
    playing: boolean;
    playing_handicap: number;
  }>;
  rounds: TourRoundContext[];

  // Pair/team support
  entities?: Array<{ entityId: string; label: string; memberPlayerIds: string[] }>;
  entityMembersById?: Record<string, string[]>;
  entityLabelsById?: Record<string, string>;
  team_best_m?: number;
};

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function safeName(v: any, fallback: string) {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function normalizeRawScore(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  const n = Number(strokes);
  return Number.isFinite(n) ? String(n) : "";
}

function upper(s: any) {
  return String(s ?? "").trim().toUpperCase();
}

function clampInt(n: any, min: number, max: number) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

export async function buildTourCompetitionContext(params: {
  tourId: string;
  includeIncompleteRounds: boolean;
  kindForEntities?: "individual" | "pair" | "team";
}): Promise<{
  ctx: TourCompetitionContext;
  tourName: string;
  rounds: RoundRow[];
  players: PlayerRow[];
  eligibleRoundIds: string[];
  entities: LeaderboardEntity[];
  entitiesError?: string;
}> {
  const { tourId, includeIncompleteRounds, kindForEntities = "individual" } = params;

  if (!tourId || !isLikelyUuid(tourId)) {
    throw new Error("Missing or invalid tourId");
  }

  // --- Load tour ---
  const { data: tData, error: tErr } = await supabase.from("tours").select("id,name").eq("id", tourId).single();
  if (tErr) throw tErr;
  const tour = tData as Tour;

  // --- Load rounds ---
  const { data: rData, error: rErr } = await supabase
    .from("rounds")
    .select("id,tour_id,name,round_no,created_at,course_id")
    .eq("tour_id", tourId)
    .order("round_no", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (rErr) throw rErr;
  const rounds = (rData ?? []) as RoundRow[];

  // --- Load players in tour (with gender) ---
  const { data: tpData, error: tpErr } = await supabase
    .from("tour_players")
    .select("tour_id,player_id,starting_handicap,players(id,name,gender)")
    .eq("tour_id", tourId)
    .order("name", { ascending: true, foreignTable: "players" });

  if (tpErr) throw tpErr;

  const players: PlayerRow[] = (tpData ?? [])
    .map((row: any) => row.players)
    .filter(Boolean)
    .map((p: any) => ({
      id: String(p.id),
      name: safeName(p.name, "(unnamed)"),
      gender: p.gender ? normalizeTee(p.gender) : null,
    }));

  const roundIds = rounds.map((r) => r.id);
  const playerIds = players.map((p) => p.id);

  // --- Load round_players (playing + playing_handicap) ---
  let roundPlayers: RoundPlayerRow[] = [];
  if (roundIds.length && playerIds.length) {
    const { data: rpData, error: rpErr } = await supabase
      .from("round_players")
      .select("round_id,player_id,playing,playing_handicap")
      .in("round_id", roundIds)
      .in("player_id", playerIds);

    if (rpErr) throw rpErr;

    roundPlayers = (rpData ?? []).map((x: any) => ({
      round_id: String(x.round_id),
      player_id: String(x.player_id),
      playing: x.playing === true,
      playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
    }));
  }

  // --- Load scores ---
  let scores: ScoreRow[] = [];
  if (roundIds.length && playerIds.length) {
    const { data: sData, error: sErr } = await supabase
      .from("scores")
      .select("round_id,player_id,hole_number,strokes,pickup")
      .in("round_id", roundIds)
      .in("player_id", playerIds);

    if (sErr) throw sErr;
    scores = (sData ?? []) as ScoreRow[];
  }

  // --- Load pars (both tees) ---
  const courseIds = Array.from(new Set(rounds.map((r) => r.course_id).filter(Boolean))) as string[];
  let pars: ParRow[] = [];
  if (courseIds.length) {
    const { data: pData, error: pErr } = await supabase
      .from("pars")
      .select("course_id,hole_number,tee,par,stroke_index")
      .in("course_id", courseIds)
      .in("tee", ["M", "F"])
      .order("course_id", { ascending: true })
      .order("hole_number", { ascending: true });

    if (pErr) throw pErr;

    pars = (pData ?? []).map((x: any) => ({
      course_id: String(x.course_id),
      hole_number: Number(x.hole_number),
      tee: normalizeTee(x.tee),
      par: Number(x.par),
      stroke_index: Number(x.stroke_index),
    }));
  }

  // --- Settings for team_best_m (optional) ---
  let teamBestM = 2;
  try {
    const { data: sData } = await supabase
      .from("tour_grouping_settings")
      .select("default_team_best_m")
      .eq("tour_id", tourId)
      .maybeSingle();

    const m = Number((sData as any)?.default_team_best_m);
    if (Number.isFinite(m) && m >= 1 && m <= 10) teamBestM = m;
  } catch {
    // ignore
  }

  // ---- Derived maps ----
  const rpByRoundPlayer = new Map<string, RoundPlayerRow>();
  for (const rp of roundPlayers) rpByRoundPlayer.set(`${rp.round_id}|${rp.player_id}`, rp);

  const scoreByRoundPlayerHole = new Map<string, ScoreRow>();
  for (const s of scores) scoreByRoundPlayerHole.set(`${s.round_id}|${s.player_id}|${Number(s.hole_number)}`, s);

  const playerById = new Map(players.map((p) => [p.id, p]));

  const parsByCourseTeeHole = new Map<string, Map<Tee, Map<number, { par: number; si: number }>>>();
  for (const p of pars) {
    if (!parsByCourseTeeHole.has(p.course_id)) parsByCourseTeeHole.set(p.course_id, new Map());
    const byTee = parsByCourseTeeHole.get(p.course_id)!;
    if (!byTee.has(p.tee)) byTee.set(p.tee, new Map());
    byTee.get(p.tee)!.set(p.hole_number, { par: p.par, si: p.stroke_index });
  }

  // Round completeness: all playing players have 18 entries ("" is missing; "P" counts as entered)
  const isRoundComplete = (round: RoundRow) => {
    const courseId = round.course_id;
    if (!courseId) return false;

    // Determine who is "playing" in this round
    const playingPlayerIds = players
      .filter((pl) => {
        const rp = rpByRoundPlayer.get(`${round.id}|${pl.id}`);
        return rp?.playing === true;
      })
      .map((p) => p.id);

    // If no round_players playing flags exist, be permissive (treat as complete)
    if (playingPlayerIds.length === 0) return true;

    for (const pid of playingPlayerIds) {
      for (let hole = 1; hole <= 18; hole++) {
        const sc = scoreByRoundPlayerHole.get(`${round.id}|${pid}|${hole}`);
        if (!sc) return false;
        const raw = normalizeRawScore(sc.strokes, sc.pickup);
        if (!String(raw ?? "").trim()) return false;
      }
    }
    return true;
  };

  // Eligible rounds list
  const sortedRounds = [...rounds].sort((a, b) => {
    const an = a.round_no ?? 999999;
    const bn = b.round_no ?? 999999;
    if (an !== bn) return an - bn;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });

  const eligibleRounds = includeIncompleteRounds ? sortedRounds : sortedRounds.filter((r) => isRoundComplete(r));
  const eligibleRoundIds = eligibleRounds.map((r) => r.id);

  // Build rounds contexts
  const tourRounds: TourRoundContext[] = eligibleRounds.map((r) => {
    const courseId = r.course_id ?? "";
    const byTee = parsByCourseTeeHole.get(courseId);

    // Baseline = Men's tee if present, otherwise Female, otherwise zeros
    const baselineTee: Tee = byTee?.has("M") ? "M" : "F";
    const baselineMap = byTee?.get(baselineTee);

    const parsByHole = Array.from({ length: 18 }, (_, i) => baselineMap?.get(i + 1)?.par ?? 0);
    const strokeIndexByHole = Array.from({ length: 18 }, (_, i) => baselineMap?.get(i + 1)?.si ?? 0);

    const scoresMatrix: Record<string, string[]> = {};
    for (const pl of players) {
      const arr = Array(18).fill("");
      for (let hole = 1; hole <= 18; hole++) {
        const sc = scoreByRoundPlayerHole.get(`${r.id}|${pl.id}|${hole}`);
        if (!sc) continue;
        arr[hole - 1] = normalizeRawScore(sc.strokes, sc.pickup).trim().toUpperCase();
      }
      scoresMatrix[pl.id] = arr;
    }

    const playedInThisRound = (playerId: string) => {
      const rp = rpByRoundPlayer.get(`${r.id}|${playerId}`);
      return rp ? rp.playing === true : false;
    };

    const isComplete = (playerId: string) => {
      // If not playing, treat as complete (so comps can skip/ignore them)
      if (!playedInThisRound(playerId)) return true;
      const arr = scoresMatrix[playerId] ?? Array(18).fill("");
      for (let i = 0; i < 18; i++) if (!String(arr[i] ?? "").trim()) return false;
      return true;
    };

    const parForPlayerHole = (playerId: string, holeIndex: number) => {
      const pl = playerById.get(playerId);
      const tee: Tee = normalizeTee(pl?.gender);
      const map = byTee?.get(tee) ?? byTee?.get("M") ?? byTee?.get("F");
      const holeNo = holeIndex + 1;
      return Number(map?.get(holeNo)?.par ?? 0) || 0;
    };

    const netPointsForHole = (playerId: string, holeIndex: number) => {
      const pl = playerById.get(playerId);
      const tee: Tee = normalizeTee(pl?.gender);

      const holeNo = holeIndex + 1;
      const map = byTee?.get(tee) ?? byTee?.get("M") ?? byTee?.get("F");
      const info = map?.get(holeNo);
      if (!info) return 0;

      const rp = rpByRoundPlayer.get(`${r.id}|${playerId}`);
      const hcp = Number.isFinite(Number(rp?.playing_handicap)) ? Number(rp?.playing_handicap) : 0;

      const raw = (scoresMatrix[playerId]?.[holeIndex] ?? "").toString();
      return netStablefordPointsForHole({
        rawScore: raw,
        par: info.par,
        strokeIndex: info.si,
        playingHandicap: hcp,
      });
    };

    return {
      roundId: r.id,
      roundName: r.name ?? r.id,
      holes: Array.from({ length: 18 }, (_, i) => i + 1),
      parsByHole,
      strokeIndexByHole,
      scores: scoresMatrix,
      netPointsForHole,
      isComplete,
      parForPlayerHole,
    };
  });

  // Players: mark playing=true if they played any eligible round (or if round_players is absent)
  const anyRoundPlayersData = roundPlayers.length > 0;
  const playedAnyEligibleRound = (playerId: string) =>
    tourRounds.some((tr) => {
      const rp = rpByRoundPlayer.get(`${tr.roundId}|${playerId}`);
      return rp?.playing === true;
    });

  // Entities (pair/team)
  let entities: LeaderboardEntity[] = [];
  let entitiesError = "";
  if (kindForEntities === "pair" || kindForEntities === "team") {
    const res = await resolveEntities({ tourId, scope: "tour", kind: kindForEntities });
    entities = res.entities ?? [];
    entitiesError = res.error ?? "";
  }

  const entityMembersById: Record<string, string[]> = {};
  const entityLabelsById: Record<string, string> = {};
  for (const e of entities) {
    entityMembersById[e.entityId] = e.memberPlayerIds;
    entityLabelsById[e.entityId] = e.name;
  }

  const ctx: TourCompetitionContext = {
    scope: "tour",
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      playing: anyRoundPlayersData ? playedAnyEligibleRound(p.id) : true,
      playing_handicap: 0, // not used by tour comps; roundPlayers carry actual PH
    })),
    rounds: tourRounds,
    entities: entities.map((e) => ({
      entityId: e.entityId,
      label: e.name,
      memberPlayerIds: e.memberPlayerIds,
    })),
    entityMembersById,
    entityLabelsById,
    team_best_m: clampInt(teamBestM, 1, 10),
  };

  return {
    ctx,
    tourName: String(tour.name ?? ""),
    rounds,
    players,
    eligibleRoundIds,
    entities,
    entitiesError: entitiesError || undefined,
  };
}
