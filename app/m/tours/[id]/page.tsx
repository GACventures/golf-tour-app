ChatGPT
































Pasted code(58).ts
TypeScript
here is the leaderboard file.  For the tour i am working on, i would like the individual  leaderboard should be based on the best five rounds,  with round 3 and round 7 to be included in the best five.  Please summarise what is required, i will confirm, and then provide replacment code


Pasted code(59).ts
TypeScript
I have added the file that calculates the pairs scorecard when you clikc a score on the pairs leaderboard.  Can you prepare a specifla version to apply for ruond 3 of this tour.  please summarise what the page will look like.  i will confirm and then you provide full replacemetn code


Pasted code(60).ts
TypeScript
here is the competitions file.  Does it only include rounds if all 18 holes have been played


Pasted code(61).ts
TypeScript

Pasted code (2)(11).ts
TypeScript
// lib/competitions/engine.ts
import type { CompetitionContext, CompetitionDefinition } from "./types";

export type CompetitionRow = {
  entryId: string;
  label: string;
  total: number;
  stats?: Record<string, any>;
};

export type CompetitionResult = {
  rows: CompetitionRow[];
};

function isTourContext(ctx: CompetitionContext): boolean {
  const c = ctx as any;
  if (typeof c?.scope === "string") return c.scope === "tour";
  return Array.isArray(c?.rounds);
}

function isRoundContext(ctx: CompetitionContext): boolean {
  const c = ctx as any;
  if (typeof c?.scope === "string") return c.scope === "round";
  return !Array.isArray(c?.rounds);
}

function safeNumber(n: any): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Decide if a player is "complete" for ROUND scope.
 * For TOUR scope, we intentionally DO NOT enforce completeness here,
 * because tour competitions already handle completeness per-round
 * (via r.isComplete(playerId) inside the competition compute).
 */
function isPlayerCompleteForRoundScope(ctx: any, playerId: string): boolean {
  // Common patterns:
  // - ctx.isComplete(playerId)
  // - ctx.round.isComplete(playerId)
  if (typeof ctx?.isComplete === "function") return !!ctx.isComplete(playerId);
  if (typeof ctx?.round?.isComplete === "function") return !!ctx.round.isComplete(playerId);

  // If no completeness fn exists, be permissive.
  return true;
}

export function runCompetition(def: CompetitionDefinition, ctx: CompetitionContext): CompetitionResult {
  // 1) Eligibility filtering (players)
  const rawPlayers = ((ctx as any)?.players ?? []) as Array<any>;
  let players = rawPlayers;

  // onlyPlaying: keep those marked playing === true
  if (def.eligibility?.onlyPlaying) {
    players = players.filter((p) => p?.playing === true);
  }

  // requireComplete:
  // ✅ Apply only for ROUND scope. For TOUR scope, competitions already skip incomplete rounds themselves.
  if (def.eligibility?.requireComplete) {
    if (isRoundContext(ctx)) {
      players = players.filter((p) => isPlayerCompleteForRoundScope(ctx as any, p.id));
    }
    // If tour context: do NOT filter here.
  }

  // 2) Run compute with the filtered players injected
  const ctxForCompute = { ...(ctx as any), players };
  const rowsRaw = (def.compute(ctxForCompute as CompetitionContext) ?? []) as any[];

  const rows: CompetitionRow[] = rowsRaw
    .map((r) => ({
      entryId: String(r.entryId ?? ""),
      label: String(r.label ?? ""),
      total: safeNumber(r.total),
      stats: r.stats ?? undefined,
    }))
    .filter((r) => r.entryId && r.label);

  // 3) Sort: highest score first, then label
  rows.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.label.localeCompare(b.label);
  });

  return { rows };
}


Pasted code(62).ts
TypeScript
here is the rehandicapping file does it only recalcuate handicaps after a round where all players have played 18 holes


Pasted code(63).ts
TypeScript
is this the file


Pasted code(64).ts
TypeScript
can you modify the attachde file so that the average score used for rehandicapping is shown in a new row at the bottom of the table.  summarise what is being requiested and if it is possible 


