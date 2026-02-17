// app/tours/[id]/players/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { supabase } from "@/lib/supabaseClient";

type Tee = "M" | "F";

type TourRow = {
  id: string;
  name: string | null;
};

type PlayerRow = {
  id: string;
  name: string;
  gender: Tee | null;
  start_handicap: number | null; // GLOBAL handicap (supports 1dp)
};

type TourPlayerJoinRow = {
  tour_id: string;
  player_id: string;
  starting_handicap: number | null; // TOUR handicap snapshot/override (supports 1dp)
  players: PlayerRow | PlayerRow[] | null; // supabase join can be array
};

function asSingle<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

/**
 * Parse a non-negative number with up to 1 decimal place.
 * Returns null for blank/invalid.
 */
function toNonNegOneDecimalOrNull(v: string): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;

  if (!/^\d+(\.\d)?$/.test(s)) return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;

  return Math.round(n * 10) / 10;
}

function fmt1(v: number | null | undefined): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.0";
  return (Math.round(n * 10) / 10).toFixed(1);
}

export default function TourPlayersPage() {
  const params = useParams<{ id: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [tour, setTour] = useState<TourRow | null>(null);
  const [allPlayers, setAllPlayers] = useState<PlayerRow[]>([]);
  const [tourPlayers, setTourPlayers] = useState<TourPlayerJoinRow[]>([]);

  // Add-player UI
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [tourStartHcpDraft, setTourStartHcpDraft] = useState<string>(""); // blank = use global

  // Per-row edit drafts
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const [editSaving, setEditSaving] = useState<Record<string, boolean>>({});
  const [editErr, setEditErr] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string>("");

  async function loadAll() {
    if (!tourId) return;

    setLoading(true);
    setErrorMsg("");
    setToast("");

    try {
      const [{ data: tData, error: tErr }, { data: pData, error: pErr }, { data: tpData, error: tpErr }] =
        await Promise.all([
          supabase.from("tours").select("id,name").eq("id", tourId).single(),
          supabase.from("players").select("id,name,gender,start_handicap").order("name", { ascending: true }),
          supabase
            .from("tour_players")
            .select("tour_id,player_id,starting_handicap,players(id,name,gender,start_handicap)")
            .eq("tour_id", tourId),
        ]);

      if (tErr) throw tErr;
      if (pErr) throw pErr;
      if (tpErr) throw tpErr;

      setTour(tData as TourRow);
      setAllPlayers((pData ?? []) as PlayerRow[]);
      setTourPlayers((tpData ?? []) as TourPlayerJoinRow[]);

      // init editDraft (1dp)
      const nextDraft: Record<string, string> = {};
      for (const tp of (tpData ?? []) as TourPlayerJoinRow[]) {
        nextDraft[String(tp.player_id)] = fmt1(tp.starting_handicap ?? 0);
      }
      setEditDraft(nextDraft);

      // Pick default available player if none selected
      const currentIds = new Set(((tpData ?? []) as TourPlayerJoinRow[]).map((x) => String(x.player_id)));
      const available = ((pData ?? []) as PlayerRow[]).filter((p) => !currentIds.has(p.id));
      if (!selectedPlayerId && available.length) {
        setSelectedPlayerId(available[0].id);
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to load players.");
      setTour(null);
      setAllPlayers([]);
      setTourPlayers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  const tourPlayerIds = useMemo(() => new Set(tourPlayers.map((tp) => String(tp.player_id))), [tourPlayers]);

  const availablePlayers = useMemo(() => allPlayers.filter((p) => !tourPlayerIds.has(p.id)), [allPlayers, tourPlayerIds]);

  const selectedPlayer = useMemo(
    () => availablePlayers.find((p) => p.id === selectedPlayerId) ?? null,
    [availablePlayers, selectedPlayerId]
  );

  // Reset input when selected player changes
  useEffect(() => {
    setTourStartHcpDraft("");
  }, [selectedPlayerId]);

  // ✅ Helper: ensure a player exists in round_players for ALL rounds in this tour
  async function addPlayerToAllRoundsInTour(playerId: string) {
    // get all rounds for this tour
    const { data: roundRows, error: roundsErr } = await supabase.from("rounds").select("id").eq("tour_id", tourId);
    if (roundsErr) throw roundsErr;

    const roundIds = (roundRows ?? []).map((r: any) => String(r.id)).filter(Boolean);

    for (const rid of roundIds) {
      // check if already exists
      const { data: existing, error: exErr } = await supabase
        .from("round_players")
        .select("id")
        .eq("round_id", rid)
        .eq("player_id", playerId)
        .limit(1);

      if (exErr) throw exErr;

      if (!existing || existing.length === 0) {
        // Insert only required columns (defaults fill: playing=true, tee='M', playing_handicap=0, course_handicap=0)
        const { error: insErr } = await supabase.from("round_players").insert({
          round_id: rid,
          player_id: playerId,
          playing: true,
        });
        if (insErr) throw insErr;
      }
    }
  }

  async function addPlayerToTour() {
    if (!tourId) return;
    if (!selectedPlayerId) return;

    setBusy(true);
    setErrorMsg("");
    setToast("");

    try {
      const globalHcp =
        Number.isFinite(Number(selectedPlayer?.start_handicap)) && selectedPlayer?.start_handicap != null
          ? Math.round(Number(selectedPlayer.start_handicap) * 10) / 10
          : 0.0;

      const parsed = toNonNegOneDecimalOrNull(tourStartHcpDraft);

      // Blank => use global
      const starting_handicap = parsed === null ? globalHcp : parsed;

      // 1) Add to tour roster
      const { error } = await supabase.from("tour_players").insert({
        tour_id: tourId,
        player_id: selectedPlayerId,
        starting_handicap,
      });

      if (error) throw error;

      // 2) Ensure they are included in all existing rounds (default playing=true)
      await addPlayerToAllRoundsInTour(selectedPlayerId);

      setToast("Added ✓");
      setTourStartHcpDraft("");
      await loadAll();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to add player to tour.");
    } finally {
      setBusy(false);
      window.setTimeout(() => setToast(""), 1200);
    }
  }

  async function saveTourStartingHcp(playerId: string) {
    const draft = (editDraft[playerId] ?? "").trim();
    const parsed = toNonNegOneDecimalOrNull(draft);

    if (parsed === null) {
      setEditErr((prev) => ({ ...prev, [playerId]: "Enter a number (0+) with up to 1 decimal place." }));
      return;
    }

    setEditErr((prev) => ({ ...prev, [playerId]: "" }));
    setEditSaving((prev) => ({ ...prev, [playerId]: true }));

    const { error } = await supabase
      .from("tour_players")
      .update({ starting_handicap: parsed })
      .eq("tour_id", tourId)
      .eq("player_id", playerId);

    if (error) {
      setEditErr((prev) => ({ ...prev, [playerId]: error.message }));
      setEditSaving((prev) => ({ ...prev, [playerId]: false }));
      return;
    }

    setToast("Saved ✓");
    setEditSaving((prev) => ({ ...prev, [playerId]: false }));
    await loadAll();
    window.setTimeout(() => setToast(""), 1200);
  }

  // ✅ Tour primacy removal: remove from tour AND all rounds in this tour
  async function removePlayerFromTour(playerId: string) {
    if (!tourId || !playerId) return;

    const ok = window.confirm(
      "Remove this player from the tour?\n\nThis will ALSO remove them from ALL rounds in this tour and delete their scores for those rounds.\nThis cannot be undone."
    );
    if (!ok) return;

    setBusy(true);
    setErrorMsg("");
    setToast("");

    try {
      // 1) Load all round ids for this tour
      const { data: roundRows, error: roundsErr } = await supabase.from("rounds").select("id").eq("tour_id", tourId);
      if (roundsErr) throw roundsErr;

      const roundIds = (roundRows ?? []).map((r: any) => String(r.id)).filter(Boolean);

      // 2) Remove the player from every round-level table for each round
      for (const rid of roundIds) {
        const delScores = await supabase.from("scores").delete().eq("round_id", rid).eq("player_id", playerId);
        if (delScores.error) throw delScores.error;

        const delBuddy1 = await supabase.from("buddy_scores").delete().eq("round_id", rid).eq("owner_player_id", playerId);
        if (delBuddy1.error) throw delBuddy1.error;

        const delBuddy2 = await supabase.from("buddy_scores").delete().eq("round_id", rid).eq("buddy_player_id", playerId);
        if (delBuddy2.error) throw delBuddy2.error;

        const delRoundGroupPlayers = await supabase
          .from("round_group_players")
          .delete()
          .eq("round_id", rid)
          .eq("player_id", playerId);
        if (delRoundGroupPlayers.error) throw delRoundGroupPlayers.error;

        const delRoundPlayers = await supabase.from("round_players").delete().eq("round_id", rid).eq("player_id", playerId);
        if (delRoundPlayers.error) throw delRoundPlayers.error;
      }

      // 3) Remove from tour pairs/teams membership
      const delTourGroupMembers = await supabase.from("tour_group_members").delete().eq("player_id", playerId);
      if (delTourGroupMembers.error) throw delTourGroupMembers.error;

      // 4) Finally remove from the tour roster
      const { error } = await supabase.from("tour_players").delete().eq("tour_id", tourId).eq("player_id", playerId);
      if (error) throw error;

      setToast("Removed from tour + rounds ✓");
      await loadAll();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to remove player from tour.");
    } finally {
      setBusy(false);
      window.setTimeout(() => setToast(""), 1600);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl p-4">
        <div className="text-sm opacity-70">Loading…</div>
      </main>
    );
  }

  if (errorMsg) {
    return (
      <main className="mx-auto max-w-4xl p-4 space-y-3">
        <div className="text-lg font-semibold text-red-600">Error</div>
        <div className="text-sm">{errorMsg}</div>
        <div className="text-sm">
          <Link className="underline" href="/tours">
            Back to tours
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-4 space-y-4">
      <header className="space-y-1">
        <div className="text-sm">
          <Link className="underline" href={`/tours/${tourId}`}>
            ← Back to tour
          </Link>
        </div>
        <h1 className="text-2xl font-semibold">Tour players</h1>
        <div className="text-sm text-gray-600">{tour?.name ?? tourId}</div>
      </header>

      {toast ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{toast}</div>
      ) : null}

      {/* Add player */}
      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <h2 className="text-lg font-semibold">Add player from global library</h2>

        <div className="text-sm text-gray-600">
          If <span className="font-medium">Tour Starting HCP</span> is left blank, we automatically use{" "}
          <code className="px-1 rounded bg-gray-100">players.start_handicap</code>.
        </div>

        {availablePlayers.length === 0 ? (
          <div className="text-sm opacity-70">All global players are already in this tour.</div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <div className="text-xs font-semibold text-gray-700">Player</div>
              <select
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={selectedPlayerId}
                onChange={(e) => setSelectedPlayerId(e.target.value)}
                disabled={busy}
              >
                {availablePlayers.map((p) => {
                  const gh =
                    Number.isFinite(Number(p.start_handicap)) && p.start_handicap != null ? Number(p.start_handicap) : 0;
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.gender ? `(${p.gender})` : ""} — Global HCP: {fmt1(gh)}
                    </option>
                  );
                })}
              </select>
            </div>

            <div className="w-full sm:w-56">
              <div className="text-xs font-semibold text-gray-700">Tour Starting HCP</div>
              <input
                inputMode="decimal"
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={tourStartHcpDraft}
                onChange={(e) => setTourStartHcpDraft(e.target.value)}
                placeholder={
                  selectedPlayer ? `Blank = Global (${fmt1(selectedPlayer.start_handicap ?? 0)})` : "Blank = Global"
                }
                disabled={busy}
              />
              <div className="mt-1 text-[11px] text-gray-500">Use up to 1 decimal place (e.g. 12.3).</div>
            </div>

            <button
              type="button"
              onClick={addPlayerToTour}
              disabled={busy || !selectedPlayerId}
              className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? "Adding…" : "Add to tour"}
            </button>
          </div>
        )}
      </section>

      {/* Tour players list */}
      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <h2 className="text-lg font-semibold">Players in this tour</h2>

        {tourPlayers.length === 0 ? (
          <div className="text-sm opacity-70">No players in this tour yet.</div>
        ) : (
          <div className="space-y-3">
            {tourPlayers
              .slice()
              .sort((a, b) => {
                const ap = asSingle(a.players);
                const bp = asSingle(b.players);
                return String(ap?.name ?? "").localeCompare(String(bp?.name ?? ""));
              })
              .map((tp) => {
                const p = asSingle(tp.players);
                const pid = String(tp.player_id);
                const saving = editSaving[pid] === true;
                const err = editErr[pid] ?? "";

                const globalHcp =
                  Number.isFinite(Number(p?.start_handicap)) && p?.start_handicap != null ? Number(p.start_handicap) : 0;

                return (
                  <div key={pid} className="rounded-xl border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">
                          {p?.name ?? "(unknown player)"}{" "}
                          {p?.gender ? <span className="opacity-60">({p.gender})</span> : null}
                        </div>
                        <div className="text-xs text-gray-600">
                          Global HCP: <span className="font-medium">{fmt1(globalHcp)}</span>
                        </div>

                        <button
                          type="button"
                          onClick={() => removePlayerFromTour(pid)}
                          disabled={busy}
                          className="mt-2 text-xs underline text-red-600 disabled:opacity-50"
                          title="Remove from tour"
                        >
                          Remove player from tour
                        </button>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <div className="text-xs font-semibold text-gray-700">Tour Starting HCP</div>
                        <div className="flex items-center gap-2">
                          <input
                            inputMode="decimal"
                            className="w-24 rounded-md border px-2 py-1 text-right"
                            value={editDraft[pid] ?? fmt1(tp.starting_handicap ?? 0)}
                            onChange={(e) => {
                              setEditDraft((prev) => ({ ...prev, [pid]: e.target.value }));
                              setEditErr((prev) => ({ ...prev, [pid]: "" }));
                            }}
                            disabled={saving || busy}
                          />
                          <button
                            type="button"
                            className="rounded-md bg-black px-3 py-1 text-sm text-white disabled:opacity-50"
                            onClick={() => saveTourStartingHcp(pid)}
                            disabled={saving || busy}
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                        </div>
                        {err ? <div className="text-xs text-red-600">{err}</div> : null}
                        <div className="text-[11px] text-gray-500">
                          Round 1 PH is seeded from this value; later rounds follow re-handicapping rules.
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </section>
    </main>
  );
}
