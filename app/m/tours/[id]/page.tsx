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

type TourDocRow = {
  id: string;
  tour_id: string;
  title: string;
  storage_bucket: string;
  storage_path: string;
  sort_order: number;
};

const DEFAULT_HERO = "/tours/tour-landing-hero-cartoon.webp";

const JAPAN_TOUR_ID = "a2d8ba33-e0e8-48a6-aff4-37a71bf29988";
const JAPAN_HERO = "/tours/japan-poster_mobile_1080w.webp";

const PORTUGAL_TOUR_ID = "b5e5b90d-0ae5-4be5-a3cd-3ef1c73cb6b5";
const PORTUGAL_HERO = "/tours/portugal_poster_hero.png";

const KIWI_MADNESS_TOUR_NAME = "Kiwi Madness Tour";
const KIWI_MADNESS_HERO = "/tours/golf-hero-celebration.webp";

// ✅ single source of truth for bucket name
const PDF_BUCKET = "tours-pdfs";

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

function normalizeStoragePath(p: string, tourId: string) {
  const path = String(p ?? "").trim().replace(/^\/+/, "");
  if (!path) return "";

  // If DB says: tours/<tourId>/file.pdf
  // but storage is: tours/tours/<tourId>/file.pdf
  if (path.startsWith(`tours/${tourId}/`)) {
    return `tours/tours/${tourId}/${path.slice(`tours/${tourId}/`.length)}`;
  }

  return path;
}

export default function MobileTourLandingPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tourId = params?.id ?? "";

  const [tour, setTour] = useState<TourRow | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [docs, setDocs] = useState<TourDocRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;

    async function loadAll() {
      setLoading(true);

      const [{ data: t, error: tErr }, { data: r, error: rErr }, { data: d, error: dErr }] = await Promise.all([
        supabase.from("tours").select("id,name,start_date,end_date,image_url").eq("id", tourId).single(),
        supabase.from("rounds").select("id,tour_id,played_on").eq("tour_id", tourId),
        supabase
          .from("tour_documents")
          .select("id,tour_id,title,storage_bucket,storage_path,sort_order")
          .eq("tour_id", tourId)
          .order("sort_order", { ascending: true }),
      ]);

      if (!alive) return;

      // Tour/rounds can still render even if docs query fails
      if (!tErr) setTour(t as TourRow);
      if (!rErr) setRounds((r ?? []) as RoundRow[]);

      if (!dErr) {
        // ✅ Force bucket to known constant regardless of DB contents
        const cleanedDocs: TourDocRow[] = (d ?? []).map((x: any) => ({
          id: String(x.id),
          tour_id: String(x.tour_id),
          title: String(x.title ?? "").trim() || "Document",
          storage_bucket: PDF_BUCKET,
          storage_path: String(x.storage_path ?? "").trim(),
          sort_order: Number(x.sort_order ?? 0),
        }));
        setDocs(cleanedDocs);
      } else {
        setDocs([]);
      }

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

  async function openDocByIndex(idx: number) {
    const doc = docs[idx];
    if (!doc) {
      alert("Document not available for this tour.");
      return;
    }

    const rawPath = String(doc.storage_path ?? "").trim();
    const path = normalizeStoragePath(rawPath, tourId);

    if (!path) {
      alert("Document not available for this tour.");
      return;
    }

    // ✅ Buckets are public, so public URL is simplest + avoids signed-url/bucket confusion
    // If public URL doesn't exist (file missing), we fall back to signed URL attempt.
    const publicRes = supabase.storage.from(PDF_BUCKET).getPublicUrl(path);
    const publicUrl = publicRes?.data?.publicUrl;

    if (publicUrl) {
      window.open(publicUrl, "_blank", "noopener,noreferrer");
      return;
    }

    // Fallback: signed URL
    const { data, error } = await supabase.storage.from(PDF_BUCKET).createSignedUrl(path, 600);
    if (error || !data?.signedUrl) {
      alert(error?.message || "Unable to open document.");
      return;
    }

    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  const baseBtn = "h-20 rounded-xl px-2 text-sm font-semibold flex items-center justify-center text-center leading-tight";

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

      {/* Landscape hero */}
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

          <button className={`${baseBtn} ${rowColors[4]}`} onClick={() => openDocByIndex(0)}>
            Itinerary
          </button>
          <button className={`${baseBtn} ${rowColors[4]}`} onClick={() => openDocByIndex(1)}>
            Accommodation
          </button>
          <button className={`${baseBtn} ${rowColors[4]}`} onClick={() => openDocByIndex(2)}>
            Dining
          </button>

          <button className={`${baseBtn} ${rowColors[5]}`} onClick={() => openDocByIndex(3)}>
            Player<br />Profiles
          </button>
          <button className={`${baseBtn} ${rowColors[5]}`} onClick={() => openDocByIndex(4)}>
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
