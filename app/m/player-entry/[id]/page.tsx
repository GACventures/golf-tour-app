"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type TourRow = {
  id: string;
  name: string | null;
};

type PlayerRow = {
  id: string;
  name: string;
};

type TourPlayerJoinRow = {
  tour_id: string;
  player_id: string;
  players: PlayerRow | PlayerRow[] | null;
};

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizePlayerJoin(val: PlayerRow | PlayerRow[] | null | undefined): PlayerRow | null {
  if (!val) return null;
  const p = Array.isArray(val) ? val[0] : val;
  if (!p?.id) return null;

  return {
    id: String(p.id),
    name: String(p.name ?? "").trim() || "(unnamed)",
  };
}

function selectedPlayerKey(tourId: string) {
  return `golfTour:selectedPlayer:${tourId}`;
}

function lastPageKey(tourId: string, playerId: string) {
  return `golfTour:lastPage:${tourId}:${playerId}`;
}

function safeLastPage(tourId: string, value: string | null) {
  const v = String(value ?? "").trim();

  if (!v) return "";
  if (!v.startsWith(`/m/tours/${tourId}`)) return "";
  if (v.includes(`/m/tours/${tourId}/players`)) return "";

  return v;
}

export default function MobileTourPlayerSelectPage() {
  const params = useParams<{ id?: string }>();
  const router = useRouter();

  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [tour, setTour] = useState<TourRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);

  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) {
      setLoading(false);
      setErrorMsg("Missing or invalid tour id.");
      return;
    }

    let alive = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");

      try {
        const [{ data: tData, error: tErr }, { data: tpData, error: tpErr }] = await Promise.all([
          supabase.from("tours").select("id,name").eq("id", tourId).single(),
          supabase
            .from("tour_players")
            .select("tour_id,player_id,players(id,name)")
            .eq("tour_id", tourId)
            .order("name", { ascending: true, foreignTable: "players" }),
        ]);

        if (tErr) throw tErr;
        if (tpErr) throw tpErr;

        const list = ((tpData ?? []) as TourPlayerJoinRow[])
          .map((row) => normalizePlayerJoin(row.players))
          .filter((p): p is PlayerRow => !!p)
          .sort((a, b) => a.name.localeCompare(b.name));

        if (!alive) return;

        setTour(tData as TourRow);
        setPlayers(list);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load players.");
        setTour(null);
        setPlayers([]);
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();

    return () => {
      alive = false;
    };
  }, [tourId]);

  const title = useMemo(() => {
    const name = String(tour?.name ?? "").trim();
    return name || "Tour";
  }, [tour?.name]);

  function handleSelectPlayer(playerId: string) {
    if (!tourId || !playerId) return;

    localStorage.setItem(selectedPlayerKey(tourId), playerId);

    const remembered = safeLastPage(tourId, localStorage.getItem(lastPageKey(tourId, playerId)));

    if (remembered) {
      router.push(remembered);
      return;
    }

    router.push(`/m/tours/${tourId}`);
  }

  function goHome() {
    router.push(`/m/tours/${tourId}`);
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      <div className="border-b bg-white">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold">{title}</div>
              <div className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Select Player</div>
            </div>

            <button
              type="button"
              onClick={goHome}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-gray-800 hover:bg-gray-100 active:bg-gray-200"
            >
              Home
            </button>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-5 pb-24">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            Loading players…
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMsg}</div>
        ) : players.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
            No players found for this tour.
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              Tap your name to continue. This device will remember the last page used for each player.
            </div>

            {players.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectPlayer(p.id)}
                className="block w-full rounded-2xl border border-slate-300 bg-white px-4 py-4 text-left text-lg font-extrabold text-slate-900 shadow-sm hover:bg-slate-50 active:bg-slate-100"
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}