// app/m/tours/[id]/more/page.tsx
"use client";

import { useParams, useRouter } from "next/navigation";

export default function MobileMorePage() {
  const params = useParams();
  const router = useRouter();

  const tourId = (params?.id as string) || "";

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200">
        <div className="h-12 px-4 flex items-center">
          <div className="flex-1 text-left font-semibold">More</div>
        </div>
      </div>

      <div className="px-4 py-6 max-w-md mx-auto space-y-3">
        {/* Top buttons */}
        <button
          type="button"
          className="w-full h-12 rounded-xl border border-gray-300 font-medium text-left px-4"
          onClick={() => router.push(`/m/tours/${tourId}/details`)}
        >
          Tour details
        </button>

        <button
          type="button"
          className="w-full h-12 rounded-xl border border-gray-300 font-medium text-left px-4"
          onClick={() => router.push(`/m/tours/${tourId}/more/rehandicapping`)}
        >
          Rehandicapping
        </button>

        <button
          type="button"
          className="w-full h-12 rounded-xl border border-gray-200 font-medium text-left px-4 text-gray-400 cursor-not-allowed"
          disabled
          aria-disabled="true"
          title="Coming soon"
        >
          (blank)
        </button>

        {/* Helper / placeholder text */}
        <div className="rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="text-sm text-gray-600">This page is a read-only menu for tour info and rules.</div>
          <div className="text-xs text-gray-500 mt-2">More items can be added later.</div>
        </div>
      </div>
    </div>
  );
}
