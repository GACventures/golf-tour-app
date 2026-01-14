"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type TourRow = {
  id: string;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  image_url?: string | null;
};

const DEFAULT_HERO = "/tours/tour-landing-hero-cartoon.webp";

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

export default function MobileTourLandingPage() {
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
        .select("id, name, start_date, end_date, image_url")
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

  // ✅ Always show a hero image (tour image_url if present, otherwise default)
  const heroImage = (tour?.image_url?.trim() ? tour!.image_url!.trim() : DEFAULT_HERO) as string;

  const start = useMemo(() => parseDate(tour?.start_date ?? null), [tour?.start_date]);
  const end = useMemo(() => parseDate(tour?.end_date ?? null), [tour?.end_date]);
  const dateLabel = useMemo(() => formatTourDates(start, end), [start, end]);

  return (
    <div className="bg-black text-white">
      {/* HERO IMAGE */}
      <div className="relative h-[72vh] w-full overflow-hidden bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={heroImage}
          alt=""
          className="h-full w-full object-contain bg-black"
        />
      </div>

      {/* TEXT AREA (no bracket/explanatory text) */}
      <div className="px-4 py-5">
        <div className="mx-auto max-w-md">
          {loading ? (
            <div className="space-y-2">
              <div className="h-6 w-48 rounded bg-white/30" />
              <div className="h-4 w-64 rounded bg-white/20" />
            </div>
          ) : errorMsg ? (
            <div className="text-sm text-red-300">{errorMsg}</div>
          ) : (
            <>
              <div className="text-2xl font-extrabold leading-tight">{title}</div>
              <div className="mt-1 text-sm font-semibold text-white/80">
                {dateLabel || "Dates TBD"}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
