// app/m/tours/[id]/rounds/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Tour = {
  id: string;
  name: string;
};

type Round = {
  id: string;
  tour_id: string;
  name: string | null;
  created_at: string | null;
  // If you later add a dedicated date column, we can prefer that.
  date?: string | null;
};

function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function MobileRoundsListPage() {
  const params = useParams();

  // IMPORTANT: your folder is /tours/[id]/..., so the param is "id"
  const tourId = (params?.id as string) || "";

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErrorMsg("");

      try {
        // Tour (for header)
        const { data: tourData, error: tourErr } = await supabase
          .from("tours")
          .select("id,name")
          .eq("id", tourId)
          .single();

        if (tourErr) throw tourErr;

        // Rounds list
        const { data: roundsData, error: roundsErr } = await supabase
          .from("rounds")
          .select("id,tour_id,name,created_at")
          .eq("tour_id", tourId)
          .order("created_at", { ascending: true });

        if (roundsErr) throw roundsErr;

        if (cancelled) return;

        setTour(tourData as Tour);
        setRounds((roundsData ?? []) as Round[]);
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.message ?? "Failed to load rounds.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    if (tourId) load();

    return () => {
      cancelled = true;
    };
  }, [tourId]);

  const rows = useMemo(() => {
    return rounds.map((r, idx) => {
      const label = (r.name && r.name.trim()) || `Round ${idx + 1}`;
      const dateText = formatDate((r as any).date ?? r.created_at);
      return { ...r, label, dateText, idx };
    });
  }, [rounds]);

  return (
    <div className="min-h-dvh bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="flex items-center gap-3">
            <Link
              href={`/m/tours/${tourId}`}
              className="rounded-lg px-2 py-1 text-sm font-medium text-gray-700 hover:bg-gray-100 active:bg-gray-200"
            >
              ← Back
            </Link>
            <div className="min-w-0">
              <div className="text-base font-semibold text-gray-900">Rounds</div>
              <div className="truncate text-sm text-gray-500">
                {tour?.name ?? ""}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <main className="mx-auto w-full max-w-md px-4 py-4">
        {errorMsg ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {errorMsg}
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="rounded-2xl border p-4">
                <div className="h-5 w-40 rounded bg-gray-100" />
                <div className="mt-2 h-4 w-28 rounded bg-gray-100" />
                <div className="mt-4 flex gap-2">
                  <div className="h-10 flex-1 rounded-xl bg-gray-100" />
                  <div className="h-10 flex-1 rounded-xl bg-gray-100" />
                  <div className="h-10 flex-1 rounded-xl bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border p-4 text-sm text-gray-700">
            No rounds found for this tour.
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((r) => (
              <div
                key={r.id}
                className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold text-gray-900">
                      {r.label}
                    </div>
                    {r.dateText ? (
                      <div className="mt-1 text-sm text-gray-500">
                        {r.dateText}
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Buttons only — no card-wide tap */}
                <div className="mt-4 flex gap-2">
                  <Link
                    href={`/m/tours/${tourId}/rounds/${r.id}/tee-times`}
                    className="flex-1 rounded-xl border border-gray-300 px-3 py-2.5 text-center text-sm font-semibold text-gray-900 hover:bg-gray-50 active:bg-gray-100"
                  >
                    Tee times
                  </Link>

                  <Link
                    href={`/m/tours/${tourId}/rounds/${r.id}/scoring`}
                    className="flex-1 rounded-xl bg-gray-900 px-3 py-2.5 text-center text-sm font-semibold text-white hover:bg-gray-800 active:bg-gray-700"
                  >
                    Score
                  </Link>

                  <Link
                    href={`/m/tours/${tourId}/rounds/${r.id}/results`}
                    className="flex-1 rounded-xl border border-gray-300 px-3 py-2.5 text-center text-sm font-semibold text-gray-900 hover:bg-gray-50 active:bg-gray-100"
                  >
                    Results
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
