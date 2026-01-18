"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import MobileNav from "./_components/MobileNav";

type Tour = { id: string; name: string };

export default function TourLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ id?: string }>();
  const pathname = usePathname();

  const tourId = String(params?.id ?? "").trim();
  const [tourName, setTourName] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function loadTourName() {
      if (!tourId) return;

      const { data, error } = await supabase.from("tours").select("id,name").eq("id", tourId).single();

      if (cancelled) return;

      if (error) {
        setTourName("");
        return;
      }

      setTourName((data as Tour)?.name ?? "");
    }

    loadTourName();

    return () => {
      cancelled = true;
    };
  }, [tourId]);

  const homeHref = `/m/tours/${tourId}`;

  // Hide ONLY on the tour landing page (/m/tours/[id])
  const hideTopBarOnLanding = useMemo(() => {
    if (!tourId) return false;
    return pathname === `/m/tours/${tourId}`;
  }, [pathname, tourId]);

  // ✅ Focus mode for score entry page only:
  // /m/tours/[id]/rounds/[roundId]/scoring/score
  const isScoreEntryFocusMode = useMemo(() => {
    const p = String(pathname ?? "");
    // robust match: works even if query params exist elsewhere (pathname has none)
    return p.includes("/scoring/score");
  }, [pathname]);

  const hideTopBar = hideTopBarOnLanding || isScoreEntryFocusMode;
  const hideBottomNav = isScoreEntryFocusMode;

  return (
    <div className={isScoreEntryFocusMode ? "h-dvh bg-white overflow-hidden" : "min-h-dvh bg-white"}>
      {/* Top bar (hidden on landing page AND on score entry focus mode) */}
      {!hideTopBar && (
        <div className="sticky top-0 z-20 border-b bg-white/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-3">
            {/* Left: Tour name */}
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-gray-900">{tourName || "Tour"}</div>
            </div>

            {/* Right: Home link */}
            <Link
              href={homeHref}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-gray-800 hover:bg-gray-100 active:bg-gray-200"
            >
              Home
            </Link>
          </div>
        </div>
      )}

      {/* Content */}
      <main className={isScoreEntryFocusMode ? "h-dvh w-full p-0" : "mx-auto w-full max-w-md px-0 pb-20"}>
        {children}
      </main>

      {/* Bottom nav (hidden on score entry focus mode) */}
      {!hideBottomNav && <MobileNav />}
    </div>
  );
}
