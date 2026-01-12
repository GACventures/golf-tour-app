// app/m/tours/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import MobileNav from "./_components/MobileNav";
import { supabase } from "@/lib/supabaseClient";

type TourRow = {
  id: string;
  name: string | null;
  start_date: string | null; // date in ISO from Supabase
  end_date: string | null;   // date in ISO from Supabase
  image_url?: string | null; // optional
  created_at?: string | null;
};

function safeParseDate(value: string | null): Date | null {
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

export default function MobileTourHomePage() {
  const params = useParams<{ id: string }>();
  const tourId = params?.id ?? "";

  const [tour, setTour] = useState<TourRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadTour() {
      setLoading(true);
      setErrorMsg("");

      const { data, error } = await supabase
        .from("tours")
        .select("id, name, start_date, end_date, image_url, created_at")
        .eq("id", tourId)
        .single();

      if (!alive) return;

      if (error) {
        setErrorMsg(error.message);
        setTour(null);
        setLoading(false);
        return;
      }

      setTour(data as TourRow);
      setLoading(false);
    }

    if (tourId) loadTour();
    else {
      setErrorMsg("Missing tour id in route.");
      setLoading(false);
    }

    return () => {
      alive = false;
    };
  }, [tourId]);

  const title = tour?.name?.trim() || "Tour";

  const start = useMemo(() => safeParseDate(tour?.start_date ?? null), [tour?.start_date]);
  const end = useMemo(() => safeParseDate(tour?.end_date ?? null), [tour?.end_date]);

  const dateLabel = useMemo(() => formatTourDates(start, end), [start, end]);

  const heroImage = (tour?.image_url?.trim() || "") as string;

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Hero */}
      <div className="relative">
        {/* Image */}
        <div className="h-48 w-full bg-gray-100 overflow-hidden">
          {heroImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={heroImage}
              alt=""
              className="h-48 w-full object-cover"
            />
          ) : (
            <div className="h-48 w-full bg-gradient-to-br from-gray-100 to-gray-200" />
          )}
        </div>

        {/* Overlay */}
        <div className="absolute inset-0 bg-black/25" />

        {/* Title card */}
        <div className="absolute inset-x-0 bottom-0 px-4 pb-4">
          <div className="max-w-md mx-auto">
            <div className="rounded-2xl bg-white/92 backdrop-blur border border-white/60 shadow-sm px-4 py-3">
              {loading ? (
                <div className="space-y-2">
                  <div className="h-5 w-44 bg-gray-200 rounded" />
                  <div className="h-4 w-64 bg-gray-200 rounded" />
                </div>
              ) : errorMsg ? (
                <div className="text-sm text-red-700">{errorMsg}</div>
              ) : (
                <>
                  <div className="text-lg font-extrabold leading-tight">{title}</div>
                  {dateLabel ? (
                    <div className="text-sm font-semibold text-gray-700 mt-0.5">{dateLabel}</div>
                  ) : (
                    <div className="text-sm font-semibold text-gray-600 mt-0.5">Dates TBD</div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body content */}
      <div className="px-4 pt-5 pb-28">
        <div className="max-w-md mx-auto space-y-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-gray-800">Welcome</div>
            <div className="text-sm text-gray-600 mt-1">
              Use the tabs below to view rounds, leaderboards, competitions, and stats.
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-gray-800">Tour details</div>
            <div className="mt-2 space-y-1 text-sm text-gray-700">
              <div>
                <span className="font-semibold text-gray-900">Name:</span>{" "}
                {loading ? "Loading…" : title}
              </div>
              <div>
                <span className="font-semibold text-gray-900">Dates:</span>{" "}
                {loading ? "Loading…" : dateLabel || "Dates TBD"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom tabs */}
      <MobileNav />
    </div>
  );
}
