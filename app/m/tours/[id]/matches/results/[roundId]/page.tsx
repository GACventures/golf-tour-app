"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Tee = "M" | "F";

type RoundRow = {
  id: string;
  tour_id: string;
  course_id: string | null;
  round_no?: number | null;
  round_date?: string | null; // may not exist
  played_on?: string | null; // may not exist
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

  const strokes = Number(rawScore);
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

type MatchplaySummary = {
  thru: number;
  diff: number;
  decidedAt: number | null;
  isFinal: boolean;
};

function computeMatchplaySummary(holeWinners: Array<"A" | "B" | "HALVED" | "NO_DATA">): MatchplaySummary {
  let diff = 0;
  let thru = 0;
  let decidedAt: number | null = null;

  for (let h = 1; h <= 18; h++) {
    const w = holeWinners[h - 1] ?? "NO_DATA";
    if (w === "NO_DATA") continue;

    thru = h;
    if (w === "A") diff += 1;
    else if (w === "B") diff -= 1;

    const holesRemaining = 18 - h;
    if (decidedAt === null && Math.abs(diff) > holesRemaining) {
      decidedAt = h;
      break;
    }
  }

  const isFinal = decidedAt !== null || thru === 18;
  return { thru, diff, decidedAt, isFinal };
}

function renderLiveText(args: { diff: number; thru: number; leftLabel: string; rightLabel: string }) {
  const { diff, thru, leftLabel, rightLabel } = args;

  if (thru <= 0) return "Not started";
  if (diff === 0) return `All Square (after ${thru} holes)`;

  const leaderLabel = diff > 0 ? leftLabel : rightLabel;
  const up = Math.abs(diff);
  return `${leaderLabel} is ${up} up (after ${thru} holes)`;
}

function renderFinalText(args: { diff: number; decidedAt: number | null; leftLabel: string; rightLabel: string }) {
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

export default function MatchesResultsRoundPage() {
  const params = useParams<{ id?: string; roundId?: string }>();
  const router = useRouter();

  const tourId = String(params?.id ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [round, setRound] = useState<RoundRow | null>(null);
  const [settings, setSettings] = useState<SettingsRow | null>(null);

  const [groupA, setGroupA] = useState<GroupRow | null>(null);
  const [groupB, setGroupB] = useState<GroupRow | null>(null);

  const [playersById, setPlayersById] = useState<Map<string, PlayerRow>>(new Map());
  const [roundPlayersById, setRoundPlayersById] = useState<Map<string, RoundPlayerRow>>(new Map());
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [parsByTeeHole, setParsByTeeHole] = useState<Map<Tee, Map<number, { par: number; si: number }>>>(new Map());

  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [tourPlayerCount, setTourPlayerCount] = useState<number>(0);

  useEffect(() => {
    if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId)) return;

    let alive = true;

    async function fetchRound(selectCols: string) {
      return supabase.from("rounds").select(selectCols).eq("id", roundId).single();
    }

    async function load() {
      setLoading(true);
      setErrorMsg("");

      try {
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

        const { data: gRows, error: gErr } = await supabase
          .from("tour_groups")
          .select("id,name")
          .in("id", [set.group_a_id, set.group_b_id]);
        if (gErr) throw gErr;

        const gA = (gRows ?? []).find((g: any) => String(g.id) === set.group_a_id) ?? null;
        const gB = (gRows ?? []).find((g: any) => String(g.id) === set.group_b_id) ?? null;

        const { data: tpRows, error: tpErr } = await supabase.from("tour_players").select("player_id").eq("tour_id", tourId);
        if (tpErr) throw tpErr;

        const tourPlayerIds = (tpRows ?? []).map((x: any) => String(x.player_id));
        const N = tourPlayerIds.length;

        let matchRows: MatchRow[] = [];
        let playerIds: string[] = [];

        if (set.format !== "INDIVIDUAL_STABLEFORD") {
          const { data: mRows, error: mErr } = await supabase
            .from("match_round_matches")
            .select("id,match_no,match_round_match_players(side,slot,player_id)")
            .eq("settings_id", set.id)
            .order("match_no", { ascending: true });
          if (mErr) throw mErr;

          matchRows = (mRows ?? []) as any;
          const pidSet = new Set<string>();
          for (const m of matchRows) {
            const pls = (m.match_round_match_players ?? []) as any[];
            pls.forEach((x) => pidSet.add(String(x.player_id)));
          }
          playerIds = Array.from(pidSet);
        } else {
          playerIds = tourPlayerIds;
        }

        const { data: pRows, error: pErr } = await supabase.from("players").select("id,name,gender").in("id", playerIds);
        if (pErr) throw pErr;

        const pMap = new Map<string, PlayerRow>();
        (pRows ?? []).forEach((p: any) => {
          pMap.set(String(p.id), { id: String(p.id), name: safeText(p.name, "(unnamed)"), gender: p.gender ?? null });
        });

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
        setTourPlayerCount(N);

        setMatches(matchRows);
        setPlayersById(pMap);
        setRoundPlayersById(rpMap);
        setScores(sRows);
        setParsByTeeHole(parsMap);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load match results.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [tourId, roundId]);

  const scoreByPlayerHole = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    for (const s of scores) m.set(`${s.player_id}|${s.hole_number}`, s);
    return m;
  }, [scores]);

  const ptsByPlayerHole = useMemo(() => {
    const m = new Map<string, number>();
    if (!round?.course_id) return m;

    for (const [playerId, p] of playersById.entries()) {
      const tee: Tee = p.gender ? normalizeTee(p.gender) : "M";
      const pars = parsByTeeHole.get(tee) || parsByTeeHole.get("M") || parsByTeeHole.get("F") || null;
      if (!pars) continue;

      const rp = roundPlayersById.get(playerId);
      if (!rp?.playing) continue;

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

  function playerName(id: string) {
    return playersById.get(id)?.name ?? "(player)";
  }

  const matchResults = useMemo(() => {
    if (!settings) return [];
    if (settings.format === "INDIVIDUAL_STABLEFORD") return [];

    const out: Array<{ match_id: string; match_no: number; resultText: string }> = [];

    for (const mRow of matches) {
      const assigns = (mRow.match_round_match_players ?? []) as any[];

      const A1 = assigns.find((x) => x.side === "A" && Number(x.slot) === 1)?.player_id ?? "";
      const A2 = assigns.find((x) => x.side === "A" && Number(x.slot) === 2)?.player_id ?? "";
      const B1 = assigns.find((x) => x.side === "B" && Number(x.slot) === 1)?.player_id ?? "";
      const B2 = assigns.find((x) => x.side === "B" && Number(x.slot) === 2)?.player_id ?? "";

      const isBetterBall = settings.format === "BETTERBALL_MATCHPLAY";
      const leftLabel = isBetterBall ? `${playerName(A1)} / ${playerName(A2)}` : `${playerName(A1)}`;
      const rightLabel = isBetterBall ? `${playerName(B1)} / ${playerName(B2)}` : `${playerName(B1)}`;

      const holeWinners: Array<"A" | "B" | "HALVED" | "NO_DATA"> = [];

      for (let h = 1; h <= 18; h++) {
        const aHas = isBetterBall
          ? ptsByPlayerHole.has(`${A1}|${h}`) || ptsByPlayerHole.has(`${A2}|${h}`)
          : ptsByPlayerHole.has(`${A1}|${h}`);
        const bHas = isBetterBall
          ? ptsByPlayerHole.has(`${B1}|${h}`) || ptsByPlayerHole.has(`${B2}|${h}`)
          : ptsByPlayerHole.has(`${B1}|${h}`);

        if (!aHas || !bHas) {
          holeWinners.push("NO_DATA");
          continue;
        }

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

      const summary = computeMatchplaySummary(holeWinners);

      const resultText = summary.isFinal
        ? renderFinalText({ diff: summary.diff, decidedAt: summary.decidedAt, leftLabel, rightLabel })
        : renderLiveText({ diff: summary.diff, thru: summary.thru, leftLabel, rightLabel });

      out.push({ match_id: String(mRow.id), match_no: Number(mRow.match_no), resultText });
    }

    out.sort((a, b) => a.match_no - b.match_no);
    return out;
  }, [settings, matches, ptsByPlayerHole, playersById]);

  const stablefordTotals = useMemo(() => {
    if (!settings) return [];
    if (settings.format !== "INDIVIDUAL_STABLEFORD") return [];

    const rows: Array<{ player_id: string; name: string; total: number }> = [];

    for (const [playerId, p] of playersById.entries()) {
      const rp = roundPlayersById.get(playerId);
      if (!rp?.playing) continue;

      let sum = 0;
      for (let h = 1; h <= 18; h++) sum += ptsByPlayerHole.get(`${playerId}|${h}`) ?? 0;

      rows.push({ player_id: playerId, name: p.name, total: sum });
    }

    rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return rows;
  }, [settings, playersById, roundPlayersById, ptsByPlayerHole]);

  const stablefordWinners = useMemo(() => {
    if (!settings) return { winners: [], cutoff: null as number | null, target: 0 };
    if (settings.format !== "INDIVIDUAL_STABLEFORD") return { winners: [], cutoff: null as number | null, target: 0 };

    const N = Math.max(0, Math.floor(tourPlayerCount || 0));
    const target = Math.floor(N / 2);

    if (target <= 0) return { winners: [], cutoff: null, target };
    if (stablefordTotals.length === 0) return { winners: [], cutoff: null, target };

    const cutoffIndex = Math.min(target - 1, stablefordTotals.length - 1);
    const cutoff = stablefordTotals[cutoffIndex]?.total ?? null;

    const winners = cutoff == null ? [] : stablefordTotals.filter((r) => r.total >= cutoff);
    return { winners, cutoff, target };
  }, [settings, stablefordTotals, tourPlayerCount]);

  const headerLine = useMemo(() => {
    const rn = round?.round_no != null ? `Round ${round.round_no}` : "Round";
    const d = fmtAuMelbourneDate(parseDateForDisplay(pickBestRoundDateISO(round)));
    const c = getCourseName(round);
    return [rn, d || "", c || ""].filter(Boolean).join(" · ");
  }, [round]);

  function hardNavigateToMatch(matchId: string) {
    if (!matchId) return;

    const url = `/m/tours/${tourId}/matches/results/${roundId}/match/${matchId}`;

    // Try SPA navigation first
    try {
      router.push(url);
    } catch {
      // ignore
    }

    // Hard fallback (covers iOS oddities / blocked client navigation)
    if (typeof window !== "undefined") {
      const targetPath = new URL(url, window.location.origin).pathname;
      window.setTimeout(() => {
        if (window.location.pathname !== targetPath) {
          window.location.href = url;
        }
      }, 120);
    }
  }

  if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900 pb-10">
        <div className="mx-auto w-full max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">Missing or invalid tour/round id in route.</div>
          <div className="mt-4">
            <Link className="underline text-sm" href={`/m/tours/${tourId}/matches/results`}>
              Back
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
            <div className="text-base font-semibold">Matches – Results</div>
            <div className="truncate text-sm text-gray-500">{headerLine || "Round"}</div>
          </div>

          <Link
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm active:bg-gray-50"
            href={`/m/tours/${tourId}/matches/results`}
          >
            Back
          </Link>
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
        ) : (
          <>
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Round format</div>
                <div className="mt-1 text-xs text-gray-600">
                  {formatLabel(settings.format)}
                  {settings.double_points ? <span className="ml-2 font-semibold">· Double points</span> : null}
                </div>
                <div className="mt-1 text-xs text-gray-600">
                  Teams: <span className="font-semibold">{safeText(groupA?.name, "Team A")}</span> vs{" "}
                  <span className="font-semibold">{safeText(groupB?.name, "Team B")}</span>
                </div>
              </div>

              <div className="p-4 text-xs text-gray-600">
                Matchplay holes are decided using <span className="font-semibold">net Stableford points</span> per hole (pickup = 0).
              </div>
            </section>

            {settings.format !== "INDIVIDUAL_STABLEFORD" ? (
              <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="p-4 border-b">
                  <div className="text-sm font-semibold text-gray-900">Match results</div>
                  <div className="mt-1 text-xs text-gray-600">Tap a match to see hole-by-hole.</div>
                </div>

                {matchResults.length === 0 ? (
                  <div className="p-4 text-sm text-gray-700">No matches configured for this round.</div>
                ) : (
                  <div className="divide-y">
                    {matchResults.map((m) => (
                      <button
                        key={m.match_id}
                        type="button"
                        onClick={() => hardNavigateToMatch(m.match_id)}
                        className="w-full text-left p-4 active:bg-gray-50"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs text-gray-500">Match {m.match_no}</div>
                            <div className="mt-1 text-sm font-semibold text-gray-900">{m.resultText}</div>
                          </div>
                          <div className="shrink-0 text-xs font-semibold text-gray-500">View</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="p-4 border-b">
                  <div className="text-sm font-semibold text-gray-900">Stableford results</div>
                  <div className="mt-1 text-xs text-gray-600">
                    Winners are top <span className="font-semibold">{stablefordWinners.target}</span> by round Stableford total (ties at cutoff included).
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  <div>
                    <div className="text-xs font-semibold text-gray-700">Winners</div>
                    {stablefordWinners.winners.length === 0 ? (
                      <div className="mt-1 text-sm text-gray-700">
                        No winners yet (no stableford totals could be calculated for this round).
                      </div>
                    ) : (
                      <div className="mt-2 space-y-1">
                        {stablefordWinners.winners.map((w) => (
                          <div
                            key={w.player_id}
                            className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-2"
                          >
                            <div className="text-sm font-semibold text-gray-900 truncate">{w.name}</div>
                            <div className="text-sm font-extrabold text-gray-900">{w.total}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-gray-700">All scores</div>
                    {stablefordTotals.length === 0 ? (
                      <div className="mt-1 text-sm text-gray-700">No scores found.</div>
                    ) : (
                      <div className="mt-2 overflow-hidden rounded-2xl border border-gray-200">
                        <div className="grid grid-cols-12 bg-gray-50 border-b">
                          <div className="col-span-9 px-3 py-2 text-[11px] font-semibold text-gray-700">Player</div>
                          <div className="col-span-3 px-3 py-2 text-right text-[11px] font-semibold text-gray-700">
                            Total
                          </div>
                        </div>
                        <div className="divide-y">
                          {stablefordTotals.map((r) => (
                            <div key={r.player_id} className="grid grid-cols-12">
                              <div className="col-span-9 px-3 py-2 text-sm font-semibold text-gray-900 truncate">{r.name}</div>
                              <div className="col-span-3 px-3 py-2 text-right text-sm font-extrabold text-gray-900">{r.total}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}
          </>
        )}

        <div className="text-[11px] text-gray-400">Dates shown in Australia/Melbourne.</div>
      </main>
    </div>
  );
}
