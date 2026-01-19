"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type MoreTab = "details" | "rehandicapping" | "admin";
type MoreRow2 = "userGuide" | "blank2" | "blank3";

export default function MobileMorePage() {
  const params = useParams();
  const router = useRouter();

  const tourId = (params?.id as string) || "";

  // Row 1: starts active (black)
  const [activeTop, setActiveTop] = useState<MoreTab>("details");

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

  const bottomItems = useMemo(
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

  function onPickBottom(key: MoreRow2) {
    const item = bottomItems.find((x) => x.key === key);
    if (!item || item.disabled) return;
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

      {/* 3-pill row + new second row */}
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

        {/* Row 2 */}
        <div className="flex gap-2">
          {bottomItems.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => onPickBottom(it.key)}
              disabled={it.disabled}
              className={`${pillBase} ${it.disabled ? pillDisabled : pillIdle}`}
              aria-label={it.label || "Placeholder button"}
            >
              {it.label}
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
