'use client';

import { useParams, useRouter } from 'next/navigation';

export default function MobileRoundTeeTimesPage() {
  const params = useParams();
  const router = useRouter();

  const tourId = (params?.id as string) || '';
  const roundId = (params?.roundId as string) || '';

  function goBack() {
    router.push(`/m/tours/${tourId}/rounds/${roundId}`);
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200">
        <div className="h-12 px-3 flex items-center">
          <button
            type="button"
            onClick={goBack}
            className="w-10 h-10 -ml-1 flex items-center justify-center rounded-full active:bg-gray-100"
            aria-label="Back"
          >
            <span className="text-2xl leading-none">‹</span>
          </button>

          <div className="flex-1 text-center font-semibold">Tee times</div>

          <div className="w-10 h-10" />
        </div>
      </div>

      <div className="px-4 py-6 max-w-md mx-auto">
        <div className="rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="text-sm text-gray-600">
            Placeholder page: <span className="font-medium">Tee times</span>
          </div>
          <div className="text-xs text-gray-500 mt-2">
            We’ll implement the actual tee times UI next using the mock → approve → full-file method.
          </div>
        </div>
      </div>
    </div>
  );
}
