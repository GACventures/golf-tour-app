// app/m/tours/[id]/more/page.tsx
"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type TopTab = "details" | "rehandicapping" | "blank";

export default function MobileMorePage() {
  const params = useParams();
  const router = useRouter();

  const tourId = (params?.id as string) || "";

  const [tab, setTab] = useState<TopTab>("details");

  const tabs = useMemo(
    () =>
      [
        { key: "details" as const, label: "Tour details", href: `/m/tours/${tourId}/details` },
        { key: "rehandicapping" as const, label: "Rehandicapping", href: `/m/tours/${tourId}/rehandicapping` },
        { key: "blank" as const, label: "", href: "" },
      ] as const,
    [tourId]
  );

  function go(next: TopTab) {
    setTab(next);

    const t = tabs.find((x) => x.key === next);
    if (!t) return;

    // Blank button does nothing (placeholder)
    if (!t.href) return;

    router.push(t.href);
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      {/* Sticky header with 3 buttons (Rounds-style) */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            {tabs.map((t) => {
              const isActive = tab === t.key;
              const isBlank = t.key === "blank";

              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => go(t.key)}
                  disabled={isBlank}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold border ${
                    isBlank
                      ? "bg-white text-gray-300 border-gray-200 cursor-not-allowed"
                      : isActive
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-900 border-gray-300 hover:bg-gray-50 active:bg-gray-100"
                  }`}
                >
                  {t.label || "\u00A0"}
                </button>
              );
            })}
          </div>

          <div className="mt-3 text-left font-semibold">More</div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 shadow-sm">
          Use the buttons above to view read-only tour information.
        </div>
      </main>
    </div>
  );
}
