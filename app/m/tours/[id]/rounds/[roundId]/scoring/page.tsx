'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { supabase } from '@/lib/supabaseClient';

type RoundRow = {
  id: string;
  name: string | null;
  number?: number | null;
  round_number?: number | null;
  course_id: string | null;
  courses?: { name: string | null } | null;
};

type PlayerRow = {
  id: string;
  name: string;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean | null;
  players?: PlayerRow | null;
};

export default function MobileRoundScoringPickerPage() {
  const params = useParams();
  const router = useRouter();

  const tourId = (params?.id as string) || '';
  const roundId = (params?.roundId as string) || '';

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [round, setRound] = useState<RoundRow | null>(null);
  const [eligible, setEligible] = useState<PlayerRow[]>([]);

  const [meId, setMeId] = useState<string>('');
  const [buddyId, setBuddyId] = useState<string>(''); // '' = None

  // Derived display
  const roundLabel = useMemo(() => {
    if (!round) return 'Round';
    const n =
      (round.round_number ?? round.number ?? null) as number | null;
    if (typeof n === 'number' && Number.isFinite(n)) return `Round ${n}`;
    return round.name ? round.name : 'Round';
  }, [round]);

  const courseName = useMemo(() => {
    const cn = round?.courses?.name ?? null;
    return cn && cn.trim().length > 0 ? cn : null;
  }, [round]);

  const buddyOptions = useMemo(() => {
    // Buddy can be anyone eligible except Me (if chosen)
    const filtered = meId ? eligible.filter((p) => p.id !== meId) : eligible;
    return filtered;
  }, [eligible, meId]);

  const canContinue = Boolean(meId);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setErrorMsg('');

      try {
        // 1) Load round (with course name if possible)
        const { data: roundData, error: roundErr } = await supabase
          .from('rounds')
          .select('id,name,number,round_number,course_id,courses(name)')
          .eq('id', roundId)
          .single();

        if (roundErr) throw roundErr;

        // 2) Load eligible players (playing = true)
        const { data: rpData, error: rpErr } = await supabase
          .from('round_players')
          .select('round_id,player_id,playing,players(id,name)')
          .eq('round_id', roundId)
          .eq('playing', true);

        if (rpErr) throw rpErr;

        const players: PlayerRow[] = (rpData ?? [])
          .map((rp: RoundPlayerRow) => rp.players)
          .filter(Boolean)
          // @ts-expect-error filtered
          .map((p: PlayerRow) => ({ id: p.id, name: p.name }))
          .sort((a, b) => a.name.localeCompare(b.name));

        if (!mounted) return;

        setRound(roundData as RoundRow);
        setEligible(players);

        // If current buddy equals me (in case of reload), clear buddy
        if (buddyId && buddyId === meId) setBuddyId('');
      } catch (e: any) {
        if (!mounted) return;
        setErrorMsg(e?.message ?? 'Failed to load scoring setup.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    if (roundId) load();

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  // Keep buddy valid if Me changes
  useEffect(() => {
    if (buddyId && buddyId === meId) {
      setBuddyId('');
    }
  }, [meId, buddyId]);

  function goBack() {
    // Back to round detail (mobile)
    router.push(`/m/tours/${tourId}/rounds/${roundId}`);
  }

  function onContinue() {
    if (!meId) return;

    const base = `/rounds/${roundId}/mobile/score`;
    const qs = new URLSearchParams();
    qs.set('meId', meId);
    if (buddyId) qs.set('buddyId', buddyId);

    router.push(`${base}?${qs.toString()}`);
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

          <div className="flex-1 text-center font-semibold">Scoring</div>

          {/* Right spacer to keep title centered */}
          <div className="w-10 h-10" />
        </div>
      </div>

      <div className="px-4 py-4 max-w-md mx-auto">
        {/* Round summary */}
        <div className="mb-4">
          <div className="text-xl font-semibold">{roundLabel}</div>
          {courseName ? (
            <div className="text-sm text-gray-600 mt-1">{courseName}</div>
          ) : null}
        </div>

        {/* States */}
        {loading ? (
          <div className="text-sm text-gray-600">Loading…</div>
        ) : errorMsg ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMsg}
          </div>
        ) : (
          <>
            {/* Me selector */}
            <div className="rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="text-sm font-semibold">Me</div>
              <div className="text-xs text-gray-500 mt-0.5">Required</div>

              <div className="mt-2">
                <select
                  className="w-full h-11 rounded-lg border border-gray-300 px-3 bg-white"
                  value={meId}
                  onChange={(e) => setMeId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {eligible.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Buddy selector */}
            <div className="rounded-xl border border-gray-200 p-4 shadow-sm mt-3">
              <div className="text-sm font-semibold">Buddy</div>
              <div className="text-xs text-gray-500 mt-0.5">Optional</div>

              <div className="mt-2">
                <select
                  className="w-full h-11 rounded-lg border border-gray-300 px-3 bg-white"
                  value={buddyId}
                  onChange={(e) => setBuddyId(e.target.value)}
                  disabled={!meId || buddyOptions.length === 0}
                >
                  <option value="">None</option>
                  {buddyOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {!meId ? (
                  <div className="text-xs text-gray-500 mt-2">
                    Select Me first to choose a Buddy.
                  </div>
                ) : null}
              </div>
            </div>

            {/* Eligible list preview */}
            <div className="mt-4">
              <div className="text-sm font-semibold text-gray-900">
                Eligible players
              </div>
              <div className="text-xs text-gray-500">
                Playing this round
              </div>

              <div className="mt-2 rounded-xl border border-gray-200 overflow-hidden">
                {eligible.length === 0 ? (
                  <div className="p-3 text-sm text-gray-600">
                    No eligible players (playing=true) found for this round.
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-200">
                    {eligible.map((p) => (
                      <li key={p.id} className="p-3 text-sm">
                        {p.name}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Continue */}
            <div className="mt-5 pb-6">
              <button
                type="button"
                onClick={onContinue}
                disabled={!canContinue}
                className={[
                  'w-full h-12 rounded-xl font-semibold',
                  canContinue
                    ? 'bg-gray-900 text-white active:opacity-90'
                    : 'bg-gray-200 text-gray-500',
                ].join(' ')}
              >
                Continue
              </button>

              {!canContinue ? (
                <div className="text-xs text-gray-500 mt-2 text-center">
                  Select Me to continue.
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
