"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type TourRow = {
  id: string;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
};

type PlayerRow = {
  id: string;
  name: string;
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
  if (v.startsWith(`/m/tours/${tourId}/admin`)) return "";

  return v;
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(d: Date) {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTourDates(start: Date | null, end: Date | null) {
  if (start && end) {
    if (start.toDateString() === end.toDateString()) return fmtDate(start);
    return `${fmtDate(start)} – ${fmtDate(end)}`;
  }
  if (start) return fmtDate(start);
  if (end) return fmtDate(end);
  return "";
}

export default function PlayerEntryPage() {
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
          supabase.from("tours").select("id,name,start_date,end_date").eq("id", tourId).single(),
          supabase
            .from("tour_players")
            .select("tour_id,player_id,players(id,name)")
            .eq("tour_id", tourId)
            .order("name", { ascending: true, foreignTable: "players" }),
        ]);

        if (tErr) throw tErr;
        if (tpErr) throw tpErr;

        const list = (tpData ?? [])
          .map((row: any) => normalizePlayerJoin(row.players))
          .filter((p: PlayerRow | null): p is PlayerRow => !!p)
          .sort((a: PlayerRow, b: PlayerRow) => a.name.localeCompare(b.name));

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

  const dateLabel = useMemo(() => {
    return formatTourDates(parseDate(tour?.start_date ?? null), parseDate(tour?.end_date ?? null));
  }, [tour?.start_date, tour?.end_date]);

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

  return (
    <main className="min-h-dvh bg-white text-gray-900">
      <div className="mx-auto w-full max-w-md px-4 py-5 pb-24">
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-center">
            <div className="text-xs font-black uppercase tracking-[0.22em] text-slate-500">Golf Tour</div>
            <h1 className="mt-2 text-3xl font-black leading-tight text-slate-900">{title}</h1>
            {dateLabel ? <div className="mt-2 text-sm font-semibold text-slate-600">{dateLabel}</div> : null}
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-sm font-semibold text-slate-700">
            Select your name to continue
          </div>
        </section>

        <section className="mt-4">
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
            <div className="grid grid-cols-3 gap-2">
              {players.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPlayer(p.id)}
                  className="min-h-20 rounded-xl bg-slate-900 px-2 py-3 text-center text-sm font-black leading-tight text-white shadow-sm active:bg-slate-700"
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}