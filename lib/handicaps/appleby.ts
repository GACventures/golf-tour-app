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

export type ApplebyRoundKey = 3 | 6 | 9 | 12;

export type ApplebyPlayerRow = {
  player_id: string;
  name: string;

  start_exact_1dp: number; // tour override if exists else global
  start_seed_int: number; // nearest int, half-up

  scoreByRound: Partial<Record<ApplebyRoundKey, number | null>>;
  cutoffByRound: Partial<Record<ApplebyRoundKey, number | null>>;
  isCutoffScoreByRound: Partial<Record<ApplebyRoundKey, boolean>>;

  adjStep: Partial<Record<ApplebyRoundKey, number | null>>; // actual applied step (after cap) 1dp
  adjStepStar: Partial<Record<ApplebyRoundKey, boolean>>; // whether reduced due to +/-3 cap

  cumAdjAfter: Partial<Record<ApplebyRoundKey, number | null>>; // cumulative after each step 1dp (capped)
  startPlusAfter: Partial<Record<ApplebyRoundKey, number | null>>; // start_exact_1dp + cumAdjAfter 1dp
  startPlusAfterRounded: Partial<Record<ApplebyRoundKey, number | null>>; // nearest int, half-up
};

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

export async function loadApplebyTourData(opts: {
  supabase: SupabaseClient;
  tourId: string;
}): Promise<
  | {
      ok: true;
      tourName: string;
      rounds: RoundRow[];
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
      return { ok: true, tourName, rounds, players: [], canUpdate: false, cannotUpdateReason: "No players found." };
    }

    const playerIds = playersBase.map((p) => p.player_id);

    // round_players (for playing=true + tee)
    const roundIds = rounds.map((r) => r.id);
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

    // Identify Appleby rounds by round_no
    const targetNos: ApplebyRoundKey[] = [3, 6, 9, 12];
    const roundByNo = new Map<number, RoundRow>();
    for (const r of rounds) {
      const n = Number(r.round_no);
      if (Number.isFinite(n)) roundByNo.set(n, r);
    }

    const targetRounds = targetNos
      .map((n) => ({ n, r: roundByNo.get(n) ?? null }))
      .filter((x) => x.r != null) as Array<{ n: ApplebyRoundKey; r: RoundRow }>;

    // If no target rounds exist yet, we still show the page but cannot compute/update
    if (targetRounds.length === 0) {
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
        players: emptyPlayers,
        canUpdate: false,
        cannotUpdateReason: "Rounds 3/6/9/12 not found yet for this tour.",
      };
    }

    // Load pars for target course_ids
    const courseIds = Array.from(new Set(targetRounds.map((x) => String(x.r.course_id ?? "")).filter(Boolean)));
    const { data: parsData, error: parsErr } = await supabase
      .from("pars")
      .select("course_id,hole_number,par,stroke_index,tee")
      .in("course_id", courseIds);

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

    // Helper: tee for a given round/player
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

    // Load scores round-by-round (avoids hitting 1000 limit for big tours)
    const scoreMap: Record<string, Record<string, Record<number, string>>> = {};
    const holesFilledCount = (roundId: string, playerId: string): number => {
      let n = 0;
      for (let hole = 1; hole <= 18; hole++) {
        const raw = scoreMap[roundId]?.[playerId]?.[hole] ?? "";
        if (raw) n++;
      }
      return n;
    };

    for (const tr of targetRounds) {
      const rid = tr.r.id;

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

    // Compute scores for R3/R6/R9/R12 (only playing=true AND 18 holes filled)
    const scoreByRoundPlayer: Record<ApplebyRoundKey, Record<string, number | null>> = { 3: {}, 6: {}, 9: {}, 12: {} };

    for (const { n, r } of targetRounds) {
      const rid = r.id;
      const courseId = String(r.course_id ?? "");
      for (const p of playersBase) {
        const pid = p.player_id;
        const okPlaying = isPlaying(rid, pid);
        const filled = holesFilledCount(rid, pid) === 18;

        if (!okPlaying || !filled || !courseId) {
          scoreByRoundPlayer[n][pid] = null;
          continue;
        }

        // Appleby scores are based on that day’s round playing handicap (integer).
        // For R3: seed int applies. For R6: by definition it is still the "post R3" handicap etc.
        // BUT for the Appleby table we only need the stableford result itself; handicap is taken from round_players on that day.
        // If round_players.playing_handicap exists for that day use it; else fall back to seed int.
        const rp = rpByKey.get(rpKey(rid, pid));
        const ph = Number.isFinite(Number(rp?.playing_handicap)) ? Number(rp!.playing_handicap) : p.start_seed_int;

        const tot = stablefordTotal(rid, courseId, pid, ph);
        scoreByRoundPlayer[n][pid] = tot == null ? null : tot;
      }
    }

    // Compute cutoff (6th best) per round, and per-player adjustments/cumulative caps
    const cutoffByRound: Record<ApplebyRoundKey, number | null> = { 3: null, 6: null, 9: null, 12: null };

    for (const key of targetNos) {
      const roundPresent = targetRounds.some((x) => x.n === key);
      if (!roundPresent) {
        cutoffByRound[key] = null;
        continue;
      }

      const vals = Object.values(scoreByRoundPlayer[key]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      vals.sort((a, b) => b - a);
      cutoffByRound[key] = vals.length >= 6 ? vals[5] : null;
    }

    // Build final per-player rows
    const rowsOut: ApplebyPlayerRow[] = playersBase
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => {
        const pid = p.player_id;

        const scoreByRound: ApplebyPlayerRow["scoreByRound"] = {};
        const isCutoffScoreByRound: ApplebyPlayerRow["isCutoffScoreByRound"] = {};
        const cutoffMap: ApplebyPlayerRow["cutoffByRound"] = {};
        const adjStep: ApplebyPlayerRow["adjStep"] = {};
        const adjStepStar: ApplebyPlayerRow["adjStepStar"] = {};
        const cumAdjAfter: ApplebyPlayerRow["cumAdjAfter"] = {};
        const startPlusAfter: ApplebyPlayerRow["startPlusAfter"] = {};
        const startPlusAfterRounded: ApplebyPlayerRow["startPlusAfterRounded"] = {};

        let cum = 0.0;

        for (const key of targetNos) {
          const sc = scoreByRoundPlayer[key]?.[pid] ?? null;
          const cutoff = cutoffByRound[key];

          scoreByRound[key] = sc;
          cutoffMap[key] = cutoff;

          const isCutoff = sc != null && cutoff != null && sc === cutoff;
          isCutoffScoreByRound[key] = isCutoff;

          // If missing info, we cannot adjust at this step
          if (sc == null || cutoff == null) {
            adjStep[key] = null;
            adjStepStar[key] = false;
            cumAdjAfter[key] = round1dp(cum);
            startPlusAfter[key] = round1dp(p.start_exact_1dp + cum);
            startPlusAfterRounded[key] = roundHalfUp(p.start_exact_1dp + cum);
            continue;
          }

          // Adjustment rule:
          // every 1 point difference => 0.1 adjustment, applied to starting handicap
          // if player beats 6th best => adjustment is negative
          // so: (cutoff - playerScore) * 0.1
          const rawStep = round1dp((cutoff - sc) * 0.1);

          const nextCumRaw = round1dp(cum + rawStep);
          const nextCumClamped = round1dp(clamp(nextCumRaw, -3.0, 3.0));

          const appliedStep = round1dp(nextCumClamped - cum);
          const starred = appliedStep !== rawStep;

          cum = nextCumClamped;

          adjStep[key] = appliedStep;
          adjStepStar[key] = starred;
          cumAdjAfter[key] = round1dp(cum);

          const startPlus = round1dp(p.start_exact_1dp + cum);
          startPlusAfter[key] = startPlus;
          startPlusAfterRounded[key] = roundHalfUp(startPlus);
        }

        return {
          player_id: pid,
          name: p.name,
          start_exact_1dp: p.start_exact_1dp,
          start_seed_int: p.start_seed_int,
          scoreByRound,
          cutoffByRound: cutoffMap,
          isCutoffScoreByRound,
          adjStep,
          adjStepStar,
          cumAdjAfter,
          startPlusAfter,
          startPlusAfterRounded,
        };
      });

    // Can update only if at least one cutoff exists (i.e. some round has 6 complete players)
    // and rounds exist (for applying).
    const anyCutoff = targetNos.some((k) => cutoffByRound[k] != null);
    const canUpdate = anyCutoff && rounds.length > 0;

    let cannotUpdateReason: string | null = null;
    if (!anyCutoff) {
      cannotUpdateReason =
        "Cannot update: need at least 6 complete (18-hole) playing players on one of R3/R6/R9/R12 to establish the 6th-best score.";
    }

    return { ok: true, tourName, rounds, players: rowsOut, canUpdate, cannotUpdateReason };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Failed to load Appleby data." };
  }
}

