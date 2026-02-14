"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { recalcAndSaveTourHandicaps } from "@/lib/handicaps/recalcAndSaveTourHandicaps";
import MobileNav from "../../_components/MobileNav";

type Tee = "M" | "F";

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
  gender?: Tee | null;
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
  playing: boolean;
  playing_handicap: number | null;
  tee: Tee | string | null;
  base_playing_handicap?: number | null;
};

type RoundOption = {
  id: string;
  round_no: number;
  played_on: string | null;
  name: string | null;
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
    gender: p.gender == null ? null : normalizeTee(p.gender),
  };
}

function fmtRoundLabel(r: RoundRow, idx: number) {
  if (Number.isFinite(Number(r.round_no)) && Number(r.round_no) > 0) return `R${Number(r.round_no)}`;
  return `R${idx + 1}`;
}

function roundLabel(r: RoundOption) {
  const rn = Number.isFinite(Number(r.round_no)) ? Number(r.round_no) : 0;
  const date = r.played_on ? String(r.played_on) : "";
  const nm = (r.name ?? "").trim();
  return `R${rn}${nm ? ` • ${nm}` : ""}${date ? ` • ${date}` : ""}`;
}

const PLAIN_ENGLISH_RULE_V1 =
  "After each completed round, the Playing Handicap (PH) for the next round is recalculated using Stableford results.\n\n" +
  "The rounded average Stableford score for the round is calculated across all players who completed the round. Each player’s Stableford score is compared to this average, and the difference is multiplied by one-third. The result is rounded to the nearest whole number, with .5 rounding up, and applied as an adjustment to the player’s PH.\n\n" +
  "The resulting Playing Handicap cannot exceed Starting Handicap + 3, and cannot be lower than half the Starting Handicap, rounded up if the Starting Handicap is odd.\n\n" +
  "If a player does not play a round, their Playing Handicap carries forward unchanged to the next round.";

