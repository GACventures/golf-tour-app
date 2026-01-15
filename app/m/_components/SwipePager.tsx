"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  /** 0-based index (e.g. current hole index) */
  index: number;
  /** total pages (e.g. 18 holes) */
  count: number;
  /** called when user swipes to a different index */
  onChangeIndex: (nextIndex: number) => void;

  /** animation duration in ms (make it feel “slower / obvious”) */
  durationMs?: number;

  /** minimum swipe distance in px to trigger change */
  swipeThresholdPx?: number;

  /** the full-page content for the current index */
  children: React.ReactNode;
};

export default function SwipePager({
  index,
  count,
  onChangeIndex,
  durationMs = 600,
  swipeThresholdPx = 60,
  children,
}: Props) {
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);
  const dragging = useRef(false);

  const [dx, setDx] = useState(0); // live drag offset
  const [animating, setAnimating] = useState(false);
  const [animDir, setAnimDir] = useState<-1 | 0 | 1>(0); // -1 left, +1 right
  const [pendingIndex, setPendingIndex] = useState<number | null>(null);

  const canGoPrev = index > 0;
  const canGoNext = index < count - 1;

  const easing = useMemo(
    () => "cubic-bezier(0.22, 1, 0.36, 1)", // smooth iOS-like
    []
  );

  // Prevent weird “scroll + swipe” interactions while dragging horizontally.
  useEffect(() => {
    function onTouchMove(e: TouchEvent) {
      if (!dragging.current) return;
      // If we decided it's a horizontal gesture, prevent page scroll.
      // We only do this once the gesture is clearly horizontal (see handler).
      // Here, we keep it as an extra guard.
      e.preventDefault();
    }

    // Important: passive must be false to allow preventDefault.
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => window.removeEventListener("touchmove", onTouchMove as any);
  }, []);

  function clamp(next: number) {
    return Math.max(0, Math.min(count - 1, next));
  }

  function onPointerDown(clientX: number, clientY: number) {
    if (animating) return;
    startX.current = clientX;
    startY.current = clientY;
    dragging.current = true;
    setDx(0);
  }

  function onPointerMove(clientX: number, clientY: number) {
    if (!dragging.current || startX.current === null || startY.current === null) return;

    const deltaX = clientX - startX.current;
    const deltaY = clientY - startY.current;

    // Decide if this is horizontal swipe.
    // If user is scrolling vertically, don't hijack.
    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (absY > absX && absY > 8) {
      // treat as vertical scroll; cancel swipe tracking
      dragging.current = false;
      setDx(0);
      return;
    }

    // horizontal drag: allow
    setDx(deltaX);
  }

  function finishSwipe() {
    if (!dragging.current) return;
    dragging.current = false;

    const delta = dx;

    // Decide direction: swipe left means next page (delta negative)
    const wantsNext = delta < -swipeThresholdPx;
    const wantsPrev = delta > swipeThresholdPx;

    if (wantsNext && canGoNext) {
      // animate current page sliding left out
      setAnimating(true);
      setAnimDir(-1);
      setPendingIndex(clamp(index + 1));
      // drive transform to -100% width (we’ll use translateX)
      setDx(-window.innerWidth); // approximate full width
      return;
    }

    if (wantsPrev && canGoPrev) {
      setAnimating(true);
      setAnimDir(1);
      setPendingIndex(clamp(index - 1));
      setDx(window.innerWidth);
      return;
    }

    // Not enough: snap back
    setAnimating(true);
    setAnimDir(0);
    setPendingIndex(null);
    setDx(0);
  }

  // When animation finishes, commit the index change (if any), then reset.
  useEffect(() => {
    if (!animating) return;

    const t = window.setTimeout(() => {
      if (pendingIndex !== null) {
        onChangeIndex(pendingIndex);
      }
      setAnimating(false);
      setAnimDir(0);
      setPendingIndex(null);
      setDx(0);
    }, durationMs);

    return () => window.clearTimeout(t);
  }, [animating, pendingIndex, onChangeIndex, durationMs]);

  // Styles:
  // - While dragging: no transition, translate by dx
  // - On finish: transition to either full width or 0 (snap back)
  const style: React.CSSProperties = {
    transform: `translateX(${dx}px)`,
    transition: animating ? `transform ${durationMs}ms ${easing}` : "none",
    willChange: "transform",
    touchAction: "pan-y", // allow vertical scroll; we handle horizontal ourselves
  };

  return (
    <div
      style={style}
      onTouchStart={(e) => {
        const t = e.touches[0];
        onPointerDown(t.clientX, t.clientY);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        onPointerMove(t.clientX, t.clientY);
      }}
      onTouchEnd={() => finishSwipe()}
      onTouchCancel={() => finishSwipe()}
    >
      {children}
    </div>
  );
}
