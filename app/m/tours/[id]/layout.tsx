"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import PlayerPageTracker from "./_components/PlayerPageTracker";

type TourRow = {
  id: string;
  name: string | null;
};

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function TourLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id?: string }>();
  const pathname = usePathname();

  const tourId = useMemo(() => String(params?.id ?? "").trim(), [params]);

  const isLandingPage = useMemo(() => {
    if (!tourId) return false;
    const base = `/m/tours/${tourId}`;
    return pathname === base || pathname === `${base}/`;
  }, [pathname, tourId]);

  const isScoreEntryPage = useMemo(() => {
    if (!tourId) return false;

    const base = `/m/tours/${tourId}/rounds/`;
    if (!pathname.startsWith(base)) return false;

    const rest = pathname.slice(base.length);
    const parts = rest.split("/").filter(Boolean);

    if (parts.length < 3) return false;

    const [roundId, a, leaf] = parts;

    if (!roundId || !isLikelyUuid(roundId)) return false;
    if (a !== "scoring") return false;

    return leaf === "score" || leaf === "score-alt";
  }, [pathname, tourId]);

  const [tourName, setTourName] = useState<string>("Tour");
  const [loadErr, setLoadErr] = useState<string>("");

  useEffect(() => {
    let alive = true;

    async function loadTourName() {
      setLoadErr("");

      if (!tourId || !isLikelyUuid(tourId)) {
        setTourName("Tour");
        return;
      }

      try {
        const { data, error } = await supabase.from("tours").select("id,name").eq("id", tourId).maybeSingle();
        if (error) throw error;

        const name = String((data as TourRow | null)?.name ?? "").trim();
        if (!alive) return;

        setTourName(name || "Tour");
      } catch (e: any) {
        if (!alive) return;
        setTourName("Tour");
        setLoadErr(e?.message ?? "Failed to load tour.");
      }
    }

    void loadTourName();
    return () => {
      alive = false;
    };
  }, [tourId]);

  if (isScoreEntryPage) {
    return (
      <>
        <PlayerPageTracker />
        {children}
      </>
    );
  }

  const FOOTER_PX = 76;

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      <PlayerPageTracker />

      {!isLandingPage ? (
        <div className="sticky top-0 z-20 border-b bg-white">
          <div className="mx-auto w-full max-w-md px-4 h-14 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-slate-900">{tourName}</div>
              {loadErr ? <div className="truncate text-xs text-red-600">{loadErr}</div> : null}
            </div>

            <Link className="shrink-0 text-sm font-semibold text-slate-900" href={`/m/tours/${tourId}`}>
              Home
            </Link>
          </div>
        </div>
      ) : null}

      <div style={!isLandingPage ? { paddingBottom: FOOTER_PX } : undefined}>{children}</div>

      {!isLandingPage ? (
        <footer className="fixed bottom-0 left-0 right-0 z-30 bg-white">
          <div className="border-t border-slate-200">
            <div className="mx-auto w-full max-w-md px-4 py-3 text-center">
              <div className="font-bold text-sm text-slate-900">Built by GAC Ventures</div>
              <div className="italic text-sm text-slate-700">Golf - Analytics - Competition</div>
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}