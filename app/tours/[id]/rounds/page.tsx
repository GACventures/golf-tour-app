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

  // NEW(used here)
  played_on: string | null; // date string (YYYY-MM-DD)
  tee_time: string | null; // optional text, e.g. "08:10"
};

type Course = { id: string; name: string };

function todayISODate() {
  // YYYY-MM-DD
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtRoundDisplayName(r: Round, idx: number) {
  const nm = (r.name ?? "").trim();
  return nm ? nm : `Round ${idx + 1}`;
}

function safeCourseName(courseNameById: Record<string, string>, course_id: string | null) {
  if (!course_id) return "—";
  return courseNameById[course_id] ?? course_id;
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

  // Add-round form
  const [savingAdd, setSavingAdd] = useState(false);
  const [newRoundName, setNewRoundName] = useState<string>("");
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");

  // NEW: required played_on + optional tee_time on create
  const [newPlayedOn, setNewPlayedOn] = useState<string>(todayISODate());
  const [newTeeTime, setNewTeeTime] = useState<string>("");

  // Inline edit state (per round)
  const [editByRoundId, setEditByRoundId] = useState<Record<string, { played_on: string; tee_time: string }>>({});
  const [savingRoundId, setSavingRoundId] = useState<string | null>(null);
  const [deletingRoundId, setDeletingRoundId] = useState<string | null>(null);

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

      // Seed edit state for rounds (so inputs are controlled)
      const nextEdit: Record<string, { played_on: string; tee_time: string }> = {};
      for (const r of rs) {
        nextEdit[r.id] = {
          played_on: r.played_on ?? "",
          tee_time: r.tee_time ?? "",
        };
      }
      setEditByRoundId(nextEdit);
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

  const canAdd = useMemo(() => {
    // played_on is required
    return !savingAdd && Boolean(selectedCourseId) && Boolean(newPlayedOn);
  }, [savingAdd, selectedCourseId, newPlayedOn]);

  async function addRound() {
    setErrorMsg("");
    if (!canAdd) return;

    setSavingAdd(true);
    try {
      // NOTE: If your DB enforces rounds.name NOT NULL, we must provide a value.
      // Your schema shows name is nullable, but you got a NOT NULL constraint error earlier.
      // So we ALWAYS provide a fallback name.
      const fallbackName = `Round ${rounds.length + 1}`;
      const nameToUse = newRoundName.trim() ? newRoundName.trim() : fallbackName;

      const payload: any = {
        tour_id: tourId,
        course_id: selectedCourseId,
        name: nameToUse,
        played_on: newPlayedOn, // required
      };

      const tt = newTeeTime.trim();
      if (tt) payload.tee_time = tt;

      const { error } = await supabase.from("rounds").insert(payload);
      if (error) throw new Error(error.message);

      setNewRoundName("");
      setNewTeeTime("");
      // keep date (often adding multiple rounds same day)
      await load();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Unknown error");
    } finally {
      setSavingAdd(false);
    }
  }

  function updateEdit(roundId: string, patch: Partial<{ played_on: string; tee_time: string }>) {
    setEditByRoundId((prev) => ({
      ...prev,
      [roundId]: {
        played_on: prev[roundId]?.played_on ?? "",
        tee_time: prev[roundId]?.tee_time ?? "",
        ...patch,
      },
    }));
  }

  async function saveRoundMeta(roundId: string) {
    setErrorMsg("");
    const ed = editByRoundId[roundId];
    if (!ed) return;

    // played_on required
    const played_on = (ed.played_on ?? "").trim();
    if (!played_on) {
      setErrorMsg("Played-on date is required.");
      return;
    }

    setSavingRoundId(roundId);
    try {
      const tee_time = (ed.tee_time ?? "").trim();

      const payload: any = {
        played_on,
        tee_time: tee_time || null,
      };

      const { error } = await supabase.from("rounds").update(payload).eq("id", roundId);
      if (error) throw new Error(error.message);

      await load();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to save round.");
    } finally {
      setSavingRoundId(null);
    }
  }

  async function deleteRoundCascade(roundId: string) {
    setErrorMsg("");

    const ok = window.confirm(
      "Delete this round?\n\nThis will delete scores, round players, groups and tee time group members for this round.\nThis cannot be undone."
    );
    if (!ok) return;

    setDeletingRoundId(roundId);
    try {
      // Delete children first (order matters with FK constraints).

      const del1 = await supabase.from("scores").delete().eq("round_id", roundId);
      if (del1.error) throw new Error(del1.error.message);

      const del2 = await supabase.from("round_group_players").delete().eq("round_id", roundId);
      if (del2.error) throw new Error(del2.error.message);

      const del3 = await supabase.from("round_groups").delete().eq("round_id", roundId);
      if (del3.error) throw new Error(del3.error.message);

      const del4 = await supabase.from("round_players").delete().eq("round_id", roundId);
      if (del4.error) throw new Error(del4.error.message);

      const del5 = await supabase.from("rounds").delete().eq("id", roundId);
      if (del5.error) throw new Error(del5.error.message);

      await load();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to delete round.");
    } finally {
      setDeletingRoundId(null);
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
          <div className="mt-1 whitespace-pre-wrap">{errorMsg}</div>
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
              placeholder={`e.g. Round ${rounds.length + 1}`}
            />
            <div className="mt-1 text-xs opacity-60">If blank, a default will be used (required by DB).</div>
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
              className="w-full rounded-xl border px-3 py-2 text-sm"
              type="date"
              value={newPlayedOn}
              onChange={(e) => setNewPlayedOn(e.target.value)}
            />
          </div>

          <div>
            <div className="text-sm opacity-70 mb-1">Tee time (optional)</div>
            <input
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={newTeeTime}
              onChange={(e) => setNewTeeTime(e.target.value)}
              placeholder="e.g. 08:10"
            />
          </div>
        </div>

        <div className="flex items-center justify-end">
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            disabled={!canAdd}
            onClick={() => void addRound()}
          >
            {savingAdd ? "Adding…" : "Add round"}
          </button>
        </div>
      </section>

      {/* Rounds list */}
      <section className="rounded-2xl border bg-white">
        {rounds.length === 0 ? (
          <div className="p-4 text-sm opacity-70">No rounds yet.</div>
        ) : (
          <ul className="divide-y">
            {rounds.map((r, idx) => {
              const ed = editByRoundId[r.id] ?? { played_on: r.played_on ?? "", tee_time: r.tee_time ?? "" };
              const isSaving = savingRoundId === r.id;
              const isDeleting = deletingRoundId === r.id;

              return (
                <li key={r.id} className="p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{fmtRoundDisplayName(r, idx)}</div>
                      <div className="text-xs opacity-70 mt-1">
                        Course: {safeCourseName(courseNameById, r.course_id)}
                      </div>

                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2 max-w-xl">
                        <label className="text-xs">
                          <div className="opacity-70 mb-1">Played on</div>
                          <input
                            type="date"
                            className="w-full rounded-xl border px-3 py-2 text-sm"
                            value={ed.played_on}
                            onChange={(e) => updateEdit(r.id, { played_on: e.target.value })}
                          />
                        </label>

                        <label className="text-xs">
                          <div className="opacity-70 mb-1">Tee time</div>
                          <input
                            className="w-full rounded-xl border px-3 py-2 text-sm"
                            value={ed.tee_time}
                            onChange={(e) => updateEdit(r.id, { tee_time: e.target.value })}
                            placeholder="e.g. 08:10"
                          />
                        </label>

                        <div className="flex items-end gap-2">
                          <button
                            className="w-full rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                            disabled={isSaving || isDeleting}
                            onClick={() => void saveRoundMeta(r.id)}
                            title="Save played-on date and tee time"
                          >
                            {isSaving ? "Saving…" : "Save"}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <Link className="text-sm underline" href={`/rounds/${r.id}`}>
                        Scores
                      </Link>
                      <Link className="text-sm underline" href={`/rounds/${r.id}/groups`}>
                        Groupings
                      </Link>

                      <button
                        className="text-sm underline text-red-700 disabled:opacity-50"
                        disabled={isSaving || isDeleting}
                        onClick={() => void deleteRoundCascade(r.id)}
                        title="Delete this round and its dependent data"
                      >
                        {isDeleting ? "Deleting…" : "Delete"}
                      </button>
                    </div>
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
