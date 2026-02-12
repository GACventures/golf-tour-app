"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type TourRow = {
  id: string;
  name: string | null;
};

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function TourLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id?: string }>();
  const tourId = useMemo(() => String(params?.id ?? "").trim(), [params]);

  const [tourName, setTourName] = useState<string>("Tour");
  const [loadErr, setLoadErr] = useState<string>("");

  useEffect(() => {
    let alive = true;

    async function loadTourName() {
      setLoadErr("");

      // If route param is not present/valid, don't crash the whole section.
      if (!tourId || !isLikelyUuid(tourId)) {
        setTourName("Tour");
        return;
      }

      try {
        const { data, error } = await supabase
          .from("tours")
          .select("id,name")
          .eq("id", tourId)
          .maybeSingle();

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

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      {/* Top bar (sticky) */}
      <div className="sticky top-0 z-20 border-b bg-white">
        <div className="mx-auto w-full max-w-md px-4 h-14 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-slate-900">{tourName}</div>
            {loadErr ? <div className="truncate text-xs text-red-600">{loadErr}</div> : null}
          </div>

          {/* Home should go to your tour landing page.
              If your actual Home route is different, change this href. */}
          <Link className="shrink-0 text-sm font-semibold text-slate-900" href={`/m/tours/${tourId}`}>
            Home
          </Link>
        </div>
      </div>

      {/* Page content */}
      {children}
    </div>
  );
}
