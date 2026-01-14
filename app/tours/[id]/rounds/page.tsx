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
  tee_time: string | null; // HH:MM:SS (or HH:MM)
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
  const v = value.trim();
  if (!v) return null;
  return v; // Postgres accepts HH:MM or HH:MM:SS
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

  // Edit mode per-round
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPlayedOn, setEditPlayedOn] = useState<string>("");
  const [editTeeTime, setEditTeeTime] = useState<string>("");

  // Delete confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState<string>("");

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
    return !saving && Boolean(selectedCourseId) && Boolean(playedOn);
  }, [saving, selectedCourseId, playedOn]);

  async function addRound() {
    setErrorMsg("");
    if (!canAdd) return;

    setSaving(true);
    try {
      const fallbackName = `Round ${sortedRounds.length + 1}`;
      const finalName = newRoundName.trim() ? newRoundName.trim() : fallbackName;

      const payload: any = {
        tour_id: tourId,
        course_id: selectedCourseId,
        name: finalName,
        played_on: playedOn,
      };

      const normalizedTime = normalizeTimeInputToPgTime(teeTime);
      if (normalizedTime) payload.tee_time = normalizedTime;

      const { error } = await supabase.from("rounds").insert(payload);
      if (error) throw new Error(error.message);

      setNewRoundName("");
      setTeeTime("");
      await load();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  function beginEdit(r: Round) {
    setErrorMsg("");
    setEditingId(r.id);
    setEditPlayedOn(r.played_on ?? todayISODate());
    setEditTeeTime(fmtTeeTime(r.tee_time)); // put HH:MM into the input
  }

  function cancelEdit() {
    setEditingId(null);
    setEditPlayedOn("");
    setEditTeeTime("");
  }

  async function saveEdit(roundId: string) {
    setErrorMsg("");
    if (!editPlayedOn) {
      setErrorMsg("Played on is required.");
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        played_on: editPlayedOn,
      };

      const normalized = normalizeTimeInputToPgTime(editTeeTime);
      // if user clears time, store NULL
      payload.tee_time = normalized ? normalized : null;

      const { error } = await supabase.from("rounds").update(payload).eq("id", roundId);
      if (error) throw new Error(error.message);

      cancelEdit();
      await load();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  function beginDelete(roundId: string) {
    setErrorMsg("");
    setDeletingId(roundId);
    setDeleteConfirmText("");
  }

  function cancelDelete() {
    setDeletingId(null);
    setDeleteConfirmText("");
  }

  async function deleteRoundCascade(roundId: string) {
    setErrorMsg("");
    setSaving(true);

    try {
      // Guard: typed confirmation
      if (deleteConfirmText.trim().toUpperCase() !== "DELETE") {
        throw new Error('Type DELETE to confirm.');
      }

      // Delete children first (order matters with FK constraints).
      // If you add more round-dependent tables later, add them here.
      const steps: Array<Promise<any>> = [
        supabase.from("scores").delete().eq("round_id", roundId),
        supabase.from("round_group_players").delete().eq("round_id", roundId),
        supabase.from("round_groups").delete().eq("round_id", roundId),
        supabase.from("round_players").delete().eq("round_id", roundId),
      ];

      for (const p of steps) {
        const res = await p;
        if (res.error) throw new Error(res.error.message);
      }

      const { error: delErr } = await supabase.from("rounds").delete().eq("id", roundId);
      if (delErr) throw new Error(delErr.message);

      cancelDelete();
      await load();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to delete round.");
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

      {errorMsg ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-semibold">Error</div>
          <div className="mt-1">{errorMsg}</div>
        </div>
      ) : null}

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
              placeholder={`e.g. Round ${sortedRounds.length + 1} (auto-filled if blank)`}
            />
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
            <input type="time" className="w-full rounded-xl border px-3 py-2 text-sm" value={teeTime} onChange={(e) => setTeeTime(e.target.value)} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50" disabled={!canAdd} onClick={() => void addRound()}>
            {saving ? "Adding…" : "Add round"}
          </button>
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

              const isEditing = editingId === r.id;
              const isDeleting = deletingId === r.id;

              return (
                <li key={r.id} className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{name}</div>
                      <div className="text-xs opacity-70">
                        {dateLabel}
                        {timeLabel ? ` · ${timeLabel}` : ""}
                        {" · "}Course: {courseLabel}
                      </div>

                      <div className="mt-2 flex items-center gap-3 text-sm">
                        <Link className="underline" href={`/rounds/${r.id}`}>
                          Scores
                        </Link>
                        <Link className="underline" href={`/rounds/${r.id}/groups`}>
                          Groupings
                        </Link>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!isEditing ? (
                        <button
                          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                          disabled={saving}
                          onClick={() => beginEdit(r)}
                        >
                          Edit date/time
                        </button>
                      ) : (
                        <button className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50" disabled={saving} onClick={cancelEdit}>
                          Cancel
                        </button>
                      )}

                      {!isDeleting ? (
                        <button
                          className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 hover:bg-red-100 disabled:opacity-50"
                          disabled={saving}
                          onClick={() => beginDelete(r.id)}
                        >
                          Delete
                        </button>
                      ) : (
                        <button
                          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                          disabled={saving}
                          onClick={cancelDelete}
                        >
                          Close
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditing ? (
                    <div className="rounded-2xl border bg-gray-50 p-3 space-y-3">
                      <div className="text-sm font-semibold">Edit round date/time</div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <div className="text-sm opacity-70 mb-1">Played on</div>
                          <input
                            type="date"
                            className="w-full rounded-xl border px-3 py-2 text-sm"
                            value={editPlayedOn}
                            onChange={(e) => setEditPlayedOn(e.target.value)}
                            required
                          />
                        </div>

                        <div>
                          <div className="text-sm opacity-70 mb-1">Tee time</div>
                          <input
                            type="time"
                            className="w-full rounded-xl border px-3 py-2 text-sm"
                            value={editTeeTime}
                            onChange={(e) => setEditTeeTime(e.target.value)}
                          />
                          <div className="mt-1 text-xs opacity-60">Clear the time to store it as blank.</div>
                        </div>

                        <div className="flex items-end">
                          <button
                            className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                            disabled={saving || !editPlayedOn}
                            onClick={() => void saveEdit(r.id)}
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {isDeleting ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 p-3 space-y-2">
                      <div className="text-sm font-semibold text-red-900">Delete this round?</div>
                      <div className="text-sm text-red-900/80">
                        This will delete the round and its dependent data (scores, round players, groupings). Type <strong>DELETE</strong> to confirm.
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          className="rounded-xl border px-3 py-2 text-sm"
                          value={deleteConfirmText}
                          onChange={(e) => setDeleteConfirmText(e.target.value)}
                          placeholder="Type DELETE"
                        />
                        <button
                          className="rounded-xl bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                          disabled={saving || deleteConfirmText.trim().toUpperCase() !== "DELETE"}
                          onClick={() => void deleteRoundCascade(r.id)}
                        >
                          {saving ? "Deleting…" : "Confirm delete"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
