// app/tours/[id]/rounds/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";

type Tour = { id: string; name: string };

type Round = {
  id: string;
  tour_id: string;
  name: string | null;
  created_at: string | null;
  course_id: string | null;

  played_on: string | null; // YYYY-MM-DD
  tee_time: string | null; // HH:MM:SS (or HH:MM) depending on Postgres output
};

type Course = { id: string; name: string };

function todayISODate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtPlayedOn(played_on: string | null) {
  if (!played_on) return "—";
  // played_on is YYYY-MM-DD; show a friendly local date
  const [y, m, d] = played_on.split("-").map((x) => Number(x));
  if (!y || !m || !d) return played_on;
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtTeeTime(t: string | null) {
  if (!t) return "";
  const parts = String(t).split(":");
  if (parts.length >= 2) return `${parts[0]}:${parts[1]}`;
  return String(t);
}

function normalizeTimeInputToPgTime(value: string) {
  // input[type=time] returns "HH:MM" (sometimes with seconds if step is set)
  // Postgres time accepts "HH:MM" or "HH:MM:SS"
  const v = value.trim();
  if (!v) return null;
  return v;
}

export default function TourRoundsPage() {
  const params = useParams<{ id: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseNameById, setCourseNameById] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);

  // Add-round form
  const [newRoundName, setNewRoundName] = useState<string>("");
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [playedOn, setPlayedOn] = useState<string>(todayISODate()); // required
  const [teeTime, setTeeTime] = useState<string>(""); // optional

  async function load() {
    setLoading(true);
    setErrorMsg("");

    try {
      if (!tourId) throw new Error("Missing tour id.");

      const [{ data: tData, error: tErr }, { data: rData, error: rErr }, { data: cData, error: cErr }] =
        await Promise.all([
          supabase.from("tours").select("id,name").eq("id", tourId).single(),
          supabase
            .from("rounds")
            .select("id,tour_id,name,created_at,course_id,played_on,tee_time")
            .eq("tour_id", tourId)
            .order("played_on", { ascending: true })
            .order("tee_time", { ascending: true })
            .order("created_at", { ascending: true }),
          supabase.from("courses").select("id,name").order("name", { ascending: true }),
        ]);

      if (tErr) throw new Error(tErr.message);
      if (rErr) throw new Error(rErr.message);
      if (cErr) throw new Error(cErr.message);

      const rs = (rData ?? []) as Round[];
      const cs = (cData ?? []) as Course[];

      const map: Record<string, string> = {};
      for (const c of cs) map[c.id] = c.name;

      setTour(tData as Tour);
      setRounds(rs);
      setCourses(cs);
      setCourseNameById(map);

      // Default selection if not set
      if (!selectedCourseId && cs.length) setSelectedCourseId(cs[0].id);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tourId) return;
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  const sortedRounds = useMemo(() => {
    const arr = [...rounds];
    arr.sort((a, b) => {
      const da = a.played_on ?? "";
      const db = b.played_on ?? "";
      if (da !== db) return da.localeCompare(db);

      const ta = a.tee_time ?? "";
      const tb = b.tee_time ?? "";
      if (ta !== tb) return ta.localeCompare(tb);

      const ca = a.created_at ? new Date(a.created_at).getTime() : 0;
      const cb = b.created_at ? new Date(b.created_at).getTime() : 0;
      if (ca !== cb) return ca - cb;

      return a.id.localeCompare(b.id);
    });
    return arr;
  }, [rounds]);

  const canAdd = useMemo(() => {
    // playedOn is required in UI
    return !saving && Boolean(selectedCourseId) && Boolean(playedOn);
  }, [saving, selectedCourseId, playedOn]);

  async function addRound() {
    setErrorMsg("");
    if (!canAdd) return;

    setSaving(true);
    try {
      // Safe name fallback even if DB later becomes NOT NULL again
      const fallbackName = `Round ${sortedRounds.length + 1}`;
      const finalName = newRoundName.trim() ? newRoundName.trim() : fallbackName;

      const payload: any = {
        tour_id: tourId,
        course_id: selectedCourseId,
        name: finalName,
        played_on: playedOn, // ✅ required by UI
      };

      const normalizedTime = normalizeTimeInputToPgTime(teeTime);
      if (normalizedTime) payload.tee_time = normalizedTime;

      const { error } = await supabase.from("rounds").insert(payload);
      if (error) throw new Error(error.message);

      // reset form bits
      setNewRoundName("");
      setTeeTime("");
      // keep playedOn as-is for convenience
      await load();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl p-4 space-y-4">
        <div className="text-sm opacity-70">Loading…</div>
      </main>
    );
  }

  if (errorMsg) {
    return (
      <main className="mx-auto max-w-5xl p-4 space-y-4">
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-semibold">Error</div>
          <div className="mt-1">{errorMsg}</div>
        </div>
        <div className="text-sm">
          <Link className="underline" href="/tours">
            Back to tours
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-4 space-y-4">
      {/* Breadcrumb */}
      <div className="text-sm opacity-70">
        <Link className="underline" href="/tours">
          Tours
        </Link>{" "}
        <span className="opacity-50">/</span>{" "}
        <Link className="underline" href={`/tours/${tourId}`}>
          {tour?.name ?? tourId}
        </Link>{" "}
        <span className="opacity-50">/</span> Rounds
      </div>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Rounds</h1>
          <div className="text-sm opacity-70">
            Tour: <span className="font-medium">{tour?.name ?? tourId}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/tours/${tourId}`}>
            Back to Tour
          </Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/tours/${tourId}/tee-times`}>
            Tee times / groupings
          </Link>
        </div>
      </header>

      {/* Add round */}
      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="text-lg font-semibold">Add a round</div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <div className="text-sm opacity-70 mb-1">Round name</div>
            <input
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={newRoundName}
              onChange={(e) => setNewRoundName(e.target.value)}
              placeholder={`e.g. Round ${sortedRounds.length + 1} (optional; auto-filled if blank)`}
            />
            <div className="mt-1 text-xs opacity-60">If blank, it will default to “Round {sortedRounds.length + 1}”.</div>
          </div>

          <div>
            <div className="text-sm opacity-70 mb-1">Course</div>
            <select
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={selectedCourseId}
              onChange={(e) => setSelectedCourseId(e.target.value)}
            >
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div className="mt-1 text-xs opacity-60">Courses come from the global Courses list.</div>
          </div>

          <div>
            <div className="text-sm opacity-70 mb-1">Played on (required)</div>
            <input
              type="date"
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={playedOn}
              onChange={(e) => setPlayedOn(e.target.value)}
              required
            />
          </div>

          <div>
            <div className="text-sm opacity-70 mb-1">Tee time (optional)</div>
            <input
              type="time"
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={teeTime}
              onChange={(e) => setTeeTime(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            disabled={!canAdd}
            onClick={() => void addRound()}
          >
            {saving ? "Adding…" : "Add round"}
          </button>

          {!playedOn ? <div className="text-sm text-red-700">Played on is required.</div> : null}
        </div>
      </section>

      {/* Rounds list */}
      <section className="rounded-2xl border bg-white">
        {sortedRounds.length === 0 ? (
          <div className="p-4 text-sm opacity-70">No rounds yet.</div>
        ) : (
          <ul className="divide-y">
            {sortedRounds.map((r, idx) => {
              const name = (r.name ?? "").trim() || `Round ${idx + 1}`;
              const courseLabel = r.course_id ? courseNameById[r.course_id] ?? r.course_id : "—";
              const dateLabel = fmtPlayedOn(r.played_on);
              const timeLabel = fmtTeeTime(r.tee_time);

              return (
                <li key={r.id} className="p-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{name}</div>
                    <div className="text-xs opacity-70">
                      {dateLabel}
                      {timeLabel ? ` · ${timeLabel}` : ""}
                      {" · "}Course: {courseLabel}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <Link className="text-sm underline" href={`/rounds/${r.id}`}>
                      Scores
                    </Link>
                    <Link className="text-sm underline" href={`/rounds/${r.id}/groups`}>
                      Groupings
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
