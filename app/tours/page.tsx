'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Link from "next/link";


type Tour = {
  id: string;
  name: string;
};

export default function ToursPage() {
  const [tours, setTours] = useState<Tour[]>([]);
  const [name, setName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    loadTours();
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

  async function addTour() {
    setErrorMsg('');
    if (!name.trim()) return;

    const { error } = await supabase.from('tours').insert({
      name: name.trim(),
    });

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    setName('');
    loadTours();
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Tours</h1>

      {errorMsg && <p style={{ color: 'red' }}>Error: {errorMsg}</p>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          placeholder="Tour name"
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <button onClick={addTour}>Add Tour</button>
      </div>

    <ul>
  
{tours.map((t) => (
  <li key={t.id}>
    {t.name}{" "}
    <a href={`/tours/${t.id}`}>View</a>{" "}
    |{" "}
    <a href={`/tours/${t.id}/leaderboard`}>Leaderboard</a>
  </li>
))}
</ul>

</div>
);
}
