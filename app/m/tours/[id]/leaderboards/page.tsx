// app/m/tours/[id]/leaderboards/page.tsx
"use client";

// PROD MARKER: mobile leaderboards updated


import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import MobileNav from "../_components/MobileNav";
import { supabase } from "@/lib/supabaseClient";

// -----------------------------
// Types
// -----------------------------
type Tee = "M" | "F";
type LeaderboardKind = "individual" | "pairs" | "teams";

type Tour = { id: string; name: string };

type RoundRow = {
  id: string;
  tour_id: string;
  name: string | null;
  round_no: number | null;
  created_at: string | null;
  course_id: string | null;
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

type IndividualRule =
  | { mode: "ALL" }
  | { mode: "BEST_N"; n: number; finalRequired: boolean };

type PairRule =
  | { mode: "ALL" }
  | { mode: "BEST_Q"; q: number; finalRequired: boolean };

type TeamRule = { bestY: number };

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

function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
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
  if (!raw) return 0; // blank -> 0 for totals
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

// -----------------------------
// Page
// -----------------------------
export default function MobileLeaderboardsPage() {
  const params = useParams<{ id?: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);

  // UI selection
  const [kind, setKind] = useState<LeaderboardKind>("individual");

  // Rules (mobile read-only). Keep them as state so TS preserves union branches.
  const [individualRule] = useState<IndividualRule>({ mode: "ALL" });
  const [pairRule] = useState<PairRule>({ mode: "ALL" });
  const [teamRule] = useState<TeamRule>({ bestY: 2 });

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
        const { data: tData, error: tErr } = await supabase
          .from("tours")
          .select("id,name")
          .eq("id", tourId)
          .single();
        if (tErr) throw tErr;
        if (!alive) return;
        setTour(tData as Tour);

        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,tour_id,name,round_no,created_at,course_id")
          .eq("tour_id", tourId)
          .order("round_no", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true });

        if (rErr) throw rErr;

        const rr = (rData ?? []) as RoundRow[];
        if (!alive) return;
        setRounds(rr);

        // players in tour via tour_players join
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

        // round_players (playing handicap per round)
        if (roundIds.length > 0 && playerIds.length > 0) {
          const { data: rpData, error: rpErr } = await supabase
            .from("round_players")
            .select("round_id,player_id,playing,playing_handicap")
            .in("round_id", roundIds)
            .in("player_id", playerIds);

          if (rpErr) throw rpErr;

          const rpRows: RoundPlayerRow[] = (rpData ?? []).map((x: any) => ({
            round_id: String(x.round_id),
            player_id: String(x.player_id),
            playing: x.playing === true,
            playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
          }));

          if (!alive) return;
          setRoundPlayers(rpRows);
        } else {
          setRoundPlayers([]);
        }

        // scores
        if (roundIds.length > 0 && playerIds.length > 0) {
          const { data: sData, error: sErr } = await supabase
            .from("scores")
            .select("round_id,player_id,hole_number,strokes,pickup")
            .in("round_id", roundIds)
            .in("player_id", playerIds);

          if (sErr) throw sErr;
          if (!alive) return;
          setScores((sData ?? []) as ScoreRow[]);
        } else {
          setScores([]);
        }

        // pars for all courses in rounds (both tees)
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
  const rpByRoundPlayer = useMemo(() => {
    const m = new Map<string, RoundPlayerRow>();
    for (const rp of roundPlayers) m.set(`${rp.round_id}|${rp.player_id}`, rp);
    return m;
  }, [roundPlayers]);

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

  // -----------------------------
  // Rounds order + final round = highest round_no (fallback created_at)
  // -----------------------------
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
      return r.finalRequired
        ? `Pairs Better Ball · Best ${r.q} rounds (Final required)`
        : `Pairs Better Ball · Best ${r.q} rounds`;
    }

    return `Teams · Best ${teamRule.bestY} scores per hole, minus 1 for each zero · All rounds`;
  }, [kind, individualRule, pairRule, teamRule.bestY]);

  // -----------------------------
  // Which rounds count (highlighting)
  // (Real “best N” selection should be computed from player totals; for now we keep the same placeholder logic.)
  // -----------------------------
  const countedRoundIds = useMemo(() => {
    if (kind !== "individual") return new Set<string>();
    if (individualRule.mode !== "BEST_N") return new Set<string>();

    const n = Math.max(1, Math.floor(individualRule.n));
    const mustIncludeFinal = !!individualRule.finalRequired && !!finalRoundId;

    const ids = sortedRounds.map((r) => r.id);
    const chosen = new Set<string>();

    if (mustIncludeFinal) chosen.add(finalRoundId);

    for (let i = ids.length - 1; i >= 0; i--) {
      if (chosen.size >= n) break;
      chosen.add(ids[i]);
    }

    return chosen;
  }, [kind, individualRule, finalRoundId, sortedRounds]);

  // -----------------------------
  // Compute Individual totals by round + tour total
  // -----------------------------
  const individualRows = useMemo(() => {
    const rows: Array<{
      playerId: string;
      name: string;
      tourTotal: number;
      perRound: Record<string, number>;
    }> = [];

    for (const p of players) {
      const perRound: Record<string, number> = {};
      let grand = 0;

      for (const r of sortedRounds) {
        const courseId = r.course_id;
        if (!courseId) {
          perRound[r.id] = 0;
          continue;
        }

        const tee: Tee = normalizeTee(p.gender);
        const parsMap = parsByCourseTeeHole.get(courseId)?.get(tee);
        if (!parsMap) {
          perRound[r.id] = 0;
          continue;
        }

        const rp = rpByRoundPlayer.get(`${r.id}|${p.id}`);
        const hcp = Number.isFinite(Number(rp?.playing_handicap)) ? Number(rp?.playing_handicap) : 0;

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
        grand += sum;
      }

      rows.push({ playerId: p.id, name: p.name, tourTotal: grand, perRound });
    }

    rows.sort((a, b) => b.tourTotal - a.tourTotal || a.name.localeCompare(b.name));
    return rows;
  }, [players, sortedRounds, parsByCourseTeeHole, rpByRoundPlayer, scoreByRoundPlayerHole]);

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

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-semibold text-gray-900">Boards</div>
              <div className="truncate text-sm text-gray-500">{tour?.name ?? ""}</div>
            </div>

            <Link
              href={`/m/tours/${tourId}`}
              className="rounded-xl border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 active:bg-gray-100"
            >
              Overview
            </Link>
          </div>

          {/* Segment control */}
          <div className="mt-3 grid grid-cols-3 gap-2">
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
            {/* TABLE */}
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
                  {kind === "individual" ? (
                    individualRows.map((row) => (
                      <tr key={row.playerId} className="border-b last:border-b-0">
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap">
                          {row.name}
                        </td>

                        <td className="px-3 py-2 text-right text-sm font-extrabold text-gray-900">
                          <span className="inline-flex min-w-[44px] justify-end rounded-md bg-yellow-100 px-2 py-1">
                            {row.tourTotal}
                          </span>
                        </td>

                        {sortedRounds.map((r) => {
                          const val = row.perRound[r.id] ?? 0;
                          const counted = countedRoundIds.has(r.id);
                          return (
                            <td key={r.id} className="px-3 py-2 text-right text-sm text-gray-900">
                              <span
                                className={
                                  counted
                                    ? "inline-flex min-w-[44px] justify-end rounded-md border-2 border-blue-500 px-2 py-1"
                                    : "inline-flex min-w-[44px] justify-end rounded-md px-2 py-1"
                                }
                              >
                                {val}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2 + sortedRounds.length} className="px-4 py-6 text-sm text-gray-700">
                        {kind === "pairs" ? (
                          <div className="space-y-2">
                            <div className="font-semibold">Pairs leaderboard</div>
                            <div className="opacity-80">
                              Next step: implement Better Ball Stableford using your saved tour pairs / round groups.
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="font-semibold">Teams leaderboard</div>
                            <div className="opacity-80">
                              Next step: implement team scoring (best {teamRule.bestY} per hole, -1 per zero) across all
                              rounds.
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {kind === "individual" && individualRule.mode === "BEST_N" ? (
              <div className="mt-3 text-xs text-gray-600">
                Rounds outlined in <span className="font-semibold">blue</span> indicate which rounds count toward the
                Tour total.
              </div>
            ) : null}

            {/* Round meta */}
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm">
              <div className="font-semibold text-gray-900">Rounds</div>
              <div className="mt-1 text-gray-600">
                {sortedRounds.map((r, idx) => {
                  const isFinal = r.id === finalRoundId;
                  const lab = roundLabel(r, idx, isFinal);
                  const dt = formatDate(r.created_at);
                  return (
                    <div key={r.id} className="flex items-center justify-between gap-3 py-1">
                      <div className="min-w-0">
                        <span className="font-semibold">{lab}</span>{" "}
                        <span className="text-gray-700">{r.name ? `· ${r.name}` : ""}</span>
                      </div>
                      <div className="text-xs text-gray-500 whitespace-nowrap">{dt || ""}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
