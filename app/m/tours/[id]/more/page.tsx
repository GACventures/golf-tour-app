"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type MoreTab = "details" | "rehandicapping" | "admin";
type MoreRow2 = "userGuide" | "blank1" | "blank2";

export default function MobileMorePage() {
  const params = useParams();
  const router = useRouter();

  const tourId = (params?.id as string) || "";

  // Active state (purely UI highlight on this page)
  const [activeTop, setActiveTop] = useState<MoreTab>("details");
  const [activeRow2, setActiveRow2] = useState<MoreRow2>("userGuide");

  const pillBase = "flex-1 h-10 rounded-xl border text-sm font-semibold flex items-center justify-center";
  const pillActive = "border-gray-900 bg-gray-900 text-white";
  const pillIdle = "border-gray-200 bg-white text-gray-900";

  const topItems = useMemo(
    () =>
      [
        { key: "details" as const, label: "Tour details", href: `/m/tours/${tourId}/details` },
        { key: "rehandicapping" as const, label: "Rehandicapping", href: `/m/tours/${tourId}/more/rehandicapping` },
        { key: "admin" as const, label: "Tour Admin", href: `/m/tours/${tourId}/more/admin` },
      ] as const,
    [tourId]
  );

  const row2Items = useMemo(
    () =>
      [
        { key: "userGuide" as const, label: "App User Guide", href: `/m/tours/${tourId}/more/user-guide` },
        { key: "blank1" as const, label: "", href: "" },
        { key: "blank2" as const, label: "", href: "" },
      ] as const,
    [tourId]
  );

  function onPickTop(key: MoreTab) {
    setActiveTop(key);
    const item = topItems.find((x) => x.key === key);
    if (!item) return;
    router.push(item.href);
  }

  function onPickRow2(key: MoreRow2) {
    setActiveRow2(key);
    const item = row2Items.find((x) => x.key === key);
    if (!item) return;

    // Blank placeholders do nothing for now
    if (!item.href) return;

    router.push(item.href);
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">More</div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 pt-4 space-y-3">
        {/* Top 3-pill row */}
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

        {/* Second 3-pill row */}
        <div className="flex gap-2">
          {row2Items.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => onPickRow2(it.key)}
              aria-label={it.label ? it.label : "Placeholder button"}
              className={`${pillBase} ${activeRow2 === it.key ? pillActive : pillIdle}`}
            >
              {it.label || "\u00A0"}
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