export async function applyApplebyHandicaps(opts: {
  supabase: SupabaseClient;
  tourId: string;
  rounds: RoundRow[];
  players: ApplebyPlayerRow[];
}): Promise<{ ok: true; updated: number } | { ok: false; error: string }> {
  const { supabase, rounds, players } = opts;

  try {
    const roundsWithNo = rounds
      .filter((r) => Number.isFinite(Number(r.round_no)))
      .map((r) => ({ ...r, round_no_num: Number(r.round_no) }))
      .sort((a, b) => a.round_no_num - b.round_no_num);

    // Load round_players so we preserve playing flag + tee; if missing, default playing=false and tee from gender.
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

    // Determine the integer handicap to apply for each segment
    const getSegmentIntForRoundNo = (p: ApplebyPlayerRow, roundNo: number): number => {
      // R1–R3: no rehandicap => starting handicap rounded to nearest int (half-up)
      if (roundNo <= 3) return p.start_seed_int;

      const r3 = p.startPlusAfterRounded[3];
      const r6 = p.startPlusAfterRounded[6];
      const r9 = p.startPlusAfterRounded[9];
      const r12 = p.startPlusAfterRounded[12];

      // R4–R6 use post-R3
      if (roundNo >= 4 && roundNo <= 6) return Number.isFinite(Number(r3)) ? Number(r3) : p.start_seed_int;

      // R7–R9 use post-R6
      if (roundNo >= 7 && roundNo <= 9) return Number.isFinite(Number(r6)) ? Number(r6) : (Number.isFinite(Number(r3)) ? Number(r3) : p.start_seed_int);

      // R10–R12 use post-R9
      if (roundNo >= 10 && roundNo <= 12) return Number.isFinite(Number(r9)) ? Number(r9) : (Number.isFinite(Number(r6)) ? Number(r6) : (Number.isFinite(Number(r3)) ? Number(r3) : p.start_seed_int));

      // R13+ use post-R12
      return Number.isFinite(Number(r12))
        ? Number(r12)
        : (Number.isFinite(Number(r9)) ? Number(r9) : (Number.isFinite(Number(r6)) ? Number(r6) : (Number.isFinite(Number(r3)) ? Number(r3) : p.start_seed_int)));
    };

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

        const ph = Math.max(0, Math.floor(getSegmentIntForRoundNo(p, rn)));

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
