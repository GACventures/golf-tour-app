"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type TourRow = {
  id: string;
  name: string | null;
  start_date: string | null;
  end_date: string | null;
  image_url?: string | null;
};

type RoundRow = {
  id: string;
  tour_id: string;
  played_on: string | null;
};

const DEFAULT_HERO = "/tours/tour-landing-hero-cartoon.webp";

const JAPAN_TOUR_ID = "a2d8ba33-e0e8-48a6-aff4-37a71bf29988";
const JAPAN_HERO = "/tours/japan-poster_mobile_1080w.webp";

const PORTUGAL_TOUR_ID = "b5e5b90d-0ae5-4be5-a3cd-3ef1c73cb6b5";
const PORTUGAL_HERO = "/tours/portugal_poster_hero.png";

const KIWI_MADNESS_TOUR_NAME = "Kiwi Madness Tour";
const KIWI_MADNESS_HERO = "/tours/golf-hero-celebration.webp";

/**
 * ✅ START-FROM-SCRATCH PDF CONFIG
 * 1) Create a brand-new PUBLIC bucket in Supabase Storage with this exact name:
 */
const PDF_BUCKET = "tours-pdfs-v2";

/**
 * 2) Only THIS tour is expected to have PDFs.
 *    For every other tour, we show "Document not available for this tour."
 */
const TOUR_WITH_PDFS_ID = "5a80b049-396f-46ec-965e-810e738471b6";

/**
 * 3) Upload PDFs under:
 *    tours/tours/<tourId>/<filename>.pdf
 */
