// app/m/tours/[id]/competitions/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import MobileNav from "../_components/MobileNav";

import { competitionCatalog } from "@/lib/competitions/catalog";
import { runCompetition } from "@/lib/competitions/engine";
import type { CompetitionDefinition, CompetitionContext } from "@/lib/competitions/types";

import {
  buildTourCompetitionContext,
  type Tee,
  type TourRoundLite,
  type PlayerLiteForTour,
  type RoundPlayerLiteForTour,
  type ScoreLiteForTour,
  type ParLiteForTour,
} from "@/lib/competitions/buildTourCompetitionContext";

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
  id: string;
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

function fmt2(x: number) {
  if (!Number.isFinite(x)) return "0.00";
  return x.toFixed(2);
}

function fmtPct0(x: number) {
  if (!Number.isFinite(x)) return "0%";
  return `${x.toFixed(0)}%`;
}

function rankWithTies(entries: Array<{ id: string; value: number }>, lowerIsBetter: boolean) {
  const sorted = [...entries].sort((a, b) => {
    const av = Number.isFinite(a.value) ? a.value : 0;
    const bv = Number.isFinite(b.value) ? b.value : 0;
    if (av === bv) return a.id.localeCompare(b.id);
    return lowerIsBetter ? av - bv : bv - av;
  });

  const rankById = new Map<string, number>();
  let currentRank = 0;
  let lastValue: number | null = null;
  let seen = 0;

  for (const e of sorted) {
    seen += 1;
    const v = Number.isFinite(e.value) ? e.value : 0;

    if (lastValue === null || v !== lastValue) {
      currentRank = seen; // 1,1,3 style
      lastValue = v;
    }
    rankById.set(e.id, currentRank);
  }

  return rankById;
}

type FixedCompKey =
  | "napoleon"
  | "bigGeorge"
  | "grandCanyon"
  | "wizard"
  | "bagelMan"
  | "eclectic"
  | "schumacher"
  | "closer"
  | "hotStreak"
  | "coldStreak";

type FixedCompMeta = {
  key: FixedCompKey;
  label: string;
  competitionId: string; // matches catalog id
  lowerIsBetter?: boolean;
  format: (v: number) => string;

  // optional: the stats key we want for tap detail
  detailFromStatsKey?: string; // e.g. "streak_where"
  tappable?: boolean;
};

type MatrixCell = {
  value: number | null;
  rank: number | null;
  detail?: string | null; // e.g. "R1: H4–H8"
};

/**
 * Fetch ALL scores (avoid PostgREST 1000-row cap) using stable paging.
 * Sort order (confirmed): round_id ASC, player_id ASC, hole_number ASC, id ASC
 */
