"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Tee = "M" | "F";

type Course = { id: string; name: string };

type ParRow = {
  course_id: string;
  hole_number: number;
  tee: Tee;
  par: number;
  stroke_index: number;
};

function clampInt(n: any, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.trunc(v);
}

function buildDefaultPars(courseId: string): ParRow[] {
  const rows: ParRow[] = [];
  for (let hole = 1; hole <= 18; hole++) {
    rows.push({ course_id: courseId, hole_number: hole, tee: "M", par: 4, stroke_index: hole });
    rows.push({ course_id: courseId, hole_number: hole, tee: "F", par: 4, stroke_index: hole });
  }
  return rows;
}

export default function MobileAdminCourseParsPage() {
  const params = useParams<{ id: string }>();
  const courseId = String(params?.id ?? "").trim();

  const [course, setCourse] = useState<Course | null>(null);
  const [pars, setPars] = useState<ParRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  async function load() {
    setLoading(true);
    setErrorMsg("");
    setStatus("");

    try {
      const [{ data: cData, error: cErr }, { data: pData, error: pErr }] = await Promise.all([
        supabase.from("courses").select("id,name").eq("id", courseId).single(),
        supabase
          .from("pars")
          .select("course_id,hole_number,tee,par,stroke_index")
          .eq("course_id", courseId),
      ]);

      if (cErr) throw new Error(cErr.message);
      if (pErr) throw new Error(pErr.message);

      setCourse({ id: String((cData as any).id), name: String((cData as any).name) });

      if (!pData || pData.length === 0) {
        setPars(buildDefaultPars(courseId));
        setStatus("No pars found yet — defaults initialised (not saved)");
        return;
      }

      const byKey = new Map<string, ParRow>();

      for (const row of pData as any[]) {
        const hole = clampInt(row.hole_number, NaN);
        if (!Number.isFinite(hole) || hole < 1 || hole > 18) continue;

        const tee: Tee = (String(row.tee ?? "M").toUpperCase() === "F" ? "F" : "M") as Tee;
        const par = clampInt(row.par, 4);
        const si = clampInt(row.stroke_index, hole);

        byKey.set(`${hole}:${tee}`, {
          course_id: String(row.course_id ?? courseId),
          hole_number: hole,
          tee,
          par: Number.isFinite(par) ? par : 4,
          stroke_index: Number.isFinite(si) && si >= 1 ? si : hole,
        });
      }

      const filled: ParRow[] = [];
      for (let hole = 1; hole <= 18; hole++) {
        for (const tee of ["M", "F"] as Tee[]) {
          filled.push(
            byKey.get(`${hole}:${tee}`) ?? {
              course_id: courseId,
              hole_number: hole,
              tee,
              par: 4,
              stroke_index: hole,
            }
          );
        }
      }

      setPars(filled);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to load course pars.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!courseId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const byHole = useMemo(() => {
    const map = new Map<number, { M: ParRow; F: ParRow }>();
    for (let hole = 1; hole <= 18; hole++) {
      map.set(hole, {
        M: pars.find((p) => p.hole_number === hole && p.tee === "M") ?? {
          course_id: courseId,
          hole_number: hole,
          tee: "M",
          par: 4,
          stroke_index: hole,
        },
        F: pars.find((p) => p.hole_number === hole && p.tee === "F") ?? {
          course_id: courseId,
          hole_number: hole,
          tee: "F",
          par: 4,
          stroke_index: hole,
        },
      });
    }
    return map;
  }, [pars, courseId]);

  function setParRow(hole: number, tee: Tee, patch: Partial<ParRow>) {
    setPars((prev) => {
      const next = [...prev];
      const idx = next.findIndex((p) => p.hole_number === hole && p.tee === tee);
      if (idx >= 0) next[idx] = { ...next[idx], ...patch };
      else next.push({ course_id: courseId, hole_number: hole, tee, par: 4, stroke_index: hole, ...patch });
      return next;
    });
    setStatus("Unsaved changes");
  }

  async function save() {
    setSaving(true);
    setErrorMsg("");
    setStatus("Saving…");

    try {
      const payload: ParRow[] = [];
      for (let hole = 1; hole <= 18; hole++) {
        for (const tee of ["M", "F"] as Tee[]) {
          const row = pars.find((p) => p.hole_number === hole && p.tee === tee) ?? {
            course_id: courseId,
            hole_number: hole,
            tee,
            par: 4,
            stroke_index: hole,
          };

          payload.push({
            course_id: courseId,
            hole_number: hole,
            tee,
            par: clampInt(row.par, 4),
            stroke_index: Math.max(1, clampInt(row.stroke_index, hole)),
          });
        }
      }

      const { error } = await supabase.from("pars").upsert(payload as any, {
        onConflict: "course_id,hole_number,tee",
      });

      if (error) throw new Error(error.message);

      setStatus("Saved ✅");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to save pars.");
      setStatus("");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm opacity-70">Loading…</div>;
  }

  if (errorMsg) {
    return (
      <div className="space-y-3">
        <div className="text-sm opacity-70">
          <Link className="underline" href="/m/admin/courses">
            ← Courses
          </Link>
        </div>
        <div className="rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-semibold">Error</div>
          <div className="mt-1">{errorMsg}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm opacity-70">
        <Link className="underline" href="/m/admin/courses">
          ← Courses
        </Link>{" "}
        <span className="opacity-50">/</span> Edit pars
      </div>

      <div className="rounded-2xl border bg-white p-4">
        <div className="text-lg font-semibold">{course?.name ?? "Course"}</div>
        <div className="mt-1 text-sm text-gray-600">Edit pars + stroke index for Men/Women tees.</div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="text-xs text-gray-600">{status || " "}</div>
          <button
            className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border bg-white overflow-hidden">
        <div className="p-3 text-xs font-semibold text-gray-700 border-b grid grid-cols-5 gap-2">
          <div>Hole</div>
          <div className="text-center">Par M</div>
          <div className="text-center">SI M</div>
          <div className="text-center">Par F</div>
          <div className="text-center">SI F</div>
        </div>

        <ul className="divide-y">
          {Array.from({ length: 18 }, (_, i) => i + 1).map((hole) => {
            const row = byHole.get(hole)!;

            return (
              <li key={hole} className="p-3 grid grid-cols-5 gap-2 items-center text-sm">
                <div className="font-semibold">{hole}</div>

                <select
                  className="rounded-lg border px-2 py-2 text-sm"
                  value={row.M.par}
                  onChange={(e) => setParRow(hole, "M", { par: Number(e.target.value) })}
                >
                  {[3, 4, 5, 6].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>

                <select
                  className="rounded-lg border px-2 py-2 text-sm"
                  value={row.M.stroke_index}
                  onChange={(e) => setParRow(hole, "M", { stroke_index: Number(e.target.value) })}
                >
                  {Array.from({ length: 18 }, (_, j) => j + 1).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>

                <select
                  className="rounded-lg border px-2 py-2 text-sm"
                  value={row.F.par}
                  onChange={(e) => setParRow(hole, "F", { par: Number(e.target.value) })}
                >
                  {[3, 4, 5, 6].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>

                <select
                  className="rounded-lg border px-2 py-2 text-sm"
                  value={row.F.stroke_index}
                  onChange={(e) => setParRow(hole, "F", { stroke_index: Number(e.target.value) })}
                >
                  {Array.from({ length: 18 }, (_, j) => j + 1).map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="text-xs text-gray-500">
        Saves 36 rows into <code className="px-1 rounded bg-gray-100">pars</code> using conflict key{" "}
        <code className="px-1 rounded bg-gray-100">(course_id,hole_number,tee)</code>.
      </div>
    </div>
  );
}