Pasted code(65).ts
TypeScript
here is the competitions file the calculatins for many of the competitions look too low.  For instance the Napoleon, Big George and Grand Canyon scores look too low.  I think the denominators might be too high - in particulqr it might be using all the holes in round 3 in the denominator but it should only be using half the holes.  Can you see if there is some error in the calcuation. ask clarifying questions if something is unclear


Pasted code(66).ts
TypeScript

Pasted code (2)(12).ts
TypeScript


Pasted code(68).ts
TypeScript

Pasted code (2)(14).ts
TypeScript
I want to now add a page theat allows scores to be entered atthe end of the round. i will make changes in two steps first the layout and then the scoring logic.  The layout change requires the button on the scoring page which says "Continue to Scoring" after me is selected should say "Continue to Live Scoring" and a new button added which says "Continue to End of Round Scoring" below it. if the Continue to End of Round Scoring button is clicked, it takes the player to a page which has a similar layout to the detailed daily results page, with the following changes: 1 The word Scorecard in the second row is replaced with Score Entry - End of Round 2. The bos with the stableford total is moved fom the top right to the top centre 3. A "Submit Score" button is placed where the Stableford total currrently appears 4. The legrnd below the scorecard is removed. 5. Instead of the legend, there are 12 buttons (two rows by six columns) with the first row beign 1,2,3,4,5,6 and the second row being 7.8.9.1-,0,P.  These buttons need to be large enough to use as the way to enter scores.  Attached are two relevenat files.  Please summarise what is requird and how you will proceed.  I will then confimr


Pasted code(69).ts
TypeScript
ok a couple of UI changes to the end of scoring page.The button with the total stableford score and the submit score button should be raised a little to align with the player name 2. The 12 buttons should  be enclosed in a larger block (using same colour scheme as the score alt page. 3. The words Enter Strokes should appear (in small text) inside this larger box and just above the first row of score entry buttons.  The scoring functionality is as follows.  the box containing the score for hole 1 should be shaded grey.  The number of strokes is chosen by pressing the buttons (like the score alt functionality) and this score appears for hole 1, and then the box for hole 2 goes grey.  then score for hole 2 is entereed and the box for hole 3 goes grey and so on.   the submit button will save the all the holes scores when clikced.  Each hole score button should be able to be clikced, and will then turn grey again  and a score can then be reetnered for that hole (this allows incorrect scores to be fixed).  Attached is the alt score file.  Please summarise what is required, ask any clarifying questions, and then explain how you will proceed.  i will then confirm


Pasted code(70).ts
TypeScript

Pasted text (2)(3).txt
Document
I would like to add a page at the front of the app that has buttons with the name of each player on the tour.  when the player presses theirname for the first time on this page they would be taken to the home page.  However when the player comes back to the app again they should be taken to the pagge that they had last been on ie for each player the app should track what page the player has been on.  Attached is the home page file.  please summarise what is required and if this is possible.  let me know if have any clarifying questions or require any other files. Provide access to this page of player names via a new button on the tour admin page


Pasted text(16).txt
Document
this is the file that needs to be amended please let me know where to add


Pasted code(71).ts
TypeScript
what are the steps that need to be done - is it just to change the score alt file ? here it is 


Pasted code(72).ts
TypeScript
i made the changes but i think i made some of them to the score file as well what else do i need to do to this file 


Pasted code(73).ts
TypeScript
HEre is the file that calculates comeptititions.  It seems like the scores for the Napoleon, Big Goerge and Grand Canyon are too low for the Japan Swing in Spring Tour, which might mean the denominators are too high. Please check if these calculations are workign as explected 


Pasted code(74).ts
TypeScript

Pasted code (2)(15).ts
TypeScript


Pasted text(17).txt
Document


Pasted text(18).txt
Document


Pasted code(75).ts
TypeScript
here is the file is this helpful


Pasted code(76).ts
TypeScript

Pasted code (2)(16).ts
TypeScript
i would like to change the teams leaderboard calculation by deduction 0.5 points for a zero stableford score rather than 1 point.  please summarise what is required and then provide full replacement code, one file at a time

I’ll change the team calculation in both places it appears: the main teams leaderboard total and the team round detail page. I’ll start with the leaderboard file first, then the detail file in the next response.

Thought for 1m 14s
Required change: teams now subtract 0.5 per zero Stableford, not 1 per zero, in the teams leaderboard calculation. The current file subtracts zeroCount from each hole total. 


First full replacement file:

Download replacement leaderboards/page.tsx


ok provide other file

Thought for 12s
Replace the team round detail file with the same file, changing zero deductions from -1 to -0.5. Affected logic is in the team detail calculation and contribution text. 


Path:

app/m/tours/[id]/leaderboards/teams/[roundId]/[teamId]/page.tsx
Use this full replacement file:

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

/* ---------------- Types ---------------- */

type Tee = "M" | "F";

type Player = {
  id: string;
  name: string;
  gender: Tee | null;
};

type RoundRow = {
  id: string;
  course_id: string | null;
};

type RoundPlayer = {
  player_id: string;
  playing: boolean;
  playing_handicap: number | null;
};

type ScoreRow = {
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup: boolean | null;
};

type TeamRule = {
  bestY: number;
};

/* ---------------- Helpers ---------------- */

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  const isF = s === "F" || s === "FEMALE" || s === "W" || s === "WOMEN" || s === "WOMAN";
  return isF ? "F" : "M";
}

