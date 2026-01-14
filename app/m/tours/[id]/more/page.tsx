// app/m/tours/[id]/more/page.tsx
"use client";

import { useParams, useRouter } from "next/navigation";

export default function MobileMorePage() {
  const params = useParams();
  const router = useRouter();

  const tourId = (params?.id as string) || "";

  const topBtnBase =
    "w-full h-12 rounded-2xl border text-sm font-semibold flex items-center justify-center shadow-sm active:scale-[0.99] active:bg-gray-50 transition";
  const topBtnPrimary = "border-gray-900 bg-gray-900 text-white active:bg-gray-900";
  const topBtnSecondary = "border-gray-200 bg-white text-gray-900";
  const topBtnDisabled = "border-gray-200 bg-white text-gray-400";

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200">
        <div className="h-12 px-4 flex items-center">
          <div className="text-base font-semibold">More</div>
        </div>
      </div>

      <div className="px-4 py-6 max-w-md mx-auto space-y-4">
        {/* Top buttons */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            className={`${topBtnBase} ${topBtnPrimary}`}
            onClick={() => router.push(`/m/tours/${tourId}/details`)}
          >
            Tour details
          </button>

          <button
            type="button"
            className={`${topBtnBase} ${topBtnSecondary}`}
            onClick={() => router.push(`/m/tours/${tourId}/rehandicapping`)}
          >
            Rehandicapping
          </button>

          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            className={`${topBtnBase} ${topBtnDisabled}`}
            aria-disabled="true"
          >
            —
          </a>
        </div>

        {/* Placeholder content */}
        <div className="rounded-2xl border border-gray-200 p-4 shadow-sm">
          <div className="text-sm text-gray-600">
            Placeholder page: <span className="font-medium">More</span>
          </div>
          <div className="text-xs text-gray-500 mt-2">
            Future items: settings, about, rules, help, etc.
          </div>
        </div>

        <button
          className="w-full h-12 rounded-2xl border border-gray-300 font-medium active:bg-gray-50"
          onClick={() => router.push(`/m/tours/${tourId}`)}
        >
          Back to Tour
        </button>
      </div>
    </div>
  );
}
