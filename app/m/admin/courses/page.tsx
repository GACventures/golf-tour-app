"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Course = {
  id: string;
  name: string;
  tour_id: string | null;
};

export default function MobileAdminCoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [name, setName] = useState("");

  async function loadCourses() {
    setLoading(true);
    setErrorMsg("");
    try {
      const { data, error } = await supabase
        .from("courses")
        .select("id,name,tour_id")
        .order("name", { ascending: true });

      if (error) throw new Error(error.message);

      setCourses((data ?? []).map((c: any) => ({
        id: String(c.id),
        name: String(c.name),
        tour_id: c.tour_id ?? null,
      })));
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to load courses.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCourses();
  }, []);

  const canAdd = useMemo(() => {
    return !saving && name.trim().length > 0;
  }, [saving, name]);

  async function addCourse() {
    if (!canAdd) return;
    setSaving(true);
    setErrorMsg("");
    try {
      const { error } = await supabase.from("courses").insert({
        name: name.trim(),
        tour_id: null, // global
      });
      if (error) throw new Error(error.message);

      setName("");
      await loadCourses();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to add course.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm opacity-70">
        <Link className="underline" href="/m/admin">
          ← Admin hub
        </Link>{" "}
        <span className="opacity-50">/</span> Courses
      </div>

      {errorMsg ? (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-semibold">Error</div>
          <div className="mt-1">{errorMsg}</div>
        </div>
      ) : null}

      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="text-lg font-semibold">Add course</div>

        <div className="flex gap-2">
          <input
            className="flex-1 rounded-xl border px-3 py-2 text-sm"
            placeholder="Course name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
          />
          <button
            className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={!canAdd}
            onClick={() => void addCourse()}
          >
            {saving ? "Saving…" : "Add"}
          </button>
        </div>

        <div className="text-xs text-gray-500">
          Courses are global. Pars are edited per course (M/F, 18 holes).
        </div>
      </section>

      <section className="rounded-2xl border bg-white">
        <div className="p-4 flex items-center justify-between">
          <div className="text-lg font-semibold">Courses</div>
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            onClick={() => void loadCourses()}
            disabled={loading || saving}
          >
            Refresh
          </button>
        </div>

        {loading ? <div className="px-4 pb-4 text-sm opacity-70">Loading…</div> : null}
        {!loading && courses.length === 0 ? <div className="px-4 pb-4 text-sm opacity-70">No courses yet.</div> : null}

        <ul className="divide-y">
          {courses.map((c) => (
            <li key={c.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate">{c.name}</div>
                <div className="text-xs text-gray-600 mt-1">Pars: M/F · 18 holes</div>
              </div>

              <Link
                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 shrink-0"
                href={`/m/admin/courses/${c.id}`}
              >
                Edit pars
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}