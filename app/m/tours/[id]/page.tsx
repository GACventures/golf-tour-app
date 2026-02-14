"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

// PDF.js (build-safe worker served from /public)
import * as pdfjsLib from "pdfjs-dist";

(pdfjsLib as any).GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

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

// Only this tour has PDFs for now
const PDF_TOUR_ID = "5a80b049-396f-46ec-965e-810e738471b6";
const NOT_AVAILABLE_MESSAGE = "Document not available for this tour.";

const PDF_FILES = [
  "itinerary.pdf",
  "accommodation.pdf",
  "dining.pdf",
  "profiles.pdf",
  "comps.pdf",
] as const;

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
  const tourId = (params?.id ?? "").trim();

  const [tour, setTour] = useState<TourRow | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [docs, setDocs] = useState<TourDocRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [openingDocIdx, setOpeningDocIdx] = useState<number | null>(null);
  const [viewerTitle, setViewerTitle] = useState<string>("Document");
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1.0);
  const [rendering, setRendering] = useState<boolean>(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const closeViewer = useCallback(() => {
    setViewerSrc(null);
    setZoom(1.0);
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadAll() {
      setLoading(true);

      const [{ data: t }, { data: r }, { data: d }] = await Promise.all([
        supabase
          .from("tours")
          .select("id,name,start_date,end_date,image_url")
          .eq("id", tourId)
          .single(),
        supabase.from("rounds").select("id,tour_id,played_on").eq("tour_id", tourId),
        supabase
          .from("tour_documents")
          .select("id,tour_id,title,storage_bucket,storage_path,sort_order")
          .eq("tour_id", tourId)
          .order("sort_order", { ascending: true }),
      ]);

      if (!alive) return;

      setTour(t as TourRow);
      setRounds((r ?? []) as RoundRow[]);
      setDocs((d ?? []) as TourDocRow[]);
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

  // Load + render first page whenever viewerSrc or zoom changes
  useEffect(() => {
    let cancelled = false;

    async function loadAndRender() {
      if (!viewerSrc || !canvasRef.current) return;

      setRendering(true);

      try {
        const loadingTask = (pdfjsLib as any).getDocument(viewerSrc);
        const pdf = await loadingTask.promise;
        if (cancelled) return;

        const page = await pdf.getPage(1);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: zoom });
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const renderTask = page.render({ canvasContext: ctx, viewport });
        await renderTask.promise;
      } catch {
        alert(NOT_AVAILABLE_MESSAGE);
        closeViewer();
      } finally {
        if (!cancelled) setRendering(false);
      }
    }

    loadAndRender();

    return () => {
      cancelled = true;
    };
  }, [viewerSrc, zoom, closeViewer]);

  const openDocByIndex = useCallback(
    async (idx: number) => {
      if (tourId !== PDF_TOUR_ID) {
        alert(NOT_AVAILABLE_MESSAGE);
        return;
      }

      const filename = PDF_FILES[idx];
      if (!filename) {
        alert(NOT_AVAILABLE_MESSAGE);
        return;
      }

      setOpeningDocIdx(idx);

      try {
        const routeUrl = `/m/tours/${tourId}/pdf/${encodeURIComponent(filename)}`;
        const head = await fetch(routeUrl, { method: "HEAD", cache: "no-store" });
        if (!head.ok) {
          alert(NOT_AVAILABLE_MESSAGE);
          return;
        }

        const fallbackTitle = filename.replace(".pdf", "");
        const title = docs?.[idx]?.title?.trim() || fallbackTitle;

        setViewerTitle(title);
        setZoom(1.0);
        setViewerSrc(routeUrl);
      } catch {
        alert(NOT_AVAILABLE_MESSAGE);
      } finally {
        setOpeningDocIdx(null);
      }
    },
    [tourId, docs]
  );

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
          <button type="button" className={`${baseBtn} ${rowColors[0]}`} onClick={() => router.push(`/m/tours/${tourId}/rounds?mode=tee-times`)}>
            Daily<br />Tee times
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[0]}`} onClick={() => router.push(`/m/tours/${tourId}/rounds?mode=results`)}>
            Daily<br />Results
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[0]}`} onClick={() => router.push(`/m/tours/${tourId}/rounds?mode=score`)}>
            Score<br />Entry
          </button>

          <button type="button" className={`${baseBtn} ${rowColors[1]}`} onClick={() => router.push(`/m/tours/${tourId}/leaderboards`)}>
            Leaderboards
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[1]}`} onClick={() => router.push(`/m/tours/${tourId}/competitions`)}>
            Competitions
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[1]}`} onClick={() => router.push(`/m/tours/${tourId}/stats`)}>
            Stats
          </button>

          <button type="button" className={`${baseBtn} ${rowColors[2]}`} onClick={() => router.push(`/m/tours/${tourId}/matches/format`)}>
            Matchplay<br />Format
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[2]}`} onClick={() => router.push(`/m/tours/${tourId}/matches/results`)}>
            Matchplay<br />Results
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[2]}`} onClick={() => router.push(`/m/tours/${tourId}/matches/leaderboard`)}>
            Matchplay<br />Leaderboard
          </button>

          <button type="button" className={`${baseBtn} ${rowColors[3]}`} onClick={() => router.push(`/m/tours/${tourId}/details`)}>
            Tour<br />Details
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[3]}`} onClick={() => router.push(`/m/tours/${tourId}/more/admin`)}>
            Tour<br />Admin
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[3]}`} onClick={() => router.push(`/m/tours/${tourId}/more/rehandicapping`)}>
            Rehandicapping
          </button>

          <button type="button" className={`${baseBtn} ${rowColors[4]} ${openingDocIdx === 0 ? "opacity-70" : ""}`} onClick={() => openDocByIndex(0)}>
            {openingDocIdx === 0 ? "Opening…" : "Itinerary"}
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[4]} ${openingDocIdx === 1 ? "opacity-70" : ""}`} onClick={() => openDocByIndex(1)}>
            {openingDocIdx === 1 ? "Opening…" : "Accommodation"}
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[4]} ${openingDocIdx === 2 ? "opacity-70" : ""}`} onClick={() => openDocByIndex(2)}>
            {openingDocIdx === 2 ? "Opening…" : "Dining"}
          </button>

          <button type="button" className={`${baseBtn} ${rowColors[5]} ${openingDocIdx === 3 ? "opacity-70" : ""}`} onClick={() => openDocByIndex(3)}>
            {openingDocIdx === 3 ? "Opening…" : <>Player<br />Profiles</>}
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[5]} ${openingDocIdx === 4 ? "opacity-70" : ""}`} onClick={() => openDocByIndex(4)}>
            {openingDocIdx === 4 ? "Opening…" : "Comps etc"}
          </button>

          <button
            type="button"
            className="h-20 rounded-xl bg-gray-200 text-gray-800 text-sm font-semibold flex items-center justify-center text-center"
            onClick={() => router.push(`/m/tours/${tourId}/more/user-guide`)}
          >
            App<br />User Guide
          </button>
        </div>

        <div className="pt-6 text-center">
          <div className="text-sm font-semibold text-gray-300">Built by GAC Ventures</div>
          <div className="text-xs italic tracking-wide text-gray-400">
            Golf · Analytics · Competition
          </div>
        </div>
      </div>

      {viewerSrc && (
        <div className="fixed inset-0 z-50 bg-black">
          <div className="flex items-center justify-between px-4 py-3 bg-black/90">
            <div className="text-white text-sm font-semibold truncate">{viewerTitle}</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.6, Number((z - 0.2).toFixed(2))))}
                className="text-white text-sm px-3 py-2 rounded-lg border border-white/20"
                disabled={rendering}
              >
                −
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(3.0, Number((z + 0.2).toFixed(2))))}
                className="text-white text-sm px-3 py-2 rounded-lg border border-white/20"
                disabled={rendering}
              >
                +
              </button>
              <button
                type="button"
                onClick={closeViewer}
                className="text-white text-sm px-3 py-2 rounded-lg border border-white/20"
              >
                Close
              </button>
            </div>
          </div>

          <div className="w-full h-[calc(100dvh-52px)] bg-white overflow-auto">
            <div className="min-h-full flex justify-center">
              <canvas ref={canvasRef} className="block" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
