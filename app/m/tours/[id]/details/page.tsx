"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Tour = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
};

type Round = {
  id: string;
  round_no: number | null;
  played_on: string | null;
  created_at: string | null;
};

type TourGroupingSettings = {
  individual_mode: string | null;
  individual_best_n: number | null;
  individual_final_required: boolean | null;
};

function fmtDate(value: string | null) {
  if (!value) return "TBC";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTourDates(start: string | null, end: string | null) {
  if (!start && !end) return "TBD";
  if (start && end) {
    if (start === end) return fmtDate(start);
    return `${fmtDate(start)} – ${fmtDate(end)}`;
  }
  return fmtDate(start ?? end);
}

function formatRehandicapRule(s: TourGroupingSettings | null) {
  if (!s) return "No rehandicapping";

  const mode = (s.individual_mode ?? "ALL").toUpperCase();
  if (mode !== "BEST_N") return "No rehandicapping";

  const n = Number(s.individual_best_n ?? 0);
  const finalReq = s.individual_final_required === true;

  if (n > 0) {
    return finalReq
      ? `Best ${n} rounds (final round required)`
      : `Best ${n} rounds`;
  }

  return finalReq
    ? "Best N rounds (final round required)"
    : "Best N rounds";
}

export default function MobileTourDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tourId = params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [settings, setSettings] = useState<TourGroupingSettings | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const { data: tData, error: tErr } = await supabase
          .from("tours")
          .select("id,name,start_date,end_date")
          .eq("id", tourId)
          .single();
        if (tErr) throw tErr;

        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,round_no,played_on,created_at")
          .eq("tour_id", tourId);
        if (rErr) throw rErr;

        const { data: sData } = await supabase
          .from("tour_grouping_settings")
          .select("individual_mode,individual_best_n,individual_final_required")
          .eq("tour_id", tourId)
          .maybeSingle();

        if (!alive) return;

        setTour(tData as Tour);
        setRounds((rData ?? []) as Round[]);
        setSettings((sData ?? null) as TourGroupingSettings | null);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load tour details.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [tourId]);

  const sortedRounds = useMemo(() => {
    return [...rounds].sort((a, b) => {
      const an = a.round_no ?? 9999;
      const bn = b.round_no ?? 9999;
      if (an !== bn) return an - bn;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });
  }, [rounds]);

  const rehandicapSummary = formatRehandicapRule(settings);
  const rehandicappingEnabled = rehandicapSummary !== "No rehandicapping";

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white">
        <div className="h-12 px-4 flex items-center">
          <button
            onClick={() => router.back()}
            className="mr-3 text-xl"
            aria-label="Back"
          >
            ‹
          </button>
          <div className="font-semibold">Tour details</div>
        </div>
      </div>

      <main className="max-w-md mx-auto px-4 py-4 space-y-6">
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        ) : (
          <>
            {/* Tour summary */}
            <section className="rounded-xl border p-4">
              <div className="text-lg font-semibold">{tour?.name}</div>
              <div className="mt-1 text-sm text-gray-600">
                Dates: {formatTourDates(tour?.start_date ?? null, tour?.end_date ?? null)}
              </div>
            </section>

            {/* Rounds summary */}
            <section className="rounded-xl border p-4">
              <div className="font-semibold mb-2">Rounds</div>
              <div className="text-sm text-gray-700">
                Total rounds: <strong>{sortedRounds.length}</strong>
              </div>

              {sortedRounds.length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-gray-600">
                  {sortedRounds.map((r, i) => (
                    <li key={r.id}>
                      Round {r.round_no ?? i + 1} —{" "}
                      {fmtDate(r.played_on ?? r.created_at)}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Rehandicapping (BOTTOM, as requested) */}
            <section className="rounded-xl border p-4">
              <div className="font-semibold mb-1">Rehandicapping</div>
              <div className="text-sm text-gray-700">
                Enabled:{" "}
                <strong>{rehandicappingEnabled ? "Yes" : "No"}</strong>
              </div>
              <div className="mt-1 text-sm text-gray-600">
                {rehandicapSummary}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
