// lib/handicaps/appleby.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { netStablefordPointsForHole } from "@/lib/stableford";

type Tee = "M" | "F";

type RoundRow = {
  id: string;
  tour_id: string;
  course_id: string | null;
  round_no: number | null;
  played_on: string | null;
  created_at: string | null;
  name: string | null;
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

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean;
  tee: Tee | string | null;
  playing_handicap: number | null;
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

export type ApplebyRoundKey = number;

export type ApplebyPlayerRow = {
  player_id: string;
  name: string;

  start_exact_1dp: number; // tour override if exists else global
  start_seed_int: number; // nearest int, half-up

  // keyed by "applied rounds" (i.e. rounds where Appleby adjustment is applied)
  scoreByRound: Partial<Record<ApplebyRoundKey, number | null>>;
  cutoffByRound: Partial<Record<ApplebyRoundKey, number | null>>;
  isCutoffScoreByRound: Partial<Record<ApplebyRoundKey, boolean>>;

  adjStep: Partial<Record<ApplebyRoundKey, number | null>>; // actual applied step (after cap) 1dp
  adjStepStar: Partial<Record<ApplebyRoundKey, boolean>>; // whether reduced due to cap

  cumAdjAfter: Partial<Record<ApplebyRoundKey, number | null>>; // cumulative after each step 1dp (capped)
  startPlusAfter: Partial<Record<ApplebyRoundKey, number | null>>; // start_exact_1dp + cumAdjAfter 1dp
  startPlusAfterRounded: Partial<Record<ApplebyRoundKey, number | null>>; // nearest int, half-up
};

const CAP_UP = 4.0;
const CAP_DOWN = -2.0;

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function round1dp(x: number): number {
  return Math.round(x * 10) / 10;
}

function roundHalfUp(x: number): number {
  return x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
}

function rawScoreString(s: ScoreRow): string {
  const isPickup = (s as any).pickup === true;
  if (isPickup) return "P";
  if (s.strokes === null || s.strokes === undefined) return "";
  return String(s.strokes).trim().toUpperCase();
}

function normalizePlayerJoin(val: PlayerJoin | PlayerJoin[] | null | undefined): PlayerJoin | null {
  if (!val) return null;
  const p = Array.isArray(val) ? val[0] : val;
  if (!p) return null;

  const id = String((p as any).id ?? "").trim();
  if (!id) return null;

  const name = String((p as any).name ?? "").trim() || "(missing player)";

  const shNum = Number((p as any).start_handicap);
  const start_handicap = Number.isFinite(shNum) ? Math.max(0, round1dp(shNum)) : null;

  const gender = (p as any).gender == null ? null : normalizeTee((p as any).gender);

  return { id, name, start_handicap, gender };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function cmpNullableNum(a: number | null, b: number | null) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

// 4BBB rounds are 1,4,7,10,13,... (every 3rd starting at 1)
function is4bbbRound(roundNo: number): boolean {
  return roundNo >= 1 && (roundNo - 1) % 3 === 0;
}

// Appleby adjustment is applied after all rounds except 4BBB rounds.
// We also exclude round 1 explicitly (covered by 4BBB rule anyway).
function isApplebyAppliedRound(roundNo: number): boolean {
  if (!Number.isFinite(roundNo) || roundNo <= 0) return false;
  return !is4bbbRound(roundNo);
}

export async function loadApplebyTourData(opts: {
  supabase: SupabaseClient;
  tourId: string;
}): Promise<
  | {
      ok: true;
      tourName: string;
      rounds: RoundRow[];
      appliedRoundNos: number[];
      players: ApplebyPlayerRow[];
      canUpdate: boolean;
      cannotUpdateReason: string | null;
    }
  | { ok: false; error: string }
> {
  const { supabase, tourId } = opts;

  try {
    // Tour
    const { data: tourData, error: tErr } = await supabase.from("tours").select("id,name").eq("id", tourId).single();
    if (tErr) throw tErr;
    const tourName = String((tourData as any)?.name ?? "").trim() || "Tour";

    // Rounds
    const { data: roundsData, error: rErr } = await supabase
      .from("rounds")
      .select("id,tour_id,course_id,round_no,played_on,created_at,name")
      .eq("tour_id", tourId);

    if (rErr) throw rErr;

    const roundsRaw = (roundsData ?? []) as RoundRow[];
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

    const roundsWithNo = rounds
      .filter((r) => Number.isFinite(Number(r.round_no)))
      .map((r) => ({ ...r, round_no_num: Number(r.round_no) }))
      .sort((a, b) => a.round_no_num - b.round_no_num);

    const roundByNo = new Map<number, RoundRow>();
    for (const r of roundsWithNo) roundByNo.set(r.round_no_num, r);

    const appliedRoundNos = roundsWithNo.map((r) => r.round_no_num).filter(isApplebyAppliedRound);

    // Tour players
    const { data: tpData, error: tpErr } = await supabase
      .from("tour_players")
      .select("tour_id,player_id,starting_handicap, players(id,name,start_handicap,gender)")
      .eq("tour_id", tourId);

    if (tpErr) throw tpErr;

    const tourPlayers = (tpData ?? []) as unknown as TourPlayerJoinRow[];

    const playersBase = tourPlayers
      .map((r) => {
        const pj = normalizePlayerJoin(r.players);
        if (!pj) return null;

        const overrideRaw = Number((r as any).starting_handicap);
        const tourStart = Number.isFinite(overrideRaw) ? Math.max(0, round1dp(overrideRaw)) : null;

        const globalStart = pj.start_handicap ?? 0;

        const startExact = Math.max(0, round1dp(tourStart ?? globalStart ?? 0));
        const seedInt = Math.max(0, roundHalfUp(startExact));

        return {
          player_id: pj.id,
          name: pj.name,
          gender: pj.gender ?? null,
          start_exact_1dp: startExact,
          start_seed_int: seedInt,
        };
      })
      .filter(Boolean) as Array<{
      player_id: string;
      name: string;
      gender: Tee | null;
      start_exact_1dp: number;
      start_seed_int: number;
    }>;

    if (playersBase.length === 0) {
      return {
        ok: true,
        tourName,
        rounds,
        appliedRoundNos,
        players: [],
        canUpdate: false,
        cannotUpdateReason: "No players found.",
      };
    }

    const playerIds = playersBase.map((p) => p.player_id);
    const roundIds = roundsWithNo.map((r) => r.id);

    // round_players (playing + tee + maybe existing playing_handicap for fallback)
    const { data: rpData, error: rpErr } = await supabase
      .from("round_players")
      .select("round_id,player_id,playing,tee,playing_handicap")
      .in("round_id", roundIds)
      .in("player_id", playerIds);

    if (rpErr) throw rpErr;

    const rpRows: RoundPlayerRow[] = (rpData ?? []).map((x: any) => ({
      round_id: String(x.round_id),
      player_id: String(x.player_id),
      playing: x.playing === true,
      tee: x.tee == null ? null : String(x.tee),
      playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
    }));

    const rpByKey = new Map<string, RoundPlayerRow>();
    const rpKey = (rid: string, pid: string) => `${rid}::${pid}`;
    for (const rp of rpRows) rpByKey.set(rpKey(rp.round_id, rp.player_id), rp);

    // If no applied rounds exist yet, show page but cannot compute/update
    if (appliedRoundNos.length === 0) {
      const emptyPlayers: ApplebyPlayerRow[] = playersBase
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({
          player_id: p.player_id,
          name: p.name,
          start_exact_1dp: p.start_exact_1dp,
          start_seed_int: p.start_seed_int,
          scoreByRound: {},
          cutoffByRound: {},
          isCutoffScoreByRound: {},
          adjStep: {},
          adjStepStar: {},
          cumAdjAfter: {},
          startPlusAfter: {},
          startPlusAfterRounded: {},
        }));

      return {
        ok: true,
        tourName,
        rounds,
        appliedRoundNos,
        players: emptyPlayers,
        canUpdate: false,
        cannotUpdateReason: "No eligible (non-4BBB) rounds found yet for this tour.",
      };
    }

    // Load pars for all course_ids used by applied rounds
    const appliedCourseIds = Array.from(
      new Set(
        appliedRoundNos
          .map((n) => String(roundByNo.get(n)?.course_id ?? ""))
          .filter(Boolean)
      )
    );

    const { data: parsData, error: parsErr } = await supabase
      .from("pars")
      .select("course_id,hole_number,par,stroke_index,tee")
      .in("course_id", appliedCourseIds);

    if (parsErr) throw parsErr;

    const pars = (parsData ?? []) as ParRow[];
    const parsByCourseTee: Record<string, Record<Tee, Record<number, { par: number; si: number }>>> = {};
    for (const row of pars) {
      const cid = String(row.course_id);
      const tee = normalizeTee(row.tee);
      const hole = Number(row.hole_number);
      if (!parsByCourseTee[cid]) parsByCourseTee[cid] = { M: {}, F: {} };
      parsByCourseTee[cid][tee][hole] = { par: Number(row.par), si: Number(row.stroke_index) };
    }

    // Default tee per player
    const defaultTeeByPlayer: Record<string, Tee> = {};
    for (const p of playersBase) defaultTeeByPlayer[p.player_id] = p.gender ? normalizeTee(p.gender) : "M";

    const teeFor = (roundId: string, playerId: string): Tee => {
      const existing = rpByKey.get(rpKey(roundId, playerId));
      if (existing?.tee) return normalizeTee(existing.tee);
      return defaultTeeByPlayer[playerId] ?? "M";
    };

    const isPlaying = (roundId: string, playerId: string): boolean => {
      const existing = rpByKey.get(rpKey(roundId, playerId));
      return existing?.playing === true;
    };

    // Load raw scores for every applied round (page-by-page)
    const scoreMap: Record<string, Record<string, Record<number, string>>> = {};

    const holesFilledCount = (roundId: string, playerId: string): number => {
      let n = 0;
      for (let hole = 1; hole <= 18; hole++) {
        const raw = scoreMap[roundId]?.[playerId]?.[hole] ?? "";
        if (raw) n++;
      }
      return n;
    };

    for (const roundNo of appliedRoundNos) {
      const r = roundByNo.get(roundNo);
      if (!r) continue;

      const rid = r.id;
      scoreMap[rid] = scoreMap[rid] ?? {};

      const PAGE_SIZE = 1000;
      let from = 0;

      while (true) {
        const to = from + PAGE_SIZE - 1;

        const { data: page, error: pageErr } = await supabase
          .from("scores")
          .select("round_id,player_id,hole_number,strokes,pickup")
          .eq("round_id", rid)
          .in("player_id", playerIds)
          .range(from, to);

        if (pageErr) throw pageErr;

        const rows = (page ?? []) as ScoreRow[];
        for (const s of rows) {
          const pid = String(s.player_id);
          const hole = Number(s.hole_number);
          if (!scoreMap[rid][pid]) scoreMap[rid][pid] = {};
          scoreMap[rid][pid][hole] = rawScoreString(s);
        }

        if (rows.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
    }

    const stablefordTotal = (roundId: string, courseId: string, playerId: string, ph: number): number | null => {
      const cid = String(courseId);
      const tee = teeFor(roundId, playerId);
      const holes = parsByCourseTee[cid]?.[tee] ?? parsByCourseTee[cid]?.M ?? null;
      if (!holes) return null;

      let total = 0;
      for (let hole = 1; hole <= 18; hole++) {
        const info = holes[hole];
        if (!info) return null;
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

    // Prepare output rows scaffolding
    const byPlayer: Record<string, ApplebyPlayerRow> = {};
    for (const p of playersBase) {
      byPlayer[p.player_id] = {
        player_id: p.player_id,
        name: p.name,
        start_exact_1dp: p.start_exact_1dp,
        start_seed_int: p.start_seed_int,
        scoreByRound: {},
        cutoffByRound: {},
        isCutoffScoreByRound: {},
        adjStep: {},
        adjStepStar: {},
        cumAdjAfter: {},
        startPlusAfter: {},
        startPlusAfterRounded: {},
      };
    }

    // Sequentially simulate handicap progression + compute adjustments on each applied round
    // cumAdj tracked per player (1dp)
    const cumAdjByPlayer: Record<string, number> = {};
    for (const p of playersBase) cumAdjByPlayer[p.player_id] = 0.0;

    // PH by round number for each player (integer)
    const phByPlayerRoundNo: Record<string, Record<number, number>> = {};
    for (const p of playersBase) phByPlayerRoundNo[p.player_id] = {};

    const maxRoundNo = roundsWithNo.length > 0 ? roundsWithNo[roundsWithNo.length - 1].round_no_num : 0;

    // Seed round 1 (if it exists)
    for (const p of playersBase) {
      phByPlayerRoundNo[p.player_id][1] = p.start_seed_int;
    }

    // Helper: compute PH for round n based on previous round
    const phForRound = (pid: string, roundNo: number): number => {
      if (roundNo <= 1) return phByPlayerRoundNo[pid]?.[1] ?? byPlayer[pid].start_seed_int;

      const prev = roundNo - 1;
      const prevPH = phByPlayerRoundNo[pid]?.[prev];
      const fallbackPrevPH = prevPH ?? phForRound(pid, prev);

      // If previous round is applied, next PH = rounded(start + cumAdjAfter prev)
      if (isApplebyAppliedRound(prev)) {
        const cum = cumAdjByPlayer[pid] ?? 0.0;
        return Math.max(0, roundHalfUp(byPlayer[pid].start_exact_1dp + cum));
      }

      // If previous round is 4BBB, carry forward unchanged
      return fallbackPrevPH;
    };

    // We compute PH for every round in order, but only apply adjustments on applied rounds
    for (let roundNo = 2; roundNo <= maxRoundNo; roundNo++) {
      for (const p of playersBase) {
        phByPlayerRoundNo[p.player_id][roundNo] = phForRound(p.player_id, roundNo);
      }

      if (!isApplebyAppliedRound(roundNo)) continue;

      const round = roundByNo.get(roundNo);
      if (!round) {
        // still record "after" values as current cum even if the round row is missing
        for (const p of playersBase) {
          const pid = p.player_id;
          const row = byPlayer[pid];
          const cum = round1dp(cumAdjByPlayer[pid] ?? 0.0);
          row.scoreByRound[roundNo] = null;
          row.cutoffByRound[roundNo] = null;
          row.isCutoffScoreByRound[roundNo] = false;
          row.adjStep[roundNo] = null;
          row.adjStepStar[roundNo] = false;
          row.cumAdjAfter[roundNo] = cum;
          row.startPlusAfter[roundNo] = round1dp(row.start_exact_1dp + cum);
          row.startPlusAfterRounded[roundNo] = roundHalfUp(row.start_exact_1dp + cum);
        }
        continue;
      }

      const rid = round.id;
      const courseId = String(round.course_id ?? "");

      // Compute stableford scores for eligible players on this round (playing=true and 18 holes filled)
      const scoreByPid: Record<string, number | null> = {};
      for (const p of playersBase) {
        const pid = p.player_id;

        const okPlaying = isPlaying(rid, pid);
        const filled = holesFilledCount(rid, pid) === 18;

        if (!okPlaying || !filled || !courseId) {
          scoreByPid[pid] = null;
          continue;
        }

        const ph = phByPlayerRoundNo[pid]?.[roundNo] ?? p.start_seed_int;
        const tot = stablefordTotal(rid, courseId, pid, ph);
        scoreByPid[pid] = tot == null ? null : tot;
      }

      // Cutoff = 6th best among numeric scores
      const vals = Object.values(scoreByPid).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      vals.sort((a, b) => b - a);
      const cutoff = vals.length >= 6 ? vals[5] : null;

      // Apply per-player step, update cumulative, store row values
      for (const p of playersBase) {
        const pid = p.player_id;
        const row = byPlayer[pid];

        const sc = scoreByPid[pid] ?? null;

        row.scoreByRound[roundNo] = sc;
        row.cutoffByRound[roundNo] = cutoff;
        row.isCutoffScoreByRound[roundNo] = sc != null && cutoff != null && sc === cutoff;

        const prevCum = round1dp(cumAdjByPlayer[pid] ?? 0.0);

        // If no cutoff or missing score, no adjustment at this step
        if (sc == null || cutoff == null) {
          row.adjStep[roundNo] = null;
          row.adjStepStar[roundNo] = false;
          row.cumAdjAfter[roundNo] = prevCum;
          row.startPlusAfter[roundNo] = round1dp(row.start_exact_1dp + prevCum);
          row.startPlusAfterRounded[roundNo] = roundHalfUp(row.start_exact_1dp + prevCum);
          continue;
        }

        // rawStep = (cutoff - score) * 0.1
        const rawStep = round1dp((cutoff - sc) * 0.1);

        const nextCumRaw = round1dp(prevCum + rawStep);
        const nextCumClamped = round1dp(clamp(nextCumRaw, CAP_DOWN, CAP_UP));

        const appliedStep = round1dp(nextCumClamped - prevCum);
        const starred = appliedStep !== rawStep;

        cumAdjByPlayer[pid] = nextCumClamped;

        row.adjStep[roundNo] = appliedStep;
        row.adjStepStar[roundNo] = starred;
        row.cumAdjAfter[roundNo] = nextCumClamped;

        const startPlus = round1dp(row.start_exact_1dp + nextCumClamped);
        row.startPlusAfter[roundNo] = startPlus;
        row.startPlusAfterRounded[roundNo] = roundHalfUp(startPlus);
      }
    }

    const rowsOut: ApplebyPlayerRow[] = Object.values(byPlayer).sort((a, b) => a.name.localeCompare(b.name));

    // Can update only if at least one applied round has a cutoff
    const anyCutoff = appliedRoundNos.some((n) => {
      const anyRow = rowsOut.find((p) => p.cutoffByRound?.[n] != null);
      return anyRow?.cutoffByRound?.[n] != null;
    });

    const canUpdate = anyCutoff && roundsWithNo.length > 0;

    let cannotUpdateReason: string | null = null;
    if (!anyCutoff) {
      cannotUpdateReason =
        "Cannot update: need at least 6 complete (18-hole) playing players on a rehandicap round to establish the 6th-best score.";
    }

    return { ok: true, tourName, rounds, appliedRoundNos, players: rowsOut, canUpdate, cannotUpdateReason };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Failed to load Appleby data." };
  }
}

export async function applyApplebyHandicaps(opts: {
  supabase: SupabaseClient;
  tourId: string;
  rounds: RoundRow[];
  appliedRoundNos?: number[]; // optional (page can pass; but we can derive)
  players: ApplebyPlayerRow[];
}): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const { supabase, rounds, players } = opts;

  try {
    const roundsWithNo = rounds
      .filter((r) => Number.isFinite(Number(r.round_no)))
      .map((r) => ({ ...r, round_no_num: Number(r.round_no) }))
      .sort((a, b) => a.round_no_num - b.round_no_num);

    if (roundsWithNo.length === 0 || players.length === 0) return { ok: true, updated: 0 };

    const appliedRoundNos = roundsWithNo.map((r) => r.round_no_num).filter(isApplebyAppliedRound);

    // Load round_players so we preserve playing flag + tee
    const roundIds = roundsWithNo.map((r) => r.id);
    const playerIds = players.map((p) => p.player_id);

    const { data: rpData, error: rpErr } = await supabase
      .from("round_players")
      .select("round_id,player_id,playing,tee")
      .in("round_id", roundIds)
      .in("player_id", playerIds);

    if (rpErr) throw rpErr;

    const rpByKey = new Map<string, { playing: boolean; tee: Tee | string | null }>();
    const rpKey = (rid: string, pid: string) => `${rid}::${pid}`;
    for (const x of rpData ?? []) {
      rpByKey.set(rpKey(String((x as any).round_id), String((x as any).player_id)), {
        playing: (x as any).playing === true,
        tee: (x as any).tee == null ? null : String((x as any).tee),
      });
    }

    // Build PH per player per roundNo using the computed cumAdjAfter from players
    // Round 1: start_seed_int
    // Round n>1: if (n-1) is applied -> PH = rounded(start + cumAdjAfter[n-1])
    //           else carry forward unchanged
    const cumAdjAfterFor = (p: ApplebyPlayerRow, appliedRoundNo: number): number => {
      const v = p.cumAdjAfter?.[appliedRoundNo];
      return Number.isFinite(Number(v)) ? Number(v) : 0.0;
    };

    const phByPlayerRoundNo: Record<string, Record<number, number>> = {};
    for (const p of players) phByPlayerRoundNo[p.player_id] = { 1: p.start_seed_int };

    const maxRoundNo = roundsWithNo[roundsWithNo.length - 1].round_no_num;

    for (let n = 2; n <= maxRoundNo; n++) {
      const prev = n - 1;
      const prevApplied = appliedRoundNos.includes(prev);

      for (const p of players) {
        const prevPH = phByPlayerRoundNo[p.player_id]?.[prev] ?? p.start_seed_int;

        if (prevApplied) {
          const cum = cumAdjAfterFor(p, prev);
          const ph = Math.max(0, roundHalfUp(p.start_exact_1dp + cum));
          phByPlayerRoundNo[p.player_id][n] = ph;
        } else {
          phByPlayerRoundNo[p.player_id][n] = prevPH;
        }
      }
    }

    const payload: Array<{
      round_id: string;
      player_id: string;
      playing: boolean;
      tee: Tee;
      playing_handicap: number;
      base_playing_handicap: null;
    }> = [];

    for (const r of roundsWithNo) {
      const rn = r.round_no_num;

      for (const p of players) {
        const existing = rpByKey.get(rpKey(r.id, p.player_id));
        const playing = existing?.playing === true;
        const tee = existing?.tee ? normalizeTee(existing.tee) : "M";

        const ph = Math.max(0, Math.floor(phByPlayerRoundNo[p.player_id]?.[rn] ?? p.start_seed_int));

        payload.push({
          round_id: r.id,
          player_id: p.player_id,
          playing,
          tee,
          playing_handicap: ph,
          base_playing_handicap: null,
        });
      }
    }

    if (payload.length === 0) return { ok: true, updated: 0 };

    const { error: upErr } = await supabase.from("round_players").upsert(payload, { onConflict: "round_id,player_id" });
    if (upErr) throw upErr;

    return { ok: true, updated: payload.length };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Failed to apply Appleby handicaps." };
  }
}