export default function MobileTourMoreRehandicappingPage() {
  const params = useParams<{ id?: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [tourPlayers, setTourPlayers] = useState<TourPlayerJoinRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);

  // Automatic toggle UI state
  const [autoSaving, setAutoSaving] = useState(false);
  const [autoError, setAutoError] = useState("");
  const [autoMsg, setAutoMsg] = useState("");
  const [autoEnabledInput, setAutoEnabledInput] = useState<boolean | null>(null);

  // Manual toggle (only when automatic = OFF)
  const [manualEnabled, setManualEnabled] = useState(false);

  // Manual editor state
  const [manSelectedRoundId, setManSelectedRoundId] = useState<string>("");
  const [manInputs, setManInputs] = useState<Record<string, string>>({});
  const [manSaving, setManSaving] = useState(false);
  const [manError, setManError] = useState("");
  const [manMsg, setManMsg] = useState("");

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

      const t = tData as Tour;
      setTour(t);
      setAutoEnabledInput(t.rehandicapping_enabled === true);

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
        .select("tour_id,player_id,starting_handicap, players(id,name,start_handicap,gender)")
        .eq("tour_id", tourId)
        .order("name", { ascending: true, foreignTable: "players" });
      if (tpErr) throw tpErr;

      const tps = (tpData ?? []) as any[];
      setTourPlayers(tps as TourPlayerJoinRow[]);

      const roundIds = rr.map((r) => r.id);
      const playerIds = tps.map((x) => String(x.player_id)).filter(Boolean);

      // round_players: per-round handicap display + needed fields for manual apply
      if (roundIds.length > 0 && playerIds.length > 0) {
        const { data: rpData, error: rpErr } = await supabase
          .from("round_players")
          .select("round_id,player_id,playing,playing_handicap,tee,base_playing_handicap")
          .in("round_id", roundIds)
          .in("player_id", playerIds);

        if (rpErr) throw rpErr;

        const rps: RoundPlayerRow[] = (rpData ?? []).map((x: any) => ({
          round_id: String(x.round_id),
          player_id: String(x.player_id),
          playing: x.playing === true,
          playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
          tee: x.tee == null ? null : String(x.tee),
          base_playing_handicap: x.base_playing_handicap == null ? null : Number(x.base_playing_handicap),
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

  const { players, roundsSorted, hcpByRoundPlayer, rpByRoundPlayer, fallbackStartByPlayerId, roundsForSelect } = useMemo(() => {
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
          gender: p.gender ?? null,
          tourStart,
          globalStart,
        };
      })
      .filter(Boolean) as Array<{ id: string; name: string; gender: Tee | null; tourStart: number | null; globalStart: number | null }>;

    const fallbackStartByPlayerId: Record<string, number | null> = {};
    for (const p of players) fallbackStartByPlayerId[p.id] = p.tourStart ?? p.globalStart ?? null;

    const hcpByRoundPlayer: Record<string, Record<string, number | null>> = {};
    const rpByRoundPlayer: Record<string, Record<string, RoundPlayerRow>> = {};
    for (const rp of roundPlayers) {
      const rid = String(rp.round_id);
      const pid = String(rp.player_id);
      if (!hcpByRoundPlayer[rid]) hcpByRoundPlayer[rid] = {};
      if (!rpByRoundPlayer[rid]) rpByRoundPlayer[rid] = {};
      hcpByRoundPlayer[rid][pid] = rp.playing_handicap ?? null;
      rpByRoundPlayer[rid][pid] = rp;
    }

    const roundsForSelect: RoundOption[] = roundsSorted.map((r) => ({
      id: r.id,
      round_no: Number.isFinite(Number(r.round_no)) ? Number(r.round_no) : 0,
      played_on: r.played_on ?? null,
      name: r.name ?? null,
    }));

    return { players, roundsSorted, hcpByRoundPlayer, rpByRoundPlayer, fallbackStartByPlayerId, roundsForSelect };
  }, [tourPlayers, rounds, roundPlayers]);

  const autoEnabled = tour?.rehandicapping_enabled === true;

  const autoDirty = useMemo(() => {
    if (!tour) return false;
    return (tour.rehandicapping_enabled === true) !== (autoEnabledInput === true);
  }, [tour, autoEnabledInput]);

  const ruleText = autoEnabled ? PLAIN_ENGLISH_RULE_V1 : "No automatic rehandicapping.";

  async function saveAutomaticToggle() {
    if (!tour) return;

    setAutoSaving(true);
    setAutoError("");
    setAutoMsg("");
    setManError("");
    setManMsg("");

    try {
      const nextEnabled = autoEnabledInput === true;

      const { error } = await supabase.from("tours").update({ rehandicapping_enabled: nextEnabled }).eq("id", tour.id);
      if (error) throw error;

      // Keep automatic logic unchanged; run it so the table reflects the new mode.
      const recalcRes = await recalcAndSaveTourHandicaps({ supabase, tourId: tour.id });
      if (!recalcRes.ok) throw new Error(recalcRes.error);

      setTour((prev) => (prev ? { ...prev, rehandicapping_enabled: nextEnabled } : prev));
      setAutoMsg(`Saved. Automatic rehandicapping is now ${nextEnabled ? "enabled" : "disabled"}.`);

      // When turning automatic ON, manual UI becomes irrelevant.
      if (nextEnabled) {
        setManualEnabled(false);
        setManSelectedRoundId("");
        setManInputs({});
      }

      await loadAll();
    } catch (e: any) {
      setAutoError(e?.message ?? "Failed to save automatic rehandicapping setting.");
    } finally {
      setAutoSaving(false);
    }
  }

  function setManInput(playerId: string, next: string) {
    setManInputs((prev) => ({ ...prev, [playerId]: next }));
  }

  const manTargetRoundIds = useMemo(() => {
    if (!manSelectedRoundId || !isLikelyUuid(manSelectedRoundId)) return [];
    const idx = roundsSorted.findIndex((r) => r.id === manSelectedRoundId);
    if (idx < 0) return [];
    return roundsSorted.slice(idx).map((r) => r.id);
  }, [manSelectedRoundId, roundsSorted]);

  async function applyManualForward(playerId: string) {
    if (!manualEnabled || autoEnabled) return;
    if (!manSelectedRoundId || !isLikelyUuid(manSelectedRoundId)) return;
    if (manTargetRoundIds.length === 0) return;

    const raw = String(manInputs[playerId] ?? "").trim();
    if (!raw) return;

    const nextPH = Number(raw);
    if (!Number.isFinite(nextPH)) return;

    setManSaving(true);
    setManError("");
    setManMsg("");

    try {
      const ph = Math.max(0, Math.floor(nextPH));

      // Apply from selected round forward (inclusive)
      const payload = manTargetRoundIds.map((rid) => {
        const existing = rpByRoundPlayer[rid]?.[playerId];
        const tee = existing?.tee
          ? normalizeTee(existing.tee)
          : normalizeTee(players.find((p) => p.id === playerId)?.gender ?? "M");
        const playing = existing?.playing === true;

        return {
          round_id: rid,
          player_id: playerId,
          playing,
          tee,
          playing_handicap: ph,
          base_playing_handicap: null,
        };
      });

      const { error } = await supabase.from("round_players").upsert(payload, { onConflict: "round_id,player_id" });
      if (error) throw error;

      setManMsg("Saved. Applied forward from the selected round (inclusive).");
      await loadAll();
    } catch (e: any) {
      setManError(e?.message ?? "Failed to apply manual handicap forward.");
    } finally {
      setManSaving(false);
    }
  }

  async function resetManualForward(playerId: string) {
    if (!manualEnabled || autoEnabled) return;
    if (!manSelectedRoundId || !isLikelyUuid(manSelectedRoundId)) return;
    if (manTargetRoundIds.length === 0) return;

    const start = fallbackStartByPlayerId[playerId];
    if (start == null) return;

    setManSaving(true);
    setManError("");
    setManMsg("");

    try {
      const ph = Math.max(0, Math.floor(Number(start)));

      const payload = manTargetRoundIds.map((rid) => {
        const existing = rpByRoundPlayer[rid]?.[playerId];
        const tee = existing?.tee
          ? normalizeTee(existing.tee)
          : normalizeTee(players.find((p) => p.id === playerId)?.gender ?? "M");
        const playing = existing?.playing === true;

        return {
          round_id: rid,
          player_id: playerId,
          playing,
          tee,
          playing_handicap: ph,
          base_playing_handicap: null,
        };
      });

      const { error } = await supabase.from("round_players").upsert(payload, { onConflict: "round_id,player_id" });
      if (error) throw error;

      setManMsg("Reset forward to starting handicap from the selected round (inclusive).");
      await loadAll();
    } catch (e: any) {
      setManError(e?.message ?? "Failed to reset manual handicap forward.");
    } finally {
      setManSaving(false);
    }
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

  const pillBase = "flex-1 h-10 rounded-xl border text-sm font-semibold flex items-center justify-center";
  const pillActive = "border-gray-900 bg-gray-900 text-white";
  const pillIdle = "border-gray-200 bg-white text-gray-900";

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      {/* Header */}
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
            {/* 1) Automatic rehandicapping toggle */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Automatic rehandicapping</div>
                {/* CHANGE #1: removed the helper sentence under the heading */}
              </div>

              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`${pillBase} ${autoEnabledInput === true ? pillActive : pillIdle}`}
                    onClick={() => {
                      setAutoMsg("");
                      setAutoError("");
                      setAutoEnabledInput(true);
                    }}
                    aria-pressed={autoEnabledInput === true}
                  >
                    Yes
                  </button>

                  <button
                    type="button"
                    className={`${pillBase} ${autoEnabledInput === false ? pillActive : pillIdle}`}
                    onClick={() => {
                      setAutoMsg("");
                      setAutoError("");
                      setAutoEnabledInput(false);
                    }}
                    aria-pressed={autoEnabledInput === false}
                  >
                    No
                  </button>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-gray-600">{autoDirty ? "Change pending" : "No pending change"}</div>

                  <button
                    type="button"
                    onClick={saveAutomaticToggle}
                    disabled={autoSaving || !autoDirty}
                    className={`h-10 rounded-xl px-4 text-sm font-semibold border shadow-sm ${
                      autoSaving || !autoDirty
                        ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                        : "border-gray-900 bg-gray-900 text-white active:bg-gray-800"
                    }`}
                  >
                    {autoSaving ? "Saving…" : "Save"}
                  </button>
                </div>

                {autoError ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{autoError}</div> : null}
                {autoMsg ? <div className="text-sm text-green-700">{autoMsg}</div> : null}
              </div>
            </section>

            {/* 2) Rule */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
              {/* CHANGE #2: heading text */}
              <div className="text-sm font-semibold text-gray-900">Rehandicapping rule</div>
              <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{ruleText}</div>

              {autoEnabled ? (
                <div className="mt-2 text-[11px] text-gray-500">
                  Key: <span className="font-medium">{tour?.rehandicapping_rule_key ?? "—"}</span>
                </div>
              ) : null}
            </section>

            {/* 3) Manual rehandicapping (only when automatic is OFF) */}
            {!autoEnabled ? (
              <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="p-4 border-b">
                  <div className="text-sm font-semibold text-gray-900">Manual rehandicapping</div>
                  <div className="mt-1 text-xs text-gray-600">
                    When enabled, you can set a player’s playing handicap from a selected round onward (inclusive).
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={`${pillBase} ${manualEnabled ? pillActive : pillIdle}`}
                      onClick={() => {
                        setManMsg("");
                        setManError("");
                        setManualEnabled(true);
                      }}
                      aria-pressed={manualEnabled === true}
                    >
                      Yes
                    </button>

                    <button
                      type="button"
                      className={`${pillBase} ${!manualEnabled ? pillActive : pillIdle}`}
                      onClick={() => {
                        setManMsg("");
                        setManError("");
                        setManualEnabled(false);
                        setManSelectedRoundId("");
                        setManInputs({});
                      }}
                      aria-pressed={manualEnabled === false}
                    >
                      No
                    </button>
                  </div>

                  {manualEnabled ? (
                    <>
                      {roundsForSelect.length === 0 ? (
                        <div className="text-sm text-gray-700">No rounds found for this tour.</div>
                      ) : (
                        <>
                          <label className="block text-xs font-semibold text-gray-700" htmlFor="manualRoundSelect">
                            Select starting round
                          </label>

                          <select
                            id="manualRoundSelect"
                            className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-sm"
                            value={manSelectedRoundId}
                            onChange={(e) => {
                              setManSelectedRoundId(e.target.value);
                              setManError("");
                              setManMsg("");
                            }}
                          >
                            <option value="">Select a round…</option>
                            {roundsForSelect.map((r) => (
                              <option key={r.id} value={r.id}>
                                {roundLabel(r)}
                              </option>
                            ))}
                          </select>

                          {!manSelectedRoundId ? (
                            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                              Choose a round to apply manual handicaps from that round onward.
                            </div>
                          ) : (
                            <>
                              {manError ? (
                                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{manError}</div>
                              ) : null}

                              {manMsg ? <div className="text-sm text-green-700">{manMsg}</div> : null}

                              <div className="rounded-2xl border border-gray-200 overflow-hidden">
                                <div className="grid grid-cols-12 gap-0 border-b bg-gray-50">
                                  <div className="col-span-6 px-2 py-2 text-[11px] font-semibold text-gray-700">Player</div>
                                  <div className="col-span-3 px-2 py-2 text-[11px] font-semibold text-gray-700 text-right">
                                    PH (selected)
                                  </div>
                                  <div className="col-span-3 px-2 py-2 text-[11px] font-semibold text-gray-700 text-right">
                                    Start
                                  </div>
                                </div>

                                <div className="divide-y">
                                  {players.map((p) => {
                                    const currentPH = hcpByRoundPlayer[manSelectedRoundId]?.[p.id];
                                    const startFallback = fallbackStartByPlayerId[p.id];
                                    const hasStart = startFallback != null;

                                    return (
                                      <div key={p.id} className="p-3">
                                        <div className="grid grid-cols-12 items-center gap-2">
                                          <div className="col-span-6 min-w-0">
                                            <div className="truncate text-sm font-semibold text-gray-900">{p.name}</div>
                                          </div>

                                          <div className="col-span-3 text-right">
                                            <div className="text-xs text-gray-600">{Number.isFinite(Number(currentPH)) ? currentPH : "—"}</div>
                                          </div>

                                          <div className="col-span-3 text-right">
                                            <div className="text-xs text-gray-600">{hasStart ? startFallback : "—"}</div>
                                          </div>
                                        </div>

                                        <div className="mt-2 flex items-center gap-2">
                                          <input
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            className="w-24 rounded-xl border border-gray-200 bg-white px-3 py-2 text-right text-sm font-semibold text-gray-900 shadow-sm"
                                            value={manInputs[p.id] ?? ""}
                                            onChange={(e) => setManInput(p.id, e.target.value)}
                                            placeholder="PH"
                                            aria-label={`Manual playing handicap for ${p.name}`}
                                            disabled={manSaving}
                                          />

                                          <button
                                            type="button"
                                            onClick={() => applyManualForward(p.id)}
                                            disabled={manSaving}
                                            className={`h-10 flex-1 rounded-xl px-4 text-sm font-semibold border shadow-sm ${
                                              manSaving
                                                ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                                : "border-gray-900 bg-gray-900 text-white active:bg-gray-800"
                                            }`}
                                          >
                                            {manSaving ? "Saving…" : "Apply forward"}
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() => resetManualForward(p.id)}
                                            disabled={manSaving || !hasStart}
                                            className={`h-10 rounded-xl px-4 text-sm font-semibold border shadow-sm ${
                                              manSaving || !hasStart
                                                ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                                : "border-gray-200 bg-white text-gray-900 active:bg-gray-50"
                                            }`}
                                          >
                                            Reset forward
                                          </button>
                                        </div>

                                        <div className="mt-1 text-[11px] text-gray-500">
                                          Applies from the selected round onward (inclusive).
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </>
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* 4) Handicap table */}
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
