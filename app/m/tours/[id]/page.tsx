"use client";

import React, { useCallback, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const PDF_TOUR_ID = "5a80b049-396f-46ec-965e-810e738471b6";
const BUCKET = "tours-pdfs-v2";
const NOT_AVAILABLE_MESSAGE = "Document not available for this tour.";

type PdfKey = "itinerary" | "accommodation" | "dining" | "profiles" | "comps";

const PDF_BUTTONS: Array<{
  key: PdfKey;
  label: string;
  filename: string;
}> = [
  { key: "itinerary", label: "Itinerary", filename: "itinerary.pdf" },
  { key: "accommodation", label: "Accommodation", filename: "accommodation.pdf" },
  { key: "dining", label: "Dining", filename: "dining.pdf" },
  { key: "profiles", label: "Player Profiles", filename: "profiles.pdf" },
  { key: "comps", label: "Comps etc", filename: "comps.pdf" },
];

function getSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }
  return createClient(url, anon);
}

export default function MobileTourLandingPage() {
  const params = useParams<{ id: string }>();
  const tourId = params?.id ?? "";

  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [openingKey, setOpeningKey] = useState<PdfKey | null>(null);

  // When we have a valid URL, we show a full-screen "tap to open" overlay.
  // This avoids popup blockers because the final navigation is a direct user tap.
  const [docUrl, setDocUrl] = useState<string | null>(null);
  const [docLabel, setDocLabel] = useState<string>("Document");

  const closeOverlay = useCallback(() => {
    setDocUrl(null);
  }, []);

  const openPdf = useCallback(
    async (filename: string, key: PdfKey, label: string) => {
      // Rule 1: only one tour has PDFs
      if (tourId !== PDF_TOUR_ID) {
        alert(NOT_AVAILABLE_MESSAGE);
        return;
      }

      setOpeningKey(key);

      try {
        const path = `tours/tours/${tourId}/${filename}`;

        // Required: getPublicUrl (no signed URLs)
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
        const publicUrl = data?.publicUrl;

        if (!publicUrl) {
          alert(NOT_AVAILABLE_MESSAGE);
          return;
        }

        // Required: if file does not exist -> alert
        const head = await fetch(publicUrl, { method: "HEAD", cache: "no-store" });
        if (!head.ok) {
          alert(NOT_AVAILABLE_MESSAGE);
          return;
        }

        // Show overlay; user taps an actual link (most reliable on mobile).
        setDocLabel(label);
        setDocUrl(publicUrl);

        // Also attempt immediate open (works in some environments)
        window.open(publicUrl, "_blank", "noopener,noreferrer");
      } catch {
        alert(NOT_AVAILABLE_MESSAGE);
      } finally {
        setOpeningKey(null);
      }
    },
    [supabase, tourId]
  );

  return (
    <main className="min-h-dvh w-full px-4 py-4">
      <header className="mb-4">
        <h1 className="text-xl font-semibold">Tour</h1>
        <p className="text-sm opacity-70 break-all">Tour ID: {tourId}</p>
      </header>

      <section className="mb-4 rounded-xl border p-3">
        <p className="text-sm font-medium">Documents (Buttons 13–17)</p>
        <p className="text-xs opacity-70 mt-1">
          Opens PDFs only for the hard-coded PDF tour. All other tours show an alert.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        {PDF_BUTTONS.map((b) => {
          const isOpening = openingKey === b.key;

          return (
            <button
              key={b.key}
              type="button"
              onClick={() => openPdf(b.filename, b.key, b.label)}
              disabled={isOpening}
              className="rounded-2xl border px-4 py-4 text-left active:scale-[0.99] disabled:opacity-60"
            >
              <div className="text-base font-semibold">{b.label}</div>
              <div className="mt-1 text-xs opacity-70">
                {isOpening ? "Opening…" : b.filename}
              </div>
            </button>
          );
        })}
      </section>

      {/* Full-screen overlay with a real link the user taps */}
      {docUrl && (
        <div className="fixed inset-0 z-50 bg-black/95">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div className="text-white text-sm font-semibold truncate">{docLabel}</div>
            <button
              type="button"
              onClick={closeOverlay}
              className="text-white text-sm px-3 py-2 rounded-lg border border-white/20"
            >
              Close
            </button>
          </div>

          <div className="px-4 py-6">
            <p className="text-white/80 text-sm mb-4">
              Tap below to open the document.
            </p>

            {/* This is the key: user-initiated navigation */}
            <a
              href={docUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full text-center rounded-2xl bg-white text-black font-semibold py-4"
            >
              Open {docLabel}
            </a>

            {/* Same-tab fallback (some in-app browsers block new tabs) */}
            <a
              href={docUrl}
              className="block w-full text-center rounded-2xl border border-white/20 text-white font-semibold py-4 mt-3"
            >
              Open in this tab
            </a>

            <p className="text-white/60 text-xs mt-4 break-all">
              {docUrl}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