function safeName(v: any, fallback: string) {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function normalizeRawScore(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  const n = Number(strokes);
  return Number.isFinite(n) ? String(n) : "";
}

function netStablefordPointsForHole(params: {
  rawScore: string;
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

function clampInt(n: any, min: number, max: number) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function pickTopNPositivesExact(args: {
  entries: Array<{ playerId: string; pts: number; orderIndex: number }>;
  n: number;
}) {
  const N = clampInt(args.n, 1, 99);
  const positives = args.entries.filter((e) => e.pts > 0);

  positives.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    return a.orderIndex - b.orderIndex;
  });

  return positives.slice(0, Math.min(N, positives.length));
}

/* ---------------- Page ---------------- */

export default function TeamRoundDetailPage() {
  const params = useParams<{
    id?: string;
    roundId?: string;
    teamId?: string;
  }>();

  const tourId = String(params?.id ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();
  const teamId = String(params?.teamId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [teamName, setTeamName] = useState<string>("Team");
  const [players, setPlayers] = useState<Player[]>([]);
  const [round, setRound] = useState<RoundRow | null>(null);
  const [roundPlayers, setRoundPlayers] = useState<Map<string, RoundPlayer>>(new Map());
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [parsByTeeHole, setParsByTeeHole] = useState<Map<Tee, Map<number, { par: number; si: number }>>>(new Map());
  const [teamRule, setTeamRule] = useState<TeamRule>({ bestY: 1 });

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const { data: teamRow, error: teamErr } = await supabase
          .from("tour_groups")
          .select("id,name")
          .eq("id", teamId)
          .maybeSingle();
        if (teamErr) throw teamErr;

        const { data: memRows, error: memErr } = await supabase
          .from("tour_group_members")
          .select("group_id,player_id,position,players(id,name,gender)")
          .eq("group_id", teamId)
          .order("position", { ascending: true, nullsFirst: true });
        if (memErr) throw memErr;

        const ps: Player[] = (memRows ?? [])
          .map((m: any) => m.players)
          .filter(Boolean)
          .map((p: any) => ({
            id: String(p.id),
            name: safeName(p.name, "(unnamed)"),
            gender: p.gender ? normalizeTee(p.gender) : null,
          }));

        const { data: rRow, error: rErr } = await supabase
          .from("rounds")
          .select("id,course_id")
          .eq("id", roundId)
          .single();
        if (rErr) throw rErr;
        const rr = rRow as RoundRow;

        const playerIds = ps.map((p) => p.id);

        let rpMap = new Map<string, RoundPlayer>();
        if (playerIds.length > 0) {
          const { data: rpRows, error: rpErr } = await supabase
            .from("round_players")
            .select("player_id,playing,playing_handicap")
            .eq("round_id", roundId)
            .in("player_id", playerIds);
          if (rpErr) throw rpErr;

          rpMap = new Map();
          (rpRows ?? []).forEach((x: any) => {
            rpMap.set(String(x.player_id), {
              player_id: String(x.player_id),
              playing: x.playing === true,
              playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
            });
          });
        }

        let scRows: ScoreRow[] = [];
        if (playerIds.length > 0) {
          const { data: sRows, error: sErr } = await supabase
            .from("scores")
            .select("player_id,hole_number,strokes,pickup")
            .eq("round_id", roundId)
            .in("player_id", playerIds);
          if (sErr) throw sErr;

          scRows =
            (sRows ?? []).map((s: any) => ({
              player_id: String(s.player_id),
              hole_number: Number(s.hole_number),
              strokes: s.strokes === null || s.strokes === undefined ? null : Number(s.strokes),
              pickup: s.pickup === true ? true : s.pickup === false ? false : (s.pickup ?? null),
            })) ?? [];
        }

        const courseId = rr.course_id;
        let parsMap = new Map<Tee, Map<number, { par: number; si: number }>>();
        if (courseId) {
          const { data: pRows, error: pErr } = await supabase
            .from("pars")
            .select("hole_number,par,stroke_index,tee")
            .eq("course_id", courseId)
            .in("tee", ["M", "F"])
            .order("hole_number", { ascending: true });
          if (pErr) throw pErr;

          parsMap = new Map();
          (pRows ?? []).forEach((p: any) => {
            const tee: Tee = normalizeTee(p.tee);
            if (!parsMap.has(tee)) parsMap.set(tee, new Map());
            parsMap.get(tee)!.set(Number(p.hole_number), {
              par: Number(p.par),
              si: Number(p.stroke_index),
            });
          });
        }

        const { data: setRow, error: setErr } = await supabase
          .from("tour_grouping_settings")
          .select("default_team_best_m")
          .eq("tour_id", tourId)
          .maybeSingle();
        if (setErr) throw setErr;

        const y = Number.isFinite(Number((setRow as any)?.default_team_best_m))
          ? Number((setRow as any)?.default_team_best_m)
          : 1;

        if (!alive) return;

        const nm = String((teamRow as any)?.name ?? "").trim();
        setTeamName(nm || "Team");
        setPlayers(ps);
        setRound(rr);
        setRoundPlayers(rpMap);
        setScores(scRows);
        setParsByTeeHole(parsMap);
        setTeamRule({ bestY: clampInt(y, 1, 99) });
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load team round detail.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    if (tourId && roundId && teamId) void load();
    else {
      setError("Missing route params.");
      setLoading(false);
    }

    return () => {
      alive = false;
    };
  }, [tourId, roundId, teamId]);

  const scoreByPlayerHole = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    for (const s of scores) m.set(`${s.player_id}|${s.hole_number}`, s);
    return m;
  }, [scores]);

  const ptsByPlayerHole = useMemo(() => {
    const m = new Map<string, number>();
    if (!round?.course_id) return m;

    for (const p of players) {
      const tee: Tee = p.gender ? normalizeTee(p.gender) : "M";
      const pars = parsByTeeHole.get(tee) || parsByTeeHole.get("M") || parsByTeeHole.get("F") || null;
      if (!pars) continue;

      const rp = roundPlayers.get(p.id);
      if (!rp?.playing) continue;

      const hcp = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0;

      for (let h = 1; h <= 18; h++) {
        const pr = pars.get(h);
        if (!pr) continue;

        const sc = scoreByPlayerHole.get(`${p.id}|${h}`);
        if (!sc) continue;

        const raw = normalizeRawScore(sc.strokes, sc.pickup);
        const pts = netStablefordPointsForHole({
          rawScore: raw,
          par: pr.par,
          strokeIndex: pr.si,
          playingHandicap: hcp,
        });

        m.set(`${p.id}|${h}`, pts);
      }
    }

    return m;
  }, [players, round, roundPlayers, parsByTeeHole, scoreByPlayerHole]);

  const computed = useMemo(() => {
    const N = clampInt(teamRule.bestY, 1, 99);

    const teamHoleTotals: number[] = Array.from({ length: 19 }).map(() => 0);

    const playerContributionTotals = new Map<string, number>();
    for (const p of players) playerContributionTotals.set(p.id, 0);

    const boxedBlueByHole = new Map<number, Set<string>>();
    const zeroByHole = new Map<number, Set<string>>();

    for (let h = 1; h <= 18; h++) {
      const zeroSet = new Set<string>();
      const entries: Array<{ playerId: string; pts: number; orderIndex: number }> = [];

      for (let idx = 0; idx < players.length; idx++) {
        const p = players[idx];
        const rp = roundPlayers.get(p.id);
        if (!rp?.playing) continue;

        const pts = ptsByPlayerHole.get(`${p.id}|${h}`);
        if (pts === undefined) continue;

        if (pts === 0) {
          zeroSet.add(p.id);
          playerContributionTotals.set(p.id, (playerContributionTotals.get(p.id) || 0) - 0.5);
        } else if (pts > 0) {
          entries.push({ playerId: p.id, pts, orderIndex: idx });
        }
      }

      const picked = pickTopNPositivesExact({ entries, n: N });
      const blueSet = new Set<string>(picked.map((x) => x.playerId));

      let posSum = 0;
      for (const x of picked) {
        posSum += x.pts;
        playerContributionTotals.set(x.playerId, (playerContributionTotals.get(x.playerId) || 0) + x.pts);
      }

      const holeTotal = posSum - zeroSet.size * 0.5;

      teamHoleTotals[h] = holeTotal;
      boxedBlueByHole.set(h, blueSet);
      zeroByHole.set(h, zeroSet);
    }

    const teamTotal = teamHoleTotals.slice(1, 19).reduce((a, b) => a + b, 0);

    return {
      teamHoleTotals,
      teamTotal,
      playerContributionTotals,
      boxedBlueByHole,
      zeroByHole,
    };
  }, [players, roundPlayers, ptsByPlayerHole, teamRule.bestY]);

  const playerRoundStablefordTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of players) totals.set(p.id, 0);

    for (const p of players) {
      const rp = roundPlayers.get(p.id);
      if (!rp?.playing) continue;

      let sum = 0;
      for (let h = 1; h <= 18; h++) {
        const pts = ptsByPlayerHole.get(`${p.id}|${h}`);
        if (pts === undefined) continue;
        sum += pts;
      }
      totals.set(p.id, sum);
    }

    return totals;
  }, [players, roundPlayers, ptsByPlayerHole]);

  const cutoffByHole = useMemo(() => {
    const m = new Map<number, number | null>();

    for (let h = 1; h <= 18; h++) {
      const blueSet = computed.boxedBlueByHole.get(h);
      if (!blueSet || blueSet.size === 0) {
        m.set(h, null);
        continue;
      }

      let min: number | null = null;
      for (const playerId of blueSet) {
        const pts = ptsByPlayerHole.get(`${playerId}|${h}`);
        if (pts === undefined) continue;
        if (min === null || pts < min) min = pts;
      }

      m.set(h, min);
    }

    return m;
  }, [computed.boxedBlueByHole, ptsByPlayerHole]);

  const N = clampInt(teamRule.bestY, 1, 99);

  const qualifiesByHole = useMemo(() => {
    const m = new Map<number, Set<string>>();

    for (let h = 1; h <= 18; h++) {
      const cutoff = cutoffByHole.get(h) ?? null;
      const set = new Set<string>();

      if (cutoff === null) {
        m.set(h, set);
        continue;
      }

      for (const p of players) {
        const rp = roundPlayers.get(p.id);
        if (!rp?.playing) continue;

        const val = ptsByPlayerHole.get(`${p.id}|${h}`);
        if (val === undefined) continue;

        const isBlue = computed.boxedBlueByHole.get(h)?.has(p.id) ?? false;
        const isZero = computed.zeroByHole.get(h)?.has(p.id) ?? false;

        if (!isBlue && !isZero && val === cutoff) {
          set.add(p.id);
        }
      }

      m.set(h, set);
    }

    return m;
  }, [players, roundPlayers, ptsByPlayerHole, computed.boxedBlueByHole, computed.zeroByHole, cutoffByHole]);

  const playerContributionByBoxes = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of players) totals.set(p.id, 0);

    for (const p of players) {
      const rp = roundPlayers.get(p.id);
      if (!rp?.playing) continue;

      let sum = 0;

      for (let h = 1; h <= 18; h++) {
        const val = ptsByPlayerHole.get(`${p.id}|${h}`);
        if (val === undefined) continue;

        const isBlue = computed.boxedBlueByHole.get(h)?.has(p.id) ?? false;
        const isQualifies = qualifiesByHole.get(h)?.has(p.id) ?? false;
        const isZero = computed.zeroByHole.get(h)?.has(p.id) ?? false;

        if (isZero) {
          sum -= 0.5;
        } else if (isBlue || isQualifies) {
          sum += val;
        }
      }

      totals.set(p.id, sum);
    }

    return totals;
  }, [players, roundPlayers, ptsByPlayerHole, computed.boxedBlueByHole, computed.zeroByHole, qualifiesByHole]);

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
            <Link className="underline text-sm" href={`/m/tours/${tourId}/leaderboards`}>
              Back to Leaderboards
            </Link>
          </div>
        </div>
      </div>
    );
  }

  function Cell({
    pts,
    boxedBlue,
    boxedZero,
    boxedQualifies,
  }: {
    pts: number | null;
    boxedBlue: boolean;
    boxedZero: boolean;
    boxedQualifies: boolean;
  }) {
    const base = "inline-flex min-w-[24px] justify-center rounded-sm px-1 py-0.5";

    if (boxedZero) return <span className={`${base} border-2 border-red-500`}>{pts === null ? "" : pts}</span>;
    if (boxedBlue) return <span className={`${base} border-2 border-blue-500`}>{pts === null ? "" : pts}</span>;
    if (boxedQualifies) return <span className={`${base} border-2 border-sky-300`}>{pts === null ? "" : pts}</span>;

    return <span className="inline-flex min-w-[24px] justify-center">{pts === null ? "" : pts}</span>;
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-10">
      <div className="mx-auto w-full max-w-md px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-extrabold leading-tight">{teamName}</div>
            <div className="mt-1 text-xs text-gray-600">
              Round detail · Team total: <span className="font-semibold">{computed.teamTotal}</span>
            </div>

            <div className="mt-2 text-[11px] text-gray-600">
              <span className="inline-flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-sm border-2 border-blue-500" /> Counted (top {N})
                <span className="inline-block h-3 w-3 rounded-sm border-2 border-sky-300 ml-3" /> Qualifies for top {N}{" "}
                scores
                <span className="inline-block h-3 w-3 rounded-sm border-2 border-red-500 ml-3" /> Zero
              </span>
            </div>
          </div>

          <Link
            className="shrink-0 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-gray-50"
            href={`/m/tours/${tourId}/leaderboards`}
          >
            Back
          </Link>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-max border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="sticky left-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700">
                  Player
                </th>

                {Array.from({ length: 18 }).map((_, i) => (
                  <th
                    key={i + 1}
                    className="border-b border-gray-200 px-2 py-2 text-center text-[11px] font-semibold text-gray-700"
                  >
                    {i + 1}
                  </th>
                ))}

                <th className="border-b border-gray-200 px-3 py-2 text-center text-xs font-semibold text-gray-700">
                  Total
                </th>

                <th className="border-b border-gray-200 px-3 py-2 text-center text-xs font-semibold text-gray-700">
                  Contribution
                </th>
              </tr>
            </thead>

            <tbody>
              {players.map((p) => {
                const contribution = playerContributionByBoxes.get(p.id) ?? 0;
                const roundTotal = playerRoundStablefordTotals.get(p.id) ?? 0;

                return (
                  <tr key={p.id} className="border-b last:border-b-0">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap">
                      {p.name}
                    </td>

                    {Array.from({ length: 18 }).map((_, idx) => {
                      const hole = idx + 1;
                      const pts = ptsByPlayerHole.get(`${p.id}|${hole}`);
                      const val = pts === undefined ? null : pts;

                      const boxedBlue = computed.boxedBlueByHole.get(hole)?.has(p.id) ?? false;
                      const boxedZero = computed.zeroByHole.get(hole)?.has(p.id) ?? false;
                      const boxedQualifies = qualifiesByHole.get(hole)?.has(p.id) ?? false;

                      return (
                        <td key={hole} className="px-2 py-2 text-center text-sm text-gray-900">
                          <Cell pts={val} boxedBlue={boxedBlue} boxedZero={boxedZero} boxedQualifies={boxedQualifies} />
                        </td>
                      );
                    })}

                    <td className="px-3 py-2 text-center text-sm font-semibold text-gray-900">
                      <span className="inline-flex min-w-[36px] justify-center rounded-md bg-gray-100 px-2 py-1">
                        {roundTotal}
                      </span>
                    </td>

                    <td className="px-3 py-2 text-center text-sm font-extrabold text-gray-900">
                      <span className="inline-flex min-w-[36px] justify-center rounded-md bg-yellow-100 px-2 py-1">
                        {contribution}
                      </span>
                    </td>
                  </tr>
                );
              })}

              <tr className="bg-gray-50">
                <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">Team</td>

                {Array.from({ length: 18 }).map((_, idx) => {
                  const hole = idx + 1;
                  const v = computed.teamHoleTotals[hole] ?? 0;
                  return (
                    <td key={hole} className="px-2 py-2 text-center text-sm font-semibold text-gray-900">
                      {v}
                    </td>
                  );
                })}

                <td className="px-3 py-2 text-center text-sm font-semibold text-gray-600">—</td>

                <td className="px-3 py-2 text-center text-sm font-extrabold text-gray-900">
                  <span className="inline-flex min-w-[36px] justify-center rounded-md bg-yellow-100 px-2 py-1">
                    {computed.teamTotal}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-gray-600">
          Rule: only the top {N} positive scores are counted (ties are resolved by table order). Blue boxes show exactly{" "}
          {N} counted positives (or fewer if fewer positives exist). Light-blue boxes show players who qualify for top {N}{" "}
          scores by tying the cutoff value. Zeros are always boxed red and count as −0.5. Contribution is the sum of all
          boxed blue + boxed light-blue scores minus 0.5 per red zero.
        </div>
      </div>
    </div>
  );
}

