"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Tour = { id: string; name: string };

type ParRow = {
  course_id: string;
  hole_number: number;
  par: number;
  stroke_index: number;
};

type Course = {
  id: string;
  name: string;
  tour_id: string | null;
};

export default function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [tours, setTours] = useState<Tour[]>([]);
  const [selectedTourId, setSelectedTourId] = useState<string>("");

  const [name, setName] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
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

  async function loadPars(courseId: string) {
    setParsStatus("");

    const { data, error } = await supabase
      .from("pars")
      .select("course_id,hole_number,par,stroke_index")
      .eq("course_id", courseId)
      .order("hole_number", { ascending: true });

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    // If nothing in DB yet, initialise all 18 with defaults
    if (!data || data.length === 0) {
      const initial: ParRow[] = Array.from({ length: 18 }, (_, i) => ({
        course_id: courseId,
        hole_number: i + 1,
        par: 4,
        stroke_index: i + 1,
      }));
      setPars(initial);
      setParsStatus("No pars found yet — defaults initialised (not saved)");
      return;
    }

    // Normalise to exactly 18 holes
    const byHole = new Map<number, ParRow>();
    for (const row of data as any[]) {
      const hole = Number(row.hole_number);
      if (!Number.isFinite(hole) || hole < 1 || hole > 18) continue;

      const par = Number(row.par);
      const si = Number(row.stroke_index);

      byHole.set(hole, {
        course_id: row.course_id ?? courseId,
        hole_number: hole,
        par: Number.isFinite(par) ? par : 4,
        stroke_index: Number.isFinite(si) && si >= 1 ? si : hole,
      });
    }

    const filled: ParRow[] = Array.from({ length: 18 }, (_, i) => {
      const hole = i + 1;
      return (
        byHole.get(hole) ?? {
          course_id: courseId,
          hole_number: hole,
          par: 4,
          stroke_index: hole,
        }
      );
    });

    setPars(filled);
  }

  async function savePars(courseId: string) {
    setParsStatus("Saving...");

    const payload: ParRow[] = Array.from({ length: 18 }, (_, i) => {
      const hole = i + 1;
      const existing = pars.find((p) => p.hole_number === hole);

      const par = existing?.par ?? 4;
      const si = existing?.stroke_index;

      return {
        course_id: courseId,
        hole_number: hole,
        par,
        stroke_index: Number.isFinite(Number(si)) && Number(si) >= 1 ? Number(si) : hole,
      };
    });

    const { error } = await supabase.from("pars").upsert(payload, {
      onConflict: "course_id,hole_number",
    });

    if (error) {
      setErrorMsg(error.message);
      setParsStatus("");
      return;
    }

    setParsStatus("Saved ✅");
  }

  return (
    <div style={{ padding: 20 }}>
      <h1>Courses</h1>

      <div style={{ marginBottom: 12 }}>
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

          <h3>Course Pars</h3>
          {parsStatus && <p>{parsStatus}</p>}

          <table>
            <thead>
              <tr>
                <th>Hole</th>
                <th>Par</th>
                <th>Stroke Index</th>
              </tr>
            </thead>

            <tbody>
              {pars.map((p, idx) => (
                <tr key={p.hole_number}>
                  <td>{p.hole_number}</td>

                  <td>
                    <select
                      value={p.par}
                      onChange={(e) => {
                        const next = [...pars];
                        next[idx] = { ...next[idx], par: Number(e.target.value) };
                        setPars(next);
                        setParsStatus("Unsaved changes");
                      }}
                    >
                      {[3, 4, 5, 6].map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td>
                    <select
                      value={p.stroke_index}
                      onChange={(e) => {
                        const next = [...pars];
                        next[idx] = { ...next[idx], stroke_index: Number(e.target.value) };
                        setPars(next);
                        setParsStatus("Unsaved changes");
                      }}
                    >
                      {Array.from({ length: 18 }, (_, i) => i + 1).map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button onClick={() => savePars(selectedCourse.id)}>Save Pars</button>
        </>
      )}
    </div>
  );
}
