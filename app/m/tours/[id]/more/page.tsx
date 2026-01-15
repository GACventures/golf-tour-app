"use client";

import { useParams, useRouter } from "next/navigation";

export default function MobileMorePage() {
  const params = useParams();
  const router = useRouter();

  const tourId = (params?.id as string) || "";

  const cardBtn =
    "w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm active:bg-gray-50";

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      {/* Header: keep “More” where it is */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">More</div>
        </div>
      </div>

      {/* Second line under header, buttons underneath */}
      <main className="mx-auto w-full max-w-md px-4 py-4">
        <div className="space-y-2">
          <button type="button" className={cardBtn} onClick={() => router.push(`/m/tours/${tourId}/details`)}>
            <div className="text-sm font-semibold text-gray-900">Tour details</div>
          </button>

          <button
            type="button"
            className={cardBtn}
            onClick={() => router.push(`/m/tours/${tourId}/more/rehandicapping`)}
          >
            <div className="text-sm font-semibold text-gray-900">Rehandicapping</div>
          </button>

          <button
            type="button"
            className={`${cardBtn} text-gray-400 cursor-not-allowed`}
            disabled
            aria-disabled="true"
            title="Coming soon"
          >
            <div className="text-sm font-semibold">(blank)</div>
          </button>
        </div>
      </main>
    </div>
  );
}
