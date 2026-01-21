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

type ParRow = {
  hole_number: number;
  par: number;
  stroke_index: number;
  tee: Tee;
};

type TeamRule = {
  bestY: number;
};

/* ---------------- Helpers ---------------- */

function normalizeTee(v: any): Tee {
  return String(v ?? "").trim().toUpperCase() === "F" ? "F" : "M";
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

// Stableford (net) per hole (same rules as mobile leaderboards page)
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
        // 1) Team meta (name)
        const { data: teamRow, error: teamErr } = await supabase
          .from("tour_groups")
          .select("id,name")
          .eq("id", teamId)
          .maybeSingle();

        if (teamErr) throw teamErr;

        // 2) Team members (+ player details)
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

        // 3) Round -> ONLY fetch course_id (avoid non-existent columns like round_date)
        const { data: rRow, error: rErr } = await supabase
          .from("rounds")
          .select("id,course_id")
          .eq("id", roundId)
          .single();

        if (rErr) throw rErr;

        const rr = rRow as RoundRow;

        // 4) Round players (playing + handicap) for the team members
        const playerIds = ps.map((p) => p.id);

        let rpMap = new Map<string, RoundPlayer>();
        if (playerIds.length > 0) {
          const { data: rpRows, error: rpErr } = await supabase
            .from("round_players")
            .select("player_id,playing,playing_handicap")
            .eq("round_id", roundId)
            .in("player_id", playerIds);

          if (rpErr) throw rpErr;

          rpMap = new Map<string, RoundPlayer>();
          (rpRows ?? []).forEach((x: any) => {
            rpMap.set(String(x.player_id), {
              player_id: String(x.player_id),
              playing: x.playing === true,
              playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
            });
          });
        }

        // 5) Scores for the round + team members
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

        // 6) Pars for the course (both tees)
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

        // 7) Team scoring rule Y from settings (fallback to 1)
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
        setTeamRule({ bestY: Math.max(1, Math.floor(y)) });
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

  // Compute per-player per-hole stableford (net)
  const ptsByPlayerHole = useMemo(() => {
    const m = new Map<string, number>(); // key: player|hole -> pts
    if (!round?.course_id) return m;

    for (const p of players) {
      const tee: Tee = p.gender ? normalizeTee(p.gender) : "M";
      const pars = parsByTeeHole.get(tee);
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

  // Compute team totals per hole using rule: bestY positive scores minus 1 for each zero
  const computed = useMemo(() => {
    const Y = Math.max(1, Math.floor(teamRule.bestY || 1));

    const teamHoleTotals: number[] = Array.from({ length: 19 }).map(() => 0); // index 1..18
    const playerContributionTotals = new Map<string, number>();
    for (const p of players) playerContributionTotals.set(p.id, 0);

    for (let h = 1; h <= 18; h++) {
      const entries: { playerId: string; pts: number }[] = [];
      let zeroCount = 0;

      for (const p of players) {
        const rp = roundPlayers.get(p.id);
        if (!rp?.playing) continue;

        const pts = ptsByPlayerHole.get(`${p.id}|${h}`);
        if (pts === undefined) continue;

        entries.push({ playerId: p.id, pts });

        if (pts === 0) {
          zeroCount += 1;
          playerContributionTotals.set(p.id, (playerContributionTotals.get(p.id) || 0) - 1);
        }
      }

      const positives = entries.filter((e) => e.pts > 0).sort((a, b) => b.pts - a.pts);
      const chosen = positives.slice(0, Math.min(Y, positives.length));

      const holePosSum = chosen.reduce((acc, x) => acc + x.pts, 0);
      const holeTotal = holePosSum - zeroCount;

      teamHoleTotals[h] = holeTotal;

      // Add the chosen positive points to each contributing player
      for (const c of chosen) {
        playerContributionTotals.set(c.playerId, (playerContributionTotals.get(c.playerId) || 0) + c.pts);
      }
    }

    const teamTotal = teamHoleTotals.slice(1, 19).reduce((a, b) => a + b, 0);

    return { teamHoleTotals, playerContributionTotals, teamTotal };
  }, [players, roundPlayers, ptsByPlayerHole, teamRule.bestY]);

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

  // NOTE: This page is step-1 for Step 3: it renders the grid + team totals.
  // Coloured boxes (counted vs zero) will be the next confirmed step.

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-10">
      <div className="mx-auto w-full max-w-md px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-lg font-extrabold leading-tight">{teamName}</div>
            <div className="mt-1 text-xs text-gray-600">
              Round detail · Team total: <span className="font-semibold">{computed.teamTotal}</span>
            </div>
          </div>

          <Link className="shrink-0 rounded-xl border px-3 py-2 text-sm font-semibold hover:bg-gray-50" href={`/m/tours/${tourId}/leaderboards`}>
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
              </tr>
            </thead>

            <tbody>
              {players.map((p) => {
                const total = computed.playerContributionTotals.get(p.id) ?? 0;

                return (
                  <tr key={p.id} className="border-b last:border-b-0">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap">
                      {p.name}
                    </td>

                    {Array.from({ length: 18 }).map((_, idx) => {
                      const hole = idx + 1;
                      const pts = ptsByPlayerHole.get(`${p.id}|${hole}`);
                      const show = pts === undefined ? "" : String(pts);

                      return (
                        <td key={hole} className="px-2 py-2 text-center text-sm text-gray-900">
                          <span className="inline-flex min-w-[22px] justify-center">{show}</span>
                        </td>
                      );
                    })}

                    <td className="px-3 py-2 text-center text-sm font-extrabold text-gray-900">
                      <span className="inline-flex min-w-[36px] justify-center rounded-md bg-yellow-100 px-2 py-1">
                        {total}
                      </span>
                    </td>
                  </tr>
                );
              })}

              {/* Team totals row */}
              <tr className="bg-gray-50">
                <td className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700">
                  Team
                </td>

                {Array.from({ length: 18 }).map((_, idx) => {
                  const hole = idx + 1;
                  const v = computed.teamHoleTotals[hole] ?? 0;
                  return (
                    <td key={hole} className="px-2 py-2 text-center text-sm font-semibold text-gray-900">
                      {v}
                    </td>
                  );
                })}

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
          Next step (once confirmed): add coloured squares around the counted top-N positive scores and around zeros, following your rules.
        </div>
      </div>
    </div>
  );
}
