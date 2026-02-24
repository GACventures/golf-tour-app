// app/m/tours/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
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

const NZ_TOUR_2026_ID = "5a80b049-396f-46ec-965e-810e738471b6";
const NZ_TOUR_2026_HERO = "/tours/NZ26-logo.webp";

// Only this tour has PDFs for now
const PDF_TOUR_ID = NZ_TOUR_2026_ID;
const NOT_AVAILABLE_MESSAGE = "Document not available for this tour.";
const PDF_FILES = ["itinerary.pdf", "accommodation.pdf", "dining.pdf", "profiles.pdf", "comps.pdf"] as const;

// Interaction
const MIN_SCALE = 0.6;
const MAX_SCALE = 6.0;

// Debounced refine
const RERENDER_DEBOUNCE_MS = 140;
const RERENDER_THRESHOLD_RATIO = 1.20;

// Inertia
const INERTIA_FRICTION = 0.92;
const INERTIA_STOP_SPEED = 18;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
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

function titleFromFilename(filename: string) {
  return filename.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim();
}

function normalizePath(p: string) {
  return String(p ?? "").trim().replace(/\\/g, "/").toLowerCase();
}

type Pt = { x: number; y: number };

export default function MobileTourLandingPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tourId = (params?.id ?? "").trim();

  const [tour, setTour] = useState<TourRow | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [docs, setDocs] = useState<TourDocRow[]>([]);
  const [loading, setLoading] = useState(true);

  // PDF overlay state
  const [openingDocIdx, setOpeningDocIdx] = useState<number | null>(null);
  const [viewerTitle, setViewerTitle] = useState<string>("Document");
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const [rendering, setRendering] = useState<boolean>(false);

  // PDF.js
  const pdfjsRef = useRef<any>(null);
  const [pdfjsReady, setPdfjsReady] = useState(false);

  // DOM refs
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // PDF refs
  const pdfDocRef = useRef<any>(null);
  const pdfPageRef = useRef<any>(null);

  // Transform refs (interactive “map”)
  const scaleRef = useRef<number>(1);
  const txRef = useRef<number>(0);
  const tyRef = useRef<number>(0);

  // “World” size in CSS px (IMPORTANT: now stays constant)
  const worldWRef = useRef<number>(0);
  const worldHRef = useRef<number>(0);

  // Base CSS fit scale (used to render consistent CSS size)
  const baseCssScaleRef = useRef<number>(1);

  // Last quality render multiplier (so we don’t thrash)
  const lastQualityRef = useRef<number>(1);

  // Debounce timer
  const rerenderTimerRef = useRef<number | null>(null);

  // Pointers & gesture tracking
  const pointersRef = useRef<Map<number, Pt>>(new Map());
  const gestureRef = useRef<{
    mode: "none" | "pan" | "pinch";
    startScale: number;
    startTx: number;
    startTy: number;
    startDist: number;
    anchorWorld: Pt;
    vx: number;
    vy: number;
    lastMoveT: number;
    lastMid: Pt;
  }>({
    mode: "none",
    startScale: 1,
    startTx: 0,
    startTy: 0,
    startDist: 1,
    anchorWorld: { x: 0, y: 0 },
    vx: 0,
    vy: 0,
    lastMoveT: 0,
    lastMid: { x: 0, y: 0 },
  });

  const inertiaRafRef = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    async function loadPdfJs() {
      try {
        if (typeof window === "undefined") return;
        const mod: any = await import("pdfjs-dist");
        const lib = mod?.default ?? mod;
        lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        pdfjsRef.current = lib;
        if (alive) setPdfjsReady(true);
      } catch {
        if (alive) setPdfjsReady(false);
      }
    }
    loadPdfJs();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function loadAll() {
      setLoading(true);

      const [{ data: t }, { data: r }, { data: d }] = await Promise.all([
        supabase.from("tours").select("id,name,start_date,end_date,image_url").eq("id", tourId).single(),
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
    if (tourId === NZ_TOUR_2026_ID) return NZ_TOUR_2026_HERO;
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

  const stopInertia = useCallback(() => {
    if (inertiaRafRef.current != null) {
      cancelAnimationFrame(inertiaRafRef.current);
      inertiaRafRef.current = null;
    }
  }, []);

  const clearRerenderTimer = useCallback(() => {
    if (rerenderTimerRef.current != null) {
      window.clearTimeout(rerenderTimerRef.current);
      rerenderTimerRef.current = null;
    }
  }, []);

  const applyTransform = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${txRef.current}px, ${tyRef.current}px, 0) scale(${scaleRef.current})`;
  }, []);

  const getViewportRect = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return null;
    return vp.getBoundingClientRect();
  }, []);

  const clampToBounds = useCallback((nextTx: number, nextTy: number, nextScale: number) => {
    const vp = viewportRef.current;
    if (!vp) return { tx: nextTx, ty: nextTy };

    const vw = vp.clientWidth;
    const vh = vp.clientHeight;

    const worldW = worldWRef.current;
    const worldH = worldHRef.current;

    const scaledW = worldW * nextScale;
    const scaledH = worldH * nextScale;

    let minTx: number, maxTx: number, minTy: number, maxTy: number;

    if (scaledW <= vw) {
      minTx = maxTx = (vw - scaledW) / 2;
    } else {
      minTx = vw - scaledW;
      maxTx = 0;
    }

    if (scaledH <= vh) {
      minTy = maxTy = (vh - scaledH) / 2;
    } else {
      minTy = vh - scaledH;
      maxTy = 0;
    }

    return {
      tx: clamp(nextTx, minTx, maxTx),
      ty: clamp(nextTy, minTy, maxTy),
    };
  }, []);

  const worldFromScreen = useCallback((screenPt: Pt) => {
    const s = scaleRef.current;
    return {
      x: (screenPt.x - txRef.current) / s,
      y: (screenPt.y - tyRef.current) / s,
    };
  }, []);

  // --- NEW: render with fixed CSS size, variable internal resolution ---
  const renderPageAtQuality = useCallback(async (quality: number) => {
    const page = pdfPageRef.current;
    const canvas = canvasRef.current;
    if (!page || !canvas) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    // baseCssScale defines the CSS “world” size. It never changes after open.
    const baseCssScale = baseCssScaleRef.current;

    // renderScale controls bitmap resolution. Higher = sharper, but heavier.
    const renderScale = baseCssScale * quality * dpr;

    setRendering(true);
    try {
      const viewport = page.getViewport({ scale: renderScale });
      const ctx = canvas.getContext("2d")!;

      // Internal bitmap size
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);

      // Keep CSS size fixed to the “world” size (no overshoot!)
      const cssW = worldWRef.current;
      const cssH = worldHRef.current;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;

      lastQualityRef.current = quality;

      // after a redraw, clamp translation (world size unchanged, but still safe)
      const clamped = clampToBounds(txRef.current, tyRef.current, scaleRef.current);
      txRef.current = clamped.tx;
      tyRef.current = clamped.ty;
      applyTransform();
    } finally {
      setRendering(false);
    }
  }, [applyTransform, clampToBounds]);

  const scheduleRefine = useCallback(() => {
    clearRerenderTimer();

    rerenderTimerRef.current = window.setTimeout(async () => {
      rerenderTimerRef.current = null;

      // Decide desired quality from interactive scale (bigger zoom wants more quality)
      // Clamp so we don't make enormous canvases on mobile.
      const desired = clamp(scaleRef.current, 1, 3);

      const last = lastQualityRef.current;
      const ratio = desired > last ? desired / last : last / desired;
      if (ratio < RERENDER_THRESHOLD_RATIO) return;

      try {
        await renderPageAtQuality(desired);
      } catch {
        // ignore; open/close handles errors
      }
    }, RERENDER_DEBOUNCE_MS);
  }, [clearRerenderTimer, renderPageAtQuality]);

  const closeViewer = useCallback(() => {
    stopInertia();
    clearRerenderTimer();

    setViewerSrc(null);
    setRendering(false);

    pointersRef.current.clear();
    gestureRef.current.mode = "none";

    scaleRef.current = 1;
    txRef.current = 0;
    tyRef.current = 0;

    worldWRef.current = 0;
    worldHRef.current = 0;
    baseCssScaleRef.current = 1;
    lastQualityRef.current = 1;

    pdfDocRef.current = null;
    pdfPageRef.current = null;

    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, [clearRerenderTimer, stopInertia]);

  const renderPdfFirstPage = useCallback(
    async (src: string) => {
      const pdfjsLib = pdfjsRef.current;
      const canvas = canvasRef.current;
      if (!pdfjsLib || !canvas) return;

      setRendering(true);
      try {
        const loadingTask = pdfjsLib.getDocument(src);
        const pdf = await loadingTask.promise;
        pdfDocRef.current = pdf;

        const page = await pdf.getPage(1);
        pdfPageRef.current = page;

        // Choose a base CSS scale that fits width (world size)
        const vp = viewportRef.current;
        const vpW = vp?.clientWidth ?? 360;

        const raw = page.getViewport({ scale: 1 });
        const baseCssScale = clamp((vpW - 24) / raw.width, 0.7, 1.6);
        baseCssScaleRef.current = baseCssScale;

        // Set world size in CSS pixels based on baseCssScale
        const cssVp = page.getViewport({ scale: baseCssScale });
        worldWRef.current = cssVp.width;
        worldHRef.current = cssVp.height;

        // Initial render at quality=1 (will render with dpr internally)
        lastQualityRef.current = 1;
        await renderPageAtQuality(1);

        // Reset transform: center content
        if (vp) {
          const vw = vp.clientWidth;
          const vh = vp.clientHeight;

          scaleRef.current = 1;

          const scaledW = worldWRef.current;
          const scaledH = worldHRef.current;

          txRef.current = scaledW <= vw ? (vw - scaledW) / 2 : 0;
          tyRef.current = scaledH <= vh ? (vh - scaledH) / 2 : 0;

          applyTransform();
        }
      } catch {
        alert(NOT_AVAILABLE_MESSAGE);
        closeViewer();
      } finally {
        setRendering(false);
      }
    },
    [applyTransform, closeViewer, renderPageAtQuality]
  );

  useEffect(() => {
    if (!viewerSrc) return;
    requestAnimationFrame(() => {
      void renderPdfFirstPage(viewerSrc);
    });
  }, [viewerSrc, renderPdfFirstPage]);

  const openDocByIndex = useCallback(
    async (idx: number) => {
      if (tourId !== PDF_TOUR_ID) {
        alert(NOT_AVAILABLE_MESSAGE);
        return;
      }
      if (!pdfjsRef.current) {
        alert("PDF viewer not ready yet. Please try again.");
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

        const filenameKey = String(filename).toLowerCase();
        const match = docs.find(
          (d) => normalizePath(d.storage_path).endsWith(`/${filenameKey}`) || normalizePath(d.storage_path).endsWith(filenameKey)
        );
        const title = (match?.title ?? "").trim() || titleFromFilename(filename);

        stopInertia();
        clearRerenderTimer();

        setViewerTitle(title);
        setViewerSrc(routeUrl);
      } catch {
        alert(NOT_AVAILABLE_MESSAGE);
      } finally {
        setOpeningDocIdx(null);
      }
    },
    [tourId, docs, stopInertia, clearRerenderTimer]
  );

  const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

  const startInertia = useCallback(() => {
    const g = gestureRef.current;

    stopInertia();
    let lastT = performance.now();

    const tick = (t: number) => {
      const dt = Math.max(0.001, (t - lastT) / 1000);
      lastT = t;

      const speed = Math.hypot(g.vx, g.vy);
      if (speed < INERTIA_STOP_SPEED) {
        inertiaRafRef.current = null;
        return;
      }

      const nextTx = txRef.current + g.vx * dt;
      const nextTy = tyRef.current + g.vy * dt;

      const clamped = clampToBounds(nextTx, nextTy, scaleRef.current);
      txRef.current = clamped.tx;
      tyRef.current = clamped.ty;
      applyTransform();

      g.vx *= INERTIA_FRICTION;
      g.vy *= INERTIA_FRICTION;

      inertiaRafRef.current = requestAnimationFrame(tick);
    };

    inertiaRafRef.current = requestAnimationFrame(tick);
  }, [applyTransform, clampToBounds, stopInertia]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!viewerSrc) return;

      stopInertia();
      clearRerenderTimer();

      const rect = getViewportRect();
      if (!rect) return;

      const p: Pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      pointersRef.current.set(e.pointerId, p);

      try {
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      } catch {}

      const pts = Array.from(pointersRef.current.values());
      const g = gestureRef.current;

      if (pts.length === 1) {
        g.mode = "pan";
        g.startScale = scaleRef.current;
        g.startTx = txRef.current;
        g.startTy = tyRef.current;
        g.lastMoveT = performance.now();
        g.lastMid = pts[0];
        g.vx = 0;
        g.vy = 0;
      } else if (pts.length === 2) {
        g.mode = "pinch";
        g.startScale = scaleRef.current;
        g.startTx = txRef.current;
        g.startTy = tyRef.current;

        const mid = midpoint(pts[0], pts[1]);
        g.startDist = Math.max(1, distance(pts[0], pts[1]));
        g.anchorWorld = worldFromScreen(mid);

        g.lastMoveT = performance.now();
        g.lastMid = mid;
        g.vx = 0;
        g.vy = 0;
      }

      e.preventDefault();
    },
    [viewerSrc, stopInertia, clearRerenderTimer, getViewportRect, worldFromScreen]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!viewerSrc) return;

      const rect = getViewportRect();
      if (!rect) return;

      const p: Pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (!pointersRef.current.has(e.pointerId)) return;
      pointersRef.current.set(e.pointerId, p);

      const pts = Array.from(pointersRef.current.values());
      const g = gestureRef.current;
      const now = performance.now();

      if (pts.length === 1 && g.mode === "pan") {
        const cur = pts[0];
        const dx = cur.x - g.lastMid.x;
        const dy = cur.y - g.lastMid.y;

        const nextTx = txRef.current + dx;
        const nextTy = tyRef.current + dy;

        const clamped = clampToBounds(nextTx, nextTy, scaleRef.current);
        txRef.current = clamped.tx;
        tyRef.current = clamped.ty;

        const dtMs = Math.max(1, now - g.lastMoveT);
        g.vx = (dx * 1000) / dtMs;
        g.vy = (dy * 1000) / dtMs;

        g.lastMoveT = now;
        g.lastMid = cur;

        applyTransform();
      } else if (pts.length === 2) {
        if (g.mode !== "pinch") {
          g.mode = "pinch";
          g.startScale = scaleRef.current;
          g.startTx = txRef.current;
          g.startTy = tyRef.current;

          const mid = midpoint(pts[0], pts[1]);
          g.startDist = Math.max(1, distance(pts[0], pts[1]));
          g.anchorWorld = worldFromScreen(mid);

          g.lastMoveT = now;
          g.lastMid = mid;
          g.vx = 0;
          g.vy = 0;
        }

        const mid = midpoint(pts[0], pts[1]);
        const dist = Math.max(1, distance(pts[0], pts[1]));

        const raw = g.startScale * (dist / g.startDist);
        const nextScale = clamp(raw, MIN_SCALE, MAX_SCALE);

        let nextTx = mid.x - nextScale * g.anchorWorld.x;
        let nextTy = mid.y - nextScale * g.anchorWorld.y;

        const clamped = clampToBounds(nextTx, nextTy, nextScale);
        txRef.current = clamped.tx;
        tyRef.current = clamped.ty;
        scaleRef.current = nextScale;

        const dx = mid.x - g.lastMid.x;
        const dy = mid.y - g.lastMid.y;
        const dtMs = Math.max(1, now - g.lastMoveT);
        g.vx = (dx * 1000) / dtMs;
        g.vy = (dy * 1000) / dtMs;

        g.lastMoveT = now;
        g.lastMid = mid;

        applyTransform();
      }

      e.preventDefault();
    },
    [viewerSrc, getViewportRect, clampToBounds, applyTransform, worldFromScreen]
  );

  const endPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!viewerSrc) return;

      pointersRef.current.delete(e.pointerId);
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {}

      const pts = Array.from(pointersRef.current.values());
      const g = gestureRef.current;

      if (pts.length === 0) {
        const speed = Math.hypot(g.vx, g.vy);
        if (speed >= INERTIA_STOP_SPEED) startInertia();

        // refine after release (no overshoot now)
        scheduleRefine();
      } else if (pts.length === 1) {
        g.mode = "pan";
        g.lastMoveT = performance.now();
        g.lastMid = pts[0];
        g.vx = 0;
        g.vy = 0;
      }

      e.preventDefault();
    },
    [viewerSrc, scheduleRefine, startInertia]
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const vp = viewportRef.current;
      if (!vp) return;

      stopInertia();
      clearRerenderTimer();

      const mid: Pt = { x: vp.clientWidth / 2, y: vp.clientHeight / 2 };
      const anchor = worldFromScreen(mid);

      const nextScale = clamp(scaleRef.current * factor, MIN_SCALE, MAX_SCALE);
      let nextTx = mid.x - nextScale * anchor.x;
      let nextTy = mid.y - nextScale * anchor.y;

      const clamped = clampToBounds(nextTx, nextTy, nextScale);
      txRef.current = clamped.tx;
      tyRef.current = clamped.ty;
      scaleRef.current = nextScale;

      applyTransform();
      scheduleRefine();
    },
    [applyTransform, clampToBounds, clearRerenderTimer, stopInertia, scheduleRefine, worldFromScreen]
  );

  const zoomOut = useCallback(() => zoomBy(1 / 1.6), [zoomBy]);
  const zoomIn = useCallback(() => zoomBy(1.6), [zoomBy]);

  const baseBtn = "h-20 rounded-xl px-2 text-sm font-semibold flex items-center justify-center text-center leading-tight";
  const rowColors = ["bg-blue-100 text-gray-900", "bg-blue-200 text-gray-900", "bg-blue-300 text-gray-900", "bg-blue-400 text-white", "bg-blue-500 text-white", "bg-blue-600 text-white"];

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
          <div className="text-xs italic tracking-wide text-gray-400">Golf · Analytics · Competition</div>
        </div>
      </div>

      {viewerSrc && (
        <div className="fixed inset-0 z-50 bg-black">
          <div className="flex items-center justify-between px-4 py-3 bg-black/90">
            <div className="text-white text-sm font-semibold truncate">{viewerTitle}</div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={zoomOut} className="text-white text-sm px-3 py-2 rounded-lg border border-white/20" disabled={rendering}>
                −
              </button>
              <button type="button" onClick={zoomIn} className="text-white text-sm px-3 py-2 rounded-lg border border-white/20" disabled={rendering}>
                +
              </button>
              <button type="button" onClick={closeViewer} className="text-white text-sm px-3 py-2 rounded-lg border border-white/20">
                Close
              </button>
            </div>
          </div>

          <div
            ref={viewportRef}
            className="relative w-full h-[calc(100dvh-52px)] bg-white overflow-hidden"
            style={{ touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          >
            <div
              ref={contentRef}
              style={{
                transformOrigin: "0 0",
                willChange: "transform",
              }}
            >
              <canvas ref={canvasRef} className="block" />
            </div>

            {rendering ? (
              <div className="absolute right-3 bottom-3 bg-black/70 text-white text-xs px-2 py-1 rounded">
                Rendering…
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}