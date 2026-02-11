"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type MoreTab = "details" | "rehandicapping" | "admin";

type MidRowKey = "userGuide" | "blank2" | "blank3";

type TourDocRow = {
  id: string;
  tour_id: string;
  doc_key: string;
  title: string;
  storage_bucket: string;
  storage_path: string;
  sort_order: number;
};

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function MobileMorePage() {
  const params = useParams();
  const router = useRouter();

  const tourId = (params?.id as string) || "";

  // Row 1: starts active (black)
  const [activeTop, setActiveTop] = useState<MoreTab>("details");

  const [docs, setDocs] = useState<TourDocRow[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docsError, setDocsError] = useState<string>("");

  const pillBase = "flex-1 h-10 rounded-xl border text-sm font-semibold flex items-center justify-center";
  const pillActive = "border-gray-900 bg-gray-900 text-white";
  const pillIdle = "border-gray-200 bg-white text-gray-900";
  const pillDisabled = "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed";

  // ✅ Correct bucket name
  const PDF_BUCKET = "tours-pdfs";

  const topItems = useMemo(
    () =>
      [
        { key: "details" as const, label: "Tour details", href: `/m/tours/${tourId}/details` },
        { key: "rehandicapping" as const, label: "Rehandicapping", href: `/m/tours/${tourId}/more/rehandicapping` },
        { key: "admin" as const, label: "Tour Admin", href: `/m/tours/${tourId}/more/admin` },
      ] as const,
    [tourId]
  );

  const midItems = useMemo(
    () =>
      [
        { key: "userGuide" as const, label: "App User Guide", href: `/m/tours/${tourId}/more/user-guide`, disabled: false },
        { key: "blank2" as const, label: "", href: "", disabled: true },
        { key: "blank3" as const, label: "", href: "", disabled: true },
      ] as const,
    [tourId]
  );

  function onPickTop(key: MoreTab) {
    setActiveTop(key);
    const item = topItems.find((x) => x.key === key);
    if (!item) return;
    router.push(item.href);
  }

  function onPickMid(key: MidRowKey) {
    const item = midItems.find((x) => x.key === key);
    if (!item || item.disabled) return;
    router.push(item.href);
  }

  // Load docs for this tour
  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    let alive = true;

    async function loadDocs() {
      setLoadingDocs(true);
      setDocsError("");

      try {
        const { data, error } = await supabase
          .from("tour_documents")
          .select("id,tour_id,doc_key,title,storage_bucket,storage_path,sort_order")
          .eq("tour_id", tourId)
          .order("sort_order", { ascending: true });

        if (error) throw error;

        // Force bucket to correct one; keep DB path
        const rows = ((data ?? []) as any[]).map((x) => ({
          id: String(x.id),
          tour_id: String(x.tour_id),
          doc_key: String(x.doc_key),
          title: String(x.title),
          storage_bucket: PDF_BUCKET,
          storage_path: String(x.storage_path ?? ""),
          sort_order: Number(x.sort_order ?? 0),
        })) as TourDocRow[];

        if (!alive) return;
        setDocs(rows);
      } catch (e: any) {
        if (!alive) return;
        setDocsError(e?.message ?? "Failed to load tour documents.");
        setDocs([]);
      } finally {
        if (!alive) return;
        setLoadingDocs(false);
      }
    }

    void loadDocs();

    return () => {
      alive = false;
    };
  }, [tourId]);

  function normalizeStoragePath(p: string) {
    const path = String(p ?? "").trim().replace(/^\/+/, "");
    if (!path) return "";

    // If objects were uploaded under "tours/tours/<tourId>/...", fix missing extra "tours/"
    // - If DB says: tours/<tourId>/file.pdf
    // - But storage object is: tours/tours/<tourId>/file.pdf
    // then adjust.
    if (path.startsWith(`tours/${tourId}/`)) {
      return `tours/tours/${tourId}/${path.slice(`tours/${tourId}/`.length)}`;
    }

    return path;
  }

  async function openDoc(doc: TourDocRow) {
    const bucket = PDF_BUCKET;

    // Use normalized path for safety
    const rawPath = String(doc.storage_path ?? "").trim();
    const path = normalizeStoragePath(rawPath);

    if (!path) {
      alert("This document has no storage path.");
      return;
    }

    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 10); // 10 minutes
    if (error) {
      alert(error.message || "Failed to open document.");
      return;
    }

    const url = data?.signedUrl;
    if (!url) {
      alert("No URL returned.");
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  // 5 PDF buttons in 2 rows: 3 + 2 (with placeholders)
  const docsRow1 = docs.slice(0, 3);
  const docsRow2 = docs.slice(3, 5);

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">More</div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 pt-4 space-y-3">
        {/* Row 1 */}
        <div className="flex gap-2">
          {topItems.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => onPickTop(it.key)}
              className={`${pillBase} ${activeTop === it.key ? pillActive : pillIdle}`}
            >
              {it.label}
            </button>
          ))}
        </div>

        {/* ✅ NEW Row 2 (3 buttons) */}
        <div className="flex gap-2">
          {midItems.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => onPickMid(it.key)}
              disabled={it.disabled}
              className={`${pillBase} ${it.disabled ? pillDisabled : pillIdle}`}
              aria-label={it.label || "Placeholder button"}
            >
              {it.label}
            </button>
          ))}
        </div>

        {/* Documents header */}
        <div className="rounded-2xl border border-gray-200 bg-white p-3">
          <div className="text-xs font-semibold text-gray-700">Tour PDFs</div>
          <div className="mt-1 text-[11px] text-gray-500">
            {loadingDocs
              ? "Loading documents..."
              : docsError
              ? docsError
              : docs.length
              ? `Tap to open (bucket: ${PDF_BUCKET})`
              : "No documents attached to this tour."}
          </div>
        </div>

        {/* PDF buttons */}
        <div className="space-y-2">
          <div className="flex gap-2">
            {docsRow1.map((d) => (
              <button key={d.id} type="button" onClick={() => openDoc(d)} className={`${pillBase} ${pillIdle}`}>
                {d.title}
              </button>
            ))}

            {Array.from({ length: Math.max(0, 3 - docsRow1.length) }).map((_, i) => (
              <button
                key={`ph1-${i}`}
                type="button"
                disabled
                className={`${pillBase} ${pillDisabled}`}
                aria-label="Placeholder button"
              >
                &nbsp;
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            {docsRow2.map((d) => (
              <button key={d.id} type="button" onClick={() => openDoc(d)} className={`${pillBase} ${pillIdle}`}>
                {d.title}
              </button>
            ))}

            {Array.from({ length: Math.max(0, 3 - docsRow2.length) }).map((_, i) => (
              <button
                key={`ph2-${i}`}
                type="button"
                disabled
                className={`${pillBase} ${pillDisabled}`}
                aria-label="Placeholder button"
              >
                &nbsp;
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
