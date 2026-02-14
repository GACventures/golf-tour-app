"use client";

import React, { useCallback, useState } from "react";
import { useParams } from "next/navigation";

const PDF_TOUR_ID = "5a80b049-396f-46ec-965e-810e738471b6";
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

export default function MobileTourLandingPage() {
  const params = useParams<{ id: string }>();
  const tourId = (params?.id ?? "").trim();

  const [openingKey, setOpeningKey] = useState<PdfKey | null>(null);

  // Full-screen in-app PDF viewer state (opens automatically in this tab)
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerTitle, setViewerTitle] = useState<string>("Document");

  const closeViewer = useCallback(() => {
    setViewerUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const openPdf = useCallback(
    async (filename: string, key: PdfKey, label: string) => {
      if (tourId !== PDF_TOUR_ID) {
        alert(NOT_AVAILABLE_MESSAGE);
        return;
      }

      setOpeningKey(key);

      try {
        // Fetch from SAME-ORIGIN proxy route (your Vercel domain)
        const res = await fetch(
          `/m/tours/${tourId}/pdf/${encodeURIComponent(filename)}`,
          { method: "GET", cache: "no-store" }
        );

        if (!res.ok) {
          alert(NOT_AVAILABLE_MESSAGE);
          return;
        }

        const blob = await res.blob();

        // Must be a PDF (avoid rendering an error page as a blob)
        const type = (blob.type || "").toLowerCase();
        if (!type.includes("pdf")) {
          alert(NOT_AVAILABLE_MESSAGE);
          return;
        }

        // Clean up any prior blob URL to avoid leaks
        setViewerUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return prev;
        });

        const url = URL.createObjectURL(blob);
        setViewerTitle(label);
        setViewerUrl(url);
      } catch {
        alert(NOT_AVAILABLE_MESSAGE);
      } finally {
        setOpeningKey(null);
      }
    },
    [tourId]
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

      {/* Auto-open in this tab: full-screen PDF viewer */}
      {viewerUrl && (
        <div className="fixed inset-0 z-50 bg-black">
          <div className="flex items-center justify-between px-4 py-3 bg-black/90">
            <div className="text-white text-sm font-semibold truncate">{viewerTitle}</div>
            <button
              type="button"
              onClick={closeViewer}
              className="text-white text-sm px-3 py-2 rounded-lg border border-white/20"
            >
              Close
            </button>
          </div>

          <iframe
            title={viewerTitle}
            src={viewerUrl}
            className="w-full h-[calc(100dvh-52px)] bg-white"
          />
        </div>
      )}
    </main>
  );
}
