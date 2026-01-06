'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';

import { supabase } from '@/lib/supabaseClient';
import { netStablefordPointsForHole } from '@/lib/stableford';

type Round = {
  id: string;
  name: string;
  course_id: string | null;
  is_locked?: boolean;
  courses?: { name: string } | null;
};

type ParRow = { hole_number: number; par: number; stroke_index: number };

type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean;
};

type MiniPlayer = {
  id: string;
  name: string;
  playing_handicap: number;
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export default function MobileScoreEntryPage() {
  const params = useParams();
  const sp = useSearchParams();

  const roundId = (params?.id as string) || '';
  const meId = sp.get('me') || '';
  const buddyIdParam = sp.get('buddy') || '';

  const [round, setRound] = useState<Round | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  const [parsByHole, setParsByHole] = useState<number[]>(Array(18).fill(0));
  const [siByHole, setSiByHole] = useState<number[]>(Array(18).fill(0));

  const [me, setMe] = useState<MiniPlayer | null>(null);
  const [buddy, setBuddy] = useState<MiniPlayer | null>(null);

  // scores[playerId] = string[18] where each entry is "", "P", or a number string
  const [scores, setScores] = useState<Record<string, string[]>>({});
  const [holeIndex, setHoleIndex] = useState(0); // 0..17

  const [showGrid, setShowGrid] = useState(false);

  const [loading, setLoading] = useState(true);

  // UX states
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [savedMsg, setSavedMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Unsaved changes guard (Me only)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const dirtyRef = useRef(false);

  // Double-save prevention
  const saveInFlightRef = useRef(false);

  // Auto-hide "Saved ✓"
  const hideSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const holes = useMemo(() => Array.from({ length: 18 }, (_, i) => i + 1), []);
  const hasValidParams = !!roundId && !!meId;

  function setDirty(next: boolean) {
    dirtyRef.current = next;
    setHasUnsavedChanges(next);
  }

  function confirmAbandonChanges(): boolean {
    if (!dirtyRef.current) return true;
    return window.confirm('You have unsaved changes for your scores. Leave without saving?');
  }

  // Warn on refresh / close tab (only if not locked)
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (isLocked) return;
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isLocked]);

  // Warn on browser back / swipe-back (only if not locked)
  useEffect(() => {
    if (isLocked) return;

    try {
      window.history.pushState({ __mobileScoreGuard: true }, '');
    } catch {
      // ignore
    }

    function onPopState() {
      if (!confirmAbandonChanges()) {
        try {
          window.history.pushState({ __mobileScoreGuard: true }, '');
        } catch {
          // ignore
        }
        return;
      }
      // allow leaving
    }

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocked]);

  useEffect(() => {
    return () => {
      if (hideSavedTimerRef.current) clearTimeout(hideSavedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!hasValidParams) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId, meId, buddyIdParam]);

  async function loadAll() {
    setLoading(true);
    setErrorMsg('');
    setSavedMsg('');
    setSaveStatus('idle');
    setDirty(false);

    // 1) Round + course name + is_locked
    const { data: roundData, error: roundError } = await supabase
      .from('rounds')
      .select(`id, name, course_id, is_locked, courses ( name )`)
      .eq('id', roundId)
      .single();

    if (roundError) {
      setErrorMsg(roundError.message);
      setSaveStatus('error');
      setLoading(false);
      return;
    }
    const r = roundData as Round;
    setRound(r);
    setIsLocked(r.is_locked === true);

    if (!r.course_id) {
      setErrorMsg('This round has no course assigned.');
      setSaveStatus('error');
      setLoading(false);
      return;
    }

    // 2) Pars + stroke index
    const { data: parData, error: parError } = await supabase
      .from('pars')
      .select('hole_number, par, stroke_index')
      .eq('course_id', r.course_id)
      .order('hole_number');

    if (parError) {
      setErrorMsg(parError.message);
      setSaveStatus('error');
      setLoading(false);
      return;
    }

    const parArr = Array(18).fill(0);
    const siArr = Array(18).fill(0);

    ((parData as ParRow[] | null) ?? []).forEach((row) => {
      const idx = row.hole_number - 1;
      if (idx < 0 || idx >= 18) return;
      parArr[idx] = row.par ?? 0;
      siArr[idx] = row.stroke_index ?? 0;
    });

    setParsByHole(parArr);
    setSiByHole(siArr);

    // 3) Load me (+ buddy) from round_players and ensure they are playing
    const idsToLoad = [meId, buddyIdParam].filter(Boolean);

    const { data: rp, error: rpError } = await supabase
      .from('round_players')
      .select(
        `
        playing,
        playing_handicap,
        players ( id, name )
      `
      )
      .eq('round_id', roundId)
      .in('player_id', idsToLoad);

    if (rpError) {
      setErrorMsg(rpError.message);
      setSaveStatus('error');
      setLoading(false);
      return;
    }

    const rows = Array.isArray(rp) ? rp : [];
    const byId: Record<string, any> = {};
    for (const row of rows) {
      const pid = row?.players?.id;
      if (pid) byId[pid] = row;
    }

    const meRow = byId[meId];
    if (!meRow) {
      setErrorMsg('Selected “me” player was not found for this round.');
      setSaveStatus('error');
      setLoading(false);
      return;
    }
    if (meRow.playing !== true) {
      setErrorMsg('Selected “me” player is not marked as playing for this round.');
      setSaveStatus('error');
      setLoading(false);
      return;
    }

    setMe({
      id: meRow.players.id,
      name: meRow.players.name,
      playing_handicap: meRow.playing_handicap ?? 0,
    });

    if (buddyIdParam && buddyIdParam !== meId) {
      const bRow = byId[buddyIdParam];
      if (!bRow) {
        setErrorMsg('Selected buddy was not found for this round.');
        setSaveStatus('error');
        setBuddy(null);
      } else if (bRow.playing !== true) {
        setErrorMsg('Selected buddy is not marked as playing for this round.');
        setSaveStatus('error');
        setBuddy(null);
      } else {
        setBuddy({
          id: bRow.players.id,
          name: bRow.players.name,
          playing_handicap: bRow.playing_handicap ?? 0,
        });
      }
    } else {
      setBuddy(null);
    }

    // 4) Init score arrays for me (+ buddy)
    const init: Record<string, string[]> = {};
    init[meId] = Array(18).fill('');
    if (buddyIdParam && buddyIdParam !== meId) init[buddyIdParam] = Array(18).fill('');
    setScores(init);

    // 5) Load existing scores
    const { data: scoreData, error: scoreError } = await supabase
      .from('scores')
      .select('player_id, hole_number, strokes, pickup')
      .eq('round_id', roundId)
      .in('player_id', idsToLoad);

    if (scoreError) {
      setErrorMsg(scoreError.message);
      setSaveStatus('error');
      setLoading(false);
      return;
    }

    const scoreRows = (scoreData ?? []) as ScoreRow[];

    setScores((prev) => {
      const copy: Record<string, string[]> = { ...prev };
      for (const row of scoreRows) {
        if (!copy[row.player_id]) continue;
        const idx = row.hole_number - 1;
        if (idx < 0 || idx >= 18) continue;

        const isPickup = (row as any).pickup === true;
        copy[row.player_id] = [...copy[row.player_id]];
        copy[row.player_id][idx] = isPickup ? 'P' : row.strokes == null ? '' : String(row.strokes);
      }
      return copy;
    });

    // 6) Start at first incomplete hole for me
    setHoleIndex(() => {
      const filled = Array(18).fill(false);
      for (const row of scoreRows) {
        if (row.player_id !== meId) continue;
        const idx = row.hole_number - 1;
        const raw = (row as any).pickup === true ? 'P' : row.strokes == null ? '' : String(row.strokes);
        if (idx >= 0 && idx < 18) filled[idx] = raw.trim() !== '';
      }
      const firstIncomplete = filled.findIndex((x) => x === false);
      return firstIncomplete === -1 ? 0 : firstIncomplete;
    });

    setLoading(false);
  }

  function normalizeScore(v: string): string {
    const raw = (v ?? '').toString().trim().toUpperCase();
    if (raw === 'P') return 'P';
    if (raw === '') return '';
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return '';
    return String(Math.floor(n));
  }

  function clearStatus() {
    if (hideSavedTimerRef.current) clearTimeout(hideSavedTimerRef.current);
    setSavedMsg('');
    setErrorMsg('');
    setSaveStatus('idle');
  }

  function setCell(playerId: string, idx: number, value: string) {
    if (isLocked) return; // ✅ read-only when locked
    clearStatus();
    if (playerId === meId) setDirty(true);

    setScores((prev) => {
      const arr = prev[playerId] ? [...prev[playerId]] : Array(18).fill('');
      arr[idx] = value;
      return { ...prev, [playerId]: arr };
    });
  }

  function setCellQuick(playerId: string, idx: number, value: string) {
    setCell(playerId, idx, value);
  }

  function step(playerId: string, delta: number) {
    if (isLocked) return;
    const curRaw = (scores[playerId]?.[holeIndex] ?? '').toString().trim().toUpperCase();

    if (curRaw === 'P') {
      const next = Math.max(1, 1 + delta);
      setCell(playerId, holeIndex, String(next));
      return;
    }

    const cur = Number(curRaw);
    const base = Number.isFinite(cur) && cur > 0 ? cur : 1;
    const next = Math.max(1, base + delta);
    setCell(playerId, holeIndex, String(next));
  }

  function strokesReceivedOnHole(playingHandicap: number, idx: number): number {
    const hcp = Math.max(0, Math.floor(playingHandicap ?? 0));
    if (hcp === 0) return 0;

    const base = Math.floor(hcp / 18);
    const rem = hcp % 18;

    const si = siByHole[idx]; // 1..18
    if (!Number.isFinite(si) || si <= 0) return base;

    const extra = si <= rem ? 1 : 0;
    return base + extra;
  }

  function netPointsFor(playerId: string, idx: number, playingHandicap: number): number {
    const rawScore = (scores[playerId]?.[idx] ?? '').toString();
    const par = parsByHole[idx];
    const strokeIndex = siByHole[idx];

    return netStablefordPointsForHole({
      rawScore,
      par,
      strokeIndex,
      playingHandicap,
    });
  }

  function runningTotalsFor(playerId: string, playingHandicap: number) {
    let front = 0;
    let back = 0;
    for (let i = 0; i < 9; i++) front += netPointsFor(playerId, i, playingHandicap);
    for (let i = 9; i < 18; i++) back += netPointsFor(playerId, i, playingHandicap);
    return { front, back, total: front + back };
  }

  function holesDoneCount(playerId: string) {
    const arr = scores[playerId] ?? Array(18).fill('');
    let done = 0;
    for (let i = 0; i < 18; i++) {
      const norm = normalizeScore(arr[i] ?? '');
      if (norm !== '') done++;
    }
    return done;
  }

  function nextHoleIndexAfterSave(currentIdx: number) {
    const arr = scores[meId] ?? Array(18).fill('');
    const isDone = (idx: number) => normalizeScore(arr[idx] ?? '') !== '';

    for (let i = currentIdx + 1; i < 18; i++) if (!isDone(i)) return i;
    for (let i = 0; i < 18; i++) if (!isDone(i)) return i;
    return (currentIdx + 1) % 18;
  }

  async function save() {
    if (!round) return;
    if (isLocked) return;
    if (saving) return;
    if (saveInFlightRef.current) return;

    saveInFlightRef.current = true;

    if (hideSavedTimerRef.current) clearTimeout(hideSavedTimerRef.current);

    setSaving(true);
    setErrorMsg('');
    setSavedMsg('');
    setSaveStatus('saving');

    try {
      const idsToSave = [meId]; // only save me
      const rows: ScoreRow[] = [];

      for (const pid of idsToSave) {
        const arr = scores[pid] ?? Array(18).fill('');
        for (let i = 0; i < 18; i++) {
          const raw = normalizeScore(arr[i]);
          const isPickup = raw === 'P';

          rows.push({
            round_id: roundId,
            player_id: pid,
            hole_number: i + 1,
            pickup: isPickup,
            strokes: raw === '' || isPickup ? null : Number(raw),
          });
        }
      }

      const { error } = await supabase.from('scores').upsert(rows, {
        onConflict: 'round_id,player_id,hole_number',
      });

      if (error) {
        setErrorMsg(error.message);
        setSaveStatus('error');
        return;
      }

      setSavedMsg('Saved ✓');
      setSaveStatus('saved');

      setDirty(false);

      hideSavedTimerRef.current = setTimeout(() => {
        setSavedMsg('');
        setSaveStatus('idle');
      }, 1200);

      setHoleIndex((cur) => nextHoleIndexAfterSave(cur));
    } finally {
      setSaving(false);
      saveInFlightRef.current = false;
    }
  }

  function goPrev() {
    clearStatus();
    setHoleIndex((h) => Math.max(0, h - 1));
  }
  function goNext() {
    clearStatus();
    setHoleIndex((h) => Math.min(17, h + 1));
  }

  const currentHoleNumber = holeIndex + 1;

  const par = parsByHole[holeIndex] || 0;
  const si = siByHole[holeIndex] || 0;

  const meTotals = useMemo(
    () => (me ? runningTotalsFor(me.id, me.playing_handicap) : { front: 0, back: 0, total: 0 }),
    [me, scores]
  );
  const buddyTotals = useMemo(
    () => (buddy ? runningTotalsFor(buddy.id, buddy.playing_handicap) : { front: 0, back: 0, total: 0 }),
    [buddy, scores]
  );

  const meHolePts = me ? netPointsFor(me.id, holeIndex, me.playing_handicap) : 0;
  const buddyHolePts = buddy ? netPointsFor(buddy.id, holeIndex, buddy.playing_handicap) : 0;

  const meReceived = me ? strokesReceivedOnHole(me.playing_handicap, holeIndex) : 0;
  const buddyReceived = buddy ? strokesReceivedOnHole(buddy.playing_handicap, holeIndex) : 0;

  const meDone = me ? holesDoneCount(me.id) : 0;
  const buddyDone = buddy ? holesDoneCount(buddy.id) : 0;

  function handleChangePlayersClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (isLocked) return; // safe
    if (!confirmAbandonChanges()) e.preventDefault();
  }

  if (!hasValidParams) {
    return (
      <div style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Mobile score entry</h2>
        <p style={{ color: 'red' }}>Missing required parameters. Please start from the mobile entry page and select “Me”.</p>
        <Link href={`/rounds/${roundId}/mobile`} style={{ textDecoration: 'underline' }}>
          Go to mobile entry setup
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 16 }}>
        <h2 style={{ marginTop: 0 }}>Mobile score entry</h2>
        <p>Loading…</p>
        {errorMsg && <p style={{ color: 'red' }}>Error: {errorMsg}</p>}
      </div>
    );
  }

  const canSave = !!round && !!meId && !saving && !isLocked;

  return (
    <div style={{ padding: 16, maxWidth: 520, margin: '0 auto' }}>
      {/* Sticky header */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          background: '#fff',
          paddingBottom: 12,
          borderBottom: '1px solid #e5e7eb',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              <Link
                href={`/rounds/${roundId}/mobile`}
                style={{ textDecoration: 'underline' }}
                onClick={handleChangePlayersClick}
              >
                ← Change players
              </Link>
            </div>
            <h2 style={{ margin: '6px 0 0 0', lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {round?.name ?? 'Round'}
            </h2>
            {round?.courses?.name && (
              <div style={{ fontSize: 13, opacity: 0.85, marginTop: 2 }}>
                Course: <strong>{round.courses.name}</strong>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid #111827',
                background: !canSave ? '#e5e7eb' : '#111827',
                color: !canSave ? '#6b7280' : '#fff',
                fontWeight: 800,
                cursor: !canSave ? 'not-allowed' : 'pointer',
                whiteSpace: 'nowrap',
                height: 42,
                minWidth: 112,
              }}
            >
              {isLocked ? 'Locked' : saveStatus === 'saving' ? 'Saving…' : 'Save'}
            </button>

            <div style={{ minHeight: 18, fontSize: 12 }}>
              {isLocked && <span style={{ color: '#111827', fontWeight: 800 }}>Read only</span>}
              {!isLocked && saveStatus === 'saving' && <span style={{ opacity: 0.75 }}>Saving…</span>}
              {!isLocked && savedMsg && <span style={{ color: 'green', fontWeight: 800 }}>{savedMsg}</span>}
              {!isLocked && !savedMsg && hasUnsavedChanges && saveStatus !== 'saving' && (
                <span style={{ color: '#92400e', fontWeight: 800 }}>Unsaved</span>
              )}
            </div>
          </div>
        </div>

        {/* Locked banner */}
        {isLocked && (
          <div
            style={{
              marginTop: 10,
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid #e5e7eb',
              background: '#f9fafb',
              fontSize: 13,
              fontWeight: 800,
            }}
          >
            Round locked — read only
          </div>
        )}

        {/* Mini summary pills */}
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Pill label={`Hole ${currentHoleNumber}`} strong={`Par ${par || '—'} • SI ${si || '—'}`} />
          {me && <Pill label={`${me.name}`} strong={`${meHolePts} pts • ${meTotals.total} total`} sub={`${meDone}/18`} />}
          {buddy && (
            <Pill label={`${buddy.name}`} strong={`${buddyHolePts} pts • ${buddyTotals.total} total`} sub={`${buddyDone}/18`} />
          )}
          <Pill
            label="Status"
            strong={
              isLocked
                ? 'Locked'
                : saveStatus === 'saving'
                ? 'Saving…'
                : saveStatus === 'saved'
                ? 'Saved'
                : saveStatus === 'error'
                ? 'Error'
                : hasUnsavedChanges
                ? 'Unsaved'
                : 'Ready'
            }
          />
        </div>

        {errorMsg && (
          <div
            style={{
              marginTop: 10,
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid #fecaca',
              background: '#fef2f2',
              color: '#991b1b',
              fontSize: 13,
              fontWeight: 700,
            }}
          >
            Error: {errorMsg}
          </div>
        )}
      </div>

      {/* Hole navigator */}
      <div style={{ marginTop: 14, padding: 12, border: '1px solid #e5e7eb', borderRadius: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <button
            type="button"
            onClick={goPrev}
            disabled={holeIndex === 0}
            style={{
              width: 52,
              height: 46,
              borderRadius: 14,
              border: '1px solid #d1d5db',
              background: holeIndex === 0 ? '#f3f4f6' : '#fff',
              cursor: holeIndex === 0 ? 'not-allowed' : 'pointer',
              fontSize: 18,
              fontWeight: 900,
            }}
            aria-label="Previous hole"
          >
            ◀
          </button>

          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 900 }}>Hole {currentHoleNumber} of 18</div>
            <div style={{ fontSize: 13, opacity: 0.85 }}>
              Par {par || '—'} • SI {si || '—'}
            </div>
          </div>

          <button
            type="button"
            onClick={goNext}
            disabled={holeIndex === 17}
            style={{
              width: 52,
              height: 46,
              borderRadius: 14,
              border: '1px solid #d1d5db',
              background: holeIndex === 17 ? '#f3f4f6' : '#fff',
              cursor: holeIndex === 17 ? 'not-allowed' : 'pointer',
              fontSize: 18,
              fontWeight: 900,
            }}
            aria-label="Next hole"
          >
            ▶
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowGrid(true)}
          style={{
            marginTop: 10,
            width: '100%',
            padding: '12px 12px',
            borderRadius: 14,
            border: '1px solid #d1d5db',
            background: '#fff',
            cursor: 'pointer',
            fontWeight: 900,
          }}
        >
          Jump to hole (1–18)
        </button>
      </div>

      {/* Two-player blocks */}
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {me && (
          <PlayerBlock
            title={`${me.name} (You)`}
            playerId={me.id}
            meId={meId}
            isLocked={isLocked}
            playingHandicap={me.playing_handicap}
            scores={scores}
            holeIndex={holeIndex}
            received={meReceived}
            holePts={meHolePts}
            totals={meTotals}
            doneCount={meDone}
            onStep={(delta) => step(me.id, delta)}
            onSet={(val) => setCell(me.id, holeIndex, val)}
            onQuick={(val) => setCellQuick(me.id, holeIndex, val)}
            normalize={normalizeScore}
          />
        )}

        {buddy && (
          <PlayerBlock
            title={`${buddy.name} (Buddy)`}
            playerId={buddy.id}
            meId={meId}
            isLocked={isLocked}
            playingHandicap={buddy.playing_handicap}
            scores={scores}
            holeIndex={holeIndex}
            received={buddyReceived}
            holePts={buddyHolePts}
            totals={buddyTotals}
            doneCount={buddyDone}
            onStep={(delta) => step(buddy.id, delta)}
            onSet={(val) => setCell(buddy.id, holeIndex, val)}
            onQuick={(val) => setCellQuick(buddy.id, holeIndex, val)}
            normalize={normalizeScore}
          />
        )}
      </div>

      {/* Jump grid modal */}
      {showGrid && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            zIndex: 50,
          }}
          onClick={() => setShowGrid(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 520,
              background: '#fff',
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              padding: 14,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>Jump to hole</div>
              <button
                type="button"
                onClick={() => setShowGrid(false)}
                style={{
                  padding: '8px 10px',
                  borderRadius: 12,
                  border: '1px solid #d1d5db',
                  background: '#fff',
                  cursor: 'pointer',
                  fontWeight: 900,
                }}
              >
                Close
              </button>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
              Showing completion for <strong>{me?.name ?? 'Me'}</strong>.
            </div>

            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
              {holes.map((h, idx) => {
                const norm = normalizeScore((scores[meId]?.[idx] ?? '').toString());
                const done = norm !== '';
                return (
                  <button
                    key={h}
                    type="button"
                    onClick={() => {
                      setHoleIndex(idx);
                      setShowGrid(false);
                    }}
                    style={{
                      padding: '12px 0',
                      borderRadius: 14,
                      border: idx === holeIndex ? '2px solid #111827' : '1px solid #d1d5db',
                      background: done ? '#f0fdf4' : '#fff',
                      cursor: 'pointer',
                      fontWeight: 900,
                    }}
                    title={done ? `Hole ${h}: filled` : `Hole ${h}: empty`}
                  >
                    {h}
                  </button>
                );
              })}
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
              Tip: green = hole has a value (number or P).
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 18, fontSize: 12, opacity: 0.75 }}>
        {isLocked ? (
          <>This round is locked. Scores are read-only.</>
        ) : (
          <>
            Tip: tap a number for fast entry. Use <strong>P</strong> for pickup. Save regularly.
          </>
        )}
      </div>
    </div>
  );
}

