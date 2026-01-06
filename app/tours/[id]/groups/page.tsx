'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';

type Tour = { id: string; name: string; owner_id?: string | null };

type Player = {
  id: string;
  tour_id: string;
  name: string;
};

type TourGroup = {
  id: string;
  tour_id: string;
  scope: 'tour' | 'round';
  type: 'pair' | 'team';
  name: string;
  team_index: number | null;
  round_id: string | null;
};

type TourGroupMember = {
  group_id: string;
  player_id: string;
  position: number | null;
};

type Draft = {
  id: string;
  type: 'pair' | 'team';
  name: string;
  team_index: number;
  memberIds: string[];
  saving?: boolean;
};

function newId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return '00000000-0000-4000-8000-000000000000';
}

export default function TourGroupsPage() {
  const params = useParams();
  const tourId = (params?.id as string) || '';

  const [meId, setMeId] = useState<string | null>(null);
  const [tour, setTour] = useState<Tour | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const playersById = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const pairs = useMemo(
    () => drafts.filter((d) => d.type === 'pair').sort((a, b) => a.team_index - b.team_index),
    [drafts]
  );
  const teams = useMemo(
    () => drafts.filter((d) => d.type === 'team').sort((a, b) => a.team_index - b.team_index),
    [drafts]
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErr('');
      setOk('');

      const { data: uData } = await supabase.auth.getUser();
      const uid = uData.user?.id ?? null;
      if (!cancelled) setMeId(uid);

      const { data: tourRow, error: tourErr } = await supabase
        .from('tours')
        .select('id,name,owner_id')
        .eq('id', tourId)
        .single();

      if (tourErr) {
        if (!cancelled) {
          setErr(tourErr.message);
          setLoading(false);
        }
        return;
      }

      const { data: playerRows, error: playerErr } = await supabase
        .from('players')
        .select('id,tour_id,name')
        .eq('tour_id', tourId)
        .order('name', { ascending: true });

      if (playerErr) {
        if (!cancelled) {
          setErr(playerErr.message);
          setLoading(false);
        }
        return;
      }

      const { data: groupRows, error: groupErr } = await supabase
        .from('tour_groups')
        .select('id,tour_id,scope,type,name,team_index,round_id')
        .eq('tour_id', tourId)
        .eq('scope', 'tour')
        .order('type', { ascending: true })
        .order('team_index', { ascending: true });

      if (groupErr) {
        if (!cancelled) {
          setErr(groupErr.message);
          setLoading(false);
        }
        return;
      }

      const groupIds = (groupRows ?? []).map((g: any) => g.id) as string[];

      let memberRows: TourGroupMember[] = [];
      if (groupIds.length) {
        const { data: members, error: memErr } = await supabase
          .from('tour_group_members')
          .select('group_id,player_id,position')
          .in('group_id', groupIds)
          .order('position', { ascending: true });

        if (memErr) {
          if (!cancelled) {
            setErr(memErr.message);
            setLoading(false);
          }
          return;
        }
        memberRows = (members ?? []) as any;
      }

      const membersByGroup = new Map<string, TourGroupMember[]>();
      for (const m of memberRows) {
        const arr = membersByGroup.get(m.group_id) ?? [];
        arr.push(m);
        membersByGroup.set(m.group_id, arr);
      }

      const built: Draft[] = (groupRows ?? []).map((g: TourGroup) => {
        const ms = membersByGroup.get(g.id) ?? [];
        const ordered = [...ms]
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((x) => x.player_id);

        return {
          id: g.id,
          type: g.type,
          name: g.name,
          team_index: g.team_index ?? 1,
          memberIds: ordered,
        };
      });

      if (!cancelled) {
        setTour(tourRow as any);
        setPlayers((playerRows ?? []) as any);
        setDrafts(built);
        setLoading(false);
      }
    }

    if (tourId) load();
    return () => {
      cancelled = true;
    };
  }, [tourId]);

  function nextIndex(type: 'pair' | 'team') {
    const arr = drafts.filter((d) => d.type === type);
    const max = arr.reduce((m, d) => Math.max(m, d.team_index || 0), 0);
    return max + 1;
  }

  function create(type: 'pair' | 'team') {
    const idx = nextIndex(type);
    setDrafts((prev) => [
      ...prev,
      {
        id: newId(),
        type,
        name: type === 'pair' ? `Pair ${idx}` : `Team ${idx}`,
        team_index: idx,
        memberIds: [],
      },
    ]);
  }

  function update(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function toggleMember(d: Draft, playerId: string) {
    const exists = d.memberIds.includes(playerId);
    let next = exists ? d.memberIds.filter((x) => x !== playerId) : [...d.memberIds, playerId];
    if (d.type === 'pair' && next.length > 2) next = next.slice(next.length - 2);
    update(d.id, { memberIds: next });
  }

  function validate(d: Draft): string | null {
    if (!d.name.trim()) return 'Name is required';
    if (!Number.isFinite(d.team_index) || d.team_index <= 0) return 'Index must be a positive number';
    if (d.type === 'pair' && d.memberIds.length !== 2) return 'Pairs must have exactly 2 members';
    if (d.type === 'team' && d.memberIds.length < 1) return 'Teams must have at least 1 member';
    return null;
  }

  async function save(d: Draft) {
    setErr('');
    setOk('');

    const problem = validate(d);
    if (problem) {
      setErr(`${d.name}: ${problem}`);
      return;
    }

    update(d.id, { saving: true });

    const groupRow: TourGroup = {
      id: d.id,
      tour_id: tourId,
      scope: 'tour',
      type: d.type,
      name: d.name.trim(),
      team_index: d.team_index,
      round_id: null,
    };

    const { error: upErr } = await supabase.from('tour_groups').upsert(groupRow, { onConflict: 'id' });
    if (upErr) {
      update(d.id, { saving: false });
      setErr(upErr.message);
      return;
    }

    const { error: delErr } = await supabase.from('tour_group_members').delete().eq('group_id', d.id);
    if (delErr) {
      update(d.id, { saving: false });
      setErr(delErr.message);
      return;
    }

    const rows = d.memberIds.map((pid, i) => ({
      group_id: d.id,
      player_id: pid,
      position: i + 1,
    }));

    if (rows.length) {
      const { error: insErr } = await supabase.from('tour_group_members').insert(rows);
      if (insErr) {
        update(d.id, { saving: false });
        setErr(insErr.message);
        return;
      }
    }

    update(d.id, { saving: false });
    setOk(`Saved ${d.name}`);
  }

  async function remove(d: Draft) {
    setErr('');
    setOk('');

    const { error: delM } = await supabase.from('tour_group_members').delete().eq('group_id', d.id);
    if (delM) {
      setErr(delM.message);
      return;
    }

    const { error: delG } = await supabase.from('tour_groups').delete().eq('id', d.id);
    if (delG) {
      setErr(delG.message);
      return;
    }

    setDrafts((prev) => prev.filter((x) => x.id !== d.id));
    setOk(`Deleted ${d.name}`);
  }

  if (loading) return <div className="p-4 max-w-3xl mx-auto text-sm text-gray-600">Loading…</div>;

  const ownerId = tour?.owner_id ?? null;

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-gray-600">Tour</div>
          <h1 className="text-xl font-semibold truncate">{tour?.name ?? 'Manage Groups'}</h1>
          <div className="mt-1 flex gap-3 flex-wrap">
            <Link className="text-sm underline" href={`/tours/${tourId}/leaderboard`}>
              ← Back to leaderboard
            </Link>
            <Link className="text-sm underline" href={`/login`}>
              Login
            </Link>
          </div>
        </div>
      </div>

      <div className="rounded-lg border p-3 text-sm space-y-1">
        <div>
          Logged in user: <span className="font-mono">{meId ?? 'NOT LOGGED IN'}</span>
        </div>
        <div>
          Tour owner_id: <span className="font-mono">{ownerId ?? 'NULL'}</span>
        </div>
        <div>
          Loaded players: {players.length} | Loaded groups: {drafts.length}
        </div>
        {ownerId === null ? (
          <div className="text-amber-700">This tour has owner_id = NULL. Set it to your user id in SQL.</div>
        ) : null}
      </div>

      {err ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div> : null}
      {ok ? <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{ok}</div> : null}

      <Section title="Pairs" subtitle="Pick exactly 2 players per pair." onNew={() => create('pair')}>
        {pairs.length === 0 ? <div className="text-sm text-gray-600">No pairs yet.</div> : null}
        <div className="space-y-3">
          {pairs.map((d) => (
            <GroupCard
              key={d.id}
              draft={d}
              players={players}
              playersById={playersById}
              onChange={(patch) => update(d.id, patch)}
              onToggle={(pid) => toggleMember(d, pid)}
              onSave={() => save(d)}
              onDelete={() => remove(d)}
            />
          ))}
        </div>
      </Section>

      <Section title="Teams" subtitle="Pick 1+ players per team." onNew={() => create('team')}>
        {teams.length === 0 ? <div className="text-sm text-gray-600">No teams yet.</div> : null}
        <div className="space-y-3">
          {teams.map((d) => (
            <GroupCard
              key={d.id}
              draft={d}
              players={players}
              playersById={playersById}
              onChange={(patch) => update(d.id, patch)}
              onToggle={(pid) => toggleMember(d, pid)}
              onSave={() => save(d)}
              onDelete={() => remove(d)}
            />
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section(props: { title: string; subtitle?: string; onNew: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{props.title}</h2>
          {props.subtitle ? <div className="text-xs text-gray-600">{props.subtitle}</div> : null}
        </div>
        <button onClick={props.onNew} className="rounded-md bg-black text-white px-3 py-2 text-sm">
          + New
        </button>
      </div>
      {props.children}
    </section>
  );
}

function GroupCard(props: {
  draft: Draft;
  players: Player[];
  playersById: Map<string, Player>;
  onChange: (patch: Partial<Draft>) => void;
  onToggle: (playerId: string) => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  const { draft: d, players, playersById, onChange, onToggle, onSave, onDelete } = props;

  const selected = useMemo(
    () => d.memberIds.map((id) => playersById.get(id)?.name).filter(Boolean).join(', ') || '—',
    [d.memberIds, playersById]
  );

  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-2">
              <div className="text-xs text-gray-600">Name</div>
              <input
                value={d.name}
                onChange={(e) => onChange({ name: e.target.value })}
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </label>

            <label>
              <div className="text-xs text-gray-600">Index</div>
              <input
                value={String(d.team_index)}
                onChange={(e) => onChange({ team_index: Number(e.target.value || 0) })}
                inputMode="numeric"
                className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
              />
            </label>
          </div>

          <div className="text-xs text-gray-600">Members {d.type === 'pair' ? '(max 2 selections)' : ''}</div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {players.map((p) => {
              const active = d.memberIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onToggle(p.id)}
                  className={[
                    'rounded-md border px-3 py-2 text-left text-sm',
                    active ? 'bg-black text-white border-black' : 'bg-white',
                  ].join(' ')}
                >
                  <div className="font-medium truncate">{p.name}</div>
                  <div className="text-xs opacity-80">{active ? 'Selected' : 'Tap to select'}</div>
                </button>
              );
            })}
          </div>

          <div className="text-xs text-gray-500">
            Selected: <span className="text-gray-700">{selected}</span>
          </div>
        </div>

        <div className="shrink-0 flex flex-col gap-2">
          <button
            onClick={onSave}
            disabled={!!d.saving}
            className="rounded-md bg-black text-white px-3 py-2 text-sm disabled:opacity-50"
          >
            {d.saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onDelete} className="rounded-md border px-3 py-2 text-sm">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
