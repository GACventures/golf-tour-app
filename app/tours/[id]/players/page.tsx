// app/tours/[id]/players/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Tour = { id: string; name: string };

// Global library player
type Player = { id: string; name: string; starting_handicap: number };

// Tour membership row (snapshot handicap)
type TourPlayerRow = {
  tour_id: string;
  player_id: string;
  starting_handicap: number | null;
  created_at?: string | null;
  players?: Player | null; // joined
};

function intOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

export default function TourPlayersPage() {
  const params = useParams<{ id: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [tour, setTour] = useState<Tour | null>(null);

  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [tourPlayers, setTourPlayers] = useState<TourPlayerRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");

  // inline edit
  const [editingPlayerId, setEditingPlayerId] = useState<string | null>(null);
  const [editHcp, setEditHcp] = useState<string>("");

  async function load() {
    setLoading(true);
    setErrorMsg("");

    try {
      if (!tourId) throw new Error("Missing tour id.");

      const [{ data: tData, error: tErr }, { data: pData, error: pErr }, { data: tpData, error: tpErr }] =
        await Promise.all([
          supabase.from("tours").select("id,name").eq("id", tourId).single(),

          // Global players library
          supabase.from("players").select("id,name,starting_handicap").order("name", { ascending: true }),

          // Tour membership, snapshot handicap + joined player
          supabase
            .from("tour_players")
            .select("tour_id,player_id,starting_handicap,created_at, players:players(id,name,starting_handicap)")
            .eq("tour_id", tourId)
            .order("created_at", { ascending: true }),
        ]);

      if (tErr) throw new Error(tErr.message);
      if (pErr) throw new Error(pErr.message);
      if (tpErr) throw new Error(tpErr.message);

      const players = (pData ?? []) as Player[];
      const membership = (tpData ?? []) as TourPlayerRow[];

      setTour(tData as Tour);
      setAllPlayers(players);
      setTourPlayers(membership);

      // Default selection to first available
      const inTour = new Set(membership.map((x) => x.player_id));
      const firstAvailable = players.find((p) => !inTour.has(p.id));
      setSelectedPlayerId(firstAvailable?.id ?? "");

      // If editing a player that was removed, exit edit mode
      if (editingPlayerId && !membership.some((m) => m.player_id === editingPlayerId)) {
        setEditingPlayerId(null);
        setEditHcp("");
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!tourId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  const tourPlayerIds = useMemo(() => new Set(tourPlayers.map((x) => x.player_id)), [tourPlayers]);

  const availablePlayers = useMemo(
    () => allPlayers.filter((p) => !tourPlayerIds.has(p.id)),
    [allPlayers, tourPlayerIds]
  );

  const roster = useMemo(() => {
    const byId = new Map(allPlayers.map((p) => [p.id, p]));
    return tourPlayers
      .map((tp) => {
        const joined = tp.players ?? null;
        const p = joined ?? byId.get(tp.player_id) ?? null;
        if (!p) return null;

        const tourHcp = tp.starting_handicap ?? p.starting_handicap;

        return {
          id: p.id,
          name: p.name,
          tour_starting_handicap: tourHcp,
          hasOverride: tp.starting_handicap != null && tp.starting_handicap !== p.starting_handicap,
          global_starting_handicap: p.starting_handicap,
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      name: string;
      tour_starting_handicap: number;
      hasOverride: boolean;
      global_starting_handicap: number;
    }>;
  }, [allPlayers, tourPlayers]);

  const canAdd = useMemo(() => Boolean(selectedPlayerId) && !saving, [selectedPlayerId, saving]);

  async function addPlayerToTour() {
    setErrorMsg("");
    if (!canAdd) return;

    setSaving(true);
    try {
      const { error } = await supabase.from("tour_players").insert({
        tour_id: tourId,
        player_id: selectedPlayerId,
      });

      if (error) throw new Error(error.message);

      await load();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function removePlayerFromTour(playerId: string) {
    setErrorMsg("");
    setSaving(true);
    try {
      const { error } = await supabase.from("tour_players").delete().eq("tour_id", tourId).eq("player_id", playerId);
      if (error) throw new Error(error.message);

      await load();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(playerId: string) {
    const row = roster.find((r) => r.id === playerId);
    if (!row) return;
    setEditingPlayerId(playerId);
    setEditHcp(String(row.tour_starting_handicap));
  }

  async function saveEdit(playerId: string) {
    setErrorMsg("");
    const n = intOrNull(editHcp);
    if (n == null) {
      setErrorMsg("Please enter a valid whole-number handicap.");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("tour_players")
        .update({ starting_handicap: n })
        .eq("tour_id", tourId)
        .eq("player_id", playerId);

      if (error) throw new Error(error.message);

      setEditingPlayerId(null);
      setEditHcp("");
      await load();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  async function resetToGlobal(playerId: string) {
    // set to NULL -> means “use copied/global”; keeping NULL also preserves trigger behavior for future inserts
    setErrorMsg("");
    setSaving(true);
    try {
      const { error } = await supabase
        .from("tour_players")
        .update({ starting_handicap: null })
        .eq("tour_id", tourId)
        .eq("player_id", playerId);

      if (error) throw new Error(error.message);

      setEditingPlayerId(null);
      setEditHcp("");
      await load();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl p-4 space-y-4">
        <div className="text-sm opacity-70">Loading…</div>
      </main>
    );
  }

  if (errorMsg) {
    return (
      <main className="mx-auto max-w-5xl p-4 space-y-4">
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-semibold">Error</div>
          <div className="mt-1">{errorMsg}</div>
        </div>
        <div className="text-sm">
          <Link className="underline" href="/tours">
            Back to tours
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-4 space-y-4">
      <div className="text-sm opacity-70">
        <Link className="underline" href="/tours">
          Tours
        </Link>{" "}
        <span className="opacity-50">/</span>{" "}
        <Link className="underline" href={`/tours/${tourId}`}>
          {tour?.name ?? tourId}
        </Link>{" "}
        <span className="opacity-50">/</span> Players (This Tour)
      </div>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Players (This Tour)</h1>
          <div className="text-sm opacity-70">
            Tour: <span className="font-medium">{tour?.name ?? tourId}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/tours/${tourId}`}>
            Back to Tour
          </Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/tours/${tourId}/leaderboard`}>
            Leaderboard
          </Link>
        </div>
      </header>

      {/* Add from global library */}
      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold">Add player from library</div>
            <div className="text-xs opacity-70">
              If a player doesn’t exist yet, add them on{" "}
              <Link className="underline" href="/players">
                Players
              </Link>{" "}
              (and set starting handicap there).
            </div>
          </div>

          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href="/players">
            Go to Players library
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <div className="text-sm opacity-70 mb-1">Player</div>
            <select
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={selectedPlayerId}
              onChange={(e) => setSelectedPlayerId(e.target.value)}
              disabled={availablePlayers.length === 0}
            >
              {availablePlayers.length === 0 ? (
                <option value="">All players are already in this tour</option>
              ) : (
                availablePlayers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} (HCP {p.starting_handicap})
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="flex items-end">
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              disabled={!canAdd || availablePlayers.length === 0}
              onClick={() => void addPlayerToTour()}
            >
              {saving ? "Adding…" : "Add to tour"}
            </button>
          </div>
        </div>
      </section>

      {/* Tour roster */}
      <section className="rounded-2xl border bg-white">
        {roster.length === 0 ? (
          <div className="p-4 text-sm opacity-70">No players in this tour yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-3 text-left font-medium opacity-70">Player</th>
                  <th className="p-3 text-right font-medium opacity-70">Tour starting HCP</th>
                  <th className="p-3 text-right font-medium opacity-70">Global HCP</th>
                  <th className="p-3 text-right font-medium opacity-70">Actions</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((p) => {
                  const isEditing = editingPlayerId === p.id;
                  return (
                    <tr key={p.id} className="border-b last:border-b-0">
                      <td className="p-3">
                        <div className="font-medium">{p.name}</div>
                        {p.hasOverride ? <div className="text-xs opacity-70">Tour override applied</div> : null}
                      </td>

                      <td className="p-3 text-right tabular-nums">
                        {isEditing ? (
                          <input
                            className="w-24 rounded border px-2 py-1 text-right"
                            value={editHcp}
                            onChange={(e) => setEditHcp(e.target.value)}
                            inputMode="numeric"
                          />
                        ) : (
                          p.tour_starting_handicap
                        )}
                      </td>

                      <td className="p-3 text-right tabular-nums opacity-80">{p.global_starting_handicap}</td>

                      <td className="p-3 text-right">
                        <div className="inline-flex gap-3 items-center">
                          <Link className="text-sm underline" href={`/tours/${tourId}/players/${p.id}`}>
                            Stats
                          </Link>

                          {isEditing ? (
                            <>
                              <button
                                className="text-sm underline disabled:opacity-50"
                                disabled={saving}
                                onClick={() => void saveEdit(p.id)}
                              >
                                Save
                              </button>
                              <button
                                className="text-sm underline opacity-80 hover:opacity-100 disabled:opacity-50"
                                disabled={saving}
                                onClick={() => {
                                  setEditingPlayerId(null);
                                  setEditHcp("");
                                }}
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              className="text-sm underline opacity-80 hover:opacity-100 disabled:opacity-50"
                              disabled={saving}
                              onClick={() => beginEdit(p.id)}
                            >
                              Edit tour HCP
                            </button>
                          )}

                          <button
                            className="text-sm underline opacity-80 hover:opacity-100 disabled:opacity-50"
                            disabled={saving}
                            onClick={() => void resetToGlobal(p.id)}
                            title="Resets to global value (stores NULL in tour_players so it falls back)."
                          >
                            Reset
                          </button>

                          <button
                            className="text-sm underline opacity-80 hover:opacity-100 disabled:opacity-50"
                            disabled={saving}
                            onClick={() => void removePlayerFromTour(p.id)}
                            title="Remove from this tour (does not delete from library)"
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
