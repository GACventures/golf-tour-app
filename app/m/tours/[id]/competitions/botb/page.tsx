"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import MobileNav from "../../_components/MobileNav";

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

type BotBSettingsRow = {
  tour_id: string;
  enabled: boolean;
  round_nos: number[];
};

type RoundRow = {
  id: string;
  tour_id: string;
  name: string | null;
  round_no: number | null;
  created_at: string | null;
  course_id: string | null;
};

type CourseRow = { id: string; name: string | null };

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

function asInt(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function rankWithTies(entries: Array<{ id: string; value: number }>) {
  const sorted = [...entries].sort((a, b) => {
    const av = Number.isFinite(a.value) ? a.value : 0;
    const bv = Number.isFinite(b.value) ? b.value : 0;
    if (av === bv) return a.id.localeCompare(b.id);
    return bv - av; // higher is better
  });

  const rankById = new Map<string, number>();
  let currentRank = 0;
  let lastValue: number | null = null;
  let seen = 0;

  for (const e of sorted) {
    seen += 1;
    const v = Number.isFinite(e.value) ? e.value : 0;
    if (lastValue === null || v !== lastValue) {
      currentRank = seen;
      lastValue = v;
    }
    rankById.set(e.id, currentRank);
  }
  return rankById;
}

export default function MobileBotBPage() {
  const params = useParams<{ id?: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [botb, setBotb] = useState<BotBSettingsRow | null>(null);

  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [coursesById, setCoursesById] = useState<Record<string, string>>({});

  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);

  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    let alive = true;

    async function loadAll() {
      setLoading(true);
      setErrorMsg("");

      try {
        // Tour
        const { data: tData, error: tErr } = await supabase.from("tours").select("id,name").eq("id", tourId).single();
        if (tErr) throw tErr;
        if (!alive) return;
        setTour(tData as Tour);

        // BotB settings
        const { data: bData, error: bErr } = await supabase
          .from("tour_botb_settings")
          .select("tour_id,enabled,round_nos")
          .eq("tour_id", tourId)
          .maybeSingle();
        if (bErr) throw bErr;

        if (!alive) return;

        if (!bData) {
          setBotb(null);
          setRounds([]);
          setPlayers([]);
          setRoundPlayers([]);
          setScores([]);
          setPars([]);
          setCoursesById({});
          return;
        }

        const bn = Array.isArray((bData as any).round_nos)
          ? (bData as any).round_nos.map((x: any) => asInt(x, 0)).filter((n: number) => n > 0)
          : [];

        bn.sort((a: number, b: number) => a - b);

        const botbRow: BotBSettingsRow = {
          tour_id: String((bData as any).tour_id),
          enabled: (bData as any).enabled === true,
          round_nos: Array.from(new Set(bn)),
        };

        setBotb(botbRow);

        if (!botbRow.enabled || botbRow.round_nos.length === 0) {
          setRounds([]);
          setPlayers([]);
          setRoundPlayers([]);
          setScores([]);
          setPars([]);
          setCoursesById({});
          return;
        }

        // Rounds ONLY for selected round_nos
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,tour_id,name,round_no,created_at,course_id")
          .eq("tour_id", tourId)
          .in("round_no", botbRow.round_nos)
          .order("round_no", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true });
        if (rErr) throw rErr;

        const rr = (rData ?? []) as RoundRow[];
        if (!alive) return;
        setRounds(rr);

        const courseIds = Array.from(new Set(rr.map((r) => r.course_id).filter(Boolean))) as string[];

        // Courses for labels
        if (courseIds.length) {
          const { data: cData, error: cErr } = await supabase.from("courses").select("id,name").in("id", courseIds);
          if (cErr) throw cErr;
          if (!alive) return;
          const map: Record<string, string> = {};
          for (const c of (cData ?? []) as CourseRow[]) map[String(c.id)] = safeName(c.name, "(course)");
          setCoursesById(map);
        } else {
          setCoursesById({});
        }

        // Players
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

        // Round players
        if (roundIds.length && playerIds.length) {
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

        // Scores: IMPORTANT — pull scores ROUND-BY-ROUND for only BotB rounds (avoids Supabase 1000 row cap)
        if (roundIds.length && playerIds.length) {
          const allScores: ScoreRow[] = [];
          for (const r of rr) {
            const { data: sData, error: sErr } = await supabase
              .from("scores")
              .select("round_id,player_id,hole_number,strokes,pickup")
              .eq("round_id", r.id)
              .in("player_id", playerIds)
              .order("player_id", { ascending: true })
              .order("hole_number", { ascending: true });
            if (sErr) throw sErr;
            allScores.push(...((sData ?? []) as ScoreRow[]));
          }
          if (!alive) return;
          setScores(allScores);
        } else {
          setScores([]);
        }

        // Pars
        if (courseIds.length) {
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
        setErrorMsg(e?.message ?? "Failed to load BotB.");
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

  const playingSet = useMemo(() => {
    const s = new Set<string>();
    for (const rp of roundPlayers) if (rp.playing === true) s.add(`${rp.round_id}|${rp.player_id}`);
    return s;
  }, [roundPlayers]);

  const perPlayerPerRound = useMemo(() => {
    const out: Record<string, Record<string, number | null>> = {};
    for (const p of players) out[p.id] = {};

    const roundsCtx = (ctx as any)?.rounds;
    const getRoundCtx = (roundId: string) => {
      if (!Array.isArray(roundsCtx)) return null;
      return roundsCtx.find((x: any) => String(x?.roundId) === String(roundId)) ?? null;
    };

    for (const p of players) {
      for (const r of sortedRounds) {
        const key = r.id;

        if (!playingSet.has(`${r.id}|${p.id}`)) {
          out[p.id][key] = null;
          continue;
        }

        const rc = getRoundCtx(r.id);
        if (!rc || typeof rc.netPointsForHole !== "function") {
          out[p.id][key] = null;
          continue;
        }

        let total = 0;
        for (let i = 0; i < 18; i++) {
          const pts = Number(rc.netPointsForHole(p.id, i));
          if (Number.isFinite(pts)) total += pts;
        }
        out[p.id][key] = total;
      }
    }

    return out;
  }, [ctx, players, sortedRounds, playingSet]);

  const totals = useMemo(() => {
    const totalByPlayer: Record<string, number | null> = {};
    const entries: Array<{ id: string; value: number }> = [];

    for (const p of players) {
      let sum = 0;
      let any = false;

      for (const r of sortedRounds) {
        const v = perPlayerPerRound[p.id]?.[r.id];
        if (typeof v === "number") {
          sum += v;
          any = true;
        }
      }

      totalByPlayer[p.id] = any ? sum : null;
      if (any) entries.push({ id: p.id, value: sum });
    }

    const rankById = rankWithTies(entries);

    return { totalByPlayer, rankById };
  }, [players, sortedRounds, perPlayerPerRound]);

  const headerLabel = useMemo(() => {
    if (!botb?.enabled) return "BotB (disabled)";
    if (!botb.round_nos?.length) return "BotB (no rounds selected)";
    return `BotB (R${botb.round_nos.join(", R")})`;
  }, [botb]);

  const roundsLabel = useMemo(() => {
    if (!sortedRounds.length) return "";
    const parts = sortedRounds.map((r) => {
      const rn = r.round_no ?? "?";
      const rname = safeName(r.name, `Round ${rn}`);
      const cname = r.course_id ? (coursesById[r.course_id] ?? "(course)") : "(course)";
      return `R${rn} ${rname} — ${cname}`;
    });
    return parts.join(" · ");
  }, [sortedRounds, coursesById]);

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

  const thBase = "border-b border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700";
  const tdBase = "px-3 py-2 text-right text-sm text-gray-900 align-top";

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      <div className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-900">{headerLabel}</div>
              {tour?.name ? <div className="text-xs text-gray-600">{tour.name}</div> : null}
            </div>
            <Link className="text-xs underline text-gray-700 mt-1" href={`/m/tours/${tourId}/competitions`}>
              Back
            </Link>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-5 w-56 rounded bg-gray-100" />
            <div className="h-64 rounded-2xl border bg-white" />
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorMsg}</div>
        ) : !botb?.enabled ? (
          <div className="rounded-2xl border p-4 text-sm text-gray-700">
            BotB is disabled for this tour.
          </div>
        ) : sortedRounds.length === 0 ? (
          <div className="rounded-2xl border p-4 text-sm text-gray-700">
            BotB has no valid rounds selected (or selected round_nos don’t exist on rounds).
          </div>
        ) : players.length === 0 ? (
          <div className="rounded-2xl border p-4 text-sm text-gray-700">
            No players found for this tour.
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm max-h-[70vh] overflow-auto">
              <table className="min-w-full border-collapse table-fixed">
                <thead>
                  <tr className="bg-gray-50">
                    <th
                      className={`sticky left-0 top-0 z-50 bg-gray-50 border-r border-gray-200 ${thBase} text-left`}
                      style={{ width: 140, minWidth: 140 }}
                    >
                      Player
                    </th>

                    {sortedRounds.map((r) => (
                      <th key={r.id} className={`sticky top-0 z-40 bg-gray-50 ${thBase} text-right`}>
                        R{r.round_no ?? "?"}
                      </th>
                    ))}

                    <th className={`sticky top-0 z-40 bg-gray-50 ${thBase} text-right`}>Total</th>
                  </tr>
                </thead>

                <tbody>
                  {players.map((p) => {
                    const total = totals.totalByPlayer[p.id];
                    const rank = total == null ? null : totals.rankById.get(p.id) ?? null;

                    return (
                      <tr key={p.id} className="border-b last:border-b-0">
                        <td
                          className="sticky left-0 z-30 bg-white border-r border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap"
                          style={{ width: 140, minWidth: 140 }}
                        >
                          {p.name}
                        </td>

                        {sortedRounds.map((r) => {
                          const v = perPlayerPerRound[p.id]?.[r.id];
                          return (
                            <td key={`${p.id}-${r.id}`} className={tdBase}>
                              {typeof v === "number" ? v : <span className="text-gray-400">—</span>}
                            </td>
                          );
                        })}

                        <td className={tdBase}>
                          {total == null ? (
                            <span className="text-gray-400">—</span>
                          ) : (
                            <>
                              {total} <span className="text-gray-500">&nbsp;({rank ?? 0})</span>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="border-t bg-gray-50 px-3 py-2 text-xs text-gray-600">
                BotB = aggregate Stableford on {roundsLabel || "(selected rounds)"}.
              </div>
            </div>
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
