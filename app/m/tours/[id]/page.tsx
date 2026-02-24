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

// ✅ New Zealand Golf Tour 2026 hero override
const NZ_TOUR_2026_ID = "5a80b049-396f-46ec-965e-810e738471b6";
const NZ_TOUR_2026_HERO = "/tours/NZ26-logo.webp";

// Only this tour has PDFs for now
const PDF_TOUR_ID = NZ_TOUR_2026_ID;
const NOT_AVAILABLE_MESSAGE = "Document not available for this tour.";

// IMPORTANT: order matches the buttons below (idx is button -> filename)
const PDF_FILES = ["itinerary.pdf", "accommodation.pdf", "dining.pdf", "profiles.pdf", "comps.pdf"] as const;

/** Map-like interaction tuning */
const MIN_SCALE = 0.6;
const MAX_SCALE = 6.0;

// How aggressively to re-render the PDF after interactive scaling
const RERENDER_DEBOUNCE_MS = 140;
// Only re-render if the interactive scale differs enough from last render scale
const RERENDER_THRESHOLD_RATIO = 1.25;

// Inertia tuning (optional nice-to-have)
const INERTIA_FRICTION = 0.92; // closer to 1 = longer glide
const INERTIA_STOP_SPEED = 18; // px/sec threshold to stop

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

