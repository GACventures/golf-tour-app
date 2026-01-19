"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import MobileNav from "../../_components/MobileNav";

// ✅ Updated import path per your note: lib/handicaps/recalc...
import { recalcAndSaveTourHandicaps } from "@/lib/handicaps/recalcAndSaveTourHandicaps";

type Tour = { id: string; name: string };

type PlayerRow = {
  id: string;
  name: string;
};

type TourPlayerRow = {
  tour_id: string;
  player_id: string;
  starting_handicap: number | null;
  players: PlayerRow | PlayerRow[] | null;
};

type CourseOption = { id: string; name: string };

type ParRow = {
  course_id: string;
  hole_number: number;
  tee: string; // "M" | "F"
  par: number;
  stroke_index: number;
};

type HoleEditRow = {
  hole: number; // 1..18
  parM: string; // "", "3", "4", "5"
  siM: string; // "", "1".."18"
  parF: string;
  siF: string;
};

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizePlayerJoin(val: any): PlayerRow | null {
  if (!val) return null;
  const p = Array.isArray(val) ? val[0] : val;
  if (!p?.id) return null;
  return { id: String(p.id), name: String(p.name ?? "").trim() || "(unnamed)" };
}

function toNullableNumber(v: string): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function makeEmptyHoles(): HoleEditRow[] {
  return Array.from({ length: 18 }, (_, i) => {
    const hole = i + 1;
    return { hole, parM: "", siM: "", parF: "", siF: "" };
  });
}

function toIntOrNull(v: string): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function validateSiSet(values: number[]) {
  if (values.length !== 18) return { ok: false as const, error: "Stroke Index must have 18 values." };
  const set = new Set(values);
  if (set.size !== 18) return { ok: false as const, error: "Stroke Index must be unique (no duplicates)." };

  for (let i = 1; i <= 18; i++) {
    if (!set.has(i)) return { ok: false as const, error: "Stroke Index must include every number from 1 to 18." };
  }
  return { ok: true as const, error: "" };
}

