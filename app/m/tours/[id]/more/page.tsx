"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type MoreTab = "details" | "rehandicapping" | "admin";

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

const PDF_BUCKET = "tours-pdfs";

function cleanPath(p: string) {
  return String(p ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/");
}

function isObjectNotFound(errMsg: string) {
  const m = String(errMsg ?? "").toLowerCase();
  return m.includes("object not found") || m.includes("not found");
}

// If DB has: tours/<tourId>/file.pdf
// but Storage has: tours/tours/<tourId>/file.pdf
function altToursToursPath(path: string) {
  const p = cleanPath(path);

  // already tours/tours/...
  if (p.startsWith("tours/tours/")) return p;

  // if tours/<something> -> tours/tours/<something>
  if (p.startsWith("tours/")) return `tours/${p}`;

  // if <something> -> tours/tours/<something> (last resort)
  return `tours/tours/${p}`;
}

export default function MobileMorePage() {
  const params = useParams();
  const router = useRouter();

  const tourId = (params?.id as string) || "";

  const [activeTop, setActiveTop] = useState<MoreTab>("details");

  const [docs, setDocs] = useState<TourDocRow[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [docsError, setDocsError] = useState<string>("");

  const [opening, setOpening] = useState<string>("");

  const pillBase = "flex-1 h-10 rounded-xl border text-sm font-semibold flex items-center justify-center";
  const pillActive = "border-gray-900 bg-gray-900 text-white";
  const pillIdle = "border-gray-200 bg-white text-gray-900";
  const pillDisabled = "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed";

  const topItems = useMemo(
    () =>
      [
        { key: "details" as const, label: "Tour details", href: `/m/tours/${tourId}/details` },
        { key: "rehandicapping" as const, label: "Rehandicapping", href: `/m/tours/${tourId}/more/rehandicapping` },
        { key: "admin" as const, label: "Tour Admin", href: `/m/tours/${tourId}/more/admin` },
      ] as const,
    [tourId]
  );

  function onPickTop(key: MoreTab) {
    setActiveTop(key);
    const item = topItems.find((x) => x.key === key);
    if (!item) return;
    router.push(item.href);
  }

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

        const rows = ((data ?? []) as any[]).map((x) => ({
          id: String(x.id),
          tour_id: String(x.tour_id),
          doc_key: String(x.doc_key),
          title: String(x.title),
          storage_bucket: PDF_BUCKET, // force correct bucket
          storage_path: cleanPath(String(x.storage_path)),
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

  async function createSignedUrlWithFallback(path: string) {
    const primary = cleanPath(path);
    const fallback = altToursToursPath(primary);

    // Try primary first
    const r1 = await supabase.storage.from(PDF_BUCKET).createSignedUrl(primary, 60 * 10);
    if (!r1.error && r1.data?.signedUrl) return { url: r1.data.signedUrl, usedPath: primary };

    // If it wasn't "not found", fail immediately
    if (r1.error && !isObjectNotFound(r1.error.message)) {
      throw new Error(`Failed to open PDF: ${r1.error.message}`);
    }

    // Retry with tours/tours/...
    const r2 = await supabase.storage.from(PDF_BUCKET).createSignedUrl(fallback, 60 * 10);
    if (r2.error || !r2.data?.signedUrl) {
      const msg = r2.error?.message || "Object not found.";
      throw new Error(`Failed to open PDF.\nTried:\n- ${primary}\n- ${fallback}\n\nError: ${msg}`);
    }

    return { url: r2.data.signedUrl, usedPath: fallback };
  }

  async function openDoc(doc: TourDocRow) {
    const path = cleanPath(String(doc.storage_path ?? ""));
    if (!path) {
      alert("This document has no storage path.");
      return;
    }

    setOpening(`Opening: ${doc.title}…`);

    try {
      const { url } = await createSignedUrlWithFallback(path);

      // Most reliable on mobile/desktop: open in same tab
      window.location.href = url;
    } catch (e: any) {
      alert(e?.message ?? "Failed to open document.");
      setOpening("");
    }
  }

  const docsRow1 = docs.slice(0, 3);
  const docsRow2 = docs.slice(3, 5);

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">More</div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 pt-4 space-y-3">
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

        <div className="rounded-2xl border border-gray-200 bg-white p-3">
          <div className="text-xs font-semibold text-gray-700">Tour PDFs</div>
          <div className="mt-1 text-[11px] text-gray-500">
            {opening
              ? opening
              : loadingDocs
              ? "Loading documents..."
              : docsError
              ? docsError
              : docs.length
              ? `Tap to open (bucket: ${PDF_BUCKET})`
              : "No documents attached to this tour."}
          </div>
        </div>

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
