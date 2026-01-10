"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Tour = { id: string; name: string };

type Tee = "M" | "F";

type ParRow = {
  course_id: string;
  hole_number: number;
  tee: Tee;
  par: number;
  stroke_index: number;
};

type Course = {
  id: string;
  name: string;
  tour_id: string | null;
};

function clampInt(n: any, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.trunc(v);
}

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [tours, setTours] = useState<Tour[]>([]);
  const [selectedTourId, setSelectedTourId] = useState<string>("");

  const [name, setName] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);

  // Store as a flat list, but we will render a matrix by hole+tee
  const [pars, setPars] = useState<ParRow[]>([]);
  const [parsStatus, setParsStatus] = useState<string>("");

  useEffect(() => {
    void loadTours();
    void loadCourses();
  }, []);

  useEffect(() => {
    if (selectedCourse?.id) {
      void loadPars(selectedCourse.id);
    } else {
      setPars([]);
      setParsStatus("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourse?.id]);

  async function loadTours() {
    setErrorMsg("");
    const { data, error } = await supabase.from("tours").select("id,name").order("name", { ascending: true });

    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setTours((data ?? []) as Tour[]);
  }

  async function loadCourses() {
    setErrorMsg("");
    const { data, error } = await supabase.from("courses").select("id,name,tour_id").order("name", { ascending: true });

    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setCourses((data ?? []) as Course[]);
  }

  async function addCourse() {
    setErrorMsg("");
    if (!name.trim()) return;

    const { error } = await supabase.from("courses").insert({
      name: name.trim(),
      tour_id: selectedTourId || null,
    });

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    setName("");
    await loadCourses();
  }

  function buildDefaultPars(courseId: string): ParRow[] {
    const rows: ParRow[] = [];
    for (let hole = 1; hole <= 18; hole++) {
      rows.push({
        course_id: courseId,
        hole_number: hole,
        tee: "M",
        par: 4,
        stroke_index: hole,
      });
      rows.push({
        course_id: courseId,
        hole_number: hole,
        tee: "F",
        par: 4,
        stroke_index: hole,
      });
    }
    return rows;
  }

  async function loadPars(courseId: string) {
    setParsStatus("");
    setErrorMsg("");

    const { data, error } = await supabase
      .from("pars")
      .select("course_id,hole_number,tee,par,stroke_index")
      .eq("course_id", courseId);

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    // If nothing in DB yet, initialise all 18 holes x 2 tees with defaults
    if (!data || data.length === 0) {
      setPars(buildDefaultPars(courseId));
      setParsStatus("No pars found yet — defaults initialised for M/F (not saved)");
      return;
    }

    // Normalize into a complete 18-hole x (M,F) set.
    // If any old rows exist without tee (shouldn’t now), treat as M.
    const byKey = new Map<string, ParRow>();

    for (const row of data as any[]) {
      const hole = clampInt(row.hole_number, NaN);
      if (!Number.isFinite(hole) || hole < 1 || hole > 18) continue;

      const tee: Tee = (String(row.tee ?? "M").toUpperCase() === "F" ? "F" : "M") as Tee;
      const par = clampInt(row.par, 4);
      const si = clampInt(row.stroke_index, hole);

      const key = `${hole}:${tee}`;
      byKey.set(key, {
        course_id: String(row.course_id ?? courseId),
        hole_number: hole,
        tee,
        par: Number.isFinite(par) ? par : 4,
        stroke_index: Number.isFinite(si) && si >= 1 ? si : hole,
      });
    }

    const filled: ParRow[] = [];
    for (let hole = 1; hole <= 18; hole++) {
      const mKey = `${hole}:M`;
      const fKey = `${hole}:F`;

      filled.push(
        byKey.get(mKey) ?? {
          course_id: courseId,
          hole_number: hole,
          tee: "M",
          par: 4,
          stroke_index: hole,
        }
      );

      filled.push(
        byKey.get(fKey) ?? {
          course_id: courseId,
          hole_number: hole,
          tee: "F",
          par: 4,
          stroke_index: hole,
        }
      );
    }

    setPars(filled);
  }

  function getParRow(hole: number, tee: Tee): ParRow {
    const found = pars.find((p) => p.hole_number === hole && p.tee === tee);
    if (found) return found;

    // fallback (shouldn't happen)
    return {
      course_id: selectedCourse?.id ?? "",
      hole_number: hole,
      tee,
      par: 4,
      stroke_index: hole,
    };
  }

  function setParRow(hole: number, tee: Tee, patch: Partial<ParRow>) {
    setPars((prev) => {
      const next = [...prev];
      const idx = next.findIndex((p) => p.hole_number === hole && p.tee === tee);
      if (idx >= 0) {
        next[idx] = { ...next[idx], ...patch };
      } else {
        next.push({
          course_id: selectedCourse?.id ?? "",
          hole_number: hole,
          tee,
          par: 4,
          stroke_index: hole,
          ...patch,
        } as ParRow);
      }
      return next;
    });
    setParsStatus("Unsaved changes");
  }

  async function savePars(courseId: string) {
    setParsStatus("Saving...");
    setErrorMsg("");

    // Build 36 rows (18 holes x 2 tees)
    const payload: ParRow[] = [];
    for (let hole = 1; hole <= 18; hole++) {
      for (const tee of ["M", "F"] as Tee[]) {
        const existing = getParRow(hole, tee);
        const par = clampInt(existing?.par, 4);
        const si = clampInt(existing?.stroke_index, hole);

        payload.push({
          course_id: courseId,
          hole_number: hole,
          tee,
          par,
          stroke_index: Number.isFinite(si) && si >= 1 ? si : hole,
        });
      }
    }

    const { error } = await supabase.from("pars").upsert(payload as any, {
      onConflict: "course_id,hole_number,tee",
    });

    if (error) {
      setErrorMsg(error.message);
      setParsStatus("");
      return;
    }

    setParsStatus("Saved ✅");
  }

  const courseCountLabel = useMemo(() => {
    return courses.length ? `${courses.length} course(s)` : "No courses";
  }, [courses.length]);

  return (
    <div style={{ padding: 20 }}>
      <h1>Courses</h1>

      <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
        <div>
          <label style={{ marginRight: 8 }}>Tour:</label>
          <select value={selectedTourId} onChange={(e) => setSelectedTourId(e.target.value)}>
            <option value="">(No tour)</option>
            {tours.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ opacity: 0.7, fontSize: 12 }}>{courseCountLabel}</div>
      </div>

      {errorMsg && <p style={{ color: "red" }}>Error: {errorMsg}</p>}

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input placeholder="Course name" value={name} onChange={(e) => setName(e.target.value)} />
        <button onClick={addCourse}>Add Course</button>
      </div>

      <ul>
        {courses.map((c) => (
          <li key={c.id}>
            <button
              style={{
                background: selectedCourse?.id === c.id ? "#ddd" : "transparent",
                border: "none",
                cursor: "pointer",
                padding: 4,
              }}
              onClick={() => setSelectedCourse(c)}
            >
              {c.name}
            </button>
          </li>
        ))}
      </ul>

      {selectedCourse && (
        <>
          <hr />
          <h2>Editing course: {selectedCourse.name}</h2>

          <h3>Course Pars (Men + Women)</h3>
          {parsStatus && <p>{parsStatus}</p>}

          <table style={{ borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: 6 }}>Hole</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: 6 }}>Par (M)</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: 6 }}>SI (M)</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: 6 }}>Par (F)</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ccc", padding: 6 }}>SI (F)</th>
              </tr>
            </thead>

            <tbody>
              {Array.from({ length: 18 }, (_, i) => i + 1).map((hole) => {
                const m = getParRow(hole, "M");
                const f = getParRow(hole, "F");

                return (
                  <tr key={hole}>
                    <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>{hole}</td>

                    {/* Par M */}
                    <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                      <select
                        value={m.par}
                        onChange={(e) => setParRow(hole, "M", { par: Number(e.target.value) })}
                      >
                        {[3, 4, 5, 6].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* SI M */}
                    <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                      <select
                        value={m.stroke_index}
                        onChange={(e) => setParRow(hole, "M", { stroke_index: Number(e.target.value) })}
                      >
                        {Array.from({ length: 18 }, (_, j) => j + 1).map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Par F */}
                    <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                      <select
                        value={f.par}
                        onChange={(e) => setParRow(hole, "F", { par: Number(e.target.value) })}
                      >
                        {[3, 4, 5, 6].map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* SI F */}
                    <td style={{ padding: 6, borderBottom: "1px solid #eee" }}>
                      <select
                        value={f.stroke_index}
                        onChange={(e) => setParRow(hole, "F", { stroke_index: Number(e.target.value) })}
                      >
                        {Array.from({ length: 18 }, (_, j) => j + 1).map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={() => savePars(selectedCourse.id)}>Save Pars (M + F)</button>
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              Saves 36 rows into <code>pars</code> using conflict key <code>(course_id,hole_number,tee)</code>.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
