// app/m/tours/[id]/more/rehandicapping/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import MobileNav from "../../_components/MobileNav";

type Tour = {
  id: string;
  name: string;
  rehandicapping_enabled: boolean | null;
  rehandicapping_rules_summary: string | null;
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

function fmtDateShort(value: string | null) {
  if (!value) return "TBC";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export default function MobileTourRehandicappingPage() {
  const params = useParams<{ id?: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [tourPlayers, setTourPlayers] = useState<TourPlayerJoinRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);

  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    let alive = true;

    async function loadAll() {
      setLoading(true);
      setErrorMsg("");

      try {
        // Tour (rule summary lives here)
        const { data: tData, error: tErr } = await supabase
          .from("tours")
          .select("id,name,rehandicapping_enabled,rehandicapping_rules_summary,rehandicapping_rule_key")
          .eq("id", tourId)
          .single();

        if (tErr) throw tErr;
        if (!alive) return;
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
        if (!alive) return;
        setRounds(rr);

        // Players in this tour (tour_players join players)
        const { data: tpData, error: tpErr } = await supabase
          .from("tour_players")
          .select("tour_id,player_id,starting_handicap, players(id,name,start_handicap)")
          .eq("tour_id", tourId)
          .order("name", { ascending: true, foreignTable: "players" });

        if (tpErr) throw tpErr;
        const tps = (tpData ?? []) as any[];
        if (!alive) return;
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

          if (!alive) return;
          setRoundPlayers(rps);
        } else {
          setRoundPlayers([]);
        }
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load rehandicapping.");
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

  const { players, roundsSorted, hcpByRoundPlayer, fallbackStartByPlayerId } = useMemo(() => {
    const roundsSorted = [...rounds].sort((a, b) => {
      const an = a.round_no ?? 999999;
      const bn = b.round_no ?? 999999;
      if (an !== bn) return an - bn;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });

    // Player list
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

    // Fallback: prefer tour start, else global start, else null
    const fallbackStartByPlayerId: Record<string, number | null> = {};
    for (const p of players) {
      fallbackStartByPlayerId[p.id] = p.tourStart ?? p.globalStart ?? null;
    }

    // round_players map: roundId -> playerId -> playing_handicap
    const hcpByRoundPlayer: Record<string, Record<string, number | null>> = {};
    for (const rp of roundPlayers) {
      const rid = String(rp.round_id);
      const pid = String(rp.player_id);
      if (!hcpByRoundPlayer[rid]) hcpByRoundPlayer[rid] = {};
      hcpByRoundPlayer[rid][pid] = rp.playing_handicap ?? null;
    }

    return { players, roundsSorted, hcpByRoundPlayer, fallbackStartByPlayerId };
  }, [tourPlayers, rounds, roundPlayers]);

  const ruleText = useMemo(() => {
    if (!tour) return "";
    const enabled = tour.rehandicapping_enabled === true;
    if (!enabled) return "No rehandicapping.";
    const s = String(tour.rehandicapping_rules_summary ?? "").trim();
    if (s) return s;
    return "Rehandicapping is enabled (no summary provided).";
  }, [tour]);

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
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-base font-semibold text-gray-900">Rehandicapping</div>
          <div className="truncate text-sm text-gray-500">{tour?.name ?? ""}</div>
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
              <div className="text-sm font-semibold text-gray-900">Rule</div>
              <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{ruleText}</div>
              {tour?.rehandicapping_enabled ? (
                <div className="mt-2 text-[11px] text-gray-500">
                  Key: <span className="font-medium">{tour.rehandicapping_rule_key ?? "—"}</span>
                </div>
              ) : null}
            </section>

            {/* Handicap table */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Playing handicap by round</div>
                <div className="mt-1 text-xs text-gray-600">
                  Values come from <span className="font-medium">round_players.playing_handicap</span>. If missing, we show your tour/global starting handicap as a fallback.
                </div>
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
                            {fmtRoundLabel(r, idx)}{" "}
                            <span className="text-[11px] font-medium text-gray-500">({fmtDateShort(r.played_on)})</span>
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
                              const display = Number.isFinite(Number(v)) ? String(v) : startFallback == null ? "—" : `${startFallback}*`;
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
