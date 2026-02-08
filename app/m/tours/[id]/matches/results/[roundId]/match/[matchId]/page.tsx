// app/m/tours/[id]/matches/results/[roundId]/match/[matchId]/page.tsx
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

// Net stableford per hole (pickup=0)
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

type Winner = "A" | "B" | "HALVED" | "NO_DATA";

type Summary = {
  thru: number;
  diff: number; // + => A leading; - => B leading
  decidedAt: number | null;
  isFinal: boolean;
};

function computeSummary(winners: Winner[]): Summary {
  let diff = 0;
  let thru = 0;
  let decidedAt: number | null = null;

  for (let h = 1; h <= 18; h++) {
    const w = winners[h - 1] ?? "NO_DATA";
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
  const leader = diff > 0 ? leftLabel : rightLabel;
  return `${leader} ${Math.abs(diff)} up (after ${thru} holes)`;
}

function renderFinalText(args: { diff: number; decidedAt: number | null; leftLabel: string; rightLabel: string }) {
  const { diff, decidedAt, leftLabel, rightLabel } = args;
  if (diff === 0) return "All Square";

  const winner = diff > 0 ? leftLabel : rightLabel;
  const loser = diff > 0 ? rightLabel : leftLabel;
  const up = Math.abs(diff);

  if (decidedAt != null && decidedAt >= 1 && decidedAt <= 18) {
    const remaining = 18 - decidedAt;
    if (remaining > 0) return `${winner} def ${loser} ${up} & ${remaining}`;
  }
  return `${winner} def ${loser} ${up} up`;
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
  const [match, setMatch] = useState<MatchRow | null>(null);

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
        if (!set) throw new Error("No match settings found for this round.");

        // Match + players
        const { data: mRow, error: mErr } = await supabase
          .from("match_round_matches")
          .select("id,match_no,match_round_match_players(side,slot,player_id)")
          .eq("id", matchId)
          .maybeSingle();
        if (mErr) throw mErr;
        if (!mRow) throw new Error("Match not found.");

        const matchRow = mRow as any as MatchRow;

        const assigns = (matchRow.match_round_match_players ?? []) as any[];
        const playerIds = Array.from(
          new Set(
            assigns
              .map((a) => String(a.player_id ?? ""))
              .map((x) => x.trim())
              .filter(Boolean)
          )
        );

        if (playerIds.length === 0) throw new Error("No players assigned to this match.");

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
        const { data: scRows, error: scErr } = await supabase
          .from("scores")
          .select("player_id,hole_number,strokes,pickup")
          .eq("round_id", roundId)
          .in("player_id", playerIds);
        if (scErr) throw scErr;

        const sRows: ScoreRow[] = (scRows ?? []).map((s: any) => ({
          player_id: String(s.player_id),
          hole_number: Number(s.hole_number),
          strokes: s.strokes === null || s.strokes === undefined ? null : Number(s.strokes),
          pickup: s.pickup === true ? true : s.pickup === false ? false : (s.pickup ?? null),
        }));

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
        setMatch(matchRow);
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

  const headerLine = useMemo(() => {
    const rn = round?.round_no != null ? `Round ${round.round_no}` : "Round";
    const d = fmtAuMelbourneDate(parseDateForDisplay(pickBestRoundDateISO(round)));
    const c = getCourseName(round);
    return [rn, d || "", c || ""].filter(Boolean).join(" · ");
  }, [round]);

  const assigns = useMemo(() => {
    const a = (match?.match_round_match_players ?? []) as Array<{ side: "A" | "B"; slot: number; player_id: string }>;
    const get = (side: "A" | "B", slot: 1 | 2) =>
      a.find((x) => x.side === side && Number(x.slot) === slot)?.player_id ? String(a.find((x) => x.side === side && Number(x.slot) === slot)!.player_id) : "";
    return {
      A1: get("A", 1),
      A2: get("A", 2),
      B1: get("B", 1),
      B2: get("B", 2),
    };
  }, [match]);

  function playerName(id: string) {
    return playersById.get(id)?.name ?? "(player)";
  }

  const labels = useMemo(() => {
    const isBetterBall = settings?.format === "BETTERBALL_MATCHPLAY";
    const left = isBetterBall ? `${playerName(assigns.A1)} / ${playerName(assigns.A2)}` : `${playerName(assigns.A1)}`;
    const right = isBetterBall ? `${playerName(assigns.B1)} / ${playerName(assigns.B2)}` : `${playerName(assigns.B1)}`;
    return { left, right, isBetterBall };
  }, [settings, assigns, playersById]);

  const scoreByPlayerHole = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    for (const s of scores) m.set(`${s.player_id}|${s.hole_number}`, s);
    return m;
  }, [scores]);

  const ptsByPlayerHole = useMemo(() => {
    const m = new Map<string, number>();
    if (!round?.course_id) return m;

    for (const [pid, p] of playersById.entries()) {
      const tee: Tee = p.gender ? normalizeTee(p.gender) : "M";
      const pars = parsByTeeHole.get(tee) || parsByTeeHole.get("M") || parsByTeeHole.get("F") || null;
      if (!pars) continue;

      const rp = roundPlayersById.get(pid);
      // even if playing flag missing, we can still compute if scores exist; but keep strict for now:
      const hcp = Number.isFinite(Number(rp?.playing_handicap)) ? Number(rp?.playing_handicap) : 0;

      for (let h = 1; h <= 18; h++) {
        const pr = pars.get(h);
        if (!pr) continue;

        const sc = scoreByPlayerHole.get(`${pid}|${h}`);
        if (!sc) continue;

        const raw = normalizeRawScore(sc.strokes, sc.pickup);
        const pts = netStablefordPointsForHole({
          rawScore: raw,
          par: pr.par,
          strokeIndex: pr.si,
          playingHandicap: hcp,
        });
        m.set(`${pid}|${h}`, pts);
      }
    }

    return m;
  }, [round, playersById, roundPlayersById, parsByTeeHole, scoreByPlayerHole]);

  const holes = useMemo(() => {
    if (!settings || !match) return [];

    const { A1, A2, B1, B2 } = assigns;
    const isBetterBall = settings.format === "BETTERBALL_MATCHPLAY";

    const rows: Array<{
      hole: number;
      aPts: number | null;
      bPts: number | null;
      winner: Winner;
      runningText: string;
    }> = [];

    const winners: Winner[] = [];

    let diff = 0;
    let thru = 0;

    for (let h = 1; h <= 18; h++) {
      const aHas = isBetterBall
        ? ptsByPlayerHole.has(`${A1}|${h}`) || ptsByPlayerHole.has(`${A2}|${h}`)
        : ptsByPlayerHole.has(`${A1}|${h}`);
      const bHas = isBetterBall
        ? ptsByPlayerHole.has(`${B1}|${h}`) || ptsByPlayerHole.has(`${B2}|${h}`)
        : ptsByPlayerHole.has(`${B1}|${h}`);

      let aPts: number | null = null;
      let bPts: number | null = null;

      if (aHas) {
        aPts = isBetterBall
          ? Math.max(ptsByPlayerHole.get(`${A1}|${h}`) ?? 0, ptsByPlayerHole.get(`${A2}|${h}`) ?? 0)
          : ptsByPlayerHole.get(`${A1}|${h}`) ?? 0;
      }
      if (bHas) {
        bPts = isBetterBall
          ? Math.max(ptsByPlayerHole.get(`${B1}|${h}`) ?? 0, ptsByPlayerHole.get(`${B2}|${h}`) ?? 0)
          : ptsByPlayerHole.get(`${B1}|${h}`) ?? 0;
      }

      let w: Winner = "NO_DATA";
      if (aHas && bHas) {
        thru = h;
        if ((aPts ?? 0) > (bPts ?? 0)) {
          w = "A";
          diff += 1;
        } else if ((bPts ?? 0) > (aPts ?? 0)) {
          w = "B";
          diff -= 1;
        } else {
          w = "HALVED";
        }
      }

      winners.push(w);

      const runningText =
        thru <= 0
          ? ""
          : diff === 0
          ? "AS"
          : diff > 0
          ? `A ${Math.abs(diff)} up`
          : `B ${Math.abs(diff)} up`;

      rows.push({ hole: h, aPts, bPts, winner: w, runningText });
    }

    // (not used directly here, but kept for consistency)
    void winners;

    return rows;
  }, [settings, match, assigns, ptsByPlayerHole]);

  const overall = useMemo(() => {
    if (!settings || !match) return { title: "", subtitle: "" };

    const { left, right } = labels;

    const winners: Winner[] = holes.map((h) => h.winner);
    const s = computeSummary(winners);

    const title = `Match ${match.match_no}: ${left} vs ${right}`;
    const subtitle = s.isFinal
      ? renderFinalText({ diff: s.diff, decidedAt: s.decidedAt, leftLabel: left, rightLabel: right })
      : renderLiveText({ diff: s.diff, thru: s.thru, leftLabel: left, rightLabel: right });

    return { title, subtitle };
  }, [settings, match, holes, labels]);

  if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId) || !isLikelyUuid(matchId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900 pb-10">
        <div className="mx-auto w-full max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">Missing or invalid route params.</div>
          <div className="mt-4">
            <Link className="underline text-sm" href={`/m/tours/${tourId}/matches/results/${roundId}`}>
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
            <div className="text-base font-semibold">Match – Detail</div>
            <div className="truncate text-sm text-gray-500">{headerLine || "Round"}</div>
          </div>

          <Link
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm active:bg-gray-50"
            href={`/m/tours/${tourId}/matches/results/${roundId}`}
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
        ) : !settings || !match ? (
          <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">Match not available.</div>
        ) : (
          <>
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">{overall.title}</div>
                <div className="mt-1 text-xs text-gray-600">{overall.subtitle}</div>
                <div className="mt-2 text-xs text-gray-600">
                  Holes are decided using <span className="font-semibold">net Stableford points</span> (pickup = 0).
                  {settings.format === "BETTERBALL_MATCHPLAY" ? (
                    <span className="ml-2">Betterball uses the best score per side per hole.</span>
                  ) : null}
                </div>
              </div>

              <div className="p-4">
                <div className="grid grid-cols-12 text-[11px] font-semibold text-gray-700">
                  <div className="col-span-2">Hole</div>
                  <div className="col-span-3 text-center">A</div>
                  <div className="col-span-3 text-center">B</div>
                  <div className="col-span-2 text-center">Win</div>
                  <div className="col-span-2 text-right">Status</div>
                </div>

                <div className="mt-2 divide-y rounded-2xl border border-gray-200 overflow-hidden">
                  {holes.map((h) => (
                    <div key={h.hole} className="grid grid-cols-12 items-center px-3 py-2 text-sm">
                      <div className="col-span-2 font-semibold text-gray-900">{h.hole}</div>

                      <div className="col-span-3 text-center font-semibold text-gray-900">
                        {h.aPts == null ? "–" : h.aPts}
                      </div>
                      <div className="col-span-3 text-center font-semibold text-gray-900">
                        {h.bPts == null ? "–" : h.bPts}
                      </div>

                      <div className="col-span-2 text-center text-xs font-semibold text-gray-700">
                        {h.winner === "NO_DATA" ? "–" : h.winner === "HALVED" ? "½" : h.winner}
                      </div>

                      <div className="col-span-2 text-right text-xs font-semibold text-gray-700">{h.runningText}</div>
                    </div>
                  ))}
                </div>

                <div className="mt-3 text-[11px] text-gray-400">Dates shown in Australia/Melbourne.</div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
