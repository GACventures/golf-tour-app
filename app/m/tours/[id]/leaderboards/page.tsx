// app/m/tours/[id]/leaderboards/page.tsx
// PRODUCTION
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import MobileNav from "../_components/MobileNav";
import { supabase } from "@/lib/supabaseClient";

// -----------------------------
// Types
// -----------------------------
type Tee = "M" | "F";
type LeaderboardKind = "individual" | "pairs" | "teams";

type Tour = { id: string; name: string };

type CourseRel = { name: string };

type RoundRow = {
  id: string;
  tour_id: string;
  name: string | null;
  round_no: number | null;

  // Date fields (may not exist in schema yet)
  round_date?: string | null;
  played_on?: string | null;

  created_at: string | null;

  course_id: string | null;
  courses?: CourseRel | CourseRel[] | null;
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
  tee?: Tee | null; // ✅ IMPORTANT: round-specific tee (source of truth for scoring)
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

type IndividualRule = | { mode: "ALL" } | { mode: "BEST_N"; n: number; finalRequired: boolean };

type PairRule = | { mode: "ALL" } | { mode: "BEST_Q"; q: number; finalRequired: boolean };

type TeamRule = { bestY: number };

type TourGroupingSettingsRow = {
  tour_id: string;
  default_team_best_m: number | null;
  individual_mode: string;
  individual_best_n: number | null;
  individual_final_required: boolean;
  pair_mode: string;
  pair_best_q: number | null;
  pair_final_required: boolean;
};

type TourGroupRow = {
  id: string;
  tour_id: string;
  scope: "tour" | "round";
  type: "pair" | "team";
  name: string | null;
  round_id: string | null;
  team_index?: number | null;
  created_at: string;
};

type TourGroupMemberRow = {
  group_id: string;
  player_id: string;
  position: number | null;
};

// -----------------------------
// Helpers
// -----------------------------
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

function asSingle<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function roundLabel(round: RoundRow, index: number, isFinal: boolean) {
  const n = round.round_no ?? index + 1;
  return isFinal ? `R${n} (F)` : `R${n}`;
}

function normalizeRawScore(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  const n = Number(strokes);
  return Number.isFinite(n) ? String(n) : "";
}

function isMissingColumnError(msg: string, column: string) {
  const m = String(msg ?? "").toLowerCase();
  const c = column.toLowerCase();
  return m.includes("does not exist") && (m.includes(`.${c}`) || m.includes(`"${c}"`) || m.includes(` ${c} `));
}

function pickBestRoundDateISO(r: RoundRow): string | null {
  return (r.round_date ?? null) || (r.played_on ?? null) || (r.created_at ?? null) || null;
}

function parseDateForDisplay(s: string | null | undefined): Date | null {
  if (!s) return null;
  const raw = String(s).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const iso = isDateOnly ? `${raw}T00:00:00.000Z` : raw;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateAuMelbourne(iso: string | null | undefined) {
  const d = parseDateForDisplay(iso);
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}`.replace(/\s+/g, " ");
}

function clampInt(n: number, min: number, max: number) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

// Stableford (net) per hole
function netStablefordPointsForHole(params: {
  rawScore: string; // "" | "P" | "number"
  par: number;
  strokeIndex: number;
  playingHandicap: number;
}) {
  const { rawScore, par, strokeIndex, playingHandicap } = params;

  const raw = String(rawScore ?? "").trim().toUpperCase();
  if (!raw) return 0;
  if (raw === "P") return 0;

  const strokes = Number(raw);
  if (!Number.isFinite(strokes)) return 0;

  const hcp = Math.max(0, Math.floor(Number(playingHandicap) || 0));
  const base = Math.floor(hcp / 18);
  const rem = hcp % 18;
  const extra = strokeIndex <= rem ? 1 : 0;
  const shotsReceived = base + extra;

  const net = strokes - shotsReceived;
  const pts = 2 + (par - net);
  return Math.max(0, Math.min(pts, 10));
}

// Pick BEST N/Q rounds for a row, optionally forcing the final round to count.
function pickBestRoundIds(args: {
  sortedRoundIds: string[];
  perRoundTotals: Record<string, number>;
  n: number;
  finalRoundId: string | null;
  finalRequired: boolean;
}) {
  const { sortedRoundIds, perRoundTotals, n, finalRoundId, finalRequired } = args;

  const N = clampInt(n, 1, 99);
  const chosen = new Set<string>();

  const mustIncludeFinal = !!finalRequired && !!finalRoundId;
  if (mustIncludeFinal && finalRoundId) chosen.add(finalRoundId);

  const ranked = sortedRoundIds.map((rid, idx) => ({
    rid,
    idx,
    val: Number.isFinite(Number(perRoundTotals[rid])) ? Number(perRoundTotals[rid]) : 0,
  }));

  ranked.sort((a, b) => b.val - a.val || a.idx - b.idx);

  for (const r of ranked) {
    if (chosen.size >= N) break;
    if (mustIncludeFinal && r.rid === finalRoundId) continue;
    chosen.add(r.rid);
  }

  return chosen;
}

// -----------------------------
// Page
// -----------------------------
export default function MobileLeaderboardsPage() {
  const params = useParams<{ id?: string }>();
  const router = useRouter();

  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);

  // Pairs + Teams (tour scope)
  const [pairGroups, setPairGroups] = useState<TourGroupRow[]>([]);
  const [pairMembers, setPairMembers] = useState<TourGroupMemberRow[]>([]);
  const [teamGroups, setTeamGroups] = useState<TourGroupRow[]>([]);
  const [teamMembers, setTeamMembers] = useState<TourGroupMemberRow[]>([]);

  // UI selection
  const [kind, setKind] = useState<LeaderboardKind>("individual");

  // ✅ separate genders toggle (individual only)
  const [separateGender, setSeparateGender] = useState(false);

  // Rules (mobile read-only, loaded from DB)
  const [individualRule, setIndividualRule] = useState<IndividualRule>({ mode: "ALL" });
  const [pairRule, setPairRule] = useState<PairRule>({ mode: "ALL" });
  const [teamRule, setTeamRule] = useState<TeamRule>({ bestY: 1 });

  // -----------------------------
  // Load
  // -----------------------------
  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    let alive = true;

    async function loadAll() {
      setLoading(true);
      setErrorMsg("");

      try {
        const { data: tData, error: tErr } = await supabase.from("tours").select("id,name").eq("id", tourId).single();
        if (tErr) throw tErr;
        if (!alive) return;
        setTour(tData as Tour);

        // Settings
        const { data: sData, error: sErr } = await supabase
          .from("tour_grouping_settings")
          .select(
            "tour_id, default_team_best_m, individual_mode, individual_best_n, individual_final_required, pair_mode, pair_best_q, pair_final_required"
          )
          .eq("tour_id", tourId)
          .maybeSingle();
        if (sErr) throw sErr;

        const settings = (sData ?? null) as TourGroupingSettingsRow | null;

        // Individual rule
        {
          const mode = String(settings?.individual_mode ?? "ALL").toUpperCase();
          const finalRequired = settings?.individual_final_required === true;
          const n = Number.isFinite(Number(settings?.individual_best_n)) ? Number(settings?.individual_best_n) : 0;

          if (mode === "BEST_N" && n > 0) {
            setIndividualRule({ mode: "BEST_N", n: clampInt(n, 1, 99), finalRequired });
          } else {
            setIndividualRule({ mode: "ALL" });
          }
        }

        // Pair rule
        {
          const mode = String(settings?.pair_mode ?? "ALL").toUpperCase();
          const finalRequired = settings?.pair_final_required === true;
          const q = Number.isFinite(Number(settings?.pair_best_q)) ? Number(settings?.pair_best_q) : 0;

          if (mode === "BEST_Q" && q > 0) {
            setPairRule({ mode: "BEST_Q", q: clampInt(q, 1, 99), finalRequired });
          } else {
            setPairRule({ mode: "ALL" });
          }
        }

        // Team Y
        {
          const y = Number.isFinite(Number(settings?.default_team_best_m)) ? Number(settings?.default_team_best_m) : 1;
          setTeamRule({ bestY: clampInt(y, 1, 99) });
        }

        // Rounds
        const baseRoundCols = "id,tour_id,name,round_no,created_at,course_id,courses(name)";
        const cols1 = `${baseRoundCols},round_date,played_on`;
        const cols2 = `${baseRoundCols},played_on`;

        let rr: RoundRow[] = [];

        const r1 = await supabase
          .from("rounds")
          .select(cols1)
          .eq("tour_id", tourId)
          .order("round_no", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true });

        if (!alive) return;

        if (!r1.error) {
          rr = (r1.data ?? []) as unknown as RoundRow[];
        } else if (isMissingColumnError(r1.error.message, "round_date")) {
          const r2 = await supabase
            .from("rounds")
            .select(cols2)
            .eq("tour_id", tourId)
            .order("round_no", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: true });

          if (!alive) return;

          if (!r2.error) {
            rr = (r2.data ?? []) as unknown as RoundRow[];
          } else if (isMissingColumnError(r2.error.message, "played_on")) {
            const r3 = await supabase
              .from("rounds")
              .select(baseRoundCols)
              .eq("tour_id", tourId)
              .order("round_no", { ascending: true, nullsFirst: false })
              .order("created_at", { ascending: true });

            if (!alive) return;

            if (r3.error) throw r3.error;
            rr = (r3.data ?? []) as unknown as RoundRow[];
          } else {
            throw r2.error;
          }
        } else {
          throw r1.error;
        }

        if (!alive) return;
        setRounds(rr);

        // Players in tour
        const { data: tpData, error: tpErr } = await supabase
          .from("tour_players")
          .select("tour_id,player_id,starting_handicap,players(id,name,gender)")
          .eq("tour_id", tourId)
          .order("name", { ascending: true, foreignTable: "players" });
        if (tpErr) throw tpErr;

        const ps: PlayerRow[] = (tpData ?? [])
          .map((row: any) => row.players)
          .filter(Boolean)
          .map((p: any) => ({
            id: String(p.id),
            name: safeName(p.name, "(unnamed)"),
            gender: p.gender ? normalizeTee(p.gender) : null,
          }));

        if (!alive) return;
        setPlayers(ps);

        const roundIds = rr.map((r) => r.id);
        const playerIds = ps.map((p) => p.id);

        // round_players (✅ include tee)
        if (roundIds.length > 0 && playerIds.length > 0) {
          const { data: rpData, error: rpErr } = await supabase
            .from("round_players")
            .select("round_id,player_id,playing,playing_handicap,tee")
            .in("round_id", roundIds)
            .in("player_id", playerIds);
          if (rpErr) throw rpErr;

          const rpRows: RoundPlayerRow[] = (rpData ?? []).map((x: any) => ({
            round_id: String(x.round_id),
            player_id: String(x.player_id),
            playing: x.playing === true,
            playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
            tee: x.tee ? normalizeTee(x.tee) : null,
          }));

          if (!alive) return;
          setRoundPlayers(rpRows);
        } else {
          setRoundPlayers([]);
        }

        // scores
        if (roundIds.length > 0 && playerIds.length > 0) {
          const { data: sData2, error: sErr2 } = await supabase
            .from("scores")
            .select("round_id,player_id,hole_number,strokes,pickup")
            .in("round_id", roundIds)
            .in("player_id", playerIds);
          if (sErr2) throw sErr2;

          if (!alive) return;
          setScores((sData2 ?? []) as ScoreRow[]);
        } else {
          setScores([]);
        }

        // pars (both tees)
        const courseIds = Array.from(new Set(rr.map((r) => r.course_id).filter(Boolean))) as string[];
        if (courseIds.length > 0) {
          const { data: pData, error: pErr } = await supabase
            .from("pars")
            .select("course_id,hole_number,tee,par,stroke_index")
            .in("course_id", courseIds)
            .in("tee", ["M", "F"])
            .order("course_id", { ascending: true })
            .order("hole_number", { ascending: true });
          if (pErr) throw pErr;

          const pr: ParRow[] = (pData ?? []).map((x: any) => ({
            course_id: String(x.course_id),
            hole_number: Number(x.hole_number),
            tee: normalizeTee(x.tee),
            par: Number(x.par),
            stroke_index: Number(x.stroke_index),
          }));

          if (!alive) return;
          setPars(pr);
        } else {
          setPars([]);
        }

        // PAIRS groups
        const { data: pgData, error: pgErr } = await supabase
          .from("tour_groups")
          .select("id,tour_id,scope,type,name,round_id,team_index,created_at")
          .eq("tour_id", tourId)
          .eq("scope", "tour")
          .eq("type", "pair")
          .order("created_at", { ascending: true });
        if (pgErr) throw pgErr;

        const pGroups = (pgData ?? []) as TourGroupRow[];
        if (!alive) return;
        setPairGroups(pGroups);

        const pGroupIds = pGroups.map((g) => g.id);
        if (pGroupIds.length === 0) {
          setPairMembers([]);
        } else {
          const { data: pmData, error: pmErr } = await supabase
            .from("tour_group_members")
            .select("group_id,player_id,position")
            .in("group_id", pGroupIds)
            .order("position", { ascending: true, nullsFirst: true });
          if (pmErr) throw pmErr;

          if (!alive) return;
          setPairMembers((pmData ?? []) as TourGroupMemberRow[]);
        }

        // TEAMS groups
        const { data: tgData, error: tgErr } = await supabase
          .from("tour_groups")
          .select("id,tour_id,scope,type,name,round_id,team_index,created_at")
          .eq("tour_id", tourId)
          .eq("scope", "tour")
          .eq("type", "team")
          .order("team_index", { ascending: true, nullsFirst: true })
          .order("created_at", { ascending: true });
        if (tgErr) throw tgErr;

        const tGroups = (tgData ?? []) as TourGroupRow[];
        if (!alive) return;
        setTeamGroups(tGroups);

        const tGroupIds = tGroups.map((g) => g.id);
        if (tGroupIds.length === 0) {
          setTeamMembers([]);
        } else {
          const { data: tmData, error: tmErr } = await supabase
            .from("tour_group_members")
            .select("group_id,player_id,position")
            .in("group_id", tGroupIds)
            .order("position", { ascending: true, nullsFirst: true });
          if (tmErr) throw tmErr;

          if (!alive) return;
          setTeamMembers((tmData ?? []) as TourGroupMemberRow[]);
        }
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load leaderboards.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    void loadAll();

    return () => {
      alive = false;
    };
  }, [tourId]);

  // -----------------------------
  // Derived maps
  // -----------------------------
  const playerById = useMemo(() => {
    const m = new Map<string, PlayerRow>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const rpByRoundPlayer = useMemo(() => {
    const m = new Map<string, RoundPlayerRow>();
    for (const rp of roundPlayers) m.set(`${rp.round_id}|${rp.player_id}`, rp);
    return m;
  }, [roundPlayers]);

  // ✅ Tee source-of-truth for scoring:
  //    use round_players.tee, fallback to players.gender, and finally default to "M"
  function teeFor(roundId: string, playerId: string): Tee {
    const rp = rpByRoundPlayer.get(`${roundId}|${playerId}`);
    if (rp?.tee) return normalizeTee(rp.tee);
    const pl = playerById.get(playerId);
    if (pl?.gender) return normalizeTee(pl.gender);
    return "M";
  }

  const parsByCourseTeeHole = useMemo(() => {
    const m = new Map<string, Map<Tee, Map<number, { par: number; si: number }>>>();
    for (const p of pars) {
      if (!m.has(p.course_id)) m.set(p.course_id, new Map());
      const byTee = m.get(p.course_id)!;
      if (!byTee.has(p.tee)) byTee.set(p.tee, new Map());
      byTee.get(p.tee)!.set(p.hole_number, { par: p.par, si: p.stroke_index });
    }
    return m;
  }, [pars]);

  const scoreByRoundPlayerHole = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    for (const s of scores) m.set(`${s.round_id}|${s.player_id}|${Number(s.hole_number)}`, s);
    return m;
  }, [scores]);

  const sortedRounds = useMemo(() => {
    const arr = [...rounds];
    arr.sort((a, b) => {
      const an = a.round_no ?? 999999;
      const bn = b.round_no ?? 999999;
      if (an !== bn) return an - bn;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });
    return arr;
  }, [rounds]);

  const finalRoundId = useMemo(() => {
    return sortedRounds.length ? sortedRounds[sortedRounds.length - 1].id : "";
  }, [sortedRounds]);

  const sortedRoundIds = useMemo(() => sortedRounds.map((r) => r.id), [sortedRounds]);

  // Pair/Team membership grouped (ordered)
  const memberIdsByPair = useMemo(() => {
    const m = new Map<string, string[]>();
    const rows = [...pairMembers];
    rows.sort((a, b) =>
      a.group_id === b.group_id ? (a.position ?? 999) - (b.position ?? 999) : a.group_id.localeCompare(b.group_id)
    );
    for (const row of rows) {
      if (!m.has(row.group_id)) m.set(row.group_id, []);
      m.get(row.group_id)!.push(row.player_id);
    }
    return m;
  }, [pairMembers]);

  const memberIdsByTeam = useMemo(() => {
    const m = new Map<string, string[]>();
    const rows = [...teamMembers];
    rows.sort((a, b) =>
      a.group_id === b.group_id ? (a.position ?? 999) - (b.position ?? 999) : a.group_id.localeCompare(b.group_id)
    );
    for (const row of rows) {
      if (!m.has(row.group_id)) m.set(row.group_id, []);
      m.get(row.group_id)!.push(row.player_id);
    }
    return m;
  }, [teamMembers]);

  function pairDisplayName(groupId: string) {
    const ids = memberIdsByPair.get(groupId) ?? [];
    if (!ids.length) return "—";
    return ids.map((pid) => playerById.get(pid)?.name ?? pid).join(" / ");
  }

  // Team title + members line
  const teamLabelById = useMemo(() => {
    const m = new Map<string, { title: string; members: string }>();

    teamGroups.forEach((g, idx) => {
      const ids = memberIdsByTeam.get(g.id) ?? [];
      const members = ids.map((pid) => playerById.get(pid)?.name ?? pid).join(", ");

      const nm = (g.name ?? "").trim();
      const hasIdx = Number.isFinite(Number(g.team_index));
      const title = nm ? nm : hasIdx ? `Team ${Number(g.team_index)}` : `Team ${idx + 1}`;

      m.set(g.id, { title, members });
    });

    return m;
  }, [teamGroups, memberIdsByTeam, playerById]);

  // -----------------------------
  // Description
  // -----------------------------
  const description = useMemo(() => {
    if (kind === "individual") {
      if (individualRule.mode === "ALL") return "Individual Stableford · Total points across all rounds";
      const r = individualRule;
      return r.finalRequired
        ? `Individual Stableford · Best ${r.n} rounds (Final required)`
        : `Individual Stableford · Best ${r.n} rounds`;
    }

    if (kind === "pairs") {
      if (pairRule.mode === "ALL") return "Pairs Better Ball · Total points across all rounds";
      const r = pairRule;
      return r.finalRequired ? `Pairs Better Ball · Best ${r.q} rounds (Final required)` : `Pairs Better Ball · Best ${r.q} rounds`;
    }

    return `Teams · Best ${teamRule.bestY} positive scores per hole, minus 1 for each zero · All rounds`;
  }, [kind, individualRule, pairRule, teamRule.bestY]);

  // -----------------------------
  // Individual scoring
  // -----------------------------
  const individualRows = useMemo(() => {
    const rows: Array<{
      playerId: string;
      name: string;
      tourTotal: number;
      perRound: Record<string, number>;
      countedIds: Set<string>;
    }> = [];

    for (const p of players) {
      const perRound: Record<string, number> = {};

      for (const r of sortedRounds) {
        const rp = rpByRoundPlayer.get(`${r.id}|${p.id}`);
        if (!rp?.playing) {
          perRound[r.id] = 0;
          continue;
        }

        const courseId = r.course_id;
        if (!courseId) {
          perRound[r.id] = 0;
          continue;
        }

        const tee = teeFor(r.id, p.id); // ✅ FIX: use round_players.tee
        const parsMap = parsByCourseTeeHole.get(courseId)?.get(tee);
        if (!parsMap) {
          perRound[r.id] = 0;
          continue;
        }

        const hcp = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0;

        let sum = 0;
        for (let h = 1; h <= 18; h++) {
          const pr = parsMap.get(h);
          if (!pr) continue;

          const sc = scoreByRoundPlayerHole.get(`${r.id}|${p.id}|${h}`);
          if (!sc) continue;

          const raw = normalizeRawScore(sc.strokes, sc.pickup);
          sum += netStablefordPointsForHole({
            rawScore: raw,
            par: pr.par,
            strokeIndex: pr.si,
            playingHandicap: hcp,
          });
        }

        perRound[r.id] = sum;
      }

      let tourTotal = 0;
      let countedIds = new Set<string>();

      if (individualRule.mode === "BEST_N") {
        countedIds = pickBestRoundIds({
          sortedRoundIds,
          perRoundTotals: perRound,
          n: individualRule.n,
          finalRoundId: finalRoundId || null,
          finalRequired: individualRule.finalRequired,
        });
        for (const rid of countedIds) tourTotal += Number(perRound[rid] ?? 0) || 0;
      } else {
        for (const r of sortedRounds) tourTotal += Number(perRound[r.id] ?? 0) || 0;
      }

      rows.push({ playerId: p.id, name: p.name, tourTotal, perRound, countedIds });
    }

    rows.sort((a, b) => b.tourTotal - a.tourTotal || a.name.localeCompare(b.name));
    return rows;
  }, [
    players,
    sortedRounds,
    sortedRoundIds,
    parsByCourseTeeHole,
    rpByRoundPlayer,
    scoreByRoundPlayerHole,
    individualRule,
    finalRoundId,
    rpByRoundPlayer, // teeFor uses it
    playerById, // teeFor fallback
  ]);

  const femaleIndividualRows = useMemo(() => {
    return individualRows.filter((r) => teeFor(sortedRounds[0]?.id ?? "", r.playerId) === "F");
  }, [individualRows, sortedRounds]);

  const maleIndividualRows = useMemo(() => {
    return individualRows.filter((r) => teeFor(sortedRounds[0]?.id ?? "", r.playerId) !== "F");
  }, [individualRows, sortedRounds]);

  // -----------------------------
  // Pairs scoring (Better Ball per hole)
  // -----------------------------
  const pairRows = useMemo(() => {
    const rows: Array<{
      groupId: string;
      name: string;
      tourTotal: number;
      perRound: Record<string, number>;
      countedIds: Set<string>;
    }> = [];

    for (const g of pairGroups) {
      const memberIds = memberIdsByPair.get(g.id) ?? [];
      const displayName = pairDisplayName(g.id);

      const perRound: Record<string, number> = {};

      for (const r of sortedRounds) {
        const courseId = r.course_id;
        if (!courseId) {
          perRound[r.id] = 0;
          continue;
        }

        let sum = 0;

        for (let h = 1; h <= 18; h++) {
          let best = 0;

          for (const pid of memberIds) {
            const rp = rpByRoundPlayer.get(`${r.id}|${pid}`);
            if (!rp?.playing) continue;

            const sc = scoreByRoundPlayerHole.get(`${r.id}|${pid}|${h}`);
            if (!sc) continue;

            const tee = teeFor(r.id, pid); // ✅ FIX
            const pr = parsByCourseTeeHole.get(courseId)?.get(tee)?.get(h);
            if (!pr) continue;

            const raw = normalizeRawScore(sc.strokes, sc.pickup);
            const hcp = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0;

            const pts = netStablefordPointsForHole({
              rawScore: raw,
              par: pr.par,
              strokeIndex: pr.si,
              playingHandicap: hcp,
            });

            if (pts > best) best = pts;
          }

          sum += best;
        }

        perRound[r.id] = sum;
      }

      let tourTotal = 0;
      let countedIds = new Set<string>();

      if (pairRule.mode === "BEST_Q") {
        countedIds = pickBestRoundIds({
          sortedRoundIds,
          perRoundTotals: perRound,
          n: pairRule.q,
          finalRoundId: finalRoundId || null,
          finalRequired: pairRule.finalRequired,
        });
        for (const rid of countedIds) tourTotal += Number(perRound[rid] ?? 0) || 0;
      } else {
        for (const r of sortedRounds) tourTotal += Number(perRound[r.id] ?? 0) || 0;
      }

      rows.push({ groupId: g.id, name: displayName, tourTotal, perRound, countedIds });
    }

    rows.sort((a, b) => b.tourTotal - a.tourTotal || a.name.localeCompare(b.name));
    return rows;
  }, [
    pairGroups,
    memberIdsByPair,
    sortedRounds,
    sortedRoundIds,
    finalRoundId,
    pairRule,
    rpByRoundPlayer,
    playerById,
    parsByCourseTeeHole,
    scoreByRoundPlayerHole,
  ]);

  // -----------------------------
  // Teams scoring (best Y positive, minus 1 for each zero among eligible)
  // -----------------------------
  const teamRows = useMemo(() => {
    const rows: Array<{
      groupId: string;
      title: string;
      members: string;
      tourTotal: number;
      perRound: Record<string, number>;
    }> = [];

    const Y = clampInt(teamRule.bestY, 1, 99);

    for (const g of teamGroups) {
      const memberIds = memberIdsByTeam.get(g.id) ?? [];
      const lab = teamLabelById.get(g.id);
      const title = lab?.title ?? "Team";
      const membersLine = lab?.members ?? "";

      const perRound: Record<string, number> = {};
      let tourTotal = 0;

      for (const r of sortedRounds) {
        const courseId = r.course_id;
        if (!courseId) {
          perRound[r.id] = 0;
          continue;
        }

        let roundSum = 0;

        for (let h = 1; h <= 18; h++) {
          const positives: number[] = [];
          let zeroCount = 0;

          for (const pid of memberIds) {
            const rp = rpByRoundPlayer.get(`${r.id}|${pid}`);
            if (!rp?.playing) continue;

            const sc = scoreByRoundPlayerHole.get(`${r.id}|${pid}|${h}`);
            if (!sc) continue;

            const tee = teeFor(r.id, pid); // ✅ FIX
            const pr = parsByCourseTeeHole.get(courseId)?.get(tee)?.get(h);
            if (!pr) continue;

            const raw = normalizeRawScore(sc.strokes, sc.pickup);
            const hcp = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0;

            const pts = netStablefordPointsForHole({
              rawScore: raw,
              par: pr.par,
              strokeIndex: pr.si,
              playingHandicap: hcp,
            });

            if (pts === 0) zeroCount += 1;
            if (pts > 0) positives.push(pts);
          }

          positives.sort((a, b) => b - a);
          const selected = positives.slice(0, Math.min(Y, positives.length));

          let holeSum = 0;
          for (const pts of selected) holeSum += pts;
          holeSum -= zeroCount;

          roundSum += holeSum;
        }

        perRound[r.id] = roundSum;
        tourTotal += roundSum;
      }

      rows.push({ groupId: g.id, title, members: membersLine, tourTotal, perRound });
    }

    rows.sort((a, b) => b.tourTotal - a.tourTotal || a.title.localeCompare(b.title));
    return rows;
  }, [
    teamGroups,
    teamRule.bestY,
    teamLabelById,
    memberIdsByTeam,
    sortedRounds,
    rpByRoundPlayer,
    scoreByRoundPlayerHole,
    playerById,
    parsByCourseTeeHole,
  ]);

  // -----------------------------
  // TapCell (robust tap vs scroll)
  // -----------------------------
  function TapCell({
    href,
    counted,
    children,
    ariaLabel,
  }: {
    href: string;
    counted: boolean;
    children: React.ReactNode;
    ariaLabel: string;
  }) {
    const start = useRef<{ x: number; y: number } | null>(null);

    const base = "block w-full min-w-[44px] rounded-md px-2 py-1 text-right select-none touch-manipulation";
    const cls = counted
      ? `${base} border-2 border-blue-500 hover:bg-gray-50 active:bg-gray-100`
      : `${base} border border-transparent hover:bg-gray-50 active:bg-gray-100`;

    return (
      <span
        role="link"
        tabIndex={0}
        className={cls}
        aria-label={ariaLabel}
        onTouchStart={(e) => {
          const t = e.touches?.[0];
          if (!t) return;
          start.current = { x: t.clientX, y: t.clientY };
        }}
        onTouchEnd={(e) => {
          const t = e.changedTouches?.[0];
          const s = start.current;
          start.current = null;
          if (!t || !s) return;

          const dx = Math.abs(t.clientX - s.x);
          const dy = Math.abs(t.clientY - s.y);

          // treat as tap only if finger didn't move much
          if (dx <= 10 && dy <= 10) {
            router.push(href);
          }
        }}
        onClick={() => {
          // desktop / non-touch fallback
          router.push(href);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") router.push(href);
        }}
      >
        {children}
      </span>
    );
  }

  function IndividualRow({
    row,
  }: {
    row: { playerId: string; name: string; tourTotal: number; perRound: Record<string, number>; countedIds: Set<string> };
  }) {
    return (
      <tr key={row.playerId} className="border-b last:border-b-0">
        <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap">
          {row.name}
        </td>

        <td className="px-3 py-2 text-right text-sm font-extrabold text-gray-900">
          <span className="inline-flex min-w-[44px] justify-end rounded-md bg-yellow-100 px-2 py-1">{row.tourTotal}</span>
        </td>

        {sortedRounds.map((r) => {
          const val = row.perRound[r.id] ?? 0;
          const counted = individualRule.mode === "BEST_N" ? row.countedIds.has(r.id) : false;

          // go to the same hole-by-hole page used by: Rounds -> (Round) -> Results -> (Player)
          const href = `/m/tours/${tourId}/rounds/${r.id}/results/${row.playerId}`;

          return (
            <td key={r.id} className="px-3 py-2 text-right text-sm text-gray-900">
              <TapCell href={href} counted={counted} ariaLabel="Open player round detail">
                {val}
              </TapCell>
            </td>
          );
        })}
      </tr>
    );
  }

  // -----------------------------
  // UI
  // -----------------------------
  if (!tourId || !isLikelyUuid(tourId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900">
        <div className="mx-auto max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">
            Missing or invalid tour id in route.
            <div className="mt-2">
              <Link className="underline" href="/m">
                Go to mobile home
              </Link>
            </div>
          </div>
        </div>
        <MobileNav />
      </div>
    );
  }

  const colCount = 2 + sortedRounds.length;

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setKind("individual")}
              className={`rounded-xl px-3 py-2 text-sm font-semibold border ${
                kind === "individual"
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-900 border-gray-300 hover:bg-gray-50 active:bg-gray-100"
              }`}
            >
              Individual
            </button>
            <button
              type="button"
              onClick={() => setKind("pairs")}
              className={`rounded-xl px-3 py-2 text-sm font-semibold border ${
                kind === "pairs"
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-900 border-gray-300 hover:bg-gray-50 active:bg-gray-100"
              }`}
            >
              Pairs
            </button>
            <button
              type="button"
              onClick={() => setKind("teams")}
              className={`rounded-xl px-3 py-2 text-sm font-semibold border ${
                kind === "teams"
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-900 border-gray-300 hover:bg-gray-50 active:bg-gray-100"
              }`}
            >
              Teams
            </button>
          </div>

          <div className="mt-3 rounded-2xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
            {description}
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-5 w-40 rounded bg-gray-100" />
            <div className="h-4 w-64 rounded bg-gray-100" />
            <div className="h-64 rounded-2xl border bg-white" />
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorMsg}</div>
        ) : players.length === 0 ? (
          <div className="rounded-2xl border p-4 text-sm text-gray-700">No players found for this tour.</div>
        ) : sortedRounds.length === 0 ? (
          <div className="rounded-2xl border p-4 text-sm text-gray-700">No rounds found for this tour.</div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="sticky left-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700">
                      Name
                    </th>

                    <th className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700">
                      <span className="inline-flex items-center rounded-md bg-yellow-100 px-2 py-1 text-[11px] font-extrabold text-yellow-900">
                        TOUR
                      </span>
                    </th>

                    {sortedRounds.map((r, idx) => {
                      const isFinal = r.id === finalRoundId;
                      return (
                        <th
                          key={r.id}
                          className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700"
                          title={r.name ?? ""}
                        >
                          {roundLabel(r, idx, isFinal)}
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {kind === "teams" ? (
                    teamRows.length === 0 ? (
                      <tr>
                        <td colSpan={colCount} className="px-4 py-6 text-sm text-gray-700">
                          No teams found for this tour (tour_groups scope=tour type=team).
                        </td>
                      </tr>
                    ) : (
                      teamRows.map((row) => (
                        <tr key={row.groupId} className="border-b last:border-b-0">
                          <td className="sticky left-0 z-10 bg-white px-3 py-2 whitespace-nowrap">
                            <div className="text-sm font-semibold text-gray-900">{row.title}</div>
                            {row.members ? (
                              <div className="text-[11px] text-gray-500 truncate max-w-[220px]">{row.members}</div>
                            ) : null}
                          </td>

                          <td className="px-3 py-2 text-right text-sm font-extrabold text-gray-900">
                            <span className="inline-flex min-w-[44px] justify-end rounded-md bg-yellow-100 px-2 py-1">
                              {row.tourTotal}
                            </span>
                          </td>

                          {sortedRounds.map((r) => {
                            const val = row.perRound[r.id] ?? 0;
                            return (
                              <td key={r.id} className="px-3 py-2 text-right text-sm text-gray-900">
                                <span className="inline-flex min-w-[44px] justify-end rounded-md px-2 py-1">{val}</span>
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )
                  ) : kind === "pairs" ? (
                    pairRows.length === 0 ? (
                      <tr>
                        <td colSpan={colCount} className="px-4 py-6 text-sm text-gray-700">
                          No pairs found for this tour (tour_groups scope=tour type=pair).
                        </td>
                      </tr>
                    ) : (
                      pairRows.map((row) => (
                        <tr key={row.groupId} className="border-b last:border-b-0">
                          <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap">
                            {row.name}
                          </td>

                          {/* TOUR total NOT clickable */}
                          <td className="px-3 py-2 text-right text-sm font-extrabold text-gray-900">
                            <span className="inline-flex min-w-[44px] justify-end rounded-md bg-yellow-100 px-2 py-1">
                              {row.tourTotal}
                            </span>
                          </td>

                          {sortedRounds.map((r) => {
                            const val = row.perRound[r.id] ?? 0;
                            const counted = pairRule.mode === "BEST_Q" ? row.countedIds.has(r.id) : false;
                            const href = `/m/tours/${tourId}/leaderboards/pairs/${row.groupId}/${r.id}`;

                            return (
                              <td key={r.id} className="px-3 py-2 text-right text-sm text-gray-900">
                                <TapCell href={href} counted={counted} ariaLabel="Open pair round detail">
                                  {val}
                                </TapCell>
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )
                  ) : !separateGender ? (
                    individualRows.map((row) => <IndividualRow key={row.playerId} row={row} />)
                  ) : (
                    <>
                      {/* Girls label directly under header row */}
                      {femaleIndividualRows.length > 0 ? (
                        <tr className="bg-gray-50">
                          <td colSpan={colCount} className="px-3 py-2 text-xs font-semibold text-gray-700">
                            Girls
                          </td>
                        </tr>
                      ) : null}

                      {femaleIndividualRows.map((row) => (
                        <IndividualRow key={row.playerId} row={row} />
                      ))}

                      {/* divider between groups */}
                      {femaleIndividualRows.length > 0 && maleIndividualRows.length > 0 ? (
                        <tr>
                          <td colSpan={colCount} className="p-0">
                            <div className="h-[2px] bg-gray-200" />
                          </td>
                        </tr>
                      ) : null}

                      {/* Boys label directly before first M row */}
                      {maleIndividualRows.length > 0 ? (
                        <tr className="bg-gray-50">
                          <td colSpan={colCount} className="px-3 py-2 text-xs font-semibold text-gray-700">
                            Boys
                          </td>
                        </tr>
                      ) : null}

                      {maleIndividualRows.map((row) => (
                        <IndividualRow key={row.playerId} row={row} />
                      ))}
                    </>
                  )}
                </tbody>
              </table>
            </div>

            {(kind === "individual" && individualRule.mode === "BEST_N") || (kind === "pairs" && pairRule.mode === "BEST_Q") ? (
              <div className="mt-3 text-xs text-gray-600">
                Rounds outlined in <span className="font-semibold">blue</span> indicate which rounds count toward the Tour total.
              </div>
            ) : null}

            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm">
              <div className="font-semibold text-gray-900">Rounds</div>
              <div className="mt-1 text-gray-600">
                {sortedRounds.map((r, idx) => {
                  const isFinal = r.id === finalRoundId;
                  const lab = roundLabel(r, idx, isFinal);

                  const bestIso = pickBestRoundDateISO(r);
                  const dt = formatDateAuMelbourne(bestIso);

                  const courseName = safeName(asSingle(r.courses)?.name, "(course)");
                  return (
                    <div key={r.id} className="flex items-center justify-between gap-3 py-1">
                      <div className="min-w-0">
                        <span className="font-semibold">{lab}</span>
                        <span className="text-gray-700">{` · ${courseName}`}</span>
                      </div>
                      <div className="text-xs text-gray-500 whitespace-nowrap">{dt || ""}</div>
                    </div>
                  );
                })}
              </div>

              {/* Toggle at very bottom, below the rounds list */}
              {kind === "individual" ? (
                <div className="mt-4 border-t pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-gray-900">Separate Boys and Girls leaderboards?</div>
                    <button
                      type="button"
                      onClick={() => setSeparateGender((v) => !v)}
                      className={`rounded-xl px-3 py-2 text-sm font-semibold border ${
                        separateGender
                          ? "bg-gray-900 text-white border-gray-900"
                          : "bg-white text-gray-900 border-gray-300 hover:bg-gray-50 active:bg-gray-100"
                      }`}
                      aria-label="Toggle separate boys and girls leaderboards"
                    >
                      {separateGender ? "Yes" : "No"}
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-gray-600">If Yes: Girls shown first, then Boys.</div>
                </div>
              ) : null}
            </div>
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