function pdfPath(tourId: string, filename: string) {
  return `tours/tours/${tourId}/${filename}`;
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

export default function MobileTourLandingPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tourId = params?.id ?? "";

  const [tour, setTour] = useState<TourRow | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function loadAll() {
      setLoading(true);

      const [{ data: t }, { data: r }] = await Promise.all([
        supabase.from("tours").select("id,name,start_date,end_date,image_url").eq("id", tourId).single(),
        supabase.from("rounds").select("id,tour_id,played_on").eq("tour_id", tourId),
      ]);

      if (!alive) return;

      setTour((t ?? null) as TourRow | null);
      setRounds((r ?? []) as RoundRow[]);
      setLoading(false);
    }

    if (tourId) loadAll();
    return () => {
      alive = false;
    };
  }, [tourId]);

  const heroImage = useMemo(() => {
    if ((tour?.name ?? "").trim() === KIWI_MADNESS_TOUR_NAME) return KIWI_MADNESS_HERO;
    if (tourId === PORTUGAL_TOUR_ID) return PORTUGAL_HERO;
    if (tourId === JAPAN_TOUR_ID) return JAPAN_HERO;
    return tour?.image_url?.trim() || DEFAULT_HERO;
  }, [tourId, tour?.image_url, tour?.name]);

  const derivedDates = useMemo(() => {
    const played = rounds.map((r) => r.played_on).filter(Boolean) as string[];
    if (!played.length) return { start: null, end: null };
    played.sort();
    return { start: played[0], end: played[played.length - 1] };
  }, [rounds]);

  const start = parseDate(tour?.start_date || derivedDates.start);
  const end = parseDate(tour?.end_date || derivedDates.end);
  const dateLabel = formatTourDates(start, end);

  function openPdf(filename: string) {
    // Only one tour has PDFs (by design for this reset)
    if (!tourId || tourId !== TOUR_WITH_PDFS_ID) {
      alert("Document not available for this tour.");
      return;
    }

    const path = pdfPath(tourId, filename);
    const { data } = supabase.storage.from(PDF_BUCKET).getPublicUrl(path);
    const url = data?.publicUrl;

    if (!url) {
      alert("Unable to open document.");
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  const baseBtn =
    "h-20 rounded-xl px-2 text-sm font-semibold flex items-center justify-center text-center leading-tight";

  const rowColors = [
    "bg-blue-100 text-gray-900",
    "bg-blue-200 text-gray-900",
    "bg-blue-300 text-gray-900",
    "bg-blue-400 text-white",
    "bg-blue-500 text-white",
    "bg-blue-600 text-white",
  ];

  return (
    <div className="min-h-dvh bg-black text-white">
      <div className="px-4 pt-4 pb-3 max-w-md mx-auto">
        {loading ? (
          <div className="h-6 w-48 bg-white/30 rounded" />
        ) : (
          <>
            <div className="text-2xl font-extrabold">{tour?.name || "Tour"}</div>
            <div className="text-sm text-white/80">{dateLabel || "Dates TBD"}</div>
          </>
        )}
      </div>

      <div className="relative h-[26vh] bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={heroImage} alt="" className="h-full w-full object-cover" />
      </div>

      <div className="mx-auto max-w-md px-4 pt-4 pb-6 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <button className={`${baseBtn} ${rowColors[0]}`} onClick={() => router.push(`/m/tours/${tourId}/rounds?mode=tee-times`)}>
            Daily<br />Tee times
          </button>
          <button className={`${baseBtn} ${rowColors[0]}`} onClick={() => router.push(`/m/tours/${tourId}/rounds?mode=results`)}>
            Daily<br />Results
          </button>
          <button className={`${baseBtn} ${rowColors[0]}`} onClick={() => router.push(`/m/tours/${tourId}/rounds?mode=score`)}>
            Score<br />Entry
          </button>

          <button className={`${baseBtn} ${rowColors[1]}`} onClick={() => router.push(`/m/tours/${tourId}/leaderboards`)}>
            Leaderboards
          </button>
          <button className={`${baseBtn} ${rowColors[1]}`} onClick={() => router.push(`/m/tours/${tourId}/competitions`)}>
            Competitions
          </button>
          <button className={`${baseBtn} ${rowColors[1]}`} onClick={() => router.push(`/m/tours/${tourId}/stats`)}>
            Stats
          </button>

          <button className={`${baseBtn} ${rowColors[2]}`} onClick={() => router.push(`/m/tours/${tourId}/matches/format`)}>
            Matchplay<br />Format
          </button>
          <button className={`${baseBtn} ${rowColors[2]}`} onClick={() => router.push(`/m/tours/${tourId}/matches/results`)}>
            Matchplay<br />Results
          </button>
          <button className={`${baseBtn} ${rowColors[2]}`} onClick={() => router.push(`/m/tours/${tourId}/matches/leaderboard`)}>
            Matchplay<br />Leaderboard
          </button>

          <button className={`${baseBtn} ${rowColors[3]}`} onClick={() => router.push(`/m/tours/${tourId}/details`)}>
            Tour<br />Details
          </button>
          <button className={`${baseBtn} ${rowColors[3]}`} onClick={() => router.push(`/m/tours/${tourId}/more/admin`)}>
            Tour<br />Admin
          </button>
          <button className={`${baseBtn} ${rowColors[3]}`} onClick={() => router.push(`/m/tours/${tourId}/more/rehandicapping`)}>
            Rehandicapping
          </button>

          {/* Buttons 13–17 (fresh start) */}
          <button className={`${baseBtn} ${rowColors[4]}`} onClick={() => openPdf("itinerary.pdf")}>
            Itinerary
          </button>
          <button className={`${baseBtn} ${rowColors[4]}`} onClick={() => openPdf("accommodation.pdf")}>
            Accommodation
          </button>
          <button className={`${baseBtn} ${rowColors[4]}`} onClick={() => openPdf("dining.pdf")}>
            Dining
          </button>

          <button className={`${baseBtn} ${rowColors[5]}`} onClick={() => openPdf("profiles.pdf")}>
            Player<br />Profiles
          </button>
          <button className={`${baseBtn} ${rowColors[5]}`} onClick={() => openPdf("comps.pdf")}>
            Comps etc
          </button>

          <button
            className="h-20 rounded-xl bg-gray-200 text-gray-800 text-sm font-semibold flex items-center justify-center text-center"
            onClick={() => router.push(`/m/tours/${tourId}/more/user-guide`)}
          >
            App<br />User Guide
          </button>
        </div>

        <div className="pt-6 text-center">
          <div className="text-sm font-semibold text-gray-300">Built by GAC Ventures</div>
          <div className="text-xs italic tracking-wide text-gray-400">Golf · Analytics · Competition</div>
        </div>
      </div>
    </div>
  );
}
