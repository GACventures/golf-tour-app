// app/m/tours/[id]/rehandicapping/page.tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import MobileNav from "../../_components/MobileNav";

type Tour = {
  id: string;
  name: string;
  rehandicapping_enabled: boolean | null;
  rehandicapping_rules_summary: string | null; // kept in type (DB), but intentionally NOT used for display
  rehandicapping_rule_key: string | null;
};

type RoundRow = {
  id: string;
  tour_id: string;
  name: string | null;
  round_no: number | null;
  created_at: string | null;
  played_on: string | null;
};

type PlayerRow = {
  id: string;
  name: string;
  start_handicap: number | null;
};

type TourPlayerJoinRow = {
  tour_id: string;
  player_id: string;
  starting_handicap: number | null;
  players: PlayerRow | PlayerRow[] | null;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing_handicap: number | null;
};

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function safeName(v: any, fallback: string) {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function normalizePlayerJoin(val: any): PlayerRow | null {
  if (!val) return null;
  const p = Array.isArray(val) ? val[0] : val;
  if (!p) return null;

  const id = p.id != null ? String(p.id) : "";
  if (!id) return null;

  return {
    id,
    name: safeName(p.name, "(unnamed)"),
    start_handicap: Number.isFinite(Number(p.start_handicap)) ? Number(p.start_handicap) : null,
  };
}

function fmtRoundLabel(r: RoundRow, idx: number) {
  if (Number.isFinite(Number(r.round_no)) && Number(r.round_no) > 0) return `R${Number(r.round_no)}`;
  return `R${idx + 1}`;
}

const PLAIN_ENGLISH_RULE_V1 =
  "After each completed round, the Playing Handicap (PH) for the next round is recalculated using Stableford results.\n\n" +
  "The rounded average Stableford score for the round is calculated across all players who completed the round. Each player’s Stableford score is compared to this average, and the difference is multiplied by one-third. The result is rounded to the nearest whole number, with .5 rounding up, and applied as an adjustment to the player’s PH.\n\n" +
  "The resulting Playing Handicap cannot exceed Starting Handicap + 3, and cannot be lower than half the Starting Handicap, rounded up if the Starting Handicap is odd.\n\n" +
  "If a player does not play a round, their Playing Handicap carries forward unchanged to the next round.";

export default function MobileTourRehandicappingPage() {
  const params = useParams<{ id?: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [tourPlayers, setTourPlayers] = useState<TourPlayerJoinRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);

  // Prevent bursts of duplicate refetches (focus/visibility can fire in quick succession)
  const inFlightRef = useRef(false);
  const lastRunMsRef = useRef(0);

  const loadAll = useCallback(async () => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    const now = Date.now();
    if (now - lastRunMsRef.current < 250) return;
    lastRunMsRef.current = now;

    if (inFlightRef.current) return;
    inFlightRef.current = true;

    setLoading(true);
    setErrorMsg("");

    try {
      // Tour
      const { data: tData, error: tErr } = await supabase
        .from("tours")
        .select("id,name,rehandicapping_enabled,rehandicapping_rules_summary,rehandicapping_rule_key")
        .eq("id", tourId)
        .single();

      if (tErr) throw tErr;
      setTour(tData as Tour);

      // Rounds
      const { data: rData, error: rErr } = await supabase
        .from("rounds")
        .select("id,tour_id,name,round_no,created_at,played_on")
        .eq("tour_id", tourId)
        .order("round_no", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });

      if (rErr) throw rErr;
      const rr = (rData ?? []) as RoundRow[];
      setRounds(rr);

      // Players in this tour
      const { data: tpData, error: tpErr } = await supabase
        .from("tour_players")
        .select("tour_id,player_id,starting_handicap, players(id,name,start_handicap)")
        .eq("tour_id", tourId)
        .order("name", { ascending: true, foreignTable: "players" });

      if (tpErr) throw tpErr;
      const tps = (tpData ?? []) as any[];
      setTourPlayers(tps as TourPlayerJoinRow[]);

      const roundIds = rr.map((r) => r.id);
      const playerIds = tps.map((x) => String(x.player_id)).filter(Boolean);

      // round_players: the per-round handicap we want to display
      if (roundIds.length > 0 && playerIds.length > 0) {
        const { data: rpData, error: rpErr } = await supabase
          .from("round_players")
          .select("round_id,player_id,playing_handicap")
          .in("round_id", roundIds)
          .in("player_id", playerIds);

        if (rpErr) throw rpErr;

        const rps: RoundPlayerRow[] = (rpData ?? []).map((x: any) => ({
          round_id: String(x.round_id),
          player_id: String(x.player_id),
          playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
        }));

        setRoundPlayers(rps);
      } else {
        setRoundPlayers([]);
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to load rehandicapping.");
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  }, [tourId]);

  // Initial load
  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Auto-refresh when returning to this page (no button)
  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    const onFocus = () => void loadAll();
    const onVis = () => {
      if (document.visibilityState === "visible") void loadAll();
    };
    const onPageShow = () => void loadAll();

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [tourId, loadAll]);

  const { players, roundsSorted, hcpByRoundPlayer, fallbackStartByPlayerId } = useMemo(() => {
    const roundsSorted = [...rounds].sort((a, b) => {
      const an = a.round_no ?? 999999;
      const bn = b.round_no ?? 999999;
      if (an !== bn) return an - bn;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });

    const players = (tourPlayers ?? [])
      .map((row: any) => {
        const p = normalizePlayerJoin(row.players);
        if (!p) return null;

        const tourStart = Number.isFinite(Number(row.starting_handicap)) ? Number(row.starting_handicap) : null;
        const globalStart = Number.isFinite(Number(p.start_handicap)) ? Number(p.start_handicap) : null;

        return {
          id: p.id,
          name: p.name,
          tourStart,
          globalStart,
        };
      })
      .filter(Boolean) as Array<{ id: string; name: string; tourStart: number | null; globalStart: number | null }>;

    const fallbackStartByPlayerId: Record<string, number | null> = {};
    for (const p of players) {
      fallbackStartByPlayerId[p.id] = p.tourStart ?? p.globalStart ?? null;
    }

    const hcpByRoundPlayer: Record<string, Record<string, number | null>> = {};
    for (const rp of roundPlayers) {
      const rid = String(rp.round_id);
      const pid = String(rp.player_id);
      if (!hcpByRoundPlayer[rid]) hcpByRoundPlayer[rid] = {};
      hcpByRoundPlayer[rid][pid] = rp.playing_handicap ?? null;
    }

    return { players, roundsSorted, hcpByRoundPlayer, fallbackStartByPlayerId };
  }, [tourPlayers, rounds, roundPlayers]);

  const enabledFlag = tour?.rehandicapping_enabled;
  const enabled = enabledFlag === true;

  // IMPORTANT: always show plain-English rule when enabled; never use DB summary text for display.
  const ruleHeaderSuffix = enabled ? " (plain-english-v1)" : "";
  const ruleText = enabled ? PLAIN_ENGLISH_RULE_V1 : "No rehandicapping.";

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
      {/* Header (ONLY title; no tour name line) */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-base font-semibold text-gray-900">Rehandicapping</div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4 space-y-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-5 w-48 rounded bg-gray-100" />
            <div className="h-24 rounded-2xl border bg-white" />
            <div className="h-64 rounded-2xl border bg-white" />
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorMsg}</div>
        ) : (
          <>
            {/* Rule summary */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
              <div className="text-sm font-semibold text-gray-900">Rule{ruleHeaderSuffix}</div>
              <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{ruleText}</div>

              {enabled ? (
                <div className="mt-2 text-[11px] text-gray-500">
                  Key: <span className="font-medium">{tour?.rehandicapping_rule_key ?? "—"}</span>
                </div>
              ) : null}
            </section>

            {/* Handicap table */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Playing handicap by round</div>
              </div>

              {players.length === 0 ? (
                <div className="p-4 text-sm text-gray-700">No players found for this tour.</div>
              ) : roundsSorted.length === 0 ? (
                <div className="p-4 text-sm text-gray-700">No rounds found for this tour.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[720px] w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="sticky left-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700">
                          Player
                        </th>

                        {roundsSorted.map((r, idx) => (
                          <th
                            key={r.id}
                            className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700 whitespace-nowrap"
                            title={r.name ?? ""}
                          >
                            {fmtRoundLabel(r, idx)}
                          </th>
                        ))}

                        <th className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700 whitespace-nowrap">
                          Start (fallback)
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {players.map((p) => {
                        const startFallback = fallbackStartByPlayerId[p.id];
                        return (
                          <tr key={p.id} className="border-b last:border-b-0">
                            <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap">
                              {p.name}
                            </td>

                            {roundsSorted.map((r) => {
                              const v = hcpByRoundPlayer[r.id]?.[p.id];
                              const display = Number.isFinite(Number(v))
                                ? String(v)
                                : startFallback == null
                                ? "—"
                                : `${startFallback}*`;

                              return (
                                <td key={r.id} className="px-3 py-2 text-right text-sm tabular-nums text-gray-900">
                                  {display}
                                </td>
                              );
                            })}

                            <td className="px-3 py-2 text-right text-sm tabular-nums text-gray-700">
                              {startFallback == null ? "—" : startFallback}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div className="px-4 py-3 text-[11px] text-gray-600">
                    <span className="font-semibold">*</span> fallback value (no round-specific handicap found).
                  </div>
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
