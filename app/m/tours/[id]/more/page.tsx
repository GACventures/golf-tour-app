"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type MoreTab = "details" | "rehandicapping" | "blank";

export default function MobileMorePage() {
  const params = useParams();
  const router = useRouter();

  const tourId = (params?.id as string) || "";

  // Left starts active (black)
  const [active, setActive] = useState<MoreTab>("details");

  const pillBase =
    "flex-1 h-10 rounded-xl border text-sm font-semibold flex items-center justify-center";
  const pillActive = "border-gray-900 bg-gray-900 text-white";
  const pillIdle = "border-gray-200 bg-white text-gray-900";

  const items = useMemo(
    () =>
      [
        { key: "details" as const, label: "Tour details", href: `/m/tours/${tourId}/details`, disabled: false },
        {
          key: "rehandicapping" as const,
          label: "Rehandicapping",
          href: `/m/tours/${tourId}/more/rehandicapping`,
          disabled: false,
        },
        { key: "blank" as const, label: "(blank)", href: "", disabled: true },
      ] as const,
    [tourId]
  );

  function onPick(key: MoreTab) {
    setActive(key);

    const item = items.find((x) => x.key === key);
    if (!item || item.disabled) return;

    router.push(item.href);
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      {/* Header (keep “More” where it is) */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">More</div>
        </div>
      </div>

      {/* Second line under header + 3-pill row */}
      <main className="mx-auto w-full max-w-md px-4 pt-4">
        <div className="flex gap-2">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => onPick(it.key)}
              disabled={it.disabled}
              aria-disabled={it.disabled ? "true" : undefined}
              title={it.disabled ? "Coming soon" : undefined}
              className={`${pillBase} ${
                active === it.key ? pillActive : pillIdle
              } ${it.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {it.label}
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