function Pill(props: { label: string; strong: string; sub?: string }) {
  const { label, strong, sub } = props;
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        background: '#fff',
        borderRadius: 999,
        padding: '8px 10px',
        display: 'flex',
        gap: 8,
        alignItems: 'baseline',
      }}
    >
      <span style={{ fontSize: 12, opacity: 0.75, fontWeight: 800 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 900 }}>{strong}</span>
      {sub && <span style={{ fontSize: 12, opacity: 0.7, fontWeight: 800 }}>{sub}</span>}
    </div>
  );
}

function PlayerBlock(props: {
  title: string;
  playerId: string;
  meId: string;
  isLocked: boolean;
  playingHandicap: number;
  scores: Record<string, string[]>;
  holeIndex: number;

  received: number;

  holePts: number;
  totals: { front: number; back: number; total: number };
  doneCount: number;

  onStep: (delta: number) => void;
  onSet: (val: string) => void;
  onQuick: (val: string) => void;
  normalize: (v: string) => string;
}) {
  const {
    title,
    playerId,
    meId,
    isLocked,
    playingHandicap,
    scores,
    holeIndex,
    received,
    holePts,
    totals,
    doneCount,
    onStep,
    onSet,
    onQuick,
    normalize,
  } = props;

  const raw = (scores[playerId]?.[holeIndex] ?? '').toString();
  const display = normalize(raw);

  const quickNums = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const isMe = playerId === meId;

  const disabled = isLocked;

  return (
    <div
      style={{
        padding: 14,
        border: '1px solid #e5e7eb',
        borderRadius: 16,
        background: disabled ? '#f9fafb' : '#fff',
        opacity: disabled ? 0.92 : 1,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
        <div style={{ fontWeight: 950, fontSize: 16 }}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 800 }}>HCP {playingHandicap}</div>
      </div>

      <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85, fontWeight: 700 }}>
        Receives {received} shot{received === 1 ? '' : 's'}
        {!isMe && <span style={{ marginLeft: 8, opacity: 0.8 }}>(Buddy saves on their phone)</span>}
        {disabled && <span style={{ marginLeft: 8, opacity: 0.9 }}>(Locked)</span>}
      </div>

      {/* Main value + stepper */}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={() => onStep(-1)}
          disabled={disabled}
          style={{
            width: 54,
            height: 48,
            borderRadius: 16,
            border: '1px solid #d1d5db',
            background: disabled ? '#f3f4f6' : '#fff',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 20,
            fontWeight: 950,
          }}
          aria-label="Decrease score"
        >
          −
        </button>

        <div
          style={{
            flex: 1,
            height: 48,
            borderRadius: 16,
            border: '1px solid #d1d5db',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            fontWeight: 950,
            background: '#fff',
            letterSpacing: 0.2,
          }}
        >
          {display || '—'}
        </div>

        <button
          type="button"
          onClick={() => onStep(1)}
          disabled={disabled}
          style={{
            width: 54,
            height: 48,
            borderRadius: 16,
            border: '1px solid #d1d5db',
            background: disabled ? '#f3f4f6' : '#fff',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 20,
            fontWeight: 950,
          }}
          aria-label="Increase score"
        >
          +
        </button>
      </div>

      {/* Quick pad */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.8, fontWeight: 800, marginBottom: 8 }}>Quick entry</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {quickNums.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onQuick(String(n))}
              disabled={disabled}
              style={{
                height: 50,
                borderRadius: 16,
                border: '1px solid #d1d5db',
                background: disabled ? '#f3f4f6' : '#fff',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontWeight: 950,
                fontSize: 18,
              }}
            >
              {n}
            </button>
          ))}

          <button
            type="button"
            onClick={() => onSet('P')}
            disabled={disabled}
            style={{
              height: 50,
              borderRadius: 16,
              border: '1px solid #d1d5db',
              background: disabled ? '#f3f4f6' : '#fff',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontWeight: 950,
              fontSize: 16,
            }}
          >
            P
          </button>

          <button
            type="button"
            onClick={() => onSet('')}
            disabled={disabled}
            style={{
              height: 50,
              borderRadius: 16,
              border: '1px solid #d1d5db',
              background: disabled ? '#f3f4f6' : '#fff',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontWeight: 950,
              fontSize: 16,
            }}
          >
            Clear
          </button>

          <button
            type="button"
            onClick={() => onQuick(display || '1')}
            disabled={disabled}
            style={{
              height: 50,
              borderRadius: 16,
              border: '1px solid #d1d5db',
              background: disabled ? '#f3f4f6' : '#f9fafb',
              cursor: disabled ? 'not-allowed' : 'pointer',
              fontWeight: 950,
              fontSize: 14,
            }}
          >
            Reuse
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 13 }}>
        <div style={{ fontWeight: 800 }}>
          Net points this hole: <strong>{holePts}</strong>
        </div>
        <div style={{ marginTop: 6, fontWeight: 800 }}>
          Totals: <strong>{totals.total}</strong> <span style={{ opacity: 0.75 }}>(F9 {totals.front}, B9 {totals.back})</span>
        </div>
        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8, fontWeight: 800 }}>Progress: {doneCount}/18 holes entered</div>
      </div>
    </div>
  );
}
