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
    // Fail loudly and deterministically in dev if env vars are missing
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createClient(url, anon);
}

export default function MobileTourLandingPage() {
  const params = useParams<{ id: string }>();
  const tourId = params?.id ?? "";

  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [openingKey, setOpeningKey] = useState<PdfKey | null>(null);

  const openPdf = useCallback(
    async (filename: string, key: PdfKey) => {
      // Rule 1: only this one tour can ever open PDFs (hard-coded for now)
      if (tourId !== PDF_TOUR_ID) {
        alert(NOT_AVAILABLE_MESSAGE);
        return;
      }

      setOpeningKey(key);

      try {
        // Exact required path structure:
        // tours/tours/<tourId>/<filename>.pdf
        const path = `tours/tours/${tourId}/${filename}`;

        // Must use getPublicUrl (no signed URLs)
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
        const publicUrl = data?.publicUrl;

        if (!publicUrl) {
          alert(NOT_AVAILABLE_MESSAGE);
          return;
        }

        // Deterministic existence check:
        // If file does not exist (or not publicly readable), HEAD will fail.
        const head = await fetch(publicUrl, { method: "HEAD", cache: "no-store" });
        if (!head.ok) {
          alert(NOT_AVAILABLE_MESSAGE);
          return;
        }

        // Open in new tab (exact requirement)
        window.open(publicUrl, "_blank", "noopener,noreferrer");
      } catch {
        alert(NOT_AVAILABLE_MESSAGE);
      } finally {
        setOpeningKey(null);
      }
    },
    [supabase, tourId]
  );

  // Simple mobile-first layout; buttons 13–17 are the PDF buttons section
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
              onClick={() => openPdf(b.filename, b.key)}
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
    </main>
  );
}
