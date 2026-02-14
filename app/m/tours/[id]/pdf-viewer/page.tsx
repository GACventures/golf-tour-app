"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";

const NOT_AVAILABLE_MESSAGE = "Document not available for this tour.";

export default function PdfViewerPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const tourId = (params?.id ?? "").trim();
  const file = (searchParams.get("file") ?? "").trim();
  const title = (searchParams.get("title") ?? "Document").trim();

  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const src = useMemo(() => {
    if (!tourId || !file) return "";
    return `/m/tours/${tourId}/pdf/${encodeURIComponent(file)}`;
  }, [tourId, file]);

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!src) return;

      const res = await fetch(src, { method: "GET", cache: "no-store" });
      if (!res.ok) {
        alert(NOT_AVAILABLE_MESSAGE);
        router.back();
        return;
      }

      const blob = await res.blob();
      const type = (blob.type || "").toLowerCase();
      if (!type.includes("pdf")) {
        alert(NOT_AVAILABLE_MESSAGE);
        router.back();
        return;
      }

      const url = URL.createObjectURL(blob);
      if (!alive) {
        URL.revokeObjectURL(url);
        return;
      }
      setBlobUrl(url);
    }

    load();

    return () => {
      alive = false;
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [src, router]);

  return (
    <div className="min-h-dvh bg-black">
      <div className="flex items-center justify-between px-4 py-3 bg-black/90">
        <div className="text-white text-sm font-semibold truncate">{title}</div>
        <button
          type="button"
          onClick={() => router.back()}
          className="text-white text-sm px-3 py-2 rounded-lg border border-white/20"
        >
          Back
        </button>
      </div>

      <div className="h-[calc(100dvh-52px)] bg-white">
        {!blobUrl ? (
          <div className="h-full flex items-center justify-center text-sm text-black/60">
            Loading…
          </div>
        ) : (
          <>
            {/* Prefer embed for native PDF controls/zoom where supported */}
            <embed src={blobUrl} type="application/pdf" className="w-full h-full" />
            {/* Fallback (some browsers ignore embed) */}
            <iframe title={title} src={blobUrl} className="w-full h-full hidden" />
          </>
        )}
      </div>
    </div>
  );
}
