// app/m/tours/[id]/matches/leaderboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/* ---------------- Types ---------------- */

type Tee = "M" | "F";

type TourRow = { id: string; name: string | null };

type RoundRow = {
  id: string;
  tour_id: string;
  course_id: string | null;
  round_no?: number | null;
  round_date?: string | null; // may not exist
  played_on?: string | null; // may not exist
  created_at: string | null;
};

type SettingsRow = {
  id: string;
  tour_id: string;
  round_id: string;
  group_a_id: string;
  group_b_id: string;
  format: "INDIVIDUAL_MATCHPLAY" | "BETTERBALL_MATCHPLAY" | "INDIVIDUAL_STABLEFORD";
  double_points: boolean;
};

type GroupRow = { id: string; name: string | null };

type PlayerRow = { id: string; name: string | null; gender?: string | null };

type GroupMemberRow = {
  group_id: string;
  player_id: string;
  position: number | null;
  players: PlayerRow | PlayerRow[] | null;
};

type MatchRow = {
  id: string;
  settings_id: string;
  match_no: number;
};

type MatchPlayerRow = {
  match_id: string;
  side: "A" | "B";
  slot: number; // 1 or 2
  player_id: string;
};

type RoundPlayerRow = {
  player_id: string;
  playing: boolean;
  playing_handicap: number;
};

type ScoreRow = {
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup: boolean | null;
};

type ParRow = {
  course_id: string;
  hole_number: number;
  tee: string;
  par: number;
  stroke_index: number;
};

/* ---------------- Helpers ---------------- */

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isMissingColumnError(msg: string, column: string) {
  const m = String(msg ?? "").toLowerCase();
  const c = column.toLowerCase();
  return m.includes("does not exist") && (m.includes(`.${c}`) || m.includes(`"${c}"`) || m.includes(` ${c} `));
}

function safeText(v: any, fallback: string) {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  const isF = s === "F" || s === "FEMALE" || s === "W" || s === "WOMEN" || s === "WOMAN";
  return isF ? "F" : "M";
}

