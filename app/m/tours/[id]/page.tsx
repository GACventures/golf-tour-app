'use client';

import { useParams, useRouter } from 'next/navigation';

export default function MobileTourHomePage() {
  const params = useParams();
  const router = useRouter();

  const tourId = (params?.id as string) || '';

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200">
        <div className="h-12 px-3 flex items-center">
          <div className="flex-1 text-center font-semibold">
            Tour
          </div>
        </div>
      </div>

      <div className="px-4 py-6 max-w-md mx-auto space-y-3">
        <button
          className="w-full h-12 rounded-xl border border-gray-300 font-medium"
          onClick={() => router.push(`/m/tours/${tourId}/rounds`)}
        >
          Rounds
        </button>

        <button
          className="w-full h-12 rounded-xl border border-gray-300 font-medium"
          onClick={() => router.push(`/m/tours/${tourId}/leaderboards`)}
        >
          Leaderboards
        </button>

        <button
          className="w-full h-12 rounded-xl border border-gray-300 font-medium"
          onClick={() => router.push(`/m/tours/${tourId}/competitions`)}
        >
          Competitions
        </button>

        <button
          className="w-full h-12 rounded-xl border border-gray-300 font-medium"
          onClick={() => router.push(`/m/tours/${tourId}/stats`)}
        >
          Player stats
        </button>

        <button
          className="w-full h-12 rounded-xl border border-gray-300 font-medium"
          onClick={() => router.push(`/m/tours/${tourId}/more`)}
        >
          More
        </button>
      </div>
    </div>
  );
}