provide git instruction block to deploy in main

git checkout main; git pull origin main; git add 'app/m/tours/[id]/leaderboards/page.tsx' 'app/m/tours/[id]/leaderboards/teams/[roundId]/[teamId]/page.tsx'; git commit -m "Change team zero deduction from 1 to 0.5"; git push origin main


Pasted code(77).ts
TypeScript
for the tour landing page for the swing in spring tour, every button needs to have an access code of 0612 entered so that the click funcition works, otherwise it should say access denied. here is the file . Please summarise what is required and provide full repplacement code  

I’ll make this tour-specific: only the Swing in Spring landing page will require code 0612; other tours will behave normally. I’ll keep existing “results hidden” and matchplay inactive behaviour intact.

Thought for 50s
Required change:

Only Swing in Spring Tour requires access code 0612.

Add an access-code input on the landing page.

Every landing-page tile button checks the code before running its click action.

If the code is wrong or missing, the tile shows access denied.

Other tours are unchanged.

Full replacement file:

Download replacement page.tsx


provide git instruction block to deplouy in main

git checkout main; git pull origin main; git add 'app/m/tours/[id]/page.tsx'; git commit -m "Add access code protection to Swing in Spring landing page"; git push origin main
DEVELOPER MODE

1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
31
32
33
34
35
36
"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type TourRow = {
  id: string;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  image_url?: string | null;

  matchplay_active?: boolean | null;
  hide_results?: boolean | null;
};

type RoundRow = {
  id: string;
  tour_id: string;
  played_on: string | null;
};

type TourDocRow = {
  id: string;
  tour_id: string;
  title: string;
  storage_bucket: string;
  storage_path: string;
  sort_order: number;
};

const DEFAULT_HERO = "/tours/tour-landing-hero-cartoon.webp";

const SPACE_TOUR_ID = "1786d88f-0f50-460a-ad0c-ed0173b7aa1c";
const SPACE_TOUR_HERO = "/tours/golf_space_scene.webp";

typescript

Close