async function fetchAllScores(roundIds: string[], playerIds: string[]): Promise<ScoreRow[]> {
  if (roundIds.length === 0 || playerIds.length === 0) return [];

  const pageSize = 1000;
  let from = 0;
  const out: ScoreRow[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("scores")
      .select("id,round_id,player_id,hole_number,strokes,pickup")
      .in("round_id", roundIds)
      .in("player_id", playerIds)
      .order("round_id", { ascending: true })
      .order("player_id", { ascending: true })
      .order("hole_number", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);

    if (error) throw error;

    const rows = (data ?? []) as any[];

    out.push(
      ...rows.map((x) => ({
        id: String(x.id),
        round_id: String(x.round_id),
        player_id: String(x.player_id),
        hole_number: Number(x.hole_number),
        strokes: x.strokes === null || x.strokes === undefined ? null : Number(x.strokes),
        pickup: x.pickup === true ? true : x.pickup === false ? false : (x.pickup ?? null),
      }))
    );

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

export default function MobileCompetitionsPage() {
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

  // Toggle state for inline detail popup (Hot/Cold only)
  const [openDetail, setOpenDetail] = useState<{ playerId: string; key: FixedCompKey } | null>(null);

  const fixedComps: FixedCompMeta[] = useMemo(
    () => [
      { key: "napoleon", label: "Napoleon", competitionId: "tour_napoleon_par3_avg", format: (v) => fmt2(v) },
      { key: "bigGeorge", label: "Big George", competitionId: "tour_big_george_par4_avg", format: (v) => fmt2(v) },
      {
        key: "grandCanyon",
        label: "Grand Canyon",
        competitionId: "tour_grand_canyon_par5_avg",
        format: (v) => fmt2(v),
      },
      { key: "wizard", label: "Wizard", competitionId: "tour_wizard_four_plus_pct", format: (v) => fmtPct0(v) },
      {
        key: "bagelMan",
        label: "Bagel Man",
        competitionId: "tour_bagel_man_zero_pct",
        lowerIsBetter: true,
        format: (v) => fmtPct0(v),
      },
      {
        key: "eclectic",
        label: "Eclectic",
        competitionId: "tour_eclectic_total",
        format: (v) => String(Math.round(Number.isFinite(v) ? v : 0)),
      },
      { key: "schumacher", label: "Schumacher", competitionId: "tour_schumacher_first3_avg", format: (v) => fmt2(v) },
      { key: "closer", label: "Closer", competitionId: "tour_closer_last3_avg", format: (v) => fmt2(v) },
      {
        key: "hotStreak",
        label: "Hot Streak",
        competitionId: "tour_hot_streak_best_run",
        format: (v) => String(Math.round(Number.isFinite(v) ? v : 0)),
        tappable: true,
        detailFromStatsKey: "streak_where",
      },
      {
        key: "coldStreak",
        label: "Cold Streak",
        competitionId: "tour_cold_streak_best_run",
        lowerIsBetter: true,
        format: (v) => String(Math.round(Number.isFinite(v) ? v : 0)),
        tappable: true,
        detailFromStatsKey: "streak_where",
      },
    ],
    []
  );

  const definitions = useMemo(
    () => [
      { label: "Napoleon", text: "Average Stableford points on Par 3 holes" },
      { label: "Big George", text: "Average Stableford points on Par 4 holes" },
      { label: "Grand Canyon", text: "Average Stableford points on Par 5 holes" },
      { label: "Wizard", text: "Percentage of holes where Stableford points are 4+" },
      { label: "Bagel Man", text: "Percentage of holes where Stableford points are 0" },
      { label: "Eclectic", text: "Total of each player’s best Stableford points per hole" },
      { label: "Schumacher", text: "Average Stableford points on holes 1–3" },
      { label: "Closer", text: "Average Stableford points on holes 16–18" },
      { label: "Hot Streak", text: "Longest run in any round of consecutive holes where gross strokes is par or better" },
      { label: "Cold Streak", text: "Longest run in any round of consecutive holes where gross strokes is bogey or worse" },
    ],
    []
  );

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

        // ✅ scores (paginated; avoids 1000-row cap)
        if (roundIds.length > 0 && playerIds.length > 0) {
          const allScores = await fetchAllScores(roundIds, playerIds);
          if (!alive) return;
          setScores(allScores);
        } else {
          setScores([]);
        }

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
        setErrorMsg(e?.message ?? "Failed to load competitions.");
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

  const ctx = useMemo(() => {
    const roundsLite: TourRoundLite[] = sortedRounds.map((r) => ({
      id: r.id,
      name: r.name,
      course_id: r.course_id,
    }));

    const playersLite: PlayerLiteForTour[] = players.map((p) => ({
      id: p.id,
      name: p.name,
      gender: p.gender ? normalizeTee(p.gender) : null,
    }));

    const rpLite: RoundPlayerLiteForTour[] = roundPlayers.map((rp) => ({
      round_id: rp.round_id,
      player_id: rp.player_id,
      playing: rp.playing === true,
      playing_handicap: Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : null,
    }));

    const scoresLite: ScoreLiteForTour[] = scores.map((s) => ({
      round_id: s.round_id,
      player_id: s.player_id,
      hole_number: Number(s.hole_number),
      strokes: s.strokes === null || s.strokes === undefined ? null : Number(s.strokes),
      pickup: s.pickup === true,
    }));

    const parsLite: ParLiteForTour[] = pars.map((p) => ({
      course_id: p.course_id,
      hole_number: Number(p.hole_number),
      tee: normalizeTee(p.tee),
      par: Number(p.par),
      stroke_index: Number(p.stroke_index),
    }));

    return buildTourCompetitionContext({
      rounds: roundsLite,
      players: playersLite,
      roundPlayers: rpLite,
      scores: scoresLite,
      pars: parsLite,
    });
  }, [sortedRounds, players, roundPlayers, scores, pars]);

  const compMatrix = useMemo(() => {
    const out: Record<string, Record<FixedCompKey, MatrixCell>> = {};
    for (const p of players) {
      out[p.id] = {
        napoleon: { value: null, rank: null },
        bigGeorge: { value: null, rank: null },
        grandCanyon: { value: null, rank: null },
        wizard: { value: null, rank: null },
        bagelMan: { value: null, rank: null },
        eclectic: { value: null, rank: null },
        schumacher: { value: null, rank: null },
        closer: { value: null, rank: null },
        hotStreak: { value: null, rank: null, detail: null },
        coldStreak: { value: null, rank: null, detail: null },
      };
    }

    for (const meta of fixedComps) {
      const def = (competitionCatalog as CompetitionDefinition[]).find((c) => c.id === meta.competitionId);
      if (!def) continue;

      const result = runCompetition(def, ctx as unknown as CompetitionContext);
      const rows = (result?.rows ?? []).filter((r: any) => !!r?.entryId);

      const entries: Array<{ id: string; value: number }> = [];

      for (const r of rows as any[]) {
        const pid = String(r.entryId);
        const v = Number(r.total);
        if (!Number.isFinite(v)) continue;

        entries.push({ id: pid, value: v });

        if (out[pid]) {
          out[pid][meta.key].value = v;

          if (meta.detailFromStatsKey) {
            const detail = String((r as any)?.stats?.[meta.detailFromStatsKey] ?? "").trim();
            out[pid][meta.key].detail = detail || null;
          }
        }
      }

      const rankById = rankWithTies(entries, !!meta.lowerIsBetter);
      for (const pid of Object.keys(out)) {
        const rk = rankById.get(pid);
        out[pid][meta.key].rank = typeof rk === "number" ? rk : null;
      }
    }

    return out;
  }, [players, fixedComps, ctx]);

  function toggleDetail(playerId: string, key: FixedCompKey) {
    setOpenDetail((prev) => {
      if (prev && prev.playerId === playerId && prev.key === key) return null;
      return { playerId, key };
    });
  }

  if (!tourId || !isLikelyUuid(tourId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900 pb-24">
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
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">
            Competitions{tour?.name ? <span className="text-gray-500 font-normal"> · {tour.name}</span> : null}
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-5 w-40 rounded bg-gray-100" />
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
                      Player
                    </th>
                    {fixedComps.map((c) => (
                      <th
                        key={c.key}
                        className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700"
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {players.map((p) => {
                    const row = compMatrix[p.id] ?? ({} as any);

                    return (
                      <tr key={p.id} className="border-b last:border-b-0">
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap">
                          {p.name}
                        </td>

                        {fixedComps.map((c) => {
                          const cell = row?.[c.key] as MatrixCell | undefined;
                          const value = cell?.value ?? null;
                          const rank = cell?.rank ?? null;

                          const tappable = c.tappable === true;
                          const isOpen = openDetail?.playerId === p.id && openDetail?.key === c.key;
                          const detail = (cell?.detail ?? "").trim();

                          return (
                            <td key={c.key} className="px-3 py-2 text-right text-sm text-gray-900 align-top">
                              <div className="inline-flex flex-col items-end gap-1">
                                {value === null ? (
                                  <span className="text-gray-400">—</span>
                                ) : tappable ? (
                                  <button
                                    type="button"
                                    className="inline-flex min-w-[92px] justify-end rounded-md px-2 py-1 hover:bg-gray-50 active:bg-gray-100"
                                    onClick={() => toggleDetail(p.id, c.key)}
                                    aria-label={`${c.label} detail`}
                                  >
                                    {c.format(value)} <span className="text-gray-500">&nbsp;({rank ?? 0})</span>
                                  </button>
                                ) : (
                                  <span className="inline-flex min-w-[92px] justify-end rounded-md px-2 py-1">
                                    {c.format(value)} <span className="text-gray-500">&nbsp;({rank ?? 0})</span>
                                  </span>
                                )}

                                {tappable && isOpen ? (
                                  <div className="max-w-[140px] rounded-lg border bg-gray-50 px-2 py-1 text-[11px] text-gray-700 shadow-sm">
                                    {detail ? detail : <span className="text-gray-400">No streak found</span>}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="border-t bg-gray-50 px-3 py-2 text-xs text-gray-600">
                Ranks use “equal ranks” for ties (1, 1, 3). Bagel Man ranks lower % as better. Cold Streak ranks lower as
                better. Tap Hot/Cold cells for the round+hole range.
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-700">Definitions</div>
              <div className="px-4 py-3">
                <ul className="space-y-2 text-sm text-gray-800">
                  {definitions.map((d) => (
                    <li key={d.label} className="leading-snug">
                      <span className="font-semibold text-gray-900">{d.label}</span>{" "}
                      <span className="text-gray-600">—</span> <span className="text-gray-800">{d.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
