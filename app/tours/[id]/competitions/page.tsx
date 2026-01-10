// app/tours/[id]/competitions/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";

type Tour = { id: string; name: string };

export default function TourCompetitionsAliasPage() {
  const params = useParams<{ id: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [tour, setTour] = useState<Tour | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErrorMsg("");

      try {
        const { data, error } = await supabase.from("tours").select("id,name").eq("id", tourId).single();
        if (error) throw error;

        if (!cancelled) setTour(data as Tour);
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e?.message ?? "Failed to load tour.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (tourId) void load();
    return () => {
      cancelled = true;
    };
  }, [tourId]);

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
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-4 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Side competitions</h1>
        <div className="text-sm opacity-70">
          {tour?.name ? <span className="font-medium">{tour.name}</span> : <span className="font-medium">{tourId}</span>}
          <span className="opacity-50"> · </span>
          Competitions currently run from the Leaderboard dropdown.
        </div>
      </header>

      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="font-semibold">Where are the competitions?</div>

        <div className="text-sm opacity-80 leading-relaxed">
          You’re showing competitions inside the <span className="font-medium">Leaderboard</span> screen (dropdown).
          This page is kept as a simple hub so navigation stays consistent.
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Link href={`/tours/${tourId}/leaderboard`} className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
            Go to Leaderboards (incl competitions) →
          </Link>

          <Link href={`/tours/${tourId}`} className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50">
            Back to Tour overview →
          </Link>
        </div>

        <div className="rounded-xl border bg-gray-50 p-3 text-xs opacity-70">
          If you later decide you want a dedicated competitions page, we can move the dropdown UI here and keep Leaderboard
          focused on scoring.
        </div>
      </section>
    </main>
  );
}

