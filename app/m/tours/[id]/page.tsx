"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
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

function openInNewTab(url: string) {
  // Most reliable: user-gesture anchor click (works better than async window.open in many mobile/prod cases)
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();

  // Also attempt window.open (your original requirement). If blocked, anchor still handles it.
  window.open(url, "_blank", "noopener,noreferrer");
}

export default function MobileTourLandingPage() {
  const params = useParams<{ id: string }>();
  const tourId = params?.id ?? "";

  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [openingKey, setOpeningKey] = useState<PdfKey | null>(null);
  const [availableFiles, setAvailableFiles] = useState<Set<string>>(new Set());

  // ✅ Key change vs your previous attempts:
  // Pre-check file existence ONCE (via Storage list) so button clicks stay synchronous (no await before opening).
  useEffect(() => {
    let cancelled = false;

    async function loadAvailableFiles() {
      // For any other tour: treat as "no PDFs"
      if (tourId !== PDF_TOUR_ID) {
        setAvailableFiles(new Set());
        return;
      }

      const prefix = `tours/tours/${tourId}`; // folder path (no trailing slash required)
      const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
        limit: 100,
        sortBy: { column: "name", order: "asc" },
      });

      if (cancelled) return;

      if (error || !data) {
        setAvailableFiles(new Set());
        return;
      }

      // data is a list of objects in that folder; we only need names like "itinerary.pdf"
      setAvailableFiles(new Set(data.map((x) => x.name)));
    }

    loadAvailableFiles();

    return () => {
      cancelled = true;
    };
  }, [supabase, tourId]);

  const onPdfClick = useCallback(
    (filename: string, key: PdfKey) => {
      // Rule 1: only this tour can open PDFs
      if (tourId !== PDF_TOUR_ID) {
        alert(NOT_AVAILABLE_MESSAGE);
        return;
      }

      // Rule 2: if file doesn't exist -> alert
      if (!availableFiles.has(filename)) {
        alert(NOT_AVAILABLE_MESSAGE);
        return;
      }

      setOpeningKey(key);

      try {
        const path = `tours/tours/${tourId}/${filename}`;
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
        const publicUrl = data?.publicUrl;

        if (!publicUrl) {
          alert(NOT_AVAILABLE_MESSAGE);
          return;
        }

        // ✅ Synchronous open (no awaits), avoids popup blocking behaviour you saw on Vercel/mobile
        openInNewTab(publicUrl);
      } finally {
        setOpeningKey(null);
      }
    },
    [availableFiles, supabase, tourId]
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
          PDFs open only for the hard-coded PDF tour. All others show an alert.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3">
        {PDF_BUTTONS.map((b) => {
          const isOpening = openingKey === b.key;

          return (
            <button
              key={b.key}
              type="button"
              onClick={() => onPdfClick(b.filename, b.key)}
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
