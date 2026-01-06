"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { supabase } from "@/lib/supabaseClient";

type Tour = { id: string; name: string };
type Course = { id: string; tour_id: string; name: string };
type Player = { id: string; tour_id: string; name: string; start_handicap: number };
type Round = { id: string; tour_id: string; course_id: string; name: string; created_at: string | null };

export default function TourPage() {
  const params = useParams<{ id: string }>();
  const tourId = params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const [tour, setTour] = useState<Tour | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);

  // Form state
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newPlayerHandicap, setNewPlayerHandicap] = useState<number>(0);

  const [newCourseName, setNewCourseName] = useState("");

  const [newRoundName, setNewRoundName] = useState("");
  const [newRoundCourseId, setNewRoundCourseId] = useState<string>("");

  async function loadAll() {
    setLoading(true);
    setError("");
    setMsg("");

    const { data: tourData, error: tourErr } = await supabase
      .from("tours")
      .select("id,name")
      .eq("id", tourId)
      .single();

    if (tourErr) {
      setError(tourErr.message);
      setLoading(false);
      return;
    }
    setTour(tourData as Tour);

    const { data: courseData, error: courseErr } = await supabase
      .from("courses")
      .select("id,tour_id,name")
      .eq("tour_id", tourId)
      .order("name", { ascending: true });

    if (courseErr) {
      setError(courseErr.message);
      setLoading(false);
      return;
    }
    const courseList = (courseData ?? []) as Course[];
    setCourses(courseList);

    const { data: playerData, error: playerErr } = await supabase
      .from("players")
      .select("id,tour_id,name,start_handicap")
      .eq("tour_id", tourId)
      .order("name", { ascending: true });

    if (playerErr) {
      setError(playerErr.message);
      setLoading(false);
      return;
    }
    setPlayers((playerData ?? []) as Player[]);

    const { data: roundData, error: roundErr } = await supabase
      .from("rounds")
      .select("id,tour_id,course_id,name,created_at")
      .eq("tour_id", tourId)
      .order("created_at", { ascending: true });

    if (roundErr) {
      setError(roundErr.message);
      setLoading(false);
      return;
    }
  const roundList = (roundData ?? []) as Round[];
setRounds(roundList);

// ✅ Auto-fill the next round name if empty
const nextRoundNumber = roundList.length + 1;
if (!newRoundName.trim()) {
  setNewRoundName(`Round ${nextRoundNumber}`);
}


    // sensible default course for new round dropdown
    if (!newRoundCourseId && courseList.length > 0) {
      setNewRoundCourseId(courseList[0].id);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  const courseNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of courses) m[c.id] = c.name;
    return m;
  }, [courses]);

  async function addPlayer() {
    const name = newPlayerName.trim();
    if (!name) return;

    setSaving(true);
    setError("");
    setMsg("");

    const { error: insErr } = await supabase.from("players").insert([
      {
        tour_id: tourId,
        name,
        start_handicap: Number(newPlayerHandicap) || 0,
      },
    ]);

    if (insErr) {
      setError(insErr.message);
      setSaving(false);
      return;
    }

    setNewPlayerName("");
    setNewPlayerHandicap(0);
    setMsg("Player added.");
    await loadAll();
    setSaving(false);
  }

  async function addCourse() {
    const name = newCourseName.trim();
    if (!name) return;

    setSaving(true);
    setError("");
    setMsg("");

    const { error: insErr } = await supabase.from("courses").insert([{ tour_id: tourId, name }]);

    if (insErr) {
      setError(insErr.message);
      setSaving(false);
      return;
    }

    setNewCourseName("");
    setMsg("Course added.");
    await loadAll();
    setSaving(false);
  }

  async function addRound() {
    const name = newRoundName.trim();

    if (!name) {
      setError("Please enter a round name.");
      return;
    }

    if (!newRoundCourseId) {
      setError("Please choose a course for the round.");
      return;
    }

    setSaving(true);
    setError("");
    setMsg("");

    // 1) Create round (name is required by your DB)
    const { data: insertedRound, error: roundErr } = await supabase
      .from("rounds")
      .insert([{ tour_id: tourId, course_id: newRoundCourseId, name }])
      .select("id")
      .single();

    if (roundErr) {
      setError(roundErr.message);
      setSaving(false);
      return;
    }

    const roundId = insertedRound?.id;
    if (!roundId) {
      setError("Round created but no round id returned.");
      setSaving(false);
      return;
    }

    // 2) Seed round_players for all tour players (so round page has checkboxes)
    if (players.length > 0) {
      const rows = players.map((p) => ({
        round_id: roundId,
        player_id: p.id,
        playing: false,
        playing_handicap: p.start_handicap ?? 0,
      }));

      const { error: rpErr } = await supabase.from("round_players").insert(rows);

      if (rpErr) {
        setError(rpErr.message);
        setSaving(false);
        return;
      }
    }

    setMsg("Round created.");
    setNewRoundName("");
    await loadAll();
    setSaving(false);

    // Jump into the new round
    window.location.href = `/rounds/${roundId}`;
  }

  if (loading) return <div style={{ padding: 16 }}>Loading tour…</div>;

  if (error)
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: "crimson", fontWeight: 700 }}>Error</div>
        <div style={{ marginTop: 8 }}>{error}</div>
      </div>
    );

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <Link href="/tours">← Back to Tours</Link>
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 700 }}>{tour?.name ?? "Tour"}</h1>

      <div style={{ marginTop: 8 }}>
        <Link href={`/tours/${tourId}/leaderboard`}>View Tour Leaderboard</Link>
      </div>

      {msg && <div style={{ marginTop: 10, color: "green" }}>{msg}</div>}

      {/* Players */}
      <h2 style={{ marginTop: 24, fontSize: 18, fontWeight: 700 }}>Players</h2>

      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <input
          value={newPlayerName}
          onChange={(e) => setNewPlayerName(e.target.value)}
          placeholder="New player name"
          style={{ padding: 8, width: 220 }}
        />

        <input
          type="number"
          value={newPlayerHandicap}
          onChange={(e) => setNewPlayerHandicap(Number(e.target.value))}
          placeholder="Start handicap"
          style={{ padding: 8, width: 140 }}
        />

        <button onClick={addPlayer} disabled={saving || !newPlayerName.trim()}>
          Add player
        </button>
      </div>

      {players.length === 0 ? (
        <div style={{ marginTop: 8, color: "#555" }}>No players yet.</div>
      ) : (
        <ul style={{ marginTop: 8 }}>
          {players.map((p) => (
            <li key={p.id}>
              {p.name} <span style={{ color: "#777" }}>(start hcp: {p.start_handicap})</span>
            </li>
          ))}
        </ul>
      )}

      {/* Courses */}
      <h2 style={{ marginTop: 24, fontSize: 18, fontWeight: 700 }}>Courses</h2>

      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <input
          value={newCourseName}
          onChange={(e) => setNewCourseName(e.target.value)}
          placeholder="New course name"
          style={{ padding: 8, width: 260 }}
        />
        <button onClick={addCourse} disabled={saving || !newCourseName.trim()}>
          Add course
        </button>
      </div>

      {courses.length === 0 ? (
        <div style={{ marginTop: 8, color: "#555" }}>No courses yet.</div>
      ) : (
        <ul style={{ marginTop: 8 }}>
          {courses.map((c) => (
            <li key={c.id}>{c.name}</li>
          ))}
        </ul>
      )}

      {/* Rounds */}
      <h2 style={{ marginTop: 24, fontSize: 18, fontWeight: 700 }}>Rounds</h2>

      {courses.length === 0 ? (
        <div style={{ marginTop: 8, color: "#555" }}>Add a course first, then you can create rounds.</div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
          <input
            value={newRoundName}
            onChange={(e) => setNewRoundName(e.target.value)}
            placeholder="Round name (e.g. Round 1)"
            style={{ padding: 8, width: 220 }}
          />

          <select
            value={newRoundCourseId}
            onChange={(e) => setNewRoundCourseId(e.target.value)}
            style={{ padding: 8 }}
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <button onClick={addRound} disabled={saving || !newRoundCourseId || !newRoundName.trim()}>
            Create round
          </button>
        </div>
      )}

      {rounds.length === 0 ? (
        <div style={{ marginTop: 8, color: "#555" }}>No rounds yet.</div>
      ) : (
        <ul style={{ marginTop: 8 }}>
          {rounds.map((r, idx) => (
            <li key={r.id} style={{ marginBottom: 6 }}>
              <strong>{r.name}</strong> — {courseNameById[r.course_id] ?? r.course_id} |{" "}
              <Link href={`/rounds/${r.id}`}>Open</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
