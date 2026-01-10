// app/tours/[id]/rounds/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";

type Tour = { id: string; name: string };
type Round = { id: string; tour_id: string; name: string | null; created_at: string | null; course_id: string | null };
type Course = { id: string; name: string };

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
            .select("id,tour_id,name,created_at,course_id")
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
    return !saving && Boolean(selectedCourseId);
  }, [saving, selectedCourseId]);

  async function addRound() {
    setErrorMsg("");
    if (!canAdd) return;

    setSaving(true);
    try {
      const payload: any = {
        tour_id: tourId,
        course_id: selectedCourseId,
      };
      if (newRoundName.trim()) payload.name = newRoundName.trim();

      const { error } = await supabase.from("rounds").insert(payload);
      if (error) throw new Error(error.message);

      setNewRoundName("");
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <div className="text-sm opacity-70 mb-1">Round name (optional)</div>
            <input
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={newRoundName}
              onChange={(e) => setNewRoundName(e.target.value)}
              placeholder={`e.g. Round ${rounds.length + 1}`}
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
            <div className="mt-1 text-xs opacity-60">Courses come from the global Courses list.</div>
          </div>

          <div className="flex items-end">
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
              disabled={!canAdd}
              onClick={() => void addRound()}
            >
              {saving ? "Adding…" : "Add round"}
            </button>
          </div>
        </div>
      </section>

      {/* Rounds list */}
      <section className="rounded-2xl border bg-white">
        {rounds.length === 0 ? (
          <div className="p-4 text-sm opacity-70">No rounds yet.</div>
        ) : (
          <ul className="divide-y">
            {rounds.map((r, idx) => (
              <li key={r.id} className="p-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.name ?? `Round ${idx + 1}`}</div>
                  <div className="text-xs opacity-70">
                    Course: {r.course_id ? courseNameById[r.course_id] ?? r.course_id : "—"}
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
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
