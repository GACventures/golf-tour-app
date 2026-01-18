"use client";

import { useParams, useRouter } from "next/navigation";

export default function PairRoundDetailPage() {
  const router = useRouter();
  const params = useParams<{
    id?: string;
    groupId?: string;
    roundId?: string;
  }>();

  const tourId = String(params?.id ?? "");
  const groupId = String(params?.groupId ?? "");
  const roundId = String(params?.roundId ?? "");

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      <main className="mx-auto w-full max-w-md px-4 py-4 pb-24">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-semibold">Pairs · Round Detail</div>
          <button
            type="button"
            onClick={() => router.push(`/m/tours/${tourId}/leaderboards`)}
            className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-semibold hover:bg-gray-200"
          >
            Back
          </button>
        </div>

        <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm space-y-2">
          <div>
            <span className="font-semibold">Tour ID:</span> {tourId}
          </div>
          <div>
            <span className="font-semibold">Pair (groupId):</span> {groupId}
          </div>
          <div>
            <span className="font-semibold">Round ID:</span> {roundId}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          ✅ If you can see this page, the routing from the Pairs leaderboard is now working.
        </div>
      </main>
    </div>
  );
}
