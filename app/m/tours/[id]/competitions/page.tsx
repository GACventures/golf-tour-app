// app/m/tours/[id]/competitions/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import MobileNav from "../_components/MobileNav";

type Tee = "M" | "F";

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

type CompKey = "napoleon" | "bigGeorge" | "grandCanyon" | "wizard" | "bagelMan" | "eclectic";

type CompMeta = {
  key: CompKey;
  label: string;
  lowerIsBetter?: boolean;
  format: (v: number) => string;
  description: string;
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

function fmt2(x: number) {
  if (!Number.isFinite(x)) return "0.00";
  return x.toFixed(2);
}

function fmtPct(x: number) {
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

  const comps: CompMeta[] = useMemo(
    () => [
      { key: "napoleon", label: "Napoleon", format: (v) => fmt2(v), description: "Average Stableford points on Par 3 holes." },
      { key: "bigGeorge", label: "Big George", format: (v) => fmt2(v), description: "Average Stableford points on Par 4 holes." },
      { key: "grandCanyon", label: "Grand Canyon", format: (v) => fmt2(v), description: "Average Stableford points on Par 5 holes." },
      { key: "wizard", label: "Wizard", format: (v) => fmtPct(v), description: "% of holes with 4+ Stableford points." },
      {
        key: "bagelMan",
        label: "Bagel Man",
        lowerIsBetter: true,
        format: (v) => fmtPct(v),
        description: "% of holes with 0 Stableford points (lower is better).",
      },
      {
        key: "eclectic",
        label: "Eclectic",
        format: (v) => String(Math.round(v)),
        description:
          "Best Stableford score on each hole across the tour, summed. To see hole-by-hole Eclectic, tap the score in the Eclectic column.",
      },
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

  const compValuesByPlayer = useMemo(() => {
    const out: Record<string, Record<CompKey, number>> = {};

    for (const p of players) {
      out[p.id] = { napoleon: 0, bigGeorge: 0, grandCanyon: 0, wizard: 0, bagelMan: 0, eclectic: 0 };

      let par3Sum = 0,
        par3Count = 0;
      let par4Sum = 0,
        par4Count = 0;
      let par5Sum = 0,
        par5Count = 0;

      let holesWithScore = 0;
      let holesWith4plus = 0;
      let holesWith0 = 0;

      const bestByHole = new Map<number, number>();
      for (let h = 1; h <= 18; h++) bestByHole.set(h, 0);

      for (const r of sortedRounds) {
        const courseId = r.course_id;
        if (!courseId) continue;

        const rp = rpByRoundPlayer.get(`${r.id}|${p.id}`);
        if (!rp?.playing) continue;

        const tee: Tee = normalizeTee(p.gender);
        const parsMap = parsByCourseTeeHole.get(courseId)?.get(tee);
        if (!parsMap) continue;

        const hcp = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0;

        for (let h = 1; h <= 18; h++) {
          const pr = parsMap.get(h);
          if (!pr) continue;

          const sc = scoreByRoundPlayerHole.get(`${r.id}|${p.id}|${h}`);
          if (!sc) continue;

          const raw = normalizeRawScore(sc.strokes, sc.pickup);
          const pts = netStablefordPointsForHole({ rawScore: raw, par: pr.par, strokeIndex: pr.si, playingHandicap: hcp });

          holesWithScore += 1;
          if (pts >= 4) holesWith4plus += 1;
          if (pts === 0) holesWith0 += 1;

          if (pr.par === 3) {
            par3Sum += pts;
            par3Count += 1;
          } else if (pr.par === 4) {
            par4Sum += pts;
            par4Count += 1;
          } else if (pr.par === 5) {
            par5Sum += pts;
            par5Count += 1;
          }

          const prev = bestByHole.get(h) ?? 0;
          if (pts > prev) bestByHole.set(h, pts);
        }
      }

      out[p.id].napoleon = par3Count > 0 ? par3Sum / par3Count : 0;
      out[p.id].bigGeorge = par4Count > 0 ? par4Sum / par4Count : 0;
      out[p.id].grandCanyon = par5Count > 0 ? par5Sum / par5Count : 0;

      out[p.id].wizard = holesWithScore > 0 ? (holesWith4plus / holesWithScore) * 100 : 0;
      out[p.id].bagelMan = holesWithScore > 0 ? (holesWith0 / holesWithScore) * 100 : 0;

      let ecoTotal = 0;
      for (let h = 1; h <= 18; h++) ecoTotal += bestByHole.get(h) ?? 0;
      out[p.id].eclectic = ecoTotal;
    }

    return out;
  }, [players, sortedRounds, rpByRoundPlayer, parsByCourseTeeHole, scoreByRoundPlayerHole]);

  const ranksByComp = useMemo(() => {
    const byComp: Record<CompKey, Map<string, number>> = {
      napoleon: new Map(),
      bigGeorge: new Map(),
      grandCanyon: new Map(),
      wizard: new Map(),
      bagelMan: new Map(),
      eclectic: new Map(),
    };

    for (const meta of comps) {
      const entries = players.map((p) => ({ id: p.id, value: compValuesByPlayer[p.id]?.[meta.key] ?? 0 }));
      byComp[meta.key] = rankWithTies(entries, !!meta.lowerIsBetter);
    }

    return byComp;
  }, [players, comps, compValuesByPlayer]);

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
          <div className="text-sm font-semibold text-gray-900">Competitions</div>
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
                    {comps.map((c) => (
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
                    const vals = compValuesByPlayer[p.id] ?? ({} as Record<CompKey, number>);
                    return (
                      <tr key={p.id} className="border-b last:border-b-0">
                        <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap">
                          {p.name}
                        </td>

                        {comps.map((c) => {
                          const v = Number.isFinite(Number(vals[c.key])) ? Number(vals[c.key]) : 0;
                          const rk = ranksByComp[c.key].get(p.id) ?? 0;

                          const cellInner =
                            c.key === "eclectic" ? (
                              <Link
                                className="underline decoration-gray-300 underline-offset-2"
                                href={`/m/tours/${tourId}/competitions/eclectic/${p.id}`}
                                title="Tap to see hole-by-hole Eclectic"
                              >
                                {c.format(v)} <span className="text-gray-500">&nbsp;({rk})</span>
                              </Link>
                            ) : (
                              <>
                                {c.format(v)} <span className="text-gray-500">&nbsp;({rk})</span>
                              </>
                            );

                          return (
                            <td key={c.key} className="px-3 py-2 text-right text-sm text-gray-900">
                              <span className="inline-flex min-w-[76px] justify-end rounded-md px-2 py-1">
                                {cellInner}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm">
              <div className="font-semibold text-gray-900">Competition descriptions</div>
              <div className="mt-2 space-y-2 text-gray-700">
                {comps.map((c) => (
                  <div key={c.key}>
                    <span className="font-semibold">{c.label}:</span> {c.description}
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-gray-500">
                Note: ranks use “equal ranks” for ties (1, 1, 3). Bagel Man ranks lower % as better.
              </div>
            </div>
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
