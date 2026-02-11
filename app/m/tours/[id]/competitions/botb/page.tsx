// app/m/tours/[id]/competitions/botb/page.tsx
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

type BotBSettingsRow = {
  tour_id: string;
  enabled: boolean;
  round_nos: number[];
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

function n(x: any, fallback = 0): number {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
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
      currentRank = seen; // 1,1,3 ties style
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
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);
  const [botb, setBotb] = useState<BotBSettingsRow | null>(null);

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

        // rounds
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

        // players (via tour_players join)
        const { data: tpData, error: tpErr } = await supabase
          .from("tour_players")
          .select("tour_id,player_id,players(id,name,gender)")
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

        // BotB settings
        const { data: bData, error: bErr } = await supabase
          .from("tour_botb_settings")
          .select("tour_id,enabled,round_nos")
          .eq("tour_id", tourId)
          .maybeSingle();

        if (bErr) throw bErr;
        if (!alive) return;

        const bRow = (bData ?? null) as BotBSettingsRow | null;
        setBotb(
          bRow
            ? {
                tour_id: String(bRow.tour_id),
                enabled: bRow.enabled === true,
                round_nos: Array.isArray((bRow as any).round_nos) ? (bRow as any).round_nos.map((x: any) => Number(x)) : [],
              }
            : null
        );

        const roundIds = rr.map((r) => r.id);
        const playerIds = ps.map((p) => p.id);

        // round_players
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

        // scores — one round at a time (avoids Supabase 1000-row issues)
        if (roundIds.length > 0 && playerIds.length > 0) {
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

        // pars for relevant courses
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
        setErrorMsg(e?.message ?? "Failed to load BotB leaderboard.");
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

  const selectedRoundNos = useMemo(() => {
    const raw = botb?.enabled ? botb?.round_nos ?? [] : [];
    const cleaned = raw.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x >= 1);
    cleaned.sort((a, b) => a - b);
    return Array.from(new Set(cleaned));
  }, [botb]);

  const selectedRounds = useMemo(() => {
    if (selectedRoundNos.length === 0) return [];
    const byNo = new Map<number, RoundRow>();
    for (const r of sortedRounds) {
      const rn = r.round_no;
      if (Number.isFinite(Number(rn))) byNo.set(Number(rn), r);
    }
    return selectedRoundNos.map((rn) => byNo.get(rn)).filter(Boolean) as RoundRow[];
  }, [selectedRoundNos, sortedRounds]);

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
    for (const rp of roundPlayers) {
      if (rp.playing === true) s.add(`${rp.round_id}|${rp.player_id}`);
    }
    return s;
  }, [roundPlayers]);

  const botbPerPlayer = useMemo(() => {
    // per player: per selected round total stableford + overall sum
    const per: Record<string, { byRoundId: Record<string, number>; total: number }> = {};
    for (const p of players) per[p.id] = { byRoundId: {}, total: 0 };

    // ctx.rounds is what H2Z uses; it exposes netPointsForHole + scores arrays
    const ctxRounds = (ctx as any)?.rounds;
    if (!Array.isArray(ctxRounds)) return per;

    const selectedRoundIdSet = new Set(selectedRounds.map((r) => String(r.id)));

    for (const r of selectedRounds) {
      const roundId = String(r.id);
      if (!selectedRoundIdSet.has(roundId)) continue;

      const roundCtx = ctxRounds.find((x: any) => String(x?.roundId) === roundId || String(x?.id) === roundId);
      // buildTourCompetitionContext’s internal shape (as used by h2z.ts) expects roundCtx.roundId
      const effectiveRoundCtx =
        roundCtx && typeof roundCtx === "object"
          ? roundCtx
          : (ctxRounds.find((x: any) => String(x?.roundId) === roundId) ?? null);

      if (!effectiveRoundCtx) continue;

      for (const p of players) {
        const key = `${roundId}|${p.id}`;
        if (!playingSet.has(key)) continue;

        // roundCtx.scores[playerId] => array of 18 raw score cells, but we can rely on netPointsForHole
        // We compute points only for entered holes (blank ignored), pickup is already handled upstream.
        const scoreArr = effectiveRoundCtx?.scores?.[String(p.id)];
        if (!Array.isArray(scoreArr) || scoreArr.length < 18) continue;

        let sum = 0;
        for (let holeIndex = 0; holeIndex < 18; holeIndex++) {
          const raw = String(scoreArr[holeIndex] ?? "").trim().toUpperCase();
          if (!raw) continue; // blank not entered
          const pts = n(effectiveRoundCtx.netPointsForHole?.(p.id, holeIndex), 0);
          sum += pts;
        }

        per[p.id].byRoundId[roundId] = sum;
        per[p.id].total += sum;
      }
    }

    return per;
  }, [ctx, players, selectedRounds, playingSet]);

  const rankByPlayerId = useMemo(() => {
    const entries = players.map((p) => ({
      id: p.id,
      value: n(botbPerPlayer[p.id]?.total, 0),
    }));
    // higher is better
    return rankWithTies(entries, false);
  }, [players, botbPerPlayer]);

  const botbDescription = useMemo(() => {
    if (!botb?.enabled) return "BotB is disabled for this tour.";
    if (selectedRounds.length === 0) return "BotB is enabled, but no rounds are selected.";

    const parts = selectedRounds.map((r) => {
      const rn = Number.isFinite(Number(r.round_no)) ? `R${Number(r.round_no)}` : "R?";
      const nm = safeName(r.name, rn);
      return `${rn}: ${nm}`;
    });

    return `BotB = aggregate Stableford score on ${parts.join(" · ")}`;
  }, [botb, selectedRounds]);

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
  const medalClass = (rank: number | null) =>
    rank === 1
      ? "border border-yellow-500 bg-yellow-300 text-gray-900"
      : rank === 2
      ? "border border-gray-400 bg-gray-200 text-gray-900"
      : rank === 3
      ? "border border-amber-700 bg-amber-400 text-gray-900"
      : "bg-transparent";

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      <div className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">BotB leaderboard</div>
          {tour?.name ? <div className="text-xs text-gray-600">{tour.name}</div> : null}
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-5 w-44 rounded bg-gray-100" />
            <div className="h-64 rounded-2xl border bg-white" />
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorMsg}</div>
        ) : players.length === 0 ? (
          <div className="rounded-2xl border p-4 text-sm text-gray-700">No players found for this tour.</div>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <Link
                href={`/m/tours/${tourId}/competitions`}
                className="text-sm underline text-gray-800"
              >
                ← Back to competitions
              </Link>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm max-h-[70vh] overflow-auto">
              <table className="min-w-full border-collapse table-fixed">
                <thead>
                  <tr className="bg-gray-50">
                    {/* Player (sticky left) */}
                    <th
                      className={`sticky left-0 top-0 z-50 bg-gray-50 border-r border-gray-200 ${thBase} text-left whitespace-nowrap`}
                      style={{ width: 140, minWidth: 140 }}
                    >
                      Player
                    </th>

                    {/* BotB Total (SECOND COLUMN) — bold, wide, no-wrap */}
                    <th
                      className={`sticky top-0 z-40 bg-gray-50 ${thBase} text-right whitespace-nowrap`}
                      style={{ width: 120, minWidth: 120 }}
                    >
                      BotB total
                    </th>

                    {/* Selected BotB rounds */}
                    {selectedRounds.map((r) => {
                      const rn = Number.isFinite(Number(r.round_no)) ? `R${Number(r.round_no)}` : "R?";
                      return (
                        <th key={r.id} className={`sticky top-0 z-40 bg-gray-50 ${thBase} text-right whitespace-nowrap`}>
                          {rn}
                        </th>
                      );
                    })}
                  </tr>
                </thead>

                <tbody>
                  {players.map((p) => {
                    const total = n(botbPerPlayer[p.id]?.total, 0);
                    const rank = rankByPlayerId.get(p.id) ?? null;

                    return (
                      <tr key={p.id} className="border-b last:border-b-0">
                        {/* Player */}
                        <td
                          className="sticky left-0 z-30 bg-white border-r border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap"
                          style={{ width: 140, minWidth: 140 }}
                        >
                          {p.name}
                        </td>

                        {/* BotB Total SECOND — bold, no-wrap, wide enough */}
                        <td
                          className={`${tdBase} whitespace-nowrap`}
                          style={{ width: 120, minWidth: 120 }}
                        >
                          <span className={`inline-flex justify-end rounded-md px-2 py-1 font-bold ${medalClass(rank)}`}>
                            {total} <span className="text-gray-700">&nbsp;({rank ?? 0})</span>
                          </span>
                        </td>

                        {/* Round columns */}
                        {selectedRounds.map((r) => {
                          const v = botbPerPlayer[p.id]?.byRoundId?.[String(r.id)];
                          return (
                            <td key={`${p.id}-${r.id}`} className={tdBase}>
                              {typeof v === "number" ? v : <span className="text-gray-400">—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="border-t bg-gray-50 px-3 py-2 text-xs text-gray-600">
                {botbDescription}
              </div>
            </div>
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
