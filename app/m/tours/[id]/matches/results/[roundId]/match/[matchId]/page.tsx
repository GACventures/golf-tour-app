"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Tee = "M" | "F";

type RoundRow = {
  id: string;
  tour_id: string;
  course_id: string | null;
  round_no?: number | null;
  round_date?: string | null;
  played_on?: string | null;
  created_at: string | null;
  courses?: { name: string } | { name: string }[] | null;
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

type PlayerRow = { id: string; name: string; gender?: string | null };

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

type MatchRow = {
  id: string;
  match_no: number;
  settings_id?: string | null;
  match_round_match_players?: Array<{ side: "A" | "B"; slot: number; player_id: string }>;
};

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isMissingColumnError(msg: string, column: string) {
  const m = String(msg ?? "").toLowerCase();
  const c = column.toLowerCase();
  return m.includes("does not exist") && (m.includes(`.${c}`) || m.includes(`"${c}"`) || m.includes(` ${c} `));
}

function safeText(v: any, fallback = "") {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  const isF = s === "F" || s === "FEMALE" || s === "W" || s === "WOMEN" || s === "WOMAN";
  return isF ? "F" : "M";
}

function getCourseName(r: RoundRow | null) {
  if (!r) return "";
  const c: any = r.courses;
  if (!c) return "";
  if (Array.isArray(c)) return c?.[0]?.name ?? "";
  return c?.name ?? "";
}

function pickBestRoundDateISO(r: RoundRow | null): string | null {
  if (!r) return null;
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

function fmtDate(d: Date | null): string {
  if (!d) return "";
  // No explicit timezone mention/handling in UI (display-only).
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
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

function formatLabel(f: SettingsRow["format"]) {
  if (f === "INDIVIDUAL_MATCHPLAY") return "Individual matchplay";
  if (f === "BETTERBALL_MATCHPLAY") return "Better ball matchplay";
  return "Individual stableford";
}

type HoleOutcome = "A" | "B" | "HALVED" | "NO_DATA";

type MatchStop = { stopHoleExclusive: number; reason: "NO_DATA" | "CLINCHED" | null; decidedAt: number | null };

function computeStopAndRunning(holeOutcomes: HoleOutcome[]) {
  let diff = 0; // + => A leading; - => B leading
  let decidedAt: number | null = null;

  for (let h = 1; h <= 18; h++) {
    const w = holeOutcomes[h - 1] ?? "NO_DATA";
    if (w === "NO_DATA") {
      // stop at first missing-data hole
      return { stopHoleExclusive: h, reason: "NO_DATA" as const, decidedAt: null };
    }

    if (w === "A") diff += 1;
    else if (w === "B") diff -= 1;

    const holesRemaining = 18 - h;
    if (Math.abs(diff) > holesRemaining) {
      decidedAt = h;
      // stop after clinch hole
      return { stopHoleExclusive: h + 1, reason: "CLINCHED" as const, decidedAt };
    }
  }

  return { stopHoleExclusive: 19, reason: null, decidedAt: null };
}

// Used for per-row status strings (kept as-is except for display trimming in the table)
function liveStatusText(diff: number, thru: number) {
  if (thru <= 0) return "Not started";
  if (diff === 0) return `All Square (thru ${thru})`;
  const up = Math.abs(diff);
  const who = diff > 0 ? "A" : "B";
  return `${who} ${up} up (thru ${thru})`;
}

function finalText(diff: number, decidedAt: number | null) {
  if (diff === 0) return "All Square";
  const winner = diff > 0 ? "A" : "B";
  const up = Math.abs(diff);

  if (decidedAt != null && decidedAt >= 1 && decidedAt <= 18) {
    const remaining = 18 - decidedAt;
    if (remaining > 0) return `${winner} wins ${up} & ${remaining}`;
  }
  return `${winner} wins ${up} up`;
}

// Display-only helper: remove "(thru X...)" / "(after X...)" suffixes from status strings
function stripThruSuffix(s: string) {
  const raw = String(s ?? "").trim();
  if (!raw) return "";
  // remove trailing parenthetical that contains "thru" or "after" + a number
  return raw.replace(/\s*\((?:thru|after)\s*\d+[^)]*\)\s*$/i, "").trim();
}

function renderLiveSummary(args: { diff: number; thru: number; leftLabel: string; rightLabel: string }) {
  const { diff, thru, leftLabel, rightLabel } = args;

  if (thru <= 0) return "Not started";
  if (diff === 0) return "All Square";

  const leaderLabel = diff > 0 ? leftLabel : rightLabel;
  const up = Math.abs(diff);

  // wording requested: "2 up through 5"
  return `${leaderLabel} is ${up} up through ${thru}`;
}

function renderFinalSummary(args: { diff: number; decidedAt: number | null; leftLabel: string; rightLabel: string }) {
  const { diff, decidedAt, leftLabel, rightLabel } = args;

  if (diff === 0) return "All Square";

  const winnerLabel = diff > 0 ? leftLabel : rightLabel;
  const loserLabel = diff > 0 ? rightLabel : leftLabel;
  const up = Math.abs(diff);

  if (decidedAt != null && decidedAt >= 1 && decidedAt <= 18) {
    const remaining = 18 - decidedAt;
    if (remaining > 0) return `${winnerLabel} def ${loserLabel} ${up} & ${remaining}`;
  }

  return `${winnerLabel} def ${loserLabel} ${up} up`;
}

export default function MatchDetailPage() {
  const params = useParams<{ id?: string; roundId?: string; matchId?: string }>();
  const tourId = String(params?.id ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();
  const matchId = String(params?.matchId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [round, setRound] = useState<RoundRow | null>(null);
  const [settings, setSettings] = useState<SettingsRow | null>(null);

  const [groupA, setGroupA] = useState<GroupRow | null>(null);
  const [groupB, setGroupB] = useState<GroupRow | null>(null);

  const [matchRow, setMatchRow] = useState<MatchRow | null>(null);

  const [playersById, setPlayersById] = useState<Map<string, PlayerRow>>(new Map());
  const [roundPlayersById, setRoundPlayersById] = useState<Map<string, RoundPlayerRow>>(new Map());
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [parsByTeeHole, setParsByTeeHole] = useState<Map<Tee, Map<number, { par: number; si: number }>>>(new Map());

  useEffect(() => {
    if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId) || !isLikelyUuid(matchId)) return;

    let alive = true;

    async function fetchRound(selectCols: string) {
      return supabase.from("rounds").select(selectCols).eq("id", roundId).single();
    }

    async function load() {
      setLoading(true);
      setErrorMsg("");

      try {
        // Round meta (column fallback)
        const baseCols = "id,tour_id,course_id,round_no,created_at,courses(name)";
        const cols1 = `${baseCols},round_date,played_on`;
        const cols2 = `${baseCols},played_on`;

        let rRow: any = null;
        const r1 = await fetchRound(cols1);
        if (r1.error) {
          if (isMissingColumnError(r1.error.message, "round_date")) {
            const r2 = await fetchRound(cols2);
            if (r2.error) {
              if (isMissingColumnError(r2.error.message, "played_on")) {
                const r3 = await fetchRound(baseCols);
                if (r3.error) throw r3.error;
                rRow = r3.data;
              } else {
                throw r2.error;
              }
            } else {
              rRow = r2.data;
            }
          } else {
            throw r1.error;
          }
        } else {
          rRow = r1.data;
        }

        // Settings for this round
        const { data: sRow, error: sErr } = await supabase
          .from("match_round_settings")
          .select("id,tour_id,round_id,group_a_id,group_b_id,format,double_points")
          .eq("round_id", roundId)
          .maybeSingle();
        if (sErr) throw sErr;

        const set = (sRow ?? null) as any as SettingsRow | null;
        if (!set) {
          if (!alive) return;
          setRound(rRow as any);
          setSettings(null);
          setLoading(false);
          return;
        }

        // Group names
        const { data: gRows, error: gErr } = await supabase
          .from("tour_groups")
          .select("id,name")
          .in("id", [set.group_a_id, set.group_b_id]);
        if (gErr) throw gErr;

        const gA = (gRows ?? []).find((g: any) => String(g.id) === set.group_a_id) ?? null;
        const gB = (gRows ?? []).find((g: any) => String(g.id) === set.group_b_id) ?? null;

        // Match row
        const { data: mRow, error: mErr } = await supabase
          .from("match_round_matches")
          .select("id,match_no,settings_id,match_round_match_players(side,slot,player_id)")
          .eq("id", matchId)
          .maybeSingle();
        if (mErr) throw mErr;

        const match = (mRow ?? null) as any as MatchRow | null;
        if (!match) throw new Error("Match not found.");

        const assigns = (match.match_round_match_players ?? []) as any[];
        const A1 = assigns.find((x) => x.side === "A" && Number(x.slot) === 1)?.player_id ?? "";
        const A2 = assigns.find((x) => x.side === "A" && Number(x.slot) === 2)?.player_id ?? "";
        const B1 = assigns.find((x) => x.side === "B" && Number(x.slot) === 1)?.player_id ?? "";
        const B2 = assigns.find((x) => x.side === "B" && Number(x.slot) === 2)?.player_id ?? "";

        const playerIds = Array.from(new Set([A1, A2, B1, B2].map((x) => String(x || "").trim()).filter(Boolean)));

        // Players info
        const { data: pRows, error: pErr } = await supabase.from("players").select("id,name,gender").in("id", playerIds);
        if (pErr) throw pErr;

        const pMap = new Map<string, PlayerRow>();
        (pRows ?? []).forEach((p: any) => {
          pMap.set(String(p.id), { id: String(p.id), name: safeText(p.name, "(unnamed)"), gender: p.gender ?? null });
        });

        // Round players (handicap + playing)
        const { data: rpRows, error: rpErr } = await supabase
          .from("round_players")
          .select("player_id,playing,playing_handicap")
          .eq("round_id", roundId)
          .in("player_id", playerIds);
        if (rpErr) throw rpErr;

        const rpMap = new Map<string, RoundPlayerRow>();
        (rpRows ?? []).forEach((rp: any) => {
          rpMap.set(String(rp.player_id), {
            player_id: String(rp.player_id),
            playing: rp.playing === true,
            playing_handicap: Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0,
          });
        });

        // Scores
        let sRows: ScoreRow[] = [];
        if (playerIds.length > 0) {
          const { data: scRows, error: scErr } = await supabase
            .from("scores")
            .select("player_id,hole_number,strokes,pickup")
            .eq("round_id", roundId)
            .in("player_id", playerIds);
          if (scErr) throw scErr;

          sRows = (scRows ?? []).map((s: any) => ({
            player_id: String(s.player_id),
            hole_number: Number(s.hole_number),
            strokes: s.strokes === null || s.strokes === undefined ? null : Number(s.strokes),
            pickup: s.pickup === true ? true : s.pickup === false ? false : (s.pickup ?? null),
          }));
        }

        // If round_players.playing not set but scores exist, treat as playing (for match calc)
        const hasScore = new Set<string>();
        sRows.forEach((s) => hasScore.add(s.player_id));
        for (const pid of playerIds) {
          if (!rpMap.has(pid) && hasScore.has(pid)) {
            rpMap.set(pid, { player_id: pid, playing: true, playing_handicap: 0 });
          } else if (rpMap.has(pid) && rpMap.get(pid)!.playing !== true && hasScore.has(pid)) {
            const cur = rpMap.get(pid)!;
            rpMap.set(pid, { ...cur, playing: true });
          }
        }

        // Pars
        const courseId = (rRow as any)?.course_id ?? null;
        let parsMap = new Map<Tee, Map<number, { par: number; si: number }>>();
        if (courseId) {
          const { data: parRows, error: parErr } = await supabase
            .from("pars")
            .select("hole_number,par,stroke_index,tee")
            .eq("course_id", courseId)
            .in("tee", ["M", "F"])
            .order("hole_number", { ascending: true });
          if (parErr) throw parErr;

          parsMap = new Map();
          (parRows ?? []).forEach((p: any) => {
            const tee: Tee = normalizeTee(p.tee);
            if (!parsMap.has(tee)) parsMap.set(tee, new Map());
            parsMap.get(tee)!.set(Number(p.hole_number), { par: Number(p.par), si: Number(p.stroke_index) });
          });
        }

        if (!alive) return;

        setRound(rRow as any);
        setSettings(set);
        setGroupA(gA ? { id: String(gA.id), name: gA.name ?? null } : null);
        setGroupB(gB ? { id: String(gB.id), name: gB.name ?? null } : null);
        setMatchRow(match);

        setPlayersById(pMap);
        setRoundPlayersById(rpMap);
        setScores(sRows);
        setParsByTeeHole(parsMap);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load match detail.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [tourId, roundId, matchId]);

  const assigns = useMemo(() => (matchRow?.match_round_match_players ?? []) as any[], [matchRow]);

  const sideIds = useMemo(() => {
    const A1 = assigns.find((x) => x.side === "A" && Number(x.slot) === 1)?.player_id ?? "";
    const A2 = assigns.find((x) => x.side === "A" && Number(x.slot) === 2)?.player_id ?? "";
    const B1 = assigns.find((x) => x.side === "B" && Number(x.slot) === 1)?.player_id ?? "";
    const B2 = assigns.find((x) => x.side === "B" && Number(x.slot) === 2)?.player_id ?? "";
    return { A1: String(A1 || ""), A2: String(A2 || ""), B1: String(B1 || ""), B2: String(B2 || "") };
  }, [assigns]);

  const scoreByPlayerHole = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    for (const s of scores) m.set(`${s.player_id}|${s.hole_number}`, s);
    return m;
  }, [scores]);

  const ptsByPlayerHole = useMemo(() => {
    const m = new Map<string, number>();
    if (!round?.course_id) return m;

    for (const [playerId, p] of playersById.entries()) {
      const rp = roundPlayersById.get(playerId);
      if (!rp?.playing) continue;

      const tee: Tee = p.gender ? normalizeTee(p.gender) : "M";
      const pars = parsByTeeHole.get(tee) || parsByTeeHole.get("M") || parsByTeeHole.get("F") || null;
      if (!pars) continue;

      const hcp = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0;

      for (let h = 1; h <= 18; h++) {
        const pr = pars.get(h);
        if (!pr) continue;

        const sc = scoreByPlayerHole.get(`${playerId}|${h}`);
        if (!sc) continue;

        const raw = normalizeRawScore(sc.strokes, sc.pickup);
        const pts = netStablefordPointsForHole({
          rawScore: raw,
          par: pr.par,
          strokeIndex: pr.si,
          playingHandicap: hcp,
        });

        m.set(`${playerId}|${h}`, pts);
      }
    }

    return m;
  }, [round, playersById, roundPlayersById, parsByTeeHole, scoreByPlayerHole]);

  function playerName(pid: string) {
    return playersById.get(pid)?.name ?? "(player)";
  }

  const labels = useMemo(() => {
    if (!settings) return { left: "", right: "", aLabel: "", bLabel: "" };
    const isBB = settings.format === "BETTERBALL_MATCHPLAY";
    const aLabel = isBB ? `${playerName(sideIds.A1)} / ${playerName(sideIds.A2)}` : `${playerName(sideIds.A1)}`;
    const bLabel = isBB ? `${playerName(sideIds.B1)} / ${playerName(sideIds.B2)}` : `${playerName(sideIds.B1)}`;
    return { left: aLabel, right: bLabel, aLabel, bLabel };
  }, [settings, sideIds, playersById]);

  const holeRows = useMemo(() => {
    if (!settings) return null;

    const isBB = settings.format === "BETTERBALL_MATCHPLAY";

    // Determine per-hole outcome (A/B/HALVED/NO_DATA) using "computable" rule
    const outcomes: HoleOutcome[] = [];
    const aPtsArr: Array<number | null> = [];
    const bPtsArr: Array<number | null> = [];

    for (let h = 1; h <= 18; h++) {
      const aHas = isBB
        ? ptsByPlayerHole.has(`${sideIds.A1}|${h}`) || ptsByPlayerHole.has(`${sideIds.A2}|${h}`)
        : ptsByPlayerHole.has(`${sideIds.A1}|${h}`);
      const bHas = isBB
        ? ptsByPlayerHole.has(`${sideIds.B1}|${h}`) || ptsByPlayerHole.has(`${sideIds.B2}|${h}`)
        : ptsByPlayerHole.has(`${sideIds.B1}|${h}`);

      if (!aHas || !bHas) {
        outcomes.push("NO_DATA");
        aPtsArr.push(null);
        bPtsArr.push(null);
        continue;
      }

      const aPts = isBB
        ? Math.max(ptsByPlayerHole.get(`${sideIds.A1}|${h}`) ?? 0, ptsByPlayerHole.get(`${sideIds.A2}|${h}`) ?? 0)
        : ptsByPlayerHole.get(`${sideIds.A1}|${h}`) ?? 0;

      const bPts = isBB
        ? Math.max(ptsByPlayerHole.get(`${sideIds.B1}|${h}`) ?? 0, ptsByPlayerHole.get(`${sideIds.B2}|${h}`) ?? 0)
        : ptsByPlayerHole.get(`${sideIds.B1}|${h}`) ?? 0;

      aPtsArr.push(aPts);
      bPtsArr.push(bPts);

      if (aPts > bPts) outcomes.push("A");
      else if (bPts > aPts) outcomes.push("B");
      else outcomes.push("HALVED");
    }

    // Stop logic (first NO_DATA OR clinch)
    const stop: MatchStop = computeStopAndRunning(outcomes);

    // Build table rows, blanking everything at/after stopHoleExclusive
    const rows: Array<{
      hole: number;
      aPts: number | null;
      bPts: number | null;
      winner: "A" | "B" | "HALVED" | null;
      status: string | null;
    }> = [];

    let runningDiff = 0;
    let thru = 0;

    for (let h = 1; h <= 18; h++) {
      const shouldBlank = h >= stop.stopHoleExclusive;

      if (shouldBlank) {
        rows.push({ hole: h, aPts: null, bPts: null, winner: null, status: null });
        continue;
      }

      const w = outcomes[h - 1];
      const aPts = aPtsArr[h - 1];
      const bPts = bPtsArr[h - 1];

      // By definition pre-stop, w cannot be NO_DATA.
      if (w === "A") runningDiff += 1;
      else if (w === "B") runningDiff -= 1;
      thru = h;

      const status =
        stop.reason === "CLINCHED" && stop.decidedAt != null && h === stop.decidedAt
          ? finalText(runningDiff, stop.decidedAt)
          : liveStatusText(runningDiff, thru);

      rows.push({
        hole: h,
        aPts: aPts ?? 0,
        bPts: bPts ?? 0,
        winner: w === "HALVED" ? "HALVED" : (w as any),
        status,
      });
    }

    return { rows, stop };
  }, [settings, sideIds, ptsByPlayerHole]);

  const headerLine = useMemo(() => {
    const rn = round?.round_no != null ? `Round ${round.round_no}` : "Round";
    const d = fmtDate(parseDateForDisplay(pickBestRoundDateISO(round)));
    const c = getCourseName(round);
    return [rn, d || "", c || ""].filter(Boolean).join(" · ");
  }, [round]);

  const matchNo = matchRow?.match_no ?? null;

  const contextLine = useMemo(() => {
    return {`Match ${matchNo ?? ""}${headerLine ? ` · ${headerLine}` : ""}`.trim() || "Match"};
  }, [matchNo, headerLine]);

  const topSummaryText = useMemo(() => {
    if (!settings) return "";
    if (!holeRows?.rows) return "Not started";

    const rows = holeRows.rows;
    const stop = holeRows.stop;

    // Find last non-null status row to infer thru & whether final
    let lastIdx = -1;
    for (let i = Math.min(rows.length, 18) - 1; i >= 0; i--) {
      if (rows[i]?.status) {
        lastIdx = i;
        break;
      }
    }

    if (lastIdx < 0) return "Not started";

    const thru = Number(rows[lastIdx]?.hole) || 0;

    // Recompute diff up to `thru` using the same outcome rules embedded in status generation:
    // We can derive diff from the "Win" column data we already stored in rows (A/B/HALVED).
    let diff = 0;
    for (let i = 0; i <= lastIdx; i++) {
      const w = rows[i]?.winner;
      if (w === "A") diff += 1;
      else if (w === "B") diff -= 1;
    }

    const isFinal = stop?.reason === "CLINCHED" || thru === 18;

    return isFinal
      ? renderFinalSummary({ diff, decidedAt: stop?.decidedAt ?? null, leftLabel: labels.left, rightLabel: labels.right })
      : renderLiveSummary({ diff, thru, leftLabel: labels.left, rightLabel: labels.right });
  }, [settings, holeRows, labels.left, labels.right]);

  if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId) || !isLikelyUuid(matchId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900 pb-10">
        <div className="mx-auto w-full max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">Missing or invalid tour/round/match id in route.</div>
          <div className="mt-4">
            <Link className="underline text-sm" href={`/m/tours/${tourId}/matches/results`}>
              Back
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isMatchplay = settings && settings.format !== "INDIVIDUAL_STABLEFORD";

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-10">
      {/* IMPORTANT:
          Tour name + Home is provided globally by app/m/tours/[id]/layout.tsx.
          Do NOT render a second Tour/Home header here.
      */}
      <div className="sticky top-14 z-10 bg-white/95 backdrop-blur">
        {/* Title band */}
        <div className="border-b border-slate-200">
          <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-semibold text-slate-900">Matchplay results</div>
            </div>

            <Link className="text-sm font-semibold text-slate-900" href={`/m/tours/${tourId}/matches/results/${roundId}`}>
              Back
            </Link>
          </div>
        </div>

        {/* Context band */}
        <div className="border-b border-slate-200 bg-slate-50">
          <div className="mx-auto w-full max-w-md px-4 py-2">
            <div className="truncate text-sm font-semibold text-slate-800">{contextLine}</div>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4 space-y-4">
        {loading ? (
          <div className="rounded-2xl border p-4 text-sm">Loading…</div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorMsg}</div>
        ) : !settings ? (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            No match format is set for this round yet.
          </div>
        ) : !isMatchplay ? (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            This match detail view is only for matchplay formats.
          </div>
        ) : (
          <>
            {/* Match summary */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b space-y-2">
                <div className="text-sm font-semibold text-gray-900">
                  Match summary: <span className="font-semibold text-gray-900">{topSummaryText || "Not started"}</span>
                </div>

                <div className="text-xs text-gray-600">
                  Round format: <span className="font-semibold text-gray-900">{formatLabel(settings.format)}</span>
                  {settings.double_points ? <span className="ml-2 font-semibold">· Double points</span> : null}
                </div>
              </div>

              {/* Sides (single-row each) */}
              <div className="p-4 space-y-2">
                <div className="text-xs font-semibold text-gray-700">Sides</div>

                <div className="rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-3 py-2 text-sm">
                    <span className="font-semibold text-gray-900">A: {safeText(groupA?.name, "Team A")}:</span>{" "}
                    <span className="font-semibold text-gray-900">{labels.aLabel}</span>
                  </div>
                  <div className="border-t border-gray-200 px-3 py-2 text-sm">
                    <span className="font-semibold text-gray-900">B: {safeText(groupB?.name, "Team B")}:</span>{" "}
                    <span className="font-semibold text-gray-900">{labels.bLabel}</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Hole-by-hole */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Hole-by-hole</div>
              </div>

              {/* Table */}
              <div className="grid grid-cols-12 bg-gray-50 border-b">
                <div className="col-span-2 px-3 py-2 text-[11px] font-semibold text-gray-700">Hole</div>
                <div className="col-span-2 px-3 py-2 text-[11px] font-semibold text-gray-700 bg-blue-50">A</div>
                <div className="col-span-2 px-3 py-2 text-[11px] font-semibold text-gray-700 bg-amber-50">B</div>
                <div className="col-span-2 px-3 py-2 text-[11px] font-semibold text-gray-700">Win</div>
                <div className="col-span-4 px-3 py-2 text-[11px] font-semibold text-gray-700">Status</div>
              </div>

              <div className="divide-y">
                {holeRows?.rows?.map((r: any) => {
                  const win = r.winner as "A" | "B" | "HALVED" | null;

                  const winBg =
                    win === "A" ? "bg-blue-50" : win === "B" ? "bg-amber-50" : win === "HALVED" ? "bg-gray-50" : "";
                  const winText = win === "A" ? "A" : win === "B" ? "B" : win === "HALVED" ? "½" : "";

                  return (
                    <div key={r.hole} className="grid grid-cols-12">
                      <div className="col-span-2 px-3 py-2 text-sm font-semibold text-gray-900">{r.hole}</div>

                      <div className="col-span-2 px-3 py-2 text-sm font-extrabold text-gray-900 bg-blue-50">
                        {r.aPts == null ? "" : String(r.aPts)}
                      </div>

                      <div className="col-span-2 px-3 py-2 text-sm font-extrabold text-gray-900 bg-amber-50">
                        {r.bPts == null ? "" : String(r.bPts)}
                      </div>

                      <div className={`col-span-2 px-3 py-2 text-sm font-extrabold text-gray-900 ${winBg}`}>{winText}</div>

                      <div className="col-span-4 px-3 py-2 text-sm text-gray-800">
                        {r.status ? stripThruSuffix(String(r.status)) : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