// Prefer DB title that matches the clicked pdf filename, else fall back to filename-derived
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

  // PDF viewer state
  const [openingDocIdx, setOpeningDocIdx] = useState<number | null>(null);
  const [viewerTitle, setViewerTitle] = useState<string>("Document");
  const [viewerSrc, setViewerSrc] = useState<string | null>(null);
  const [rendering, setRendering] = useState<boolean>(false);

  // pdfjs
  const pdfjsRef = useRef<any>(null);
  const [pdfjsReady, setPdfjsReady] = useState(false);

  // Refs for DOM nodes
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // PDF state refs (avoid re-renders during pinch)
  const pdfDocRef = useRef<any>(null);
  const pdfPageRef = useRef<any>(null);

  // Transform refs (map-like)
  const scaleRef = useRef<number>(1);
  const txRef = useRef<number>(0);
  const tyRef = useRef<number>(0);

  // Canvas "world" size at last render (CSS pixels)
  const worldWRef = useRef<number>(0);
  const worldHRef = useRef<number>(0);

  // PDF render scale bookkeeping (so we only repaint when needed)
  const lastRenderScaleRef = useRef<number>(1);
  const rerenderTimerRef = useRef<number | null>(null);

  // Pointer tracking
  const pointersRef = useRef<Map<number, Pt>>(new Map());
  const gestureRef = useRef<{
    mode: "none" | "pan" | "pinch";
    startScale: number;
    startTx: number;
    startTy: number;
    startMid: Pt;
    startDist: number;
    // world-point under the gesture midpoint at start
    anchorWorld: Pt;
    // velocity for inertia (px/sec) in screen space
    vx: number;
    vy: number;
    lastMoveT: number;
    lastMid: Pt;
  }>({
    mode: "none",
    startScale: 1,
    startTx: 0,
    startTy: 0,
    startMid: { x: 0, y: 0 },
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

        // worker served from /public
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

  const heroImage = useMemo(() => {
    if (tourId === NZ_TOUR_2026_ID) return NZ_TOUR_2026_HERO;
    if ((tour?.name ?? "").trim() === KIWI_MADNESS_TOUR_NAME) return KIWI_MADNESS_HERO;
    if (tourId === PORTUGAL_TOUR_ID) return PORTUGAL_HERO;
    if (tourId === JAPAN_TOUR_ID) return JAPAN_HERO;
    return tour?.image_url?.trim() || DEFAULT_HERO;
  }, [tourId, tour?.image_url, tour?.name]);

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
    // Use translate3d for better compositing on mobile
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

    // If content smaller than viewport, center it (no drifting into blank space)
    let minTx: number, maxTx: number, minTy: number, maxTy: number;

    if (scaledW <= vw) {
      minTx = maxTx = (vw - scaledW) / 2;
    } else {
      // allow panning but keep at least edge visible
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

  const setTransformClamped = useCallback(
    (tx: number, ty: number, scale: number) => {
      const clamped = clampToBounds(tx, ty, scale);
      txRef.current = clamped.tx;
      tyRef.current = clamped.ty;
      scaleRef.current = scale;
      applyTransform();
    },
    [applyTransform, clampToBounds]
  );

  const worldFromScreen = useCallback((screenPt: Pt) => {
    // Convert a viewport-local screen point into "world" coords (canvas CSS pixels)
    const s = scaleRef.current;
    return {
      x: (screenPt.x - txRef.current) / s,
      y: (screenPt.y - tyRef.current) / s,
    };
  }, []);

  const scheduleRerenderIfNeeded = useCallback(() => {
    clearRerenderTimer();

    rerenderTimerRef.current = window.setTimeout(async () => {
      rerenderTimerRef.current = null;
      const page = pdfPageRef.current;
      const canvas = canvasRef.current;
      if (!page || !canvas) return;

      const target = scaleRef.current;
      const last = lastRenderScaleRef.current;

      // Only re-render if we drifted enough (prevents thrashing)
      const ratio = target > last ? target / last : last / target;
      if (ratio < RERENDER_THRESHOLD_RATIO) return;

      // Re-render at a scale closer to the current view scale,
      // but clamp to avoid huge canvases that blow memory on mobile.
      const renderScale = clamp(target, 0.7, 3.0);
      try {
        setRendering(true);

        const viewport = page.getViewport({ scale: renderScale });
        const ctx = canvas.getContext("2d")!;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        // Keep CSS size in CSS pixels (world units)
        worldWRef.current = viewport.width;
        worldHRef.current = viewport.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;

        lastRenderScaleRef.current = renderScale;

        // After world size changes, clamp current translate to bounds again
        const clamped = clampToBounds(txRef.current, tyRef.current, scaleRef.current);
        txRef.current = clamped.tx;
        tyRef.current = clamped.ty;
        applyTransform();
      } catch {
        // ignore; route failures handled elsewhere
      } finally {
        setRendering(false);
      }
    }, RERENDER_DEBOUNCE_MS);
  }, [applyTransform, clampToBounds, clearRerenderTimer]);

  const closeViewer = useCallback(() => {
    stopInertia();
    clearRerenderTimer();

    setViewerSrc(null);
    setRendering(false);

    // reset
    pointersRef.current.clear();
    gestureRef.current.mode = "none";

    scaleRef.current = 1;
    txRef.current = 0;
    tyRef.current = 0;

    lastRenderScaleRef.current = 1;
    worldWRef.current = 0;
    worldHRef.current = 0;

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

        // Render at a "base" scale that fits viewport width nicely.
        // We'll still allow interactive zoom via transforms.
        const vpEl = viewportRef.current;
        const vpW = vpEl?.clientWidth ?? 360;

        // Start with pdf scale 1, then fit to width (leaving small padding)
        const rawVp = page.getViewport({ scale: 1 });
        const fitScale = clamp((vpW - 24) / rawVp.width, 0.7, 1.6);
        const renderScale = fitScale;

        const viewport = page.getViewport({ scale: renderScale });

        const ctx = canvas.getContext("2d")!;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        // CSS size defines our "world" units
        worldWRef.current = viewport.width;
        worldHRef.current = viewport.height;
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport }).promise;

        lastRenderScaleRef.current = renderScale;

        // Reset transform: center content
        const vp = viewportRef.current;
        if (vp) {
          const vw = vp.clientWidth;
          const vh = vp.clientHeight;
          const s = 1; // interactive scale starts at 1
          scaleRef.current = s;

          const scaledW = worldWRef.current * s;
          const scaledH = worldHRef.current * s;

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
    [applyTransform, closeViewer]
  );

  // When viewerSrc opens, render once
  useEffect(() => {
    if (!viewerSrc) return;
    // wait a frame so the overlay DOM is mounted and viewport sizes are correct
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

        // Keep your existing HEAD check — route.ts below makes it reliable.
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

  // ---- Pointer math helpers ----
  const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

  const stopAndResetGesture = useCallback(() => {
    gestureRef.current.mode = "none";
    gestureRef.current.vx = 0;
    gestureRef.current.vy = 0;
  }, []);

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

      // friction
      g.vx *= INERTIA_FRICTION;
      g.vy *= INERTIA_FRICTION;

      inertiaRafRef.current = requestAnimationFrame(tick);
    };

    inertiaRafRef.current = requestAnimationFrame(tick);
  }, [applyTransform, clampToBounds, stopInertia]);

  // ---- Pointer handlers on the viewport ----
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only handle gestures when viewer is open
      if (!viewerSrc) return;

      stopInertia();
      clearRerenderTimer();

      const rect = getViewportRect();
      if (!rect) return;

      // Track pointer in viewport-local coords
      const p: Pt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      pointersRef.current.set(e.pointerId, p);

      try {
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      } catch {}

      const pts = Array.from(pointersRef.current.values());

      if (pts.length === 1) {
        // start pan
        const g = gestureRef.current;
        g.mode = "pan";
        g.startScale = scaleRef.current;
        g.startTx = txRef.current;
        g.startTy = tyRef.current;

        g.lastMoveT = performance.now();
        g.lastMid = pts[0];
        g.vx = 0;
        g.vy = 0;
      } else if (pts.length === 2) {
        // start pinch
        const g = gestureRef.current;
        g.mode = "pinch";
        g.startScale = scaleRef.current;
        g.startTx = txRef.current;
        g.startTy = tyRef.current;

        const mid = midpoint(pts[0], pts[1]);
        const dist = Math.max(1, distance(pts[0], pts[1]));

        g.startMid = mid;
        g.startDist = dist;

        // Anchor: world-point under the midpoint at start
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

      // We update transforms via rAF to avoid React state updates
      const now = performance.now();

      if (pts.length === 1 && g.mode === "pan") {
        const cur = pts[0];

        // delta in screen space
        const dx = cur.x - g.lastMid.x;
        const dy = cur.y - g.lastMid.y;

        const nextTx = txRef.current + dx;
        const nextTy = tyRef.current + dy;

        const clamped = clampToBounds(nextTx, nextTy, scaleRef.current);
        txRef.current = clamped.tx;
        tyRef.current = clamped.ty;

        // velocity for inertia
        const dtMs = Math.max(1, now - g.lastMoveT);
        g.vx = (dx * 1000) / dtMs;
        g.vy = (dy * 1000) / dtMs;

        g.lastMoveT = now;
        g.lastMid = cur;

        applyTransform();
      } else if (pts.length === 2) {
        // ensure pinch mode
        if (g.mode !== "pinch") {
          g.mode = "pinch";
          g.startScale = scaleRef.current;
          g.startTx = txRef.current;
          g.startTy = tyRef.current;

          const mid = midpoint(pts[0], pts[1]);
          const dist = Math.max(1, distance(pts[0], pts[1]));
          g.startMid = mid;
          g.startDist = dist;
          g.anchorWorld = worldFromScreen(mid);

          g.lastMoveT = now;
          g.lastMid = mid;
          g.vx = 0;
          g.vy = 0;
        }

        const mid = midpoint(pts[0], pts[1]);
        const dist = Math.max(1, distance(pts[0], pts[1]));

        // scale factor relative to pinch start
        const raw = g.startScale * (dist / g.startDist);
        const nextScale = clamp(raw, MIN_SCALE, MAX_SCALE);

        // Keep the anchored world-point under the current midpoint:
        // mid = T + S * anchorWorld  =>  T = mid - S*anchorWorld
        let nextTx = mid.x - nextScale * g.anchorWorld.x;
        let nextTy = mid.y - nextScale * g.anchorWorld.y;

        const clamped = clampToBounds(nextTx, nextTy, nextScale);
        nextTx = clamped.tx;
        nextTy = clamped.ty;

        scaleRef.current = nextScale;
        txRef.current = nextTx;
        tyRef.current = nextTy;

        // velocity from midpoint movement (for optional inertia after 2-finger pan)
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
        // Gesture ended completely
        const speed = Math.hypot(g.vx, g.vy);

        // Optional inertia after single-finger pan (or two-finger pan)
        if (speed >= INERTIA_STOP_SPEED) {
          startInertia();
        } else {
          stopAndResetGesture();
        }

        // Debounced high-res re-render if scale moved enough
        scheduleRerenderIfNeeded();
      } else if (pts.length === 1) {
        // Transition back to pan with remaining pointer
        const rect = getViewportRect();
        if (!rect) return;

        g.mode = "pan";
        g.lastMoveT = performance.now();
        g.lastMid = pts[0];
        g.vx = 0;
        g.vy = 0;
      }

      e.preventDefault();
    },
    [viewerSrc, getViewportRect, scheduleRerenderIfNeeded, startInertia, stopAndResetGesture]
  );

  // Buttons zoom +/- (still useful)
  const zoomBy = useCallback(
    (factor: number) => {
      const vp = viewportRef.current;
      if (!vp) return;

      stopInertia();
      clearRerenderTimer();

      const vw = vp.clientWidth;
      const vh = vp.clientHeight;
      const mid: Pt = { x: vw / 2, y: vh / 2 };

      const anchor = worldFromScreen(mid);

      const nextScale = clamp(scaleRef.current * factor, MIN_SCALE, MAX_SCALE);
      let nextTx = mid.x - nextScale * anchor.x;
      let nextTy = mid.y - nextScale * anchor.y;

      const clamped = clampToBounds(nextTx, nextTy, nextScale);
      nextTx = clamped.tx;
      nextTy = clamped.ty;

      scaleRef.current = nextScale;
      txRef.current = nextTx;
      tyRef.current = nextTy;
      applyTransform();

      scheduleRerenderIfNeeded();
    },
    [applyTransform, clampToBounds, clearRerenderTimer, stopInertia, scheduleRerenderIfNeeded, worldFromScreen]
  );

  const zoomOut = useCallback(() => zoomBy(1 / 1.6), [zoomBy]);
  const zoomIn = useCallback(() => zoomBy(1.6), [zoomBy]);

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

      <div className="relative h-[26vh] bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={heroImage} alt="" className="h-full w-full object-cover" />
      </div>

      <div className="mx-auto max-w-md px-4 pt-4 pb-6 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <button type="button" className={`${baseBtn} ${rowColors[0]}`} onClick={() => router.push(`/m/tours/${tourId}/rounds?mode=tee-times`)}>
            Daily
            <br />
            Tee times
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[0]}`} onClick={() => router.push(`/m/tours/${tourId}/rounds?mode=results`)}>
            Daily
            <br />
            Results
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[0]}`} onClick={() => router.push(`/m/tours/${tourId}/rounds?mode=score`)}>
            Score
            <br />
            Entry
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
            Matchplay
            <br />
            Format
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[2]}`} onClick={() => router.push(`/m/tours/${tourId}/matches/results`)}>
            Matchplay
            <br />
            Results
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[2]}`} onClick={() => router.push(`/m/tours/${tourId}/matches/leaderboard`)}>
            Matchplay
            <br />
            Leaderboard
          </button>

          <button type="button" className={`${baseBtn} ${rowColors[3]}`} onClick={() => router.push(`/m/tours/${tourId}/details`)}>
            Tour
            <br />
            Details
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[3]}`} onClick={() => router.push(`/m/tours/${tourId}/more/admin`)}>
            Tour
            <br />
            Admin
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
            {openingDocIdx === 3 ? (
              "Opening…"
            ) : (
              <>
                Player
                <br />
                Profiles
              </>
            )}
          </button>
          <button type="button" className={`${baseBtn} ${rowColors[5]} ${openingDocIdx === 4 ? "opacity-70" : ""}`} onClick={() => openDocByIndex(4)}>
            {openingDocIdx === 4 ? "Opening…" : "Comps etc"}
          </button>

          <button
            type="button"
            className="h-20 rounded-xl bg-gray-200 text-gray-800 text-sm font-semibold flex items-center justify-center text-center"
            onClick={() => router.push(`/m/tours/${tourId}/more/user-guide`)}
          >
            App
            <br />
            User Guide
          </button>
        </div>

        <div className="pt-6 text-center">
          <div className="text-sm font-semibold text-gray-300">Built by GAC Ventures</div>
          <div className="text-xs italic tracking-wide text-gray-400">Golf · Analytics · Competition</div>
        </div>
      </div>

      {/* PDF overlay: map-like pinch + pan */}
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
            className="w-full h-[calc(100dvh-52px)] bg-white overflow-hidden"
            // Critical: prevents iOS/Android native panning/zooming and allows us to handle pointer moves.
            style={{ touchAction: "none" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
          >
            {/* The "content" layer that gets transformed like a map */}
            <div
              ref={contentRef}
              style={{
                transformOrigin: "0 0",
                willChange: "transform",
              }}
            >
              {/* canvas CSS size defines world units; internal resolution is set by PDF.js render */}
              <canvas ref={canvasRef} className="block" />
            </div>

            {/* Optional rendering indicator */}
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