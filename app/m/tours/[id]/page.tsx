"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type TourRow = {
  id: string;
  name: string | null;
  start_date: string | null; // YYYY-MM-DD
  end_date: string | null; // YYYY-MM-DD
  image_url?: string | null;
};

type RoundRow = {
  id: string;
  tour_id: string;
  played_on: string | null; // YYYY-MM-DD
};

const DEFAULT_HERO = "/tours/tour-landing-hero-cartoon.webp";

// ✅ Japan “Swing in Spring” tour (mobile landing hero override)
const JAPAN_TOUR_ID = "a2d8ba33-e0e8-48a6-aff4-37a71bf29988";
const JAPAN_HERO = "/tours/japan-poster_mobile_1080w.webp";

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
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadTourAndRounds() {
      setLoading(true);
      setErrorMsg("");

      try {
        const [{ data: tData, error: tErr }, { data: rData, error: rErr }] =
          await Promise.all([
            supabase
              .from("tours")
              .select("id, name, start_date, end_date, image_url")
              .eq("id", tourId)
              .single(),
            supabase
              .from("rounds")
              .select("id, tour_id, played_on")
              .eq("tour_id", tourId),
          ]);

        if (!alive) return;

        if (tErr) throw new Error(tErr.message);
        if (rErr) throw new Error(rErr.message);

        setTour(tData as TourRow);
        setRounds((rData ?? []) as RoundRow[]);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load tour.");
        setTour(null);
        setRounds([]);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    if (tourId) loadTourAndRounds();
    else {
      setErrorMsg("Missing tour id in route.");
      setLoading(false);
    }

    return () => {
      alive = false;
    };
  }, [tourId]);

  const title = tour?.name?.trim() || "Tour";

  // ✅ Hero selection:
  // - Japan tour: always use local hero override (public/)
  // - Otherwise: tour image_url if present, else default
  const heroImage = useMemo(() => {
    if (tourId === JAPAN_TOUR_ID) return JAPAN_HERO;
    const t = (tour?.image_url ?? "").trim();
    return t ? t : DEFAULT_HERO;
  }, [tourId, tour?.image_url]);

  // Default dates from rounds.played_on if tour dates not set
  const derived = useMemo(() => {
    const played = rounds
      .map((r) => (r.played_on ? String(r.played_on) : null))
      .filter(Boolean) as string[];

    if (!played.length)
      return { start: null as string | null, end: null as string | null };

    played.sort(); // ISO date strings sort correctly
    return { start: played[0] ?? null, end: played[played.length - 1] ?? null };
  }, [rounds]);

  const effectiveStartStr = (tour?.start_date ?? "").trim() || derived.start;
  const effectiveEndStr = (tour?.end_date ?? "").trim() || derived.end;

  const start = useMemo(
    () => parseDate(effectiveStartStr ?? null),
    [effectiveStartStr]
  );
  const end = useMemo(
    () => parseDate(effectiveEndStr ?? null),
    [effectiveEndStr]
  );
  const dateLabel = useMemo(() => formatTourDates(start, end), [start, end]);

  return (
    <div className="bg-black text-white">
      {/* TOP TEXT AREA (moved above hero image) */}
      <div className="px-4 py-4">
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
              <div className="text-2xl font-extrabold leading-tight">
                {title}
              </div>
              <div className="mt-1 text-sm font-semibold text-white/80">
                {dateLabel || "Dates TBD"}
              </div>
            </>
          )}
        </div>
      </div>

      {/* HERO IMAGE */}
      <div className="relative h-[72vh] w-full overflow-hidden bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={heroImage}
          alt=""
          className="h-full w-full object-contain bg-black"
        />
      </div>
    </div>
  );
}
