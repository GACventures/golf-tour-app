// app/m/tours/[id]/matches/leaderboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/* ---------------- Types ---------------- */

type Tee = "M" | "F";

type Tour = {
  id: string;
  name: string | null;
};

type RoundRow = {
  id: string;
  tour_id: string;
  round_no: number | null;
  created_at: string | null;
  played_on?: string | null;
  round_date?: string | null;
  name?: string | null;
};

type PlayerRow = {
  id: string;
  name: string | null;
  gender: string | null;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number;
};

type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup: boolean;
};

type ParRow = {
  course_id: string;
  hole_number: number;
  tee: string;
  par: number;
  stroke_index: number;
};

type CourseRow = {
  id: string;
  name: string | null;
};

type GroupRow = {
  id: string;
  name: string | null;
};

type GroupMemberRow = {
  group_id: string;
  player_id: string;
  position: number | null;
  players: PlayerRow | PlayerRow[] | null;
};

type MatchFormat = "INDIVIDUAL_MATCHPLAY" | "BETTERBALL_MATCHPLAY" | "INDIVIDUAL_STABLEFORD";

type MatchRoundSettingsRow = {
  id: string;
  round_id: string;
  tour_id: string;
  group_a_id: string;
  group_b_id: string;
  format: MatchFormat;
  double_points: boolean;
};

type MatchRoundMatchRow = {
  id: string;
  settings_id: string;
  match_no: number;
  match_round_match_players: Array<{
    side: "A" | "B";
    slot: 1 | 2;
    player_id: string;
  }>;
};

/* ---------------- Helpers ---------------- */

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function safeName(v: any, fallback: string) {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

/** Align with existing patterns: treat W/FEMALE as F */
function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  const isF = s === "F" || s === "FEMALE" || s === "W" || s === "WOMEN" || s === "WOMAN";
  return isF ? "F" : "M";
}

function normalizeRawScore(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  const n = Number(strokes);
  return Number.isFinite(n) ? String(n) : "";
}

function pickBestRoundDateISO(r: RoundRow): string | null {
  return (r as any).round_date ?? (r as any).played_on ?? r.created_at ?? null;
}

function parseDateForDisplay(s: string | null): Date | null {
  if (!s) return null;
  const raw = String(s).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const iso = isDateOnly ? `${raw}T00:00:00.000Z` : raw;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Use NZ locale without forcing timezone (mobile-first, consistent)
function fmtDate(d: Date | null): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-NZ", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`.replace(/\s+/g, " ");
}

function isMissingColumnError(msg: string, column: string) {
  const m = msg.toLowerCase();
  const c = column.toLowerCase();
  return m.includes("does not exist") && (m.includes(`.${c}`) || m.includes(`"${c}"`) || m.includes(` ${c} `));
}

/** Stableford (net) per hole — consistent with existing pages */
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

function formatLabelShort(fmt: MatchFormat | null): string {
  if (!fmt) return "—";
  if (fmt === "INDIVIDUAL_MATCHPLAY") return "Ind. M/P";
  if (fmt === "BETTERBALL_MATCHPLAY") return "BB M/P";
  return "Ind. Stblfd";
}

/* ---------------- Page ---------------- */

