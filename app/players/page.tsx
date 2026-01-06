'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

type Player = {
  id: string;
  name: string;
  start_handicap: number | null;
};

type Tour = {
  id: string;
  name: string;
};


export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [name, setName] = useState('');
  const [handicap, setHandicap] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [tours, setTours] = useState<Tour[]>([]);
const [selectedTourId, setSelectedTourId] = useState('');


  useEffect(() => {
    loadTours();
    loadPlayers();

  }, []);

  async function loadTours() {
  setErrorMsg('');
  const { data, error } = await supabase.from('tours').select('*');

  if (error) {
    setErrorMsg(error.message);
    return;
  }

  if (data) setTours(data as Tour[]);
}


  async function loadPlayers() {
    setErrorMsg('');
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    if (data) setPlayers(data as Player[]);
  }

  async function addPlayer() {
  setErrorMsg('');
  if (!name.trim()) return;

  const tourIdToSave = selectedTourId ? selectedTourId : null;
  console.log('Saving player with tour_id:', tourIdToSave);

  const { data, error } = await supabase
    .from('players')
    .insert({
      name: name.trim(),
      start_handicap: handicap ? Number(handicap) : null,
      tour_id: tourIdToSave,
    })
    .select();

  if (error) {
    setErrorMsg(error.message);
    console.log('addPlayer error:', error);
    return;
  }

  console.log('Inserted row:', data);

  setName('');
  setHandicap('');
  loadPlayers();
}


  return (
    <div style={{ padding: 20 }}>
      <h1>Players</h1>

      <div style={{ marginBottom: 12 }}>
  <label style={{ marginRight: 8 }}>Tour:</label>
  <select value={selectedTourId} onChange={e => setSelectedTourId(e.target.value)}>
    <option value="">(No tour)</option>
    {tours.map(t => (
      <option key={t.id} value={t.id}>{t.name}</option>
    ))}
  </select>
</div>

<p>Selected tour id: {selectedTourId || '(none selected)'}</p>

      {errorMsg && <p style={{ color: 'red' }}>Error: {errorMsg}</p>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          placeholder="Player name"
          value={name}
          onChange={e => setName(e.target.value)}
        />

        <input
          placeholder="Handicap"
          type="number"
          value={handicap}
          onChange={e => setHandicap(e.target.value)}
        />

        <button onClick={addPlayer}>Add Player</button>
      </div>

      <ul>
        {players.map(p => (
          <li key={p.id}>
            {p.name} {p.start_handicap !== null && `(HC ${p.start_handicap})`}
          </li>
        ))}
      </ul>
    </div>
  );
}