function normalizePlayerJoin(val: any): PlayerRow | null {
  if (!val) return null;
  const p = Array.isArray(val) ? val[0] : val;
  if (!p?.id) return null;
  return { id: String(p.id), name: String(p.name ?? "").trim() || "(unnamed)", gender: p.gender ?? null };
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

function fmtAuMelbourneDate(d: Date | null): string {
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

function normalizeRawScore(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  const n = Number(strokes);
  return Number.isFinite(n) ? String(n) : "";
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

function matchplayWinnerFromHoleWinners(holeWinners: Array<"A" | "B" | "HALVED">): "A" | "B" | "TIE" {
  let aUp = 0;
  let bUp = 0;

  for (let i = 0; i < 18; i++) {
    const h = holeWinners[i] ?? "HALVED";
    if (h === "A") aUp++;
    if (h === "B") bUp++;

    const diff = aUp - bUp;
    const holesPlayed = i + 1;
    const holesRemaining = 18 - holesPlayed;

    if (Math.abs(diff) > holesRemaining) {
      return diff > 0 ? "A" : "B";
    }
  }

  const diff = aUp - bUp;
  if (diff === 0) return "TIE";
  return diff > 0 ? "A" : "B";
}

function formatShortLabel(f: SettingsRow["format"]) {
  if (f === "INDIVIDUAL_MATCHPLAY") return "Ind MP";
  if (f === "BETTERBALL_MATCHPLAY") return "BB MP";
  return "Stableford";
}

/* ---------------- Page ---------------- */

export default function MatchesLeaderboardPage() {
  const params = useParams<{ id?: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [tour, setTour] = useState<TourRow | null>(null);

  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [settingsByRoundId, setSettingsByRoundId] = useState<Map<string, SettingsRow>>(new Map());

  // “teams are fixed for tour”; we use the first settings row’s group_a/group_b as the canonical teams
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [teams, setTeams] = useState<
    Array<{
      id: string;
      name: string;
      members: Array<{ player_id: string; name: string; gender: Tee | null; orderIndex: number }>;
    }>
  >([]);

  const [tourPlayerIds, setTourPlayerIds] = useState<string[]>([]);
  const [warning, setWarning] = useState<string>("");

  // Computed: points[playerId][roundId] and totals
  const [pointsByRoundPlayer, setPointsByRoundPlayer] = useState<Map<string, Map<string, number>>>(new Map()); // roundId -> (playerId -> pts)
  const [teamRoundTotals, setTeamRoundTotals] = useState<Map<string, Map<string, number>>>(new Map()); // roundId -> (teamId -> pts)

  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    let alive = true;

    async function fetchRounds(selectCols: string) {
      return supabase
        .from("rounds")
        .select(selectCols)
        .eq("tour_id", tourId)
        .order("round_no", { ascending: true })
        .order("created_at", { ascending: true });
    }

    async function load() {
      setLoading(true);
      setErrorMsg("");
      setWarning("");

      try {
        // Tour meta
        const { data: tRow, error: tErr } = await supabase.from("tours").select("id,name").eq("id", tourId).single();
        if (tErr) throw tErr;

        // Rounds with fallback columns
        const baseCols = "id,tour_id,course_id,round_no,created_at";
        const cols1 = `${baseCols},round_date,played_on`;
        const cols2 = `${baseCols},played_on`;

        let rRows: any[] = [];
        const r1 = await fetchRounds(cols1);
        if (r1.error) {
          if (isMissingColumnError(r1.error.message, "round_date")) {
            const r2 = await fetchRounds(cols2);
            if (r2.error) {
              if (isMissingColumnError(r2.error.message, "played_on")) {
                const r3 = await fetchRounds(baseCols);
                if (r3.error) throw r3.error;
                rRows = r3.data ?? [];
              } else {
                throw r2.error;
              }
            } else {
              rRows = r2.data ?? [];
            }
          } else {
            throw r1.error;
          }
        } else {
          rRows = r1.data ?? [];
        }

        const roundList = (rRows ?? []) as RoundRow[];

        // Match settings for this tour
        const { data: setRows, error: setErr } = await supabase
          .from("match_round_settings")
          .select("id,tour_id,round_id,group_a_id,group_b_id,format,double_points")
          .eq("tour_id", tourId);
        if (setErr) throw setErr;

        const sMap = new Map<string, SettingsRow>();
        (setRows ?? []).forEach((s: any) => sMap.set(String(s.round_id), s as SettingsRow));

        // Determine canonical teams from the first configured round (if any)
        const firstSetting = (setRows ?? [])[0] as any as SettingsRow | undefined;
        const ids: string[] =
          firstSetting && firstSetting.group_a_id && firstSetting.group_b_id
            ? [String(firstSetting.group_a_id), String(firstSetting.group_b_id)]
            : [];

        // Warn if settings vary groups across rounds (still works; but you said teams fixed)
        if (ids.length === 2) {
          const mismatched = (setRows ?? []).some(
            (s: any) =>
              String(s.group_a_id) !== ids[0] ||
              String(s.group_b_id) !== ids[1]
          );
          if (mismatched) {
            setWarning(
              "Note: Some rounds have different team group selections than the first configured round. The leaderboard will still score each round using its configured teams."
            );
          }
        }

        // Tour players (N for stableford)
        const { data: tpRows, error: tpErr } = await supabase.from("tour_players").select("player_id").eq("tour_id", tourId);
        if (tpErr) throw tpErr;

        const tpIds = (tpRows ?? []).map((x: any) => String(x.player_id));

        // Load group names + members (canonical teams only)
        let teamData: Array<{ id: string; name: string; members: any[] }> = [];
        if (ids.length === 2) {
          const { data: gRows, error: gErr } = await supabase.from("tour_groups").select("id,name").in("id", ids);
          if (gErr) throw gErr;

          const gById = new Map<string, GroupRow>();
          (gRows ?? []).forEach((g: any) => gById.set(String(g.id), { id: String(g.id), name: g.name ?? null }));

          const { data: memRows, error: memErr } = await supabase
            .from("tour_group_members")
            .select("group_id,player_id,position,players(id,name,gender)")
            .in("group_id", ids)
            .order("position", { ascending: true, nullsFirst: true });
          if (memErr) throw memErr;

          const memByGroup = new Map<string, GroupMemberRow[]>();
          (memRows ?? []).forEach((m: any) => {
            const gid = String(m.group_id);
            if (!memByGroup.has(gid)) memByGroup.set(gid, []);
            memByGroup.get(gid)!.push(m as GroupMemberRow);
          });

          teamData = ids.map((gid) => {
            const members = (memByGroup.get(gid) ?? []).map((m: any, idx: number) => {
              const p = normalizePlayerJoin(m.players);
              return {
                player_id: String(m.player_id ?? p?.id ?? ""),
                name: safeText(p?.name, "(player)"),
                gender: p?.gender ? normalizeTee(p.gender) : null,
                orderIndex: idx,
              };
            }).filter((x: any) => !!x.player_id);

            return {
              id: gid,
              name: safeText(gById.get(gid)?.name, "Team"),
              members,
            };
          });
        }

        if (!alive) return;

        setTour(tRow as TourRow);
        setRounds(roundList);
        setSettingsByRoundId(sMap);
        setTeamIds(ids);
        setTeams(teamData as any);
        setTourPlayerIds(tpIds);

        // If no settings at all, stop here (UI will show empty state)
        if ((setRows ?? []).length === 0) {
          setPointsByRoundPlayer(new Map());
          setTeamRoundTotals(new Map());
          setLoading(false);
          return;
        }

        // ---- Compute points for each configured round ----
        // Preload pars for all relevant courses
        const configuredRoundIds = Array.from(sMap.keys());
        const roundsById = new Map<string, RoundRow>();
        roundList.forEach((r) => roundsById.set(r.id, r));

        const courseIds = Array.from(
          new Set(
            configuredRoundIds
              .map((rid) => roundsById.get(rid)?.course_id ?? null)
              .filter(Boolean) as string[]
          )
        );

        const parsByCourse = new Map<string, Map<Tee, Map<number, { par: number; si: number }>>>();
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
            const hole = Number(p.hole_number);
            if (!(hole >= 1 && hole <= 18)) return;

            if (!parsByCourse.has(cid)) parsByCourse.set(cid, new Map());
            const byTee = parsByCourse.get(cid)!;
            if (!byTee.has(tee)) byTee.set(tee, new Map());
            byTee.get(tee)!.set(hole, { par: Number(p.par), si: Number(p.stroke_index) });
          });
        }

        // Load matches + match players for all settings (for matchplay formats)
        const settingIds = (setRows ?? []).map((s: any) => String(s.id));
        const { data: matchRows, error: mErr } = await supabase
          .from("match_round_matches")
          .select("id,settings_id,match_no")
          .in("settings_id", settingIds)
          .order("match_no", { ascending: true });
        if (mErr) throw mErr;

        const matchesBySettings = new Map<string, MatchRow[]>();
        (matchRows ?? []).forEach((m: any) => {
          const sid = String(m.settings_id);
          if (!matchesBySettings.has(sid)) matchesBySettings.set(sid, []);
          matchesBySettings.get(sid)!.push({ id: String(m.id), settings_id: sid, match_no: Number(m.match_no) });
        });

        const allMatchIds = (matchRows ?? []).map((m: any) => String(m.id));
        const matchPlayersByMatch = new Map<string, MatchPlayerRow[]>();
        if (allMatchIds.length > 0) {
          const { data: mpRows, error: mpErr } = await supabase
            .from("match_round_match_players")
            .select("match_id,side,slot,player_id")
            .in("match_id", allMatchIds);
          if (mpErr) throw mpErr;

          (mpRows ?? []).forEach((x: any) => {
            const mid = String(x.match_id);
            if (!matchPlayersByMatch.has(mid)) matchPlayersByMatch.set(mid, []);
            matchPlayersByMatch.get(mid)!.push({
              match_id: mid,
              side: String(x.side) as "A" | "B",
              slot: Number(x.slot),
              player_id: String(x.player_id),
            });
          });
        }

        // Players info needed: all team members + all tour players (stableford)
        const teamMemberIds = new Set<string>();
        teamData.forEach((t) => t.members.forEach((m: any) => teamMemberIds.add(String(m.player_id))));
        const allNeededPlayerIds = new Set<string>(tpIds);
        teamMemberIds.forEach((id) => allNeededPlayerIds.add(id));

        // Fetch player meta (gender for tee)
        const allPlayers = Array.from(allNeededPlayerIds);
        const playersById = new Map<string, { id: string; name: string; gender: Tee | null }>();
        if (allPlayers.length > 0) {
          const { data: plRows, error: plErr } = await supabase
            .from("players")
            .select("id,name,gender")
            .in("id", allPlayers);
          if (plErr) throw plErr;

          (plRows ?? []).forEach((p: any) => {
            playersById.set(String(p.id), {
              id: String(p.id),
              name: safeText(p.name, "(player)"),
              gender: p.gender ? normalizeTee(p.gender) : null,
            });
          });
        }

        // Compute per-round points
        const roundToPlayerPts = new Map<string, Map<string, number>>();
        const roundToTeamPts = new Map<string, Map<string, number>>();

        // helper: assign team memberships
        const teamByPlayer = new Map<string, string>(); // playerId -> teamId
        teamData.forEach((t) => t.members.forEach((m: any) => teamByPlayer.set(String(m.player_id), String(t.id))));

        // score/handicap fetch per round (avoid pagination patterns)
        for (const rid of configuredRoundIds) {
          const set = sMap.get(rid);
          if (!set) continue;

          const rr = roundsById.get(rid);
          const courseId = rr?.course_id ?? null;
          const coursePars = courseId ? parsByCourse.get(courseId) ?? null : null;

          const mult = set.double_points ? 2 : 1;

          // Determine which players are involved for this round’s scoring
          // Matchplay formats: only players assigned into matches
          // Stableford: all tour players (N is all tour players)
          let involvedPlayerIds: string[] = [];
          if (set.format === "INDIVIDUAL_STABLEFORD") {
            involvedPlayerIds = tpIds.slice();
          } else {
            const ms = matchesBySettings.get(set.id) ?? [];
            const pidSet = new Set<string>();
            for (const m of ms) {
              (matchPlayersByMatch.get(m.id) ?? []).forEach((x) => pidSet.add(String(x.player_id)));
            }
            involvedPlayerIds = Array.from(pidSet);
          }

          // Round players (handicap + playing)
          const rpMap = new Map<string, RoundPlayerRow>();
          if (involvedPlayerIds.length > 0) {
            const { data: rpRows, error: rpErr } = await supabase
              .from("round_players")
              .select("player_id,playing,playing_handicap")
              .eq("round_id", rid)
              .in("player_id", involvedPlayerIds);
            if (rpErr) throw rpErr;

            (rpRows ?? []).forEach((rp: any) => {
              rpMap.set(String(rp.player_id), {
                player_id: String(rp.player_id),
                playing: rp.playing === true,
                playing_handicap: Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0,
              });
            });
          }

          // Scores
          const scoreMap = new Map<string, ScoreRow>(); // key player|hole
          const hasScore = new Set<string>();
          if (involvedPlayerIds.length > 0) {
            const { data: sRows, error: sErr } = await supabase
              .from("scores")
              .select("player_id,hole_number,strokes,pickup")
              .eq("round_id", rid)
              .in("player_id", involvedPlayerIds);
            if (sErr) throw sErr;

            (sRows ?? []).forEach((s: any) => {
              const pid = String(s.player_id);
              const hole = Number(s.hole_number);
              hasScore.add(pid);
              scoreMap.set(`${pid}|${hole}`, {
                player_id: pid,
                hole_number: hole,
                strokes: s.strokes === null || s.strokes === undefined ? null : Number(s.strokes),
                pickup: s.pickup === true ? true : s.pickup === false ? false : (s.pickup ?? null),
              });
            });
          }

          // Stableford: treat “playing” as true if any score exists (so leaderboard works even if playing flag wasn’t set)
          if (set.format === "INDIVIDUAL_STABLEFORD") {
            for (const pid of involvedPlayerIds) {
              const cur = rpMap.get(pid);
              if (!cur && hasScore.has(pid)) {
                rpMap.set(pid, { player_id: pid, playing: true, playing_handicap: 0 });
              } else if (cur && cur.playing !== true && hasScore.has(pid)) {
                rpMap.set(pid, { ...cur, playing: true });
              }
            }
          }

          // Compute per-player per-hole stableford pts (net)
          const ptsByPlayerHole = new Map<string, number>();
          if (coursePars) {
            for (const pid of involvedPlayerIds) {
              const rp = rpMap.get(pid);
              if (!rp?.playing) continue;

              const p = playersById.get(pid);
              const tee: Tee = p?.gender ? p.gender : "M";

              const pars =
                coursePars.get(tee) || coursePars.get("M") || coursePars.get("F") || null;
              if (!pars) continue;

              const hcp = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0;

              for (let h = 1; h <= 18; h++) {
                const pr = pars.get(h);
                if (!pr) continue;

                const sc = scoreMap.get(`${pid}|${h}`);
                if (!sc) continue;

                const raw = normalizeRawScore(sc.strokes, sc.pickup);
                const pts = netStablefordPointsForHole({
                  rawScore: raw,
                  par: pr.par,
                  strokeIndex: pr.si,
                  playingHandicap: hcp,
                });

                ptsByPlayerHole.set(`${pid}|${h}`, pts);
              }
            }
          }

          // Initialize per-player points for this round (only for team members; others can exist but we’ll keep them too)
          const playerPts = new Map<string, number>();

          // Matchplay formats
          if (set.format === "INDIVIDUAL_MATCHPLAY" || set.format === "BETTERBALL_MATCHPLAY") {
            const ms = matchesBySettings.get(set.id) ?? [];
            for (const m of ms) {
              const assigns = matchPlayersByMatch.get(m.id) ?? [];

              const A1 = assigns.find((x) => x.side === "A" && x.slot === 1)?.player_id ?? "";
              const A2 = assigns.find((x) => x.side === "A" && x.slot === 2)?.player_id ?? "";
              const B1 = assigns.find((x) => x.side === "B" && x.slot === 1)?.player_id ?? "";
              const B2 = assigns.find((x) => x.side === "B" && x.slot === 2)?.player_id ?? "";

              const isBetterBall = set.format === "BETTERBALL_MATCHPLAY";

              const holeWinners: Array<"A" | "B" | "HALVED"> = [];

              for (let h = 1; h <= 18; h++) {
                const aPts = isBetterBall
                  ? Math.max(ptsByPlayerHole.get(`${A1}|${h}`) ?? 0, ptsByPlayerHole.get(`${A2}|${h}`) ?? 0)
                  : ptsByPlayerHole.get(`${A1}|${h}`) ?? 0;

                const bPts = isBetterBall
                  ? Math.max(ptsByPlayerHole.get(`${B1}|${h}`) ?? 0, ptsByPlayerHole.get(`${B2}|${h}`) ?? 0)
                  : ptsByPlayerHole.get(`${B1}|${h}`) ?? 0;

                if (aPts > bPts) holeWinners.push("A");
                else if (bPts > aPts) holeWinners.push("B");
                else holeWinners.push("HALVED");
              }

              const winner = matchplayWinnerFromHoleWinners(holeWinners);
              const winPts = 1 * mult;
              const tiePts = 0.5 * mult;

              if (!isBetterBall) {
                if (A1) playerPts.set(A1, (playerPts.get(A1) ?? 0) + (winner === "A" ? winPts : winner === "TIE" ? tiePts : 0));
                if (B1) playerPts.set(B1, (playerPts.get(B1) ?? 0) + (winner === "B" ? winPts : winner === "TIE" ? tiePts : 0));
              } else {
                const aAward = winner === "A" ? winPts : winner === "TIE" ? tiePts : 0;
                const bAward = winner === "B" ? winPts : winner === "TIE" ? tiePts : 0;

                if (A1) playerPts.set(A1, (playerPts.get(A1) ?? 0) + aAward);
                if (A2) playerPts.set(A2, (playerPts.get(A2) ?? 0) + aAward);
                if (B1) playerPts.set(B1, (playerPts.get(B1) ?? 0) + bAward);
                if (B2) playerPts.set(B2, (playerPts.get(B2) ?? 0) + bAward);
              }
            }
          }

          // Stableford format
          if (set.format === "INDIVIDUAL_STABLEFORD") {
            const N = tpIds.length;
            const target = Math.floor(N / 2);

            // totals for all tour players who are “playing” (or have scores)
            const totals: Array<{ player_id: string; total: number }> = [];
            for (const pid of tpIds) {
              const rp = rpMap.get(pid);
              if (!rp?.playing) continue;

              let sum = 0;
              for (let h = 1; h <= 18; h++) sum += ptsByPlayerHole.get(`${pid}|${h}`) ?? 0;
              totals.push({ player_id: pid, total: sum });
            }

            totals.sort((a, b) => b.total - a.total || a.player_id.localeCompare(b.player_id));

            if (target > 0 && totals.length > 0) {
              const idx = Math.min(target - 1, totals.length - 1);
              const cutoff = totals[idx]?.total ?? null;

              if (cutoff !== null) {
                const above = totals.filter((x) => x.total > cutoff);
                const at = totals.filter((x) => x.total === cutoff);

                const countAbove = above.length;
                const remaining = target - countAbove;

                // award 1 to all above
                for (const x of above) {
                  playerPts.set(x.player_id, (playerPts.get(x.player_id) ?? 0) + 1 * mult);
                }

                if (remaining > 0 && at.length > 0) {
                  const frac = remaining / at.length;
                  for (const x of at) {
                    playerPts.set(x.player_id, (playerPts.get(x.player_id) ?? 0) + frac * mult);
                  }
                }
              }
            }
          }

          // Team totals for this round (canonical teams only)
          const tPts = new Map<string, number>();
          for (const t of teamData) tPts.set(t.id, 0);

          for (const [pid, pts] of playerPts.entries()) {
            const tid = teamByPlayer.get(pid);
            if (tid) tPts.set(tid, (tPts.get(tid) ?? 0) + pts);
          }

          roundToPlayerPts.set(rid, playerPts);
          roundToTeamPts.set(rid, tPts);
        }

        if (!alive) return;

        setPointsByRoundPlayer(roundToPlayerPts);
        setTeamRoundTotals(roundToTeamPts);

        // Warn if pars are missing for any configured round course
        const missingParsRounds = configuredRoundIds.filter((rid) => {
          const rr = roundsById.get(rid);
          const cid = rr?.course_id ?? null;
          if (!cid) return true;
          const byTee = parsByCourse.get(cid);
          // require at least one tee map with 18 holes to be considered “present”
          const m = byTee?.get("M");
          const f = byTee?.get("F");
          const mOk = m && m.size >= 18;
          const fOk = f && f.size >= 18;
          return !(mOk || fOk);
        });

        if (missingParsRounds.length > 0) {
          setWarning((prev) =>
            [
              prev,
              prev ? "" : "",
              `Warning: Some configured rounds may not score correctly because pars are missing (rounds: ${missingParsRounds
                .map((r) => {
                  const rr = roundsById.get(r);
                  return rr?.round_no != null ? `R${rr.round_no}` : r.slice(0, 6);
                })
                .join(", ")}).`,
            ]
              .filter(Boolean)
              .join(" ")
              .trim()
          );
        }
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load matches leaderboard.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [tourId]);

  // Sorted rounds for columns (all rounds, but we show “—” if not configured)
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

      return a.id.localeCompare(b.id);
    });
    return arr;
  }, [rounds]);

  const configuredRoundIds = useMemo(() => new Set(Array.from(settingsByRoundId.keys())), [settingsByRoundId]);

  // Totals by player/team
  const totals = useMemo(() => {
    const playerTotal = new Map<string, number>();
    const teamTotal = new Map<string, number>();
    teams.forEach((t) => teamTotal.set(t.id, 0));

    for (const [rid, pMap] of pointsByRoundPlayer.entries()) {
      for (const [pid, pts] of pMap.entries()) {
        playerTotal.set(pid, (playerTotal.get(pid) ?? 0) + pts);
      }
    }

    for (const t of teams) {
      let sum = 0;
      for (const m of t.members) sum += playerTotal.get(m.player_id) ?? 0;
      teamTotal.set(t.id, sum);
    }

    return { playerTotal, teamTotal };
  }, [pointsByRoundPlayer, teams]);

  const sortedTeams = useMemo(() => {
    const arr = [...teams];
    arr.sort((a, b) => {
      const ta = totals.teamTotal.get(a.id) ?? 0;
      const tb = totals.teamTotal.get(b.id) ?? 0;
      if (tb !== ta) return tb - ta;
      return a.name.localeCompare(b.name);
    });
    return arr;
  }, [teams, totals.teamTotal]);

  function roundLabel(r: RoundRow) {
    const rn = r.round_no ?? null;
    const base = rn != null ? `R${rn}` : "R";
    const set = settingsByRoundId.get(r.id);
    return set ? `${base} (${formatShortLabel(set.format)})` : base;
  }

  function formatPts(n: number) {
    // show halves and thirds cleanly
    const rounded = Math.round(n * 1000) / 1000;
    if (Number.isInteger(rounded)) return String(rounded);
    // common fractions
    const twice = Math.round(rounded * 2);
    if (Math.abs(rounded - twice / 2) < 1e-9) return (twice / 2).toFixed(1);
    return String(rounded);
  }

  if (!tourId || !isLikelyUuid(tourId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900 pb-10">
        <div className="mx-auto w-full max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">Missing or invalid tour id.</div>
          <div className="mt-4">
            <Link className="underline text-sm" href="/m">
              Go to mobile home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-10">
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold">Matches – Leaderboard</div>
            <div className="truncate text-sm text-gray-500">{safeText(tour?.name, "")}</div>
          </div>

          <Link
            className="shrink-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm active:bg-gray-50"
            href={`/m/tours/${tourId}/rounds?mode=score`}
          >
            Rounds
          </Link>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4 space-y-3">
        {loading ? (
          <div className="rounded-2xl border p-4 text-sm">Loading…</div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorMsg}</div>
        ) : settingsByRoundId.size === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            No match formats have been configured yet.
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
              <div className="text-xs text-gray-600">
                Only rounds with a configured match format contribute points. Double points rounds are applied.
              </div>
              <div className="mt-2 text-xs text-gray-600">
                N (tour players) = <span className="font-semibold">{tourPlayerIds.length}</span> · Stableford winners target ={" "}
                <span className="font-semibold">{Math.floor(tourPlayerIds.length / 2)}</span>
              </div>
              {warning ? <div className="mt-2 text-xs text-amber-800">{warning}</div> : null}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-max border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="sticky left-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700">
                      Name
                    </th>

                    <th className="border-b border-gray-200 px-3 py-2 text-center text-xs font-semibold text-gray-700">
                      Total
                    </th>

                    {sortedRounds.map((r) => {
                      const configured = configuredRoundIds.has(r.id);
                      return (
                        <th
                          key={r.id}
                          className={`border-b border-gray-200 px-3 py-2 text-center text-[11px] font-semibold ${
                            configured ? "text-gray-700" : "text-gray-400"
                          }`}
                          title={fmtAuMelbourneDate(parseDateForDisplay(pickBestRoundDateISO(r)))}
                        >
                          {roundLabel(r)}
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {sortedTeams.map((t) => {
                    const teamTotal = totals.teamTotal.get(t.id) ?? 0;

                    const playersSorted = [...t.members].sort((a, b) => {
                      const pa = totals.playerTotal.get(a.player_id) ?? 0;
                      const pb = totals.playerTotal.get(b.player_id) ?? 0;
                      if (pb !== pa) return pb - pa;
                      return a.name.localeCompare(b.name);
                    });

                    return (
                      <tbody key={t.id}>
                        {/* Team row */}
                        <tr className="bg-gray-50">
                          <td className="sticky left-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-sm font-extrabold text-gray-900 whitespace-nowrap">
                            {t.name}
                          </td>

                          <td className="border-b border-gray-200 px-3 py-2 text-center text-sm font-extrabold text-gray-900">
                            <span className="inline-flex min-w-[44px] justify-center rounded-md bg-yellow-100 px-2 py-1">
                              {formatPts(teamTotal)}
                            </span>
                          </td>

                          {sortedRounds.map((r) => {
                            const configured = configuredRoundIds.has(r.id);
                            const v = configured ? (teamRoundTotals.get(r.id)?.get(t.id) ?? 0) : null;
                            return (
                              <td key={r.id} className="border-b border-gray-200 px-3 py-2 text-center text-sm font-semibold text-gray-900">
                                {configured ? formatPts(v ?? 0) : <span className="text-gray-300">—</span>}
                              </td>
                            );
                          })}
                        </tr>

                        {/* Player rows */}
                        {playersSorted.map((p) => {
                          const pTotal = totals.playerTotal.get(p.player_id) ?? 0;

                          return (
                            <tr key={p.player_id} className="border-b last:border-b-0">
                              <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap">
                                {p.name}
                              </td>

                              <td className="px-3 py-2 text-center text-sm font-semibold text-gray-900">
                                <span className="inline-flex min-w-[44px] justify-center rounded-md bg-gray-100 px-2 py-1">
                                  {formatPts(pTotal)}
                                </span>
                              </td>

                              {sortedRounds.map((r) => {
                                const configured = configuredRoundIds.has(r.id);
                                const v = configured ? (pointsByRoundPlayer.get(r.id)?.get(p.player_id) ?? 0) : null;

                                return (
                                  <td key={r.id} className="px-3 py-2 text-center text-sm text-gray-900">
                                    {configured ? formatPts(v ?? 0) : <span className="text-gray-300">—</span>}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="text-[11px] text-gray-400">
              Dates shown in Australia/Melbourne. Rounds without a configured match format do not score (shown as —).
            </div>
          </>
        )}
      </main>
    </div>
  );
}
