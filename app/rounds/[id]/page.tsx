'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

import { supabase } from '@/lib/supabaseClient';
import { stablefordPoints } from '@/lib/stableford';
import { netStablefordPointsForHole as netStablefordPointsForHoleLib } from '@/lib/stableford';
import { recalcAndSaveTourHandicaps } from '@/lib/handicaps/recalcAndSaveTourHandicaps';

type Round = {
  id: string;
  tour_id: string;
  name: string;
  course_id: string | null;
  courses?: { name: string } | null;
  played_on: string | null;
  is_locked: boolean;
};

type Player = {
  id: string;
  name: string;
  start_handicap: number | null;
  tour_id: string | null;
};

type RoundPlayer = Player & {
  playing_handicap: number;
  playing: boolean;
};

type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean;
};

function buildAbsoluteUrl(path: string) {
  if (typeof window === 'undefined') return path;
  const origin = window.location.origin;
  return `${origin}${path.startsWith('/') ? path : `/${path}`}`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function RoundScoringPage() {
  const params = useParams();
  const roundId = (params?.id as string) || '';

  const [round, setRound] = useState<Round | null>(null);
  const [players, setPlayers] = useState<RoundPlayer[]>([]);
  const [scores, setScores] = useState<Record<string, string[]>>({});
  const [errorMsg, setErrorMsg] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  const [parsByHole, setParsByHole] = useState<number[]>(Array(18).fill(0));
  const [strokeIndexByHole, setStrokeIndexByHole] = useState<number[]>(Array(18).fill(0));

  // DB-backed lock state
  const [isLocked, setIsLocked] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);

  // ✅ Tour players always available (used for "add players anytime")
  const [tourPlayers, setTourPlayers] = useState<Player[]>([]);
  const [assignBusy, setAssignBusy] = useState(false);

  // DB-derived completeness
  const [completeCountDb, setCompleteCountDb] = useState(0);
  const [totalPlayingDb, setTotalPlayingDb] = useState(0);

  // Copy links UX
  const [copyMsg, setCopyMsg] = useState('');
  const [copyBusyKey, setCopyBusyKey] = useState<string>('');

  // Buddy dropdown state: selected buddy for each "me" player
  const [buddyByMe, setBuddyByMe] = useState<Record<string, string>>({});

  const holes = useMemo(() => Array.from({ length: 18 }, (_, i) => i + 1), []);

  useEffect(() => {
    if (!roundId) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  async function loadAll() {
    if (!roundId || roundId === 'undefined' || roundId === 'null') {
      setErrorMsg(`Invalid round id in URL: "${roundId}"`);
      return;
    }

    setErrorMsg('');
    setSavedMsg('');
    setCopyMsg('');

    // 1) load round (includes is_locked)
    const { data: roundData, error: roundError } = await supabase
      .from('rounds')
      .select(
        `
        id,
        tour_id,
        name,
        course_id,
        is_locked,
        courses ( name )
      `
      )
      .eq('id', roundId)
      .single();

    if (roundError) {
      setErrorMsg(roundError.message);
      return;
    }
    if (!roundData?.id) {
      setErrorMsg('Round not found.');
      return;
    }

    const r = roundData as Round;
    setRound(r);
    setIsLocked(r.is_locked === true);

    // 1b) load pars
    if (!r.course_id) {
      setErrorMsg('This round has no course assigned, so pars cannot be loaded.');
      return;
    }

    const { data: parData, error: parError } = await supabase
      .from('pars')
      .select('hole_number, par, stroke_index')
      .eq('course_id', r.course_id)
      .order('hole_number');

    if (parError) {
      setErrorMsg(parError.message);
      return;
    }

    const parArr = Array(18).fill(0) as number[];
    const siArr = Array(18).fill(0) as number[];

    for (const row of parData ?? []) {
      const idx = (row as any).hole_number - 1;
      if (idx < 0 || idx >= 18) continue;
      parArr[idx] = (row as any).par ?? 0;
      siArr[idx] = (row as any).stroke_index ?? 0;
    }

    setParsByHole(parArr);
    setStrokeIndexByHole(siArr);

    if (!r.tour_id || r.tour_id === 'undefined') {
      setErrorMsg(`Round has invalid tour_id: "${String(r.tour_id)}"`);
      return;
    }

    // ✅ Always load tour players (so we can add players anytime)
    const { data: tp, error: tpError } = await supabase
      .from('players')
      .select('id, name, start_handicap, tour_id')
      .eq('tour_id', r.tour_id)
      .order('name', { ascending: true });

    if (tpError) {
      setErrorMsg(tpError.message);
      return;
    }
    setTourPlayers((tp ?? []) as Player[]);

    // 2) load round_players
    const { data: rp, error: rpError } = await supabase
      .from('round_players')
      .select(
        `
        player_id,
        playing_handicap,
        playing,
        players (
          id,
          name,
          start_handicap,
          tour_id
        )
      `
      )
      .eq('round_id', r.id)
      .order('created_at', { ascending: true });

    if (rpError) {
      setErrorMsg(rpError.message);
      return;
    }

    const roundPlayerRows = Array.isArray(rp) ? rp : [];

    const ps: RoundPlayer[] = roundPlayerRows.map((row: any) => ({
      id: row.players.id,
      name: row.players.name,
      start_handicap: row.players.start_handicap,
      tour_id: row.players.tour_id,
      playing_handicap: row.playing_handicap ?? 0,
      playing: row.playing ?? false,
    }));

    setPlayers(ps);

    // Keep buddy selections valid after reload
    setBuddyByMe((prev) => {
      const validIds = new Set(ps.map((p) => p.id));
      const next: Record<string, string> = {};
      for (const [meId, buddyId] of Object.entries(prev)) {
        if (!validIds.has(meId)) continue;
        if (!buddyId) continue;
        if (!validIds.has(buddyId)) continue;
        if (buddyId === meId) continue;
        next[meId] = buddyId;
      }
      return next;
    });

    // If no round players exist, stop here (we still show "add players" UI)
    if (ps.length === 0) {
      setScores({});
      setCompleteCountDb(0);
      setTotalPlayingDb(0);
      return;
    }

    // initialize scores state for local grid display
    const initial: Record<string, string[]> = {};
    for (const p of ps) initial[p.id] = Array(18).fill('');
    setScores(initial);

    // 3) load existing scores (if any)
    const { data: scoreData, error: scoreError } = await supabase
      .from('scores')
      .select('round_id, player_id, hole_number, strokes, pickup')
      .eq('round_id', r.id);

    if (scoreError) {
      setErrorMsg(scoreError.message);
      return;
    }

    const scoreRows = (scoreData ?? []) as ScoreRow[];

    // fill into local UI state
    setScores((prev) => {
      const copy: Record<string, string[]> = { ...prev };
      for (const row of scoreRows) {
        if (!copy[row.player_id]) copy[row.player_id] = Array(18).fill('');
        const idx = row.hole_number - 1;
        if (idx < 0 || idx >= 18) continue;
        copy[row.player_id] = [...copy[row.player_id]];

        const pickup = (row as any).pickup === true;
        copy[row.player_id][idx] = pickup ? 'P' : row.strokes == null ? '' : String(row.strokes);
      }
      return copy;
    });

    computeDbCompleteness(ps, scoreRows);
  }

  function computeDbCompleteness(ps: RoundPlayer[], scoreRows: ScoreRow[]) {
    const playingPlayers = ps.filter((p) => p.playing);
    setTotalPlayingDb(playingPlayers.length);

    const doneHolesByPlayer: Record<string, Set<number>> = {};
    for (const p of playingPlayers) doneHolesByPlayer[p.id] = new Set<number>();

    for (const row of scoreRows) {
      if (!doneHolesByPlayer[row.player_id]) continue;
      const hole = row.hole_number;
      if (hole < 1 || hole > 18) continue;

      const pickup = (row as any).pickup === true;
      const hasStrokes = row.strokes != null && Number.isFinite(row.strokes);

      if (pickup || hasStrokes) doneHolesByPlayer[row.player_id].add(hole);
    }

    const completeCount = playingPlayers.filter((p) => doneHolesByPlayer[p.id]?.size === 18).length;
    setCompleteCountDb(completeCount);
  }

  function setStroke(playerId: string, holeIndex: number, value: string) {
    setSavedMsg('');
    setScores((prev) => {
      const arr = prev[playerId] ? [...prev[playerId]] : Array(18).fill('');
      arr[holeIndex] = value;
      return { ...prev, [playerId]: arr };
    });
  }

  async function saveAllScores() {
    if (isLocked) return;
    setErrorMsg('');
    setSavedMsg('');
    if (!round) return;

    const rows: ScoreRow[] = [];
    for (const p of players) {
      const arr = scores[p.id] ?? Array(18).fill('');
      for (let i = 0; i < 18; i++) {
        const raw = (arr[i] ?? '').trim().toUpperCase();
        const isPickup = raw === 'P';

        rows.push({
          round_id: roundId,
          player_id: p.id,
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
      return;
    }

    // ✅ NEW: After scores save, if round is complete -> recalc + save handicaps
    // This will only write when ALL "playing" players have 18 holes entered.
    const tourId = round.tour_id;
    if (tourId) {
      const res = await recalcAndSaveTourHandicaps({
        supabase,
        tourId,
        onlyIfRoundCompleteId: roundId,
      });

      if (!res.ok) {
        // Don’t block saving scores; just show a clear message
        setErrorMsg(`Scores saved, but handicap save failed: ${res.error}`);
      }
    }

    setSavedMsg('Saved!');
    await loadAll();
  }

  async function toggleLock() {
    if (!round) return;
    if (lockBusy) return;

    setErrorMsg('');
    setSavedMsg('');
    setLockBusy(true);

    const nextLocked = !isLocked;
    const { error } = await supabase.from('rounds').update({ is_locked: nextLocked }).eq('id', round.id);

    setLockBusy(false);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    setIsLocked(nextLocked);
    setRound((prev) => (prev ? { ...prev, is_locked: nextLocked } : prev));
    setSavedMsg(nextLocked ? 'Round locked.' : 'Round unlocked.');
  }

  function setPlayingHandicapLocal(playerId: string, value: number) {
    setPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, playing_handicap: value } : p)));
  }

  async function updatePlayingHandicap(playerId: string, value: number) {
    if (isLocked) return;
    if (!round) return;

    const safeValue = Number.isFinite(value) ? value : 0;

    const { error } = await supabase
      .from('round_players')
      .update({ playing_handicap: safeValue })
      .eq('round_id', round.id)
      .eq('player_id', playerId);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    setPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, playing_handicap: safeValue } : p)));
  }

  function strokesReceivedOnHole(playingHandicap: number, holeIndex: number): number {
    const h = Math.max(0, Math.floor(playingHandicap));
    if (h === 0) return 0;

    const base = Math.floor(h / 18);
    const rem = h % 18;

    const si = strokeIndexByHole[holeIndex];
    if (!Number.isFinite(si) || si <= 0) return base;

    const extra = si <= rem ? 1 : 0;
    return base + extra;
  }

  function netStablefordPointsForHole(playerId: string, holeIndex: number): number {
    const raw = (scores[playerId]?.[holeIndex] ?? '').toString();

    const par = parsByHole[holeIndex];
    const si = strokeIndexByHole[holeIndex];

    if (!par || !si) return 0;

    const p = players.find((x) => x.id === playerId);
    const hcp = p?.playing_handicap ?? 0;

    return netStablefordPointsForHoleLib({
      rawScore: raw,
      par,
      strokeIndex: si,
      playingHandicap: hcp,
    });
  }

  const activePlayers = players.filter((p) => p.playing);

  const totalsByPlayerId: Record<string, { front: number; back: number; total: number }> = {};
  for (const p of activePlayers) {
    let front = 0;
    let back = 0;
    for (let i = 0; i < 9; i++) front += netStablefordPointsForHole(p.id, i);
    for (let i = 9; i < 18; i++) back += netStablefordPointsForHole(p.id, i);
    totalsByPlayerId[p.id] = { front, back, total: front + back };
  }

  const leaderboardRows = activePlayers
    .map((p) => ({
      playerId: p.id,
      name: p.name,
      front: totalsByPlayerId[p.id]?.front ?? 0,
      back: totalsByPlayerId[p.id]?.back ?? 0,
      total: totalsByPlayerId[p.id]?.total ?? 0,
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.back !== a.back) return b.back - a.back;
      return a.name.localeCompare(b.name);
    });

  async function setPlayingToday(playerId: string, playing: boolean) {
    if (isLocked) return;
    if (!round?.id) return;

    const { error } = await supabase
      .from('round_players')
      .update({ playing })
      .eq('round_id', round.id)
      .eq('player_id', playerId);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    setPlayers((prev) => prev.map((p) => (p.id === playerId ? { ...p, playing } : p)));
    await loadAll();
  }

  async function assignPlayerToRound(p: Player) {
    if (!round) return;
    if (isLocked) return;

    setErrorMsg('');
    setSavedMsg('');
    setAssignBusy(true);

    const { error } = await supabase.from('round_players').insert({
      round_id: round.id,
      player_id: p.id,
      playing: true,
      playing_handicap: p.start_handicap ?? 0,
    });

    setAssignBusy(false);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    await loadAll();
  }

  async function assignAllPlayersToRound(list: Player[]) {
    if (!round) return;
    if (isLocked) return;
    if (list.length === 0) return;

    setErrorMsg('');
    setSavedMsg('');
    setAssignBusy(true);

    const rows = list.map((p) => ({
      round_id: round.id,
      player_id: p.id,
      playing: true,
      playing_handicap: p.start_handicap ?? 0,
    }));

    const { error } = await supabase.from('round_players').insert(rows);

    setAssignBusy(false);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    await loadAll();
  }

  async function handleCopy(key: string, urlPath: string) {
    setCopyMsg('');
    setErrorMsg('');
    setCopyBusyKey(key);

    const abs = buildAbsoluteUrl(urlPath);
    const ok = await copyToClipboard(abs);

    setCopyBusyKey('');
    setCopyMsg(ok ? 'Copied link ✓' : 'Copy failed (browser blocked clipboard)');
  }

  function roundSetupPath() {
    return `/rounds/${roundId}/mobile`;
  }

  function meOnlyPath(playerId: string) {
    return `/rounds/${roundId}/mobile/score?me=${encodeURIComponent(playerId)}`;
  }

  function meBuddyPath(mePlayerId: string, buddyPlayerId: string) {
    return `/rounds/${roundId}/mobile/score?me=${encodeURIComponent(mePlayerId)}&buddy=${encodeURIComponent(
      buddyPlayerId
    )}`;
  }

  const sortedPlayersByName = useMemo(() => {
    return players.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [players]);

  const sortedTourPlayersByName = useMemo(() => {
    return tourPlayers.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, [tourPlayers]);

  const playersInRoundIdSet = useMemo(() => new Set(players.map((p) => p.id)), [players]);

  const remainingTourPlayers = useMemo(() => {
    return sortedTourPlayersByName.filter((tp) => !playersInRoundIdSet.has(tp.id));
  }, [sortedTourPlayersByName, playersInRoundIdSet]);

  if (!round) {
    return (
      <div style={{ padding: 20 }}>
        <h1>Round</h1>
        {errorMsg && <p style={{ color: 'red' }}>Error: {errorMsg}</p>}
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      {round.tour_id && (
        <div style={{ marginBottom: 10 }}>
          <Link href={`/tours/${round.tour_id}`} style={{ textDecoration: 'underline' }}>
            ← Back to Tour
          </Link>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Round: {round.name}</h1>

          {round.courses?.name && (
            <p style={{ marginTop: 8, marginBottom: 0 }}>
              <strong>Course:</strong> {round.courses.name}
            </p>
          )}

          <div style={{ marginTop: 10 }}>
            {isLocked ? (
              <span style={{ color: '#b91c1c', fontWeight: 800 }}>🔒 LOCKED</span>
            ) : (
              <span style={{ color: '#15803d', fontWeight: 800 }}>🟢 EDITABLE</span>
            )}

            <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>
              <strong>
                {completeCountDb}/{totalPlayingDb}
              </strong>{' '}
              players complete
              {totalPlayingDb === 0 && players.length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.75 }}>(tick “playing” to start)</span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={toggleLock}
          disabled={lockBusy}
          style={{
            padding: '6px 10px',
            borderRadius: 6,
            border: '1px solid #ccc',
            background: isLocked ? '#fff' : '#fee2e2',
            color: isLocked ? '#111827' : '#991b1b',
            cursor: lockBusy ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
            height: 34,
            opacity: lockBusy ? 0.8 : 1,
          }}
          title={lockBusy ? 'Updating lock…' : isLocked ? 'Unlock round' : 'Lock round'}
        >
          {lockBusy ? 'Working…' : isLocked ? 'Unlock round' : 'Lock round'}
        </button>
      </div>

      {errorMsg && <p style={{ color: 'red' }}>Error: {errorMsg}</p>}
      {savedMsg && <p style={{ color: 'green' }}>{savedMsg}</p>}
      {copyMsg && <p style={{ color: '#0f766e' }}>{copyMsg}</p>}

      {/* ✅ Add players anytime */}
      <div style={{ marginTop: 14, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <h3 style={{ marginTop: 0, marginBottom: 6 }}>Add players to this round</h3>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {players.length} assigned • {remainingTourPlayers.length} remaining in tour
          </div>
        </div>

        <div style={{ fontSize: 13, opacity: 0.9 }}>
          Add any tour player to <code>round_players</code> at any time. Newly added players will appear immediately.
        </div>

        {remainingTourPlayers.length === 0 ? (
          <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>All tour players are already in this round.</div>
        ) : (
          <>
            <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => assignAllPlayersToRound(remainingTourPlayers)}
                disabled={assignBusy || isLocked}
                style={{ padding: '8px 10px' }}
                title={isLocked ? 'Round is locked' : 'Add all remaining players to this round'}
              >
                {assignBusy ? 'Adding…' : `Add all remaining (${remainingTourPlayers.length})`}
              </button>

              <span style={{ fontSize: 12, opacity: 0.75 }}>
                By default new players are added as <strong>playing</strong> with handicap from their start handicap.
              </span>
            </div>

            <div
              style={{
                marginTop: 10,
                maxHeight: 240,
                overflow: 'auto',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
              }}
            >
              <table cellPadding={8} style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Tour player</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Start HCP</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }} />
                  </tr>
                </thead>
                <tbody>
                  {remainingTourPlayers.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 700 }}>{p.name}</td>
                      <td style={{ opacity: 0.8 }}>{p.start_handicap ?? 0}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => assignPlayerToRound(p)}
                          disabled={assignBusy || isLocked}
                          style={{ padding: '6px 10px' }}
                          title={isLocked ? 'Round is locked' : 'Add player to round'}
                        >
                          {assignBusy ? 'Working…' : 'Add'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Mobile link sharing with buddy dropdown */}
      <div style={{ marginTop: 14, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>Send players mobile link</h3>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => handleCopy('setup', roundSetupPath())}
            disabled={copyBusyKey === 'setup'}
            style={{ padding: '8px 10px' }}
            title="Copy the setup page (player selects Me/Buddy)"
          >
            {copyBusyKey === 'setup' ? 'Copying…' : 'Copy setup link'}
          </button>

          <button type="button" onClick={() => loadAll()} style={{ padding: '8px 10px' }} title="Refresh from DB">
            Refresh
          </button>

          <span style={{ fontSize: 12, opacity: 0.75 }}>
            Tip: send each player their <strong>Me</strong> link so it opens straight into scoring.
          </span>
        </div>

        {players.length > 0 ? (
          <div style={{ marginTop: 10, overflowX: 'auto' }}>
            <table cellPadding={6} style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Player</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Me link</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Buddy link (optional)</th>
                </tr>
              </thead>

              <tbody>
                {sortedPlayersByName.map((p) => {
                  const meLinkPath = meOnlyPath(p.id);
                  const selectedBuddyId = buddyByMe[p.id] ?? '';
                  const selectedBuddy = players.find((x) => x.id === selectedBuddyId) ?? null;

                  const meBuddyPathVal = selectedBuddyId ? meBuddyPath(p.id, selectedBuddyId) : '';

                  return (
                    <tr key={p.id}>
                      <td style={{ verticalAlign: 'top' }}>
                        <div style={{ fontWeight: 700 }}>{p.name}</div>
                        <div style={{ fontSize: 12, opacity: 0.75 }}>
                          {p.playing ? 'Playing today' : 'Not playing'} • HCP {p.playing_handicap}
                        </div>
                      </td>

                      <td style={{ verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => handleCopy(`me:${p.id}`, meLinkPath)}
                            disabled={copyBusyKey === `me:${p.id}`}
                            style={{ padding: '6px 10px' }}
                            title="Copy link that opens scoring directly for this player"
                          >
                            {copyBusyKey === `me:${p.id}` ? 'Copying…' : 'Copy'}
                          </button>
                          <span style={{ fontSize: 12, opacity: 0.75 }}>{buildAbsoluteUrl(meLinkPath)}</span>
                        </div>
                      </td>

                      <td style={{ verticalAlign: 'top' }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <select
                            value={selectedBuddyId}
                            onChange={(e) => {
                              const val = e.target.value;
                              setBuddyByMe((prev) => ({ ...prev, [p.id]: val }));
                            }}
                            style={{ padding: '6px 8px' }}
                            aria-label={`Select buddy for ${p.name}`}
                          >
                            <option value="">Select buddy…</option>
                            {sortedPlayersByName
                              .filter((b) => b.id !== p.id)
                              .map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.name}
                                </option>
                              ))}
                          </select>

                          <button
                            type="button"
                            disabled={!selectedBuddyId || copyBusyKey === `mebuddy:${p.id}`}
                            onClick={() => {
                              if (!selectedBuddyId) return;
                              handleCopy(`mebuddy:${p.id}`, meBuddyPathVal);
                            }}
                            style={{
                              padding: '6px 10px',
                              opacity: !selectedBuddyId ? 0.6 : 1,
                              cursor: !selectedBuddyId ? 'not-allowed' : 'pointer',
                            }}
                            title={
                              selectedBuddy
                                ? `Copy a link that opens with Me=${p.name} and Buddy=${selectedBuddy.name}`
                                : 'Select a buddy first'
                            }
                          >
                            {copyBusyKey === `mebuddy:${p.id}` ? 'Copying…' : 'Copy Me + Buddy'}
                          </button>

                          {selectedBuddyId && (
                            <div style={{ fontSize: 12, opacity: 0.75 }}>{buildAbsoluteUrl(meBuddyPathVal)}</div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>No round players yet.</div>
        )}
      </div>

      {/* Main scoring UI */}
      {players.length === 0 ? (
        <div style={{ marginTop: 16, padding: 12, border: '1px solid #ddd', borderRadius: 8 }}>
          <h3 style={{ marginTop: 0 }}>No players assigned yet</h3>
          <p style={{ marginTop: 0, opacity: 0.85 }}>
            Add players above to create <code>round_players</code> rows, then the scorecard will appear here.
          </p>
        </div>
      ) : (
        <>
          <button
            onClick={saveAllScores}
            disabled={isLocked}
            style={{
              marginTop: 12,
              marginBottom: 12,
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #ccc',
              background: isLocked ? '#e5e7eb' : '#fff',
              color: isLocked ? '#6b7280' : '#111827',
              cursor: isLocked ? 'not-allowed' : 'pointer',
              opacity: isLocked ? 0.8 : 1,
            }}
            title={isLocked ? 'Round is locked' : 'Save all scores'}
          >
            Save All Scores
          </button>

          <div style={{ overflowX: 'auto' }}>
            <table border={1} cellPadding={6}>
              <thead>
                <tr>
                  <th>Player</th>

                  {holes.map((h, idx) => (
                    <th key={h}>
                      <div>H{h}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>Par {parsByHole[idx] || '-'}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>SI {strokeIndexByHole[idx] || '-'}</div>
                    </th>
                  ))}

                  <th>F9</th>
                  <th>B9</th>
                  <th>Total</th>
                </tr>
              </thead>

              <tbody>
                {players.map((p) => (
                  <tr key={p.id} style={!p.playing ? { opacity: 0.5 } : undefined}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="checkbox"
                          checked={p.playing}
                          onChange={(e) => setPlayingToday(p.id, e.target.checked)}
                          disabled={isLocked}
                          title={isLocked ? 'Round is locked' : 'Set playing'}
                        />
                        <div>{p.name}</div>
                      </div>

                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                        <span>Playing handicap: </span>

                        <input
                          type="number"
                          value={p.playing_handicap}
                          onChange={(e) => setPlayingHandicapLocal(p.id, Number(e.target.value))}
                          onBlur={(e) => updatePlayingHandicap(p.id, Number(e.target.value))}
                          style={{ width: 60 }}
                          disabled={isLocked || !p.playing}
                          title={isLocked ? 'Round is locked' : !p.playing ? 'Not playing' : 'Edit handicap'}
                        />

                        <button
                          type="button"
                          onClick={() => {
                            const resetValue = p.start_handicap ?? 0;
                            setPlayingHandicapLocal(p.id, resetValue);
                            updatePlayingHandicap(p.id, resetValue);
                          }}
                          disabled={isLocked || !p.playing}
                          style={{ marginLeft: 8, fontSize: 12 }}
                          title={isLocked ? 'Round is locked' : !p.playing ? 'Not playing' : 'Reset to start handicap'}
                        >
                          Reset
                        </button>
                      </div>
                    </td>

                    {holes.map((h, idx) => (
                      <td key={h}>
                        <input
                          style={{
                            width: 50,
                            background: isLocked || !p.playing ? '#f3f4f6' : undefined,
                            color: isLocked || !p.playing ? '#6b7280' : undefined,
                            cursor: isLocked || !p.playing ? 'not-allowed' : 'text',
                          }}
                          type="text"
                          inputMode="numeric"
                          value={scores[p.id]?.[idx] ?? ''}
                          onChange={(e) => setStroke(p.id, idx, e.target.value)}
                          disabled={isLocked || !p.playing}
                          title={isLocked ? 'Round is locked' : !p.playing ? 'Not playing' : 'Enter score or P'}
                        />

                        {p.playing &&
                          (() => {
                            const raw = (scores[p.id]?.[idx] ?? '').trim().toUpperCase();
                            const parHere = parsByHole[idx];

                            if (!parHere) return null;
                            if (!raw) return null;

                            if (raw === 'P') {
                              return <div style={{ fontSize: 12, opacity: 0.8 }}>Pts: 0</div>;
                            }

                            const strokes = Number(raw);
                            if (!Number.isFinite(strokes) || strokes <= 0) return null;

                            const received = strokesReceivedOnHole(p.playing_handicap, idx);
                            const netStrokes = strokes - received;
                            const pts = stablefordPoints(netStrokes, parHere);

                            return (
                              <div style={{ fontSize: 12, opacity: 0.8 }}>
                                Pts: {pts}
                                {received > 0 ? ` (−${received})` : ''}
                              </div>
                            );
                          })()}
                      </td>
                    ))}

                    <td>{p.playing ? totalsByPlayerId[p.id]?.front ?? 0 : 0}</td>
                    <td>{p.playing ? totalsByPlayerId[p.id]?.back ?? 0 : 0}</td>
                    <td>
                      <strong>{p.playing ? totalsByPlayerId[p.id]?.total ?? 0 : 0}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ marginTop: 16 }}>
              <h3>Leaderboard (Stableford)</h3>
              <ol>
                {leaderboardRows.map((row) => (
                  <li key={row.playerId}>
                    {row.name}: <strong>{row.total}</strong> (F9 {row.front}, B9 {row.back})
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