export default function MatchesLeaderboardPage() {
  const params = useParams<{ id?: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [settingsByRound, setSettingsByRound] = useState<Map<string, MatchRoundSettingsRow>>(new Map());

  const [groupA, setGroupA] = useState<GroupRow | null>(null);
  const [groupB, setGroupB] = useState<GroupRow | null>(null);

  const [membersA, setMembersA] = useState<Array<{ playerId: string; name: string; gender: Tee | null; order: number }>>([]);
  const [membersB, setMembersB] = useState<Array<{ playerId: string; name: string; gender: Tee | null; order: number }>>([]);

  const [roundPlayersByRound, setRoundPlayersByRound] = useState<Map<string, Map<string, RoundPlayerRow>>>(new Map());
  const [scoresByRound, setScoresByRound] = useState<Map<string, ScoreRow[]>>(new Map());

  const [courseByRound, setCourseByRound] = useState<Map<string, { course_id: string | null; name: string }>>(new Map());
  const [parsByCourseTeeHole, setParsByCourseTeeHole] = useState<Map<string, Map<Tee, Map<number, { par: number; si: number }>>>>(
    new Map()
  );

  const [matchesBySettings, setMatchesBySettings] = useState<Map<string, MatchRoundMatchRow[]>>(new Map());

  useEffect(() => {
    let alive = true;

    async function loadRoundsWithFallback() {
      // We only need ordering + ids; but we also want a display date.
      const baseCols = "id,tour_id,round_no,created_at";
      const cols1 = `${baseCols},round_date,played_on`;
      const cols2 = `${baseCols},played_on`;

      const q = (selectCols: string) =>
        supabase
          .from("rounds")
          .select(selectCols)
          .eq("tour_id", tourId)
          .order("round_no", { ascending: true })
          .order("created_at", { ascending: true });

      const r1 = await q(cols1);
      if (r1.error) {
        if (isMissingColumnError(r1.error.message, "round_date")) {
          const r2 = await q(cols2);
          if (r2.error) {
            if (isMissingColumnError(r2.error.message, "played_on")) {
              const r3 = await q(baseCols);
              if (r3.error) throw r3.error;
              return (r3.data ?? []) as any as RoundRow[];
            }
            throw r2.error;
          }
          return (r2.data ?? []) as any as RoundRow[];
        }
        throw r1.error;
      }
      return (r1.data ?? []) as any as RoundRow[];
    }

    async function load() {
      setLoading(true);
      setError("");

      try {
        if (!tourId || !isLikelyUuid(tourId)) throw new Error("Missing or invalid tour id.");

        // Tour meta
        const { data: tRow, error: tErr } = await supabase.from("tours").select("id,name").eq("id", tourId).single();
        if (tErr) throw tErr;

        // Rounds
        const rds = await loadRoundsWithFallback();

        // Settings for any rounds (format + teams + double points)
        const { data: sRows, error: sErr } = await supabase
          .from("match_round_settings")
          .select("id,tour_id,round_id,group_a_id,group_b_id,format,double_points,created_at,updated_at")
          .eq("tour_id", tourId);
        if (sErr) throw sErr;

        const sMap = new Map<string, MatchRoundSettingsRow>();
        (sRows ?? []).forEach((r: any) => {
          if (r?.round_id) sMap.set(String(r.round_id), r as MatchRoundSettingsRow);
        });

        // Determine teams (group_a/group_b) from *any* settings row (assumed consistent across rounds)
        const anySettings = (sRows ?? [])[0] as any;
        const groupAId = anySettings?.group_a_id ? String(anySettings.group_a_id) : "";
        const groupBId = anySettings?.group_b_id ? String(anySettings.group_b_id) : "";

        let gA: GroupRow | null = null;
        let gB: GroupRow | null = null;

        if (groupAId && groupBId) {
          const { data: gRows, error: gErr } = await supabase
            .from("tour_groups")
            .select("id,name")
            .in("id", [groupAId, groupBId]);
          if (gErr) throw gErr;

          const byId = new Map<string, GroupRow>();
          (gRows ?? []).forEach((g: any) => byId.set(String(g.id), { id: String(g.id), name: g.name ?? null }));

          gA = byId.get(groupAId) ?? { id: groupAId, name: "Team A" };
          gB = byId.get(groupBId) ?? { id: groupBId, name: "Team B" };
        }

        // Members (ordered)
        async function loadMembers(groupId: string) {
          const { data: mem, error: memErr } = await supabase
            .from("tour_group_members")
            .select("group_id,player_id,position,players(id,name,gender)")
            .eq("group_id", groupId)
            .order("position", { ascending: true, nullsFirst: true });
          if (memErr) throw memErr;

          const list = (mem ?? [])
            .map((m: any, idx: number) => {
              const p = Array.isArray(m.players) ? m.players[0] : m.players;
              if (!p?.id) return null;
              return {
                playerId: String(p.id),
                name: safeName(p.name, "(unnamed)"),
                gender: p.gender ? normalizeTee(p.gender) : null,
                order: Number.isFinite(Number(m.position)) ? Number(m.position) : idx + 1,
              };
            })
            .filter(Boolean) as Array<{ playerId: string; name: string; gender: Tee | null; order: number }>;

          // stable sort by order then name
          list.sort((a, b) => (a.order !== b.order ? a.order - b.order : a.name.localeCompare(b.name)));
          return list;
        }

        let memA: Array<{ playerId: string; name: string; gender: Tee | null; order: number }> = [];
        let memB: Array<{ playerId: string; name: string; gender: Tee | null; order: number }> = [];

        if (gA?.id && gB?.id) {
          memA = await loadMembers(gA.id);
          memB = await loadMembers(gB.id);
        }

        // Round players, scores, courses+pars for all rounds we might need
        const roundIds = rds.map((r) => String(r.id));
        const allPlayerIds = Array.from(new Set([...memA.map((x) => x.playerId), ...memB.map((x) => x.playerId)]));

        // course_id per round + course names (for pars lookup)
        const { data: rCourseRows, error: rCourseErr } = await supabase
          .from("rounds")
          .select("id,course_id,courses(name)")
          .eq("tour_id", tourId);
        if (rCourseErr) throw rCourseErr;

        const rb = new Map<string, { course_id: string | null; name: string }>();
        (rCourseRows ?? []).forEach((r: any) => {
          const cid = r.course_id ? String(r.course_id) : null;
          const c = r.courses;
          const nm = Array.isArray(c) ? c?.[0]?.name : c?.name;
          rb.set(String(r.id), { course_id: cid, name: safeName(nm, "Course") });
        });

        // round_players for all rounds & only our team players (fast + consistent)
        const rpByRound = new Map<string, Map<string, RoundPlayerRow>>();
        if (roundIds.length > 0 && allPlayerIds.length > 0) {
          const { data: rpRows, error: rpErr } = await supabase
            .from("round_players")
            .select("round_id,player_id,playing,playing_handicap")
            .in("round_id", roundIds)
            .in("player_id", allPlayerIds);
          if (rpErr) throw rpErr;

          (rpRows ?? []).forEach((x: any) => {
            const rid = String(x.round_id);
            if (!rpByRound.has(rid)) rpByRound.set(rid, new Map());
            rpByRound.get(rid)!.set(String(x.player_id), {
              round_id: rid,
              player_id: String(x.player_id),
              playing: x.playing === true,
              playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : 0,
            });
          });
        }

        // scores per round (avoid pagination by fetching per round)
        const scByRound = new Map<string, ScoreRow[]>();
        if (roundIds.length > 0 && allPlayerIds.length > 0) {
          for (const rid of roundIds) {
            const { data: sRows2, error: sErr2 } = await supabase
              .from("scores")
              .select("round_id,player_id,hole_number,strokes,pickup")
              .eq("round_id", rid)
              .in("player_id", allPlayerIds);

            if (sErr2) throw sErr2;

            const list: ScoreRow[] =
              (sRows2 ?? []).map((s: any) => ({
                round_id: String(s.round_id),
                player_id: String(s.player_id),
                hole_number: Number(s.hole_number),
                strokes: s.strokes === null || s.strokes === undefined ? null : Number(s.strokes),
                pickup: s.pickup === true,
              })) ?? [];

            scByRound.set(rid, list);
          }
        }

        // pars for all courses used by those rounds
        const courseIds = Array.from(new Set(Array.from(rb.values()).map((x) => x.course_id).filter(Boolean))) as string[];
        const parsBy = new Map<string, Map<Tee, Map<number, { par: number; si: number }>>>();

        if (courseIds.length > 0) {
          const { data: pRows, error: pErr } = await supabase
            .from("pars")
            .select("course_id,hole_number,par,stroke_index,tee")
            .in("course_id", courseIds)
            .in("tee", ["M", "F"])
            .order("hole_number", { ascending: true });
          if (pErr) throw pErr;

          (pRows ?? []).forEach((p: any) => {
            const cid = String(p.course_id);
            const tee: Tee = normalizeTee(p.tee);
            if (!parsBy.has(cid)) parsBy.set(cid, new Map());
            if (!parsBy.get(cid)!.has(tee)) parsBy.get(cid)!.set(tee, new Map());
            parsBy.get(cid)!.get(tee)!.set(Number(p.hole_number), { par: Number(p.par), si: Number(p.stroke_index) });
          });
        }

        // matches per settings (only needed for matchplay formats)
        const matchesMap = new Map<string, MatchRoundMatchRow[]>();
        const settingIds = Array.from(new Set((sRows ?? []).map((x: any) => String(x.id)).filter(Boolean)));

        if (settingIds.length > 0) {
          // Load all matches for these settings
          const { data: mRows, error: mErr } = await supabase
            .from("match_round_matches")
            .select("id,settings_id,match_no,match_round_match_players(side,slot,player_id)")
            .in("settings_id", settingIds)
            .order("match_no", { ascending: true });
          if (mErr) throw mErr;

          (mRows ?? []).forEach((m: any) => {
            const sid = String(m.settings_id);
            if (!matchesMap.has(sid)) matchesMap.set(sid, []);
            matchesMap.get(sid)!.push({
              id: String(m.id),
              settings_id: sid,
              match_no: Number(m.match_no),
              match_round_match_players: (m.match_round_match_players ?? []).map((mp: any) => ({
                side: String(mp.side) as "A" | "B",
                slot: Number(mp.slot) as 1 | 2,
                player_id: String(mp.player_id),
              })),
            });
          });

          // Keep each settings group sorted
          for (const [sid, list] of matchesMap.entries()) {
            list.sort((a, b) => a.match_no - b.match_no);
            matchesMap.set(sid, list);
          }
        }

        if (!alive) return;

        setTour(tRow as Tour);
        setRounds(rds);
        setSettingsByRound(sMap);

        setGroupA(gA);
        setGroupB(gB);

        setMembersA(memA);
        setMembersB(memB);

        setRoundPlayersByRound(rpByRound);
        setScoresByRound(scByRound);

        setCourseByRound(rb);
        setParsByCourseTeeHole(parsBy);

        setMatchesBySettings(matchesMap);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load matches leaderboard.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    if (tourId) void load();
    else {
      setError("Missing tour id in route.");
      setLoading(false);
    }

    return () => {
      alive = false;
    };
  }, [tourId]);

  const sortedRounds = useMemo(() => {
    const arr = [...rounds];
    arr.sort((a, b) => {
      const aNo = typeof a.round_no === "number" ? a.round_no : null;
      const bNo = typeof b.round_no === "number" ? b.round_no : null;
      if (aNo != null && bNo != null && aNo !== bNo) return aNo - bNo;
      if (aNo != null && bNo == null) return -1;
      if (aNo == null && bNo != null) return 1;

      const da = parseDateForDisplay(a.created_at)?.getTime() ?? 0;
      const db = parseDateForDisplay(b.created_at)?.getTime() ?? 0;
      if (da !== db) return da - db;

      return String(a.id).localeCompare(String(b.id));
    });
    return arr;
  }, [rounds]);

  // Quick lookup maps
  const playerMeta = useMemo(() => {
    const m = new Map<string, { name: string; gender: Tee | null; team: "A" | "B" }>();
    for (const p of membersA) m.set(p.playerId, { name: p.name, gender: p.gender, team: "A" });
    for (const p of membersB) m.set(p.playerId, { name: p.name, gender: p.gender, team: "B" });
    return m;
  }, [membersA, membersB]);

  const scoreByRoundPlayerHole = useMemo(() => {
    const outer = new Map<string, Map<string, ScoreRow>>(); // round_id -> (player|hole -> score)
    for (const [rid, list] of scoresByRound.entries()) {
      const inner = new Map<string, ScoreRow>();
      for (const s of list) inner.set(`${s.player_id}|${s.hole_number}`, s);
      outer.set(rid, inner);
    }
    return outer;
  }, [scoresByRound]);

  function getParSi(courseId: string | null, tee: Tee, hole: number) {
    if (!courseId) return null;
    const byCourse = parsByCourseTeeHole.get(courseId);
    if (!byCourse) return null;
    const byTee = byCourse.get(tee) || byCourse.get("M") || byCourse.get("F") || null;
    if (!byTee) return null;
    return byTee.get(hole) ?? null;
  }

  function stablefordTotalForRoundPlayer(roundId: string, playerId: string): number {
    const rpMap = roundPlayersByRound.get(roundId);
    const rp = rpMap?.get(playerId);
    if (!rp?.playing) return 0;

    const courseId = courseByRound.get(roundId)?.course_id ?? null;
    const tee = playerMeta.get(playerId)?.gender ?? "M";
    const scoreMap = scoreByRoundPlayerHole.get(roundId);
    if (!scoreMap || !courseId) return 0;

    let sum = 0;
    for (let h = 1; h <= 18; h++) {
      const pr = getParSi(courseId, tee, h);
      if (!pr) continue;

      const sc = scoreMap.get(`${playerId}|${h}`);
      if (!sc) continue;

      const raw = normalizeRawScore(sc.strokes, sc.pickup);
      const pts = netStablefordPointsForHole({
        rawScore: raw,
        par: pr.par,
        strokeIndex: pr.si,
        playingHandicap: rp.playing_handicap || 0,
      });

      sum += pts;
    }
    return sum;
  }

  // Matchplay hole win based on stableford points (P=0; 0/0 halves)
  function matchplayPointsForRound(roundId: string, settings: MatchRoundSettingsRow, matches: MatchRoundMatchRow[]) {
    const pointsByPlayer = new Map<string, number>();

    // defaults
    for (const p of membersA) pointsByPlayer.set(p.playerId, 0);
    for (const p of membersB) pointsByPlayer.set(p.playerId, 0);

    const mult = settings.double_points ? 2 : 1;

    for (const match of matches) {
      const mp = match.match_round_match_players ?? [];
      const a1 = mp.find((x) => x.side === "A" && x.slot === 1)?.player_id ?? null;
      const a2 = mp.find((x) => x.side === "A" && x.slot === 2)?.player_id ?? null;
      const b1 = mp.find((x) => x.side === "B" && x.slot === 1)?.player_id ?? null;
      const b2 = mp.find((x) => x.side === "B" && x.slot === 2)?.player_id ?? null;

      // INDIVIDUAL_MATCHPLAY expects a1 and b1
      // BETTERBALL_MATCHPLAY expects a1,a2,b1,b2
      if (settings.format === "INDIVIDUAL_MATCHPLAY") {
        if (!a1 || !b1) continue;

        const res = computeMatchplayResult(roundId, [{ side: "A", playerIds: [a1] }, { side: "B", playerIds: [b1] }]);
        // win=1 lose=0 tie=0.5
        applyMatchResultPoints(pointsByPlayer, res, mult);
      } else if (settings.format === "BETTERBALL_MATCHPLAY") {
        if (!a1 || !a2 || !b1 || !b2) continue;

        const res = computeMatchplayResult(roundId, [
          { side: "A", playerIds: [a1, a2] },
          { side: "B", playerIds: [b1, b2] },
        ]);
        applyMatchResultPoints(pointsByPlayer, res, mult);
      }
    }

    return pointsByPlayer;
  }

  function computeMatchplayResult(
    roundId: string,
    sides: Array<{ side: "A" | "B"; playerIds: string[] }>
  ): { sideAPlayers: string[]; sideBPlayers: string[]; winner: "A" | "B" | "TIE" } {
    const courseId = courseByRound.get(roundId)?.course_id ?? null;
    const scoreMap = scoreByRoundPlayerHole.get(roundId);
    if (!courseId || !scoreMap) {
      return { sideAPlayers: sides[0].playerIds, sideBPlayers: sides[1].playerIds, winner: "TIE" };
    }

    const rpMap = roundPlayersByRound.get(roundId) ?? new Map<string, RoundPlayerRow>();

    // Compute hole-by-hole best stableford for each side (individual = that player)
    let aUp = 0;
    for (let h = 1; h <= 18; h++) {
      const aPts = bestSideStablefordForHole(roundId, courseId, scoreMap, rpMap, sides[0].playerIds, h);
      const bPts = bestSideStablefordForHole(roundId, courseId, scoreMap, rpMap, sides[1].playerIds, h);

      if (aPts > bPts) aUp += 1;
      else if (bPts > aPts) aUp -= 1;
      // else halved
    }

    const winner: "A" | "B" | "TIE" = aUp > 0 ? "A" : aUp < 0 ? "B" : "TIE";
    return { sideAPlayers: sides[0].playerIds, sideBPlayers: sides[1].playerIds, winner };
  }

  function bestSideStablefordForHole(
    roundId: string,
    courseId: string,
    scoreMap: Map<string, ScoreRow>,
    rpMap: Map<string, RoundPlayerRow>,
    playerIds: string[],
    hole: number
  ) {
    let best = 0;

    for (const pid of playerIds) {
      const rp = rpMap.get(pid);
      if (!rp?.playing) continue;

      const tee = playerMeta.get(pid)?.gender ?? "M";
      const pr = getParSi(courseId, tee, hole);
      if (!pr) continue;

      const sc = scoreMap.get(`${pid}|${hole}`);
      if (!sc) continue;

      const raw = normalizeRawScore(sc.strokes, sc.pickup);
      const pts = netStablefordPointsForHole({
        rawScore: raw,
        par: pr.par,
        strokeIndex: pr.si,
        playingHandicap: rp.playing_handicap || 0,
      });

      if (pts > best) best = pts;
    }

    return best;
  }

  function applyMatchResultPoints(
    pointsByPlayer: Map<string, number>,
    res: { sideAPlayers: string[]; sideBPlayers: string[]; winner: "A" | "B" | "TIE" },
    mult: number
  ) {
    if (res.winner === "TIE") {
      for (const pid of res.sideAPlayers) pointsByPlayer.set(pid, (pointsByPlayer.get(pid) || 0) + 0.5 * mult);
      for (const pid of res.sideBPlayers) pointsByPlayer.set(pid, (pointsByPlayer.get(pid) || 0) + 0.5 * mult);
      return;
    }

    const winSide = res.winner;
    const loseSide = winSide === "A" ? "B" : "A";

    const winners = winSide === "A" ? res.sideAPlayers : res.sideBPlayers;
    const losers = loseSide === "A" ? res.sideAPlayers : res.sideBPlayers;

    for (const pid of winners) pointsByPlayer.set(pid, (pointsByPlayer.get(pid) || 0) + 1 * mult);
    for (const pid of losers) pointsByPlayer.set(pid, (pointsByPlayer.get(pid) || 0) + 0 * mult);
  }

  function stablefordWinnersPointsForRound(roundId: string, settings: MatchRoundSettingsRow) {
    const mult = settings.double_points ? 2 : 1;

    const allTourPlayerIds = Array.from(playerMeta.keys());
    const rpMap = roundPlayersByRound.get(roundId) ?? new Map<string, RoundPlayerRow>();

    // Only players marked playing contribute
    const playingIds = allTourPlayerIds.filter((pid) => rpMap.get(pid)?.playing);

    // No players playing: nobody scores
    const pointsByPlayer = new Map<string, number>();
    for (const pid of allTourPlayerIds) pointsByPlayer.set(pid, 0);
    if (playingIds.length === 0) return pointsByPlayer;

    const totals = playingIds.map((pid) => ({
      playerId: pid,
      total: stablefordTotalForRoundPlayer(roundId, pid),
    }));

    // winners target = N/2 where N = all players on tour (your rule)
    const N = allTourPlayerIds.length;
    const target = Math.floor(N / 2);

    // Sort descending by total
    totals.sort((a, b) => b.total - a.total);

    if (target <= 0) return pointsByPlayer;

    // Determine cutoff at position target (1-indexed)
    const above = totals.filter((x) => x.total > (totals[target - 1]?.total ?? -Infinity));
    const cutoffScore = totals[target - 1]?.total ?? null;
    const atCutoff = cutoffScore === null ? [] : totals.filter((x) => x.total === cutoffScore);

    // Points:
    // - Above cutoff: 1
    // - At cutoff: 1 if above+atCutoff <= target else fractional so total awarded = target
    const aboveCount = above.length;
    const remaining = target - aboveCount;

    let cutoffPtsEach = 0;
    if (cutoffScore !== null && atCutoff.length > 0) {
      if (aboveCount + atCutoff.length <= target) cutoffPtsEach = 1;
      else cutoffPtsEach = remaining > 0 ? remaining / atCutoff.length : 0;
    }

    for (const pid of allTourPlayerIds) pointsByPlayer.set(pid, 0);

    for (const x of above) pointsByPlayer.set(x.playerId, 1 * mult);
    for (const x of atCutoff) pointsByPlayer.set(x.playerId, cutoffPtsEach * mult);

    return pointsByPlayer;
  }

  const computed = useMemo(() => {
    // Points per player per round; totals per player + per team
    const roundCols = sortedRounds.map((r, idx) => ({
      roundId: r.id,
      label: `R${r.round_no ?? idx + 1}`,
      dateLabel: fmtDate(parseDateForDisplay(pickBestRoundDateISO(r))),
      format: settingsByRound.get(r.id)?.format ?? null,
      formatShort: formatLabelShort(settingsByRound.get(r.id)?.format ?? null),
      hasSettings: settingsByRound.has(r.id),
    }));

    const playerIdsA = membersA.map((m) => m.playerId);
    const playerIdsB = membersB.map((m) => m.playerId);

    const allPlayerIds = [...playerIdsA, ...playerIdsB];

    // Initialize structures
    const ptsByPlayerRound = new Map<string, Map<string, number>>(); // player -> (roundId -> pts)
    const totalByPlayer = new Map<string, number>();
    const totalByTeam = new Map<"A" | "B", number>([
      ["A", 0],
      ["B", 0],
    ]);
    const teamByRound = new Map<string, { A: number; B: number }>();

    for (const pid of allPlayerIds) {
      ptsByPlayerRound.set(pid, new Map());
      totalByPlayer.set(pid, 0);
    }

    for (const col of roundCols) {
      const rid = col.roundId;
      const settings = settingsByRound.get(rid) ?? null;

      const perPlayerPoints = new Map<string, number>();
      for (const pid of allPlayerIds) perPlayerPoints.set(pid, 0);

      if (settings) {
        if (settings.format === "INDIVIDUAL_STABLEFORD") {
          const m = stablefordWinnersPointsForRound(rid, settings);
          for (const [pid, v] of m.entries()) perPlayerPoints.set(pid, v);
        } else {
          // matchplay formats
          const matches = matchesBySettings.get(settings.id) ?? [];
          const m = matchplayPointsForRound(rid, settings, matches);
          for (const [pid, v] of m.entries()) perPlayerPoints.set(pid, v);
        }
      }

      // Fill by player, compute team sums
      let sumA = 0;
      let sumB = 0;

      for (const pid of allPlayerIds) {
        const v = perPlayerPoints.get(pid) ?? 0;
        ptsByPlayerRound.get(pid)!.set(rid, v);
        totalByPlayer.set(pid, (totalByPlayer.get(pid) || 0) + v);

        const tm = playerMeta.get(pid)?.team ?? null;
        if (tm === "A") sumA += v;
        else if (tm === "B") sumB += v;
      }

      teamByRound.set(rid, { A: sumA, B: sumB });
      totalByTeam.set("A", (totalByTeam.get("A") || 0) + sumA);
      totalByTeam.set("B", (totalByTeam.get("B") || 0) + sumB);
    }

    return {
      roundCols,
      ptsByPlayerRound,
      totalByPlayer,
      totalByTeam,
      teamByRound,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedRounds, settingsByRound, membersA, membersB, playerMeta, matchesBySettings, roundPlayersByRound, scoresByRound, courseByRound, parsByCourseTeeHole]);

  const hasTeams = groupA?.id && groupB?.id && membersA.length > 0 && membersB.length > 0;

  /* ---------------- UI ---------------- */

  if (!tourId || !isLikelyUuid(tourId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900">
        <div className="mx-auto w-full max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">Missing or invalid tour id.</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-dvh bg-white text-gray-900">
        <div className="mx-auto w-full max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">Loading…</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-dvh bg-white text-gray-900">
        <div className="mx-auto w-full max-w-md px-4 py-6">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
          <div className="mt-4">
            <Link className="underline text-sm" href={`/m/tours/${tourId}/rounds?mode=matches-leaderboard`}>
              Back to Rounds
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!hasTeams) {
    return (
      <div className="min-h-dvh bg-white text-gray-900">
        <div className="mx-auto w-full max-w-md px-4 py-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-extrabold leading-tight">Matches · Leaderboard</div>
            </div>
            <Link
              className="shrink-0 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              href={`/m/tours/${tourId}/rounds?mode=matches-format`}
            >
              Format
            </Link>
          </div>

          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
            Teams are not configured for this tour yet.
          </div>
        </div>
      </div>
    );
  }

  const teamAName = safeName(groupA?.name, "Team A");
  const teamBName = safeName(groupB?.name, "Team B");

  const headerCellBase = "border-b border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 bg-gray-50";
  const bodyCellBase = "px-3 py-2 text-sm text-gray-900";
  const stickyNameCell = "sticky left-0 z-10 bg-white";

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-10">
      <div className="mx-auto w-full max-w-md px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-extrabold leading-tight">Matches · Leaderboard</div>
          </div>

          <div className="flex gap-2">
            <Link
              className="shrink-0 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              href={`/m/tours/${tourId}/rounds?mode=matches-results`}
            >
              Results
            </Link>
            <Link
              className="shrink-0 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
              href={`/m/tours/${tourId}/rounds?mode=matches-format`}
            >
              Format
            </Link>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-max border-collapse">
            <thead>
              {/* Row 1: blank, Total, R1..Rn */}
              <tr className="bg-gray-50">
                <th className={`${headerCellBase} ${stickyNameCell} text-left`}></th>

                <th className={`${headerCellBase} text-center`}>Total</th>

                {computed.roundCols.map((c) => (
                  <th key={c.roundId} className={`${headerCellBase} text-center`}>
                    {c.label}
                  </th>
                ))}
              </tr>

              {/* Row 2: blank, blank, format under each round */}
              <tr className="bg-gray-50">
                <th className={`${headerCellBase} ${stickyNameCell} text-left`}></th>

                <th className={`${headerCellBase} text-center`}></th>

                {computed.roundCols.map((c) => (
                  <th key={c.roundId} className={`${headerCellBase} text-center text-[11px] font-semibold text-gray-600`}>
                    {c.formatShort}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {/* TEAM A header row */}
              <tr className="bg-gray-50">
                <td className={`${bodyCellBase} ${stickyNameCell} font-extrabold text-gray-900 whitespace-nowrap`}>{teamAName}</td>

                <td className={`${bodyCellBase} text-center font-extrabold`}>
                  {Number(computed.totalByTeam.get("A") || 0).toFixed(2).replace(/\.00$/, "")}
                </td>

                {computed.roundCols.map((c) => {
                  const v = computed.teamByRound.get(c.roundId)?.A ?? 0;
                  return (
                    <td key={c.roundId} className={`${bodyCellBase} text-center font-semibold text-gray-900`}>
                      {Number(v).toFixed(2).replace(/\.00$/, "")}
                    </td>
                  );
                })}
              </tr>

              {/* TEAM A player rows (NO horizontal separators between players) */}
              {membersA.map((p) => {
                const total = computed.totalByPlayer.get(p.playerId) ?? 0;

                return (
                  <tr key={`A:${p.playerId}`}>
                    <td className={`${bodyCellBase} ${stickyNameCell} font-semibold text-gray-900 whitespace-nowrap`}>{p.name}</td>

                    <td className={`${bodyCellBase} text-center font-semibold`}>{Number(total).toFixed(2).replace(/\.00$/, "")}</td>

                    {computed.roundCols.map((c) => {
                      const v = computed.ptsByPlayerRound.get(p.playerId)?.get(c.roundId) ?? 0;
                      return (
                        <td key={`${p.playerId}:${c.roundId}`} className={`${bodyCellBase} text-center`}>
                          {Number(v).toFixed(2).replace(/\.00$/, "")}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

              {/* Single divider line after final player in Team A */}
              <tr>
                <td colSpan={2 + computed.roundCols.length} className="h-px bg-gray-200" />
              </tr>

              {/* TEAM B header row */}
              <tr className="bg-gray-50">
                <td className={`${bodyCellBase} ${stickyNameCell} font-extrabold text-gray-900 whitespace-nowrap`}>{teamBName}</td>

                <td className={`${bodyCellBase} text-center font-extrabold`}>
                  {Number(computed.totalByTeam.get("B") || 0).toFixed(2).replace(/\.00$/, "")}
                </td>

                {computed.roundCols.map((c) => {
                  const v = computed.teamByRound.get(c.roundId)?.B ?? 0;
                  return (
                    <td key={c.roundId} className={`${bodyCellBase} text-center font-semibold text-gray-900`}>
                      {Number(v).toFixed(2).replace(/\.00$/, "")}
                    </td>
                  );
                })}
              </tr>

              {/* TEAM B player rows */}
              {membersB.map((p) => {
                const total = computed.totalByPlayer.get(p.playerId) ?? 0;

                return (
                  <tr key={`B:${p.playerId}`}>
                    <td className={`${bodyCellBase} ${stickyNameCell} font-semibold text-gray-900 whitespace-nowrap`}>{p.name}</td>

                    <td className={`${bodyCellBase} text-center font-semibold`}>{Number(total).toFixed(2).replace(/\.00$/, "")}</td>

                    {computed.roundCols.map((c) => {
                      const v = computed.ptsByPlayerRound.get(p.playerId)?.get(c.roundId) ?? 0;
                      return (
                        <td key={`${p.playerId}:${c.roundId}`} className={`${bodyCellBase} text-center`}>
                          {Number(v).toFixed(2).replace(/\.00$/, "")}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