export default function MobileTourAdminStartingHandicapsPage() {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rows, setRows] = useState<
    Array<{
      player_id: string;
      name: string;
      starting_handicap: number | null; // last saved value we loaded/committed
      input: string; // editable text
      dirty: boolean;
    }>
  >([]);

  // Course editor state
  const [courseLoading, setCourseLoading] = useState(false);
  const [courseError, setCourseError] = useState("");
  const [courseSaveMsg, setCourseSaveMsg] = useState("");
  const [courseSaving, setCourseSaving] = useState(false);

  const [courseOptions, setCourseOptions] = useState<CourseOption[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const [holeRows, setHoleRows] = useState<HoleEditRow[]>(makeEmptyHoles());

  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    let alive = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");
      setSaveMsg("");
      setCourseError("");
      setCourseSaveMsg("");

      try {
        const { data: tData, error: tErr } = await supabase.from("tours").select("id,name").eq("id", tourId).single();
        if (tErr) throw tErr;

        const { data: tpData, error: tpErr } = await supabase
          .from("tour_players")
          .select("tour_id,player_id,starting_handicap,players(id,name)")
          .eq("tour_id", tourId)
          .order("name", { ascending: true, foreignTable: "players" });

        if (tpErr) throw tpErr;

        const list = (tpData ?? [])
          .map((r: any) => {
            const p = normalizePlayerJoin(r.players);
            const pid = String(r.player_id ?? p?.id ?? "");
            if (!pid) return null;

            const sh = Number.isFinite(Number(r.starting_handicap)) ? Math.max(0, Math.floor(Number(r.starting_handicap))) : null;

            return {
              player_id: pid,
              name: p?.name ?? "(player)",
              starting_handicap: sh,
              input: sh == null ? "" : String(sh),
              dirty: false,
            };
          })
          .filter(Boolean) as any[];

        // Load tour courses (only those used by rounds in this tour)
        const { data: roundData, error: roundErr } = await supabase
          .from("rounds")
          .select("course_id")
          .eq("tour_id", tourId);

        if (roundErr) throw roundErr;

        const courseIds = Array.from(
          new Set((roundData ?? []).map((r: any) => String(r.course_id ?? "").trim()).filter(Boolean))
        );

        let courses: CourseOption[] = [];
        if (courseIds.length > 0) {
          const { data: cData, error: cErr } = await supabase
            .from("courses")
            .select("id,name")
            .in("id", courseIds)
            .order("name", { ascending: true });

          if (cErr) throw cErr;

          courses = (cData ?? []).map((c: any) => ({
            id: String(c.id),
            name: String(c.name ?? "").trim() || "(unnamed course)",
          }));
        }

        if (!alive) return;

        setTour(tData as Tour);
        setRows(list);
        setCourseOptions(courses);

        // If current selected course is not available, default to first
        setSelectedCourseId((prev) => {
          if (prev && courses.some((c) => c.id === prev)) return prev;
          return courses[0]?.id ?? "";
        });
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load Tour Admin page.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [tourId]);

  // Load pars for selected course
  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;
    if (!selectedCourseId || !isLikelyUuid(selectedCourseId)) {
      setHoleRows(makeEmptyHoles());
      return;
    }

    let alive = true;

    async function loadPars() {
      setCourseLoading(true);
      setCourseError("");
      setCourseSaveMsg("");

      try {
        const { data, error } = await supabase
          .from("pars")
          .select("course_id,hole_number,par,stroke_index,tee")
          .eq("course_id", selectedCourseId)
          .in("tee", ["M", "F"])
          .order("hole_number", { ascending: true });

        if (error) throw error;

        const rows = makeEmptyHoles();
        const byKey = new Map<string, ParRow>();
        (data ?? []).forEach((r: any) => {
          const hole = Number(r.hole_number);
          const tee = String(r.tee ?? "").toUpperCase();
          if (!(hole >= 1 && hole <= 18)) return;
          if (tee !== "M" && tee !== "F") return;
          byKey.set(`${tee}:${hole}`, {
            course_id: String(r.course_id),
            hole_number: hole,
            tee,
            par: Number(r.par),
            stroke_index: Number(r.stroke_index),
          });
        });

        for (let i = 1; i <= 18; i++) {
          const m = byKey.get(`M:${i}`);
          const f = byKey.get(`F:${i}`);
          rows[i - 1] = {
            hole: i,
            parM: m && Number.isFinite(m.par) ? String(m.par) : "",
            siM: m && Number.isFinite(m.stroke_index) ? String(m.stroke_index) : "",
            parF: f && Number.isFinite(f.par) ? String(f.par) : "",
            siF: f && Number.isFinite(f.stroke_index) ? String(f.stroke_index) : "",
          };
        }

        if (!alive) return;
        setHoleRows(rows);
      } catch (e: any) {
        if (!alive) return;
        setCourseError(e?.message ?? "Failed to load course pars.");
        setHoleRows(makeEmptyHoles());
      } finally {
        if (alive) setCourseLoading(false);
      }
    }

    void loadPars();
    return () => {
      alive = false;
    };
  }, [tourId, selectedCourseId]);

  const dirtyCount = useMemo(() => rows.filter((r) => r.dirty).length, [rows]);

  function setRowInput(playerId: string, next: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.player_id !== playerId) return r;
        const base = r.starting_handicap == null ? "" : String(r.starting_handicap);
        return { ...r, input: next, dirty: next.trim() !== base };
      })
    );
  }

  async function saveAll() {
    setSaving(true);
    setErrorMsg("");
    setSaveMsg("");

    try {
      const updates = rows
        .filter((r) => r.dirty)
        .map((r) => ({
          tour_id: tourId,
          player_id: r.player_id,
          starting_handicap: toNullableNumber(r.input),
        }));

      if (updates.length === 0) {
        setSaveMsg("No changes to save.");
        setSaving(false);
        return;
      }

      // 1) Save tour-level starting handicap
      const { error: upErr } = await supabase.from("tour_players").upsert(updates, {
        onConflict: "tour_id,player_id",
      });
      if (upErr) throw upErr;

      // 2) Recalc + save per-round playing handicaps using your rehandicapping engine.
      const recalcRes = await recalcAndSaveTourHandicaps({ supabase, tourId });
      if (!recalcRes.ok) throw new Error(recalcRes.error);

      // Mark clean locally
      setRows((prev) =>
        prev.map((r) => {
          const u = updates.find((x) => x.player_id === r.player_id);
          if (!u) return r;
          return {
            ...r,
            starting_handicap: u.starting_handicap,
            input: u.starting_handicap == null ? "" : String(u.starting_handicap),
            dirty: false,
          };
        })
      );

      setSaveMsg(
        `Saved ${updates.length} change${updates.length === 1 ? "" : "s"}. Rehandicapping recalculated and updated ${recalcRes.updated} round_player row${
          recalcRes.updated === 1 ? "" : "s"
        }.`
      );
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function setHoleCell(hole: number, key: keyof Omit<HoleEditRow, "hole">, value: string) {
    setHoleRows((prev) =>
      prev.map((r) => {
        if (r.hole !== hole) return r;
        return { ...r, [key]: value };
      })
    );
  }

  const selectedCourseName = useMemo(() => {
    return courseOptions.find((c) => c.id === selectedCourseId)?.name ?? "";
  }, [courseOptions, selectedCourseId]);

  async function saveCoursePars() {
    if (!selectedCourseId || !isLikelyUuid(selectedCourseId)) {
      setCourseError("Please select a course.");
      return;
    }

    setCourseSaving(true);
    setCourseError("");
    setCourseSaveMsg("");

    try {
      // Validate completeness + parse values
      const mSIs: number[] = [];
      const fSIs: number[] = [];

      const toUpsert: Array<{
        course_id: string;
        hole_number: number;
        tee: "M" | "F";
        par: number;
        stroke_index: number;
      }> = [];

      for (const r of holeRows) {
        const parM = toIntOrNull(r.parM);
        const siM = toIntOrNull(r.siM);
        const parF = toIntOrNull(r.parF);
        const siF = toIntOrNull(r.siF);

        if (parM == null || siM == null || parF == null || siF == null) {
          throw new Error("All Par and SI fields must be filled for holes 1–18 (both M and F).");
        }

        if (![3, 4, 5].includes(parM)) throw new Error(`Par – M must be 3/4/5 (hole ${r.hole}).`);
        if (![3, 4, 5].includes(parF)) throw new Error(`Par – F must be 3/4/5 (hole ${r.hole}).`);
        if (siM < 1 || siM > 18) throw new Error(`SI – M must be 1–18 (hole ${r.hole}).`);
        if (siF < 1 || siF > 18) throw new Error(`SI – F must be 1–18 (hole ${r.hole}).`);

        mSIs.push(siM);
        fSIs.push(siF);

        toUpsert.push({ course_id: selectedCourseId, hole_number: r.hole, tee: "M", par: parM, stroke_index: siM });
        toUpsert.push({ course_id: selectedCourseId, hole_number: r.hole, tee: "F", par: parF, stroke_index: siF });
      }

      const mVal = validateSiSet(mSIs);
      if (!mVal.ok) throw new Error(`SI – M invalid: ${mVal.error}`);

      const fVal = validateSiSet(fSIs);
      if (!fVal.ok) throw new Error(`SI – F invalid: ${fVal.error}`);

      // Prefer upsert (safe). If schema lacks a unique constraint for onConflict, fall back to delete+insert.
      const { error: upErr } = await supabase.from("pars").upsert(toUpsert, {
        onConflict: "course_id,hole_number,tee",
      });

      if (upErr) {
        const msg = String(upErr.message ?? "");
        const lacksConstraint =
          msg.toLowerCase().includes("no unique") ||
          msg.toLowerCase().includes("no unique or exclusion") ||
          msg.toLowerCase().includes("there is no unique");

        if (!lacksConstraint) throw upErr;

        // Fallback: delete existing rows for this course and tees M/F, then insert fresh.
        const { error: delErr } = await supabase.from("pars").delete().eq("course_id", selectedCourseId).in("tee", ["M", "F"]);
        if (delErr) throw delErr;

        const { error: insErr } = await supabase.from("pars").insert(toUpsert);
        if (insErr) throw insErr;
      }

      setCourseSaveMsg(`Saved course par/SI for ${selectedCourseName || "selected course"}.`);
    } catch (e: any) {
      setCourseError(e?.message ?? "Save failed.");
    } finally {
      setCourseSaving(false);
    }
  }

  function goBack() {
    router.push(`/m/tours/${tourId}/more`);
  }

  if (!tourId || !isLikelyUuid(tourId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900 pb-24">
        <div className="mx-auto max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">
            Missing or invalid tour id in route.
            <div className="mt-2">
              <Link className="underline" href="/m">
                Go to mobile home
              </Link>
            </div>
          </div>
        </div>
        <MobileNav />
      </div>
    );
  }

  const parOptions = ["", "3", "4", "5"];
  const siOptions = ["", ...Array.from({ length: 18 }, (_, i) => String(i + 1))];

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-gray-900">Tour Admin</div>
            <div className="truncate text-sm text-gray-500">{tour?.name ?? ""}</div>
          </div>

          <button
            type="button"
            onClick={goBack}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm active:bg-gray-50"
          >
            Back
          </button>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4 space-y-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-5 w-40 rounded bg-gray-100" />
            <div className="h-64 rounded-2xl border bg-white" />
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorMsg}</div>
        ) : (
          <>
            {/* Starting handicaps (existing) */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Tour starting handicaps</div>
                <div className="mt-1 text-xs text-gray-600">
                  Saves <span className="font-medium">tour_players.starting_handicap</span>, then recalculates{" "}
                  <span className="font-medium">round_players.playing_handicap</span> using the tour’s rehandicapping rule.
                </div>
              </div>

              {rows.length === 0 ? (
                <div className="p-4 text-sm text-gray-700">No players found for this tour.</div>
              ) : (
                <div className="divide-y">
                  {rows.map((r) => (
                    <div key={r.player_id} className="p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900">{r.name}</div>
                        {r.dirty ? <div className="text-[11px] text-amber-700">Unsaved</div> : null}
                      </div>

                      <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className="w-24 rounded-xl border border-gray-200 bg-white px-3 py-2 text-right text-sm font-semibold text-gray-900 shadow-sm"
                        value={r.input}
                        onChange={(e) => setRowInput(r.player_id, e.target.value)}
                        placeholder="—"
                        aria-label={`Starting handicap for ${r.name}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-gray-600">
                {dirtyCount > 0 ? `${dirtyCount} change${dirtyCount === 1 ? "" : "s"} pending` : "No pending changes"}
              </div>

              <button
                type="button"
                onClick={saveAll}
                disabled={saving || dirtyCount === 0}
                className={`h-10 rounded-xl px-4 text-sm font-semibold border shadow-sm ${
                  saving || dirtyCount === 0
                    ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "border-gray-900 bg-gray-900 text-white active:bg-gray-800"
                }`}
              >
                {saving ? "Saving…" : "Save all"}
              </button>
            </div>

            {saveMsg ? <div className="text-sm text-green-700">{saveMsg}</div> : null}

            {/* NEW: Course Par/SI Editor */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Course par &amp; stroke index (global)</div>
                <div className="mt-1 text-xs text-gray-600">
                  Updates <span className="font-medium">pars</span> for tees <span className="font-medium">M</span> and{" "}
                  <span className="font-medium">F</span>. Courses are limited to this tour’s rounds.
                </div>
              </div>

              <div className="p-4 space-y-3">
                {courseOptions.length === 0 ? (
                  <div className="text-sm text-gray-700">No courses found on this tour (rounds have no course_id).</div>
                ) : (
                  <>
                    <label className="block text-xs font-semibold text-gray-700" htmlFor="courseSelect">
                      Select course
                    </label>
                    <select
                      id="courseSelect"
                      className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-sm"
                      value={selectedCourseId}
                      onChange={(e) => setSelectedCourseId(e.target.value)}
                    >
                      {courseOptions.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>

                    {courseLoading ? (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">Loading hole data…</div>
                    ) : null}

                    {courseError ? (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{courseError}</div>
                    ) : null}

                    {/* Grid */}
                    <div className="overflow-hidden rounded-2xl border border-gray-200">
                      <div className="grid grid-cols-5 gap-0 border-b bg-gray-50">
                        <div className="px-2 py-2 text-[11px] font-semibold text-gray-700">Hole</div>
                        <div className="px-2 py-2 text-[11px] font-semibold text-gray-700">Par M</div>
                        <div className="px-2 py-2 text-[11px] font-semibold text-gray-700">SI M</div>
                        <div className="px-2 py-2 text-[11px] font-semibold text-gray-700">Par F</div>
                        <div className="px-2 py-2 text-[11px] font-semibold text-gray-700">SI F</div>
                      </div>

                      <div className="divide-y">
                        {holeRows.map((r) => (
                          <div key={r.hole} className="grid grid-cols-5 gap-0 items-center">
                            <div className="px-2 py-2 text-sm font-semibold text-gray-900">{r.hole}</div>

                            <div className="px-1 py-1">
                              <select
                                className="h-9 w-full rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900"
                                value={r.parM}
                                onChange={(e) => setHoleCell(r.hole, "parM", e.target.value)}
                                aria-label={`Par M hole ${r.hole}`}
                              >
                                <option value="">—</option>
                                {parOptions
                                  .filter((x) => x !== "")
                                  .map((p) => (
                                    <option key={p} value={p}>
                                      {p}
                                    </option>
                                  ))}
                              </select>
                            </div>

                            <div className="px-1 py-1">
                              <select
                                className="h-9 w-full rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900"
                                value={r.siM}
                                onChange={(e) => setHoleCell(r.hole, "siM", e.target.value)}
                                aria-label={`SI M hole ${r.hole}`}
                              >
                                <option value="">—</option>
                                {siOptions
                                  .filter((x) => x !== "")
                                  .map((si) => (
                                    <option key={si} value={si}>
                                      {si}
                                    </option>
                                  ))}
                              </select>
                            </div>

                            <div className="px-1 py-1">
                              <select
                                className="h-9 w-full rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900"
                                value={r.parF}
                                onChange={(e) => setHoleCell(r.hole, "parF", e.target.value)}
                                aria-label={`Par F hole ${r.hole}`}
                              >
                                <option value="">—</option>
                                {parOptions
                                  .filter((x) => x !== "")
                                  .map((p) => (
                                    <option key={p} value={p}>
                                      {p}
                                    </option>
                                  ))}
                              </select>
                            </div>

                            <div className="px-1 py-1">
                              <select
                                className="h-9 w-full rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900"
                                value={r.siF}
                                onChange={(e) => setHoleCell(r.hole, "siF", e.target.value)}
                                aria-label={`SI F hole ${r.hole}`}
                              >
                                <option value="">—</option>
                                {siOptions
                                  .filter((x) => x !== "")
                                  .map((si) => (
                                    <option key={si} value={si}>
                                      {si}
                                    </option>
                                  ))}
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-gray-600">
                        {selectedCourseName ? (
                          <>
                            Editing: <span className="font-medium">{selectedCourseName}</span>
                          </>
                        ) : (
                          "Select a course to edit"
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={saveCoursePars}
                        disabled={courseSaving || courseLoading || !selectedCourseId}
                        className={`h-10 rounded-xl px-4 text-sm font-semibold border shadow-sm ${
                          courseSaving || courseLoading || !selectedCourseId
                            ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                            : "border-gray-900 bg-gray-900 text-white active:bg-gray-800"
                        }`}
                      >
                        {courseSaving ? "Saving…" : "Save course"}
                      </button>
                    </div>

                    {courseSaveMsg ? <div className="text-sm text-green-700">{courseSaveMsg}</div> : null}
                  </>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
