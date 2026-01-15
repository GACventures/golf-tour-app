"use client";

import { useParams, useRouter } from "next/navigation";

export default function MobileMorePage() {
  const params = useParams();
  const router = useRouter();

  const tourId = (params?.id as string) || "";

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      {/* Header (keep "More" where it is) */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">More</div>
        </div>
      </div>

      {/* Second line under header + buttons below (like Competitions page structure) */}
      <main className="mx-auto w-full max-w-md px-4 py-4">
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => router.push(`/m/tours/${tourId}/details`)}
            className="w-full rounded-xl border border-gray-300 bg-slate-100 px-4 py-3 text-left text-sm font-semibold text-gray-900 hover:bg-slate-200 active:bg-slate-300"
          >
            Tour details
          </button>

          <button
            type="button"
            onClick={() => router.push(`/m/tours/${tourId}/more/rehandicapping`)}
            className="w-full rounded-xl border border-gray-300 bg-slate-100 px-4 py-3 text-left text-sm font-semibold text-gray-900 hover:bg-slate-200 active:bg-slate-300"
          >
            Rehandicapping
          </button>

          <button
            type="button"
            disabled
            aria-disabled="true"
            title="Coming soon"
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm font-semibold text-gray-400 cursor-not-allowed"
          >
            (blank)
          </button>
        </div>
      </main>
    </div>
  );
}
