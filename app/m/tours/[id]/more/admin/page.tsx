"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

import MobileNav from "../../_components/MobileNav";
import { recalcAndSaveTourHandicaps } from "@/lib/handicaps/recalcAndSaveTourHandicaps";

type Tour = {
  id: string;
  name: string;
};

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

type RoundOption = {
  id: string;
  round_no: number;
  played_on: string | null;
  name: string | null;
  course_name: string | null;
};

// Tee time grouping tables (existing)
type RoundGroupRow = {
  id: string;
  round_id: string;
  group_no: number;
  start_hole: number;
  tee_time: string | null;
  notes: string | null;
};

type RoundGroupPlayerRow = {
  id: string;
  round_id: string;
  group_id: string;
  player_id: string;
  seat: number | null;
};

type ManualGroup = {
  key: string; // local-only stable key
  groupNo: number; // 1..N visual order
  playerIds: string[]; // ordered player_ids
};

type AdminSection = "starting" | "course" | "tee" | null;

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

function makeLocalKey() {
  return `g_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

function formatRoundLine(r: RoundOption) {
  const rn = Number.isFinite(Number(r.round_no)) ? Number(r.round_no) : 0;
  const title = (r.course_name ?? "").trim() || (r.name ?? "").trim() || "Round";
  const date = (r.played_on ?? "").trim();
  const tail = date ? ` • ${date}` : "";
  return `R${rn} • ${title}${tail}`;
}

export default function MobileTourAdminPage() {
  const params = useParams<{ id?: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  // section chooser
  const [activeSection, setActiveSection] = useState<AdminSection>(null);

  // Starting handicaps state
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

  // Rounds list (used for tee time groups)
  const [roundOptions, setRoundOptions] = useState<RoundOption[]>([]);

  // Manual tee time groups (uses existing round_groups / round_group_players)
  const [ttSelectedRoundId, setTtSelectedRoundId] = useState<string>("");
  const [ttLoading, setTtLoading] = useState(false);
  const [ttSaving, setTtSaving] = useState(false);
  const [ttError, setTtError] = useState("");
  const [ttMsg, setTtMsg] = useState("");

  const [ttGroups, setTtGroups] = useState<ManualGroup[]>([]);
  const [ttAddTargetGroupNo, setTtAddTargetGroupNo] = useState<number>(1);

  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    let alive = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");
      setSaveMsg("");

      // reset course messages
      setCourseError("");
      setCourseSaveMsg("");
      setCourseLoading(false);
      setCourseSaving(false);

      // reset tee time editor (but keep the section chooser state)
      setTtError("");
      setTtMsg("");
      setTtSelectedRoundId("");
      setTtGroups([]);
      setTtAddTargetGroupNo(1);

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
        const { data: roundCourseData, error: roundCourseErr } = await supabase.from("rounds").select("course_id").eq("tour_id", tourId);
        if (roundCourseErr) throw roundCourseErr;

        const courseIds = Array.from(
          new Set((roundCourseData ?? []).map((r: any) => String(r.course_id ?? "").trim()).filter(Boolean))
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

        // Rounds list for tee time editor (and consistent formatting)
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,round_no,played_on,name,courses(name)")
          .eq("tour_id", tourId)
          .order("round_no", { ascending: true });

        if (rErr) throw rErr;

        const ropts: RoundOption[] = (rData ?? [])
          .map((r: any) => {
            const courseJoin = Array.isArray(r.courses) ? r.courses[0] : r.courses;
            const courseName = courseJoin?.name ? String(courseJoin.name) : null;
            return {
              id: String(r.id),
              round_no: Number(r.round_no),
              played_on: r.played_on == null ? null : String(r.played_on),
              name: r.name == null ? null : String(r.name),
              course_name: courseName,
            };
          })
          .filter((r: RoundOption) => !!r.id && Number.isFinite(r.round_no));

        if (!alive) return;

        setTour(tData as Tour);
        setRows(list);

        setCourseOptions(courses);
        setSelectedCourseId("");
        setHoleRows(makeEmptyHoles());

        setRoundOptions(ropts);

        // Start with no tool visible
        setActiveSection(null);
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

  // Load pars for selected course (only after user selects)
  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    if (!selectedCourseId) {
      setCourseError("");
      setCourseSaveMsg("");
      setCourseLoading(false);
      setCourseSaving(false);
      setHoleRows(makeEmptyHoles());
      return;
    }

    if (!isLikelyUuid(selectedCourseId)) {
      setCourseError("Selected course id is invalid.");
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

      // 2) Recalc + save per-round playing handicaps using the existing engine.
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
      const mSIs: number[] = [];
      const fSIs: number[] = [];

      const toInsert: Array<{
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

        toInsert.push({ course_id: selectedCourseId, hole_number: r.hole, tee: "M", par: parM, stroke_index: siM });
        toInsert.push({ course_id: selectedCourseId, hole_number: r.hole, tee: "F", par: parF, stroke_index: siF });
      }

      const mVal = validateSiSet(mSIs);
      if (!mVal.ok) throw new Error(`SI – M invalid: ${mVal.error}`);

      const fVal = validateSiSet(fSIs);
      if (!fVal.ok) throw new Error(`SI – F invalid: ${fVal.error}`);

      const { error: delErr } = await supabase.from("pars").delete().eq("course_id", selectedCourseId).in("tee", ["M", "F"]);
      if (delErr) throw delErr;

      const { error: insErr } = await supabase.from("pars").insert(toInsert);
      if (insErr) throw insErr;

      setCourseSaveMsg(`Saved course par/SI for ${selectedCourseName || "selected course"}.`);
    } catch (e: any) {
      setCourseError(e?.message ?? "Save failed.");
    } finally {
      setCourseSaving(false);
    }
  }

  // -------------------------
  // Manual tee time editor
  // -------------------------

  const playerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) m.set(r.player_id, r.name);
    return m;
  }, [rows]);

  const ttAssignedSet = useMemo(() => {
    const s = new Set<string>();
    for (const g of ttGroups) for (const pid of g.playerIds) s.add(pid);
    return s;
  }, [ttGroups]);

  const ttUnassigned = useMemo(() => {
    return rows
      .map((r) => ({ id: r.player_id, name: r.name }))
      .filter((p) => !ttAssignedSet.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, ttAssignedSet]);

  const ttGroupNos = useMemo(() => ttGroups.map((g) => g.groupNo), [ttGroups]);

  function normalizeGroupNos(next: ManualGroup[]) {
    const sorted = [...next].sort((a, b) => a.groupNo - b.groupNo);
    return sorted.map((g, idx) => ({ ...g, groupNo: idx + 1 }));
  }

  async function loadManualTeeTimes(roundId: string) {
    if (!roundId || !isLikelyUuid(roundId)) {
      setTtGroups([]);
      setTtAddTargetGroupNo(1);
      return;
    }

    setTtLoading(true);
    setTtError("");
    setTtMsg("");

    try {
      const { data: gData, error: gErr } = await supabase
        .from("round_groups")
        .select("id,round_id,group_no,start_hole,tee_time,notes")
        .eq("round_id", roundId)
        .order("group_no", { ascending: true });

      if (gErr) throw gErr;

      const groups = (gData ?? []) as RoundGroupRow[];
      if (groups.length === 0) {
        setTtGroups([]);
        setTtAddTargetGroupNo(1);
        return;
      }

      const groupIds = groups.map((g) => g.id);

      const { data: mData, error: mErr } = await supabase
        .from("round_group_players")
        .select("id,round_id,group_id,player_id,seat")
        .eq("round_id", roundId)
        .in("group_id", groupIds);

      if (mErr) throw mErr;

      const members = (mData ?? []) as RoundGroupPlayerRow[];

      const memByGroup = new Map<string, RoundGroupPlayerRow[]>();
      for (const m of members) {
        if (!memByGroup.has(m.group_id)) memByGroup.set(m.group_id, []);
        memByGroup.get(m.group_id)!.push(m);
      }
      for (const [gid, arr] of memByGroup.entries()) {
        arr.sort((a, b) => (a.seat ?? 999) - (b.seat ?? 999));
        memByGroup.set(gid, arr);
      }

      const local: ManualGroup[] = groups
        .slice()
        .sort((a, b) => a.group_no - b.group_no)
        .map((g) => {
          const mem = memByGroup.get(g.id) ?? [];
          return {
            key: makeLocalKey(),
            groupNo: Number(g.group_no),
            playerIds: mem.map((x) => String(x.player_id)).filter(Boolean),
          };
        });

      const normalized = normalizeGroupNos(local);
      setTtGroups(normalized);
      setTtAddTargetGroupNo(normalized[0]?.groupNo ?? 1);
      setTtMsg("Loaded saved groups for this round.");
    } catch (e: any) {
      setTtError(e?.message ?? "Failed to load tee time groups for this round.");
      setTtGroups([]);
      setTtAddTargetGroupNo(1);
    } finally {
      setTtLoading(false);
    }
  }

  function ttAddGroup() {
    setTtMsg("");
    setTtError("");
    setTtGroups((prev) => {
      const next = [...prev, { key: makeLocalKey(), groupNo: prev.length + 1, playerIds: [] }];
      return normalizeGroupNos(next);
    });
    setTtAddTargetGroupNo((prev) => (prev && prev > 0 ? prev : 1));
  }

  function ttDeleteGroup(groupNo: number) {
    setTtMsg("");
    setTtError("");
    setTtGroups((prev) => normalizeGroupNos(prev.filter((g) => g.groupNo !== groupNo)));
    setTtAddTargetGroupNo((prev) => {
      const remaining = ttGroupNos.filter((n) => n !== groupNo);
      const min = remaining.length ? Math.min(...remaining) : 1;
      return prev > groupNo ? prev - 1 : prev === groupNo ? min : prev;
    });
  }

  function ttMoveGroup(groupNo: number, dir: "up" | "down") {
    setTtMsg("");
    setTtError("");

    setTtGroups((prev) => {
      const next = [...prev].sort((a, b) => a.groupNo - b.groupNo);
      const idx = next.findIndex((g) => g.groupNo === groupNo);
      if (idx < 0) return prev;

      const swapIdx = dir === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;

      const a = next[idx];
      const b = next[swapIdx];
      next[idx] = { ...a, groupNo: b.groupNo };
      next[swapIdx] = { ...b, groupNo: a.groupNo };

      return normalizeGroupNos(next);
    });
  }

  function ttAddPlayerToGroup(playerId: string, groupNo: number) {
    setTtMsg("");
    setTtError("");

    setTtGroups((prev) => {
      const stripped = prev.map((g) => ({ ...g, playerIds: g.playerIds.filter((pid) => pid !== playerId) }));
      return stripped.map((g) => {
        if (g.groupNo !== groupNo) return g;
        return { ...g, playerIds: [...g.playerIds, playerId] };
      });
    });
  }

  function ttRemovePlayer(groupNo: number, playerId: string) {
    setTtMsg("");
    setTtError("");
    setTtGroups((prev) =>
      prev.map((g) => {
        if (g.groupNo !== groupNo) return g;
        return { ...g, playerIds: g.playerIds.filter((pid) => pid !== playerId) };
      })
    );
  }

  function ttMovePlayerWithinGroup(groupNo: number, playerId: string, dir: "up" | "down") {
    setTtMsg("");
    setTtError("");

    setTtGroups((prev) =>
      prev.map((g) => {
        if (g.groupNo !== groupNo) return g;
        const idx = g.playerIds.findIndex((x) => x === playerId);
        if (idx < 0) return g;
        const swapIdx = dir === "up" ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= g.playerIds.length) return g;
        const arr = [...g.playerIds];
        [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
        return { ...g, playerIds: arr };
      })
    );
  }

  async function ttSave() {
    if (!ttSelectedRoundId || !isLikelyUuid(ttSelectedRoundId)) {
      setTtError("Please select a round.");
      return;
    }

    setTtSaving(true);
    setTtError("");
    setTtMsg("");

    try {
      const nonEmpty = ttGroups
        .map((g) => ({ ...g, playerIds: g.playerIds.filter(Boolean) }))
        .filter((g) => g.playerIds.length > 0)
        .sort((a, b) => a.groupNo - b.groupNo);

      const delM = await supabase.from("round_group_players").delete().eq("round_id", ttSelectedRoundId);
      if (delM.error) throw delM.error;

      const delG = await supabase.from("round_groups").delete().eq("round_id", ttSelectedRoundId);
      if (delG.error) throw delG.error;

      if (nonEmpty.length === 0) {
        setTtMsg("Saved: cleared all tee time groups for this round.");
        setTtSaving(false);
        return;
      }

      const groupRows = nonEmpty.map((g, idx) => ({
        round_id: ttSelectedRoundId,
        group_no: idx + 1,
        start_hole: 1,
        tee_time: null,
        notes: "Manual: Mobile admin",
      }));

      const { data: insertedGroups, error: insGErr } = await supabase.from("round_groups").insert(groupRows).select("id,group_no");
      if (insGErr) throw insGErr;

      const idByNo = new Map<number, string>();
      for (const g of insertedGroups ?? []) idByNo.set(Number((g as any).group_no), String((g as any).id));

      const memberRows: any[] = [];
      nonEmpty.forEach((g, idx) => {
        const groupNo = idx + 1;
        const groupId = idByNo.get(groupNo);
        if (!groupId) return;
        g.playerIds.forEach((pid, seatIdx) => {
          memberRows.push({
            round_id: ttSelectedRoundId,
            group_id: groupId,
            player_id: pid,
            seat: seatIdx + 1,
          });
        });
      });

      const { error: insMErr } = await supabase.from("round_group_players").insert(memberRows);
      if (insMErr) throw insMErr;

      setTtMsg(`Saved ${nonEmpty.length} group${nonEmpty.length === 1 ? "" : "s"} (${memberRows.length} player assignments).`);
      await loadManualTeeTimes(ttSelectedRoundId);
    } catch (e: any) {
      setTtError(e?.message ?? "Failed to save tee time groups.");
    } finally {
      setTtSaving(false);
    }
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

  const parOptions = ["3", "4", "5"];
  const siOptions = Array.from({ length: 18 }, (_, i) => String(i + 1));

  const pillBase = "h-10 rounded-xl border text-sm font-semibold flex items-center justify-center";
  const pillActive = "border-gray-900 bg-gray-900 text-white";
  const pillIdle = "border-gray-200 bg-white text-gray-900";

  const topBtnBase = "w-full rounded-2xl border px-4 py-4 text-left shadow-sm";
  const topBtnActive = "border-gray-900 bg-gray-900 text-white";
  const topBtnIdle = "border-gray-200 bg-white text-gray-900";

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-base font-semibold text-gray-900">Tour Admin</div>
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
            {/* Button chooser (always visible) */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Admin tools</div>
              </div>

              <div className="p-4 space-y-3">
                <button
                  type="button"
                  onClick={() => setActiveSection("starting")}
                  className={`${topBtnBase} ${activeSection === "starting" ? topBtnActive : topBtnIdle}`}
                >
                  <div className="text-sm font-semibold">Tour starting handicaps</div>
                  <div className={`mt-1 text-xs ${activeSection === "starting" ? "text-white/80" : "text-gray-600"}`}>
                    Edit tour-level starting handicaps and recalculate playing handicaps.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSection("course")}
                  className={`${topBtnBase} ${activeSection === "course" ? topBtnActive : topBtnIdle}`}
                >
                  <div className="text-sm font-semibold">Course Par &amp; Stroke Index (global)</div>
                  <div className={`mt-1 text-xs ${activeSection === "course" ? "text-white/80" : "text-gray-600"}`}>
                    Update par and stroke index for tees M/F for courses used in this tour.
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveSection("tee")}
                  className={`${topBtnBase} ${activeSection === "tee" ? topBtnActive : topBtnIdle}`}
                >
                  <div className="text-sm font-semibold">Tee time groups (manual)</div>
                  <div className={`mt-1 text-xs ${activeSection === "tee" ? "text-white/80" : "text-gray-600"}`}>
                    Create/edit tee time groups and seat order for a selected round.
                  </div>
                </button>
              </div>
            </section>

            {/* Nothing else until a button is pressed */}
            {activeSection === null ? null : activeSection === "starting" ? (
              <>
                {/* Starting handicaps (existing functionality) */}
                <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <div className="p-4 border-b">
                    <div className="text-sm font-semibold text-gray-900">Tour starting handicaps</div>
                    <div className="mt-1 text-xs text-gray-600">
                      Saves <span className="font-medium">tour_players.starting_handicap</span>, then recalculates{" "}
                      <span className="font-medium">round_players.playing_handicap</span> using the tour’s rule.
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
              </>
            ) : activeSection === "course" ? (
              <>
                {/* Course Par/SI Editor (existing functionality) */}
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
                          <option value="">Select a course…</option>
                          {courseOptions.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>

                        {!selectedCourseId ? (
                          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                            Choose a course to edit par and stroke index.
                          </div>
                        ) : (
                          <>
                            {courseLoading ? (
                              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">Loading hole data…</div>
                            ) : null}

                            {courseError ? (
                              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{courseError}</div>
                            ) : null}

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
                                        {parOptions.map((p) => (
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
                                        {siOptions.map((si) => (
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
                                        {parOptions.map((p) => (
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
                                        {siOptions.map((si) => (
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
                      </>
                    )}
                  </div>
                </section>
              </>
            ) : (
              <>
                {/* Tee time groups (manual) - existing functionality, but round selection is now a list */}
                <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <div className="p-4 border-b">
                    <div className="text-sm font-semibold text-gray-900">Tee time groups (manual)</div>
                    <div className="mt-1 text-xs text-gray-600">
                      Saves to <span className="font-medium">round_groups</span> and <span className="font-medium">round_group_players</span>.
                      Saving replaces prior groups for the round (idempotent).
                    </div>
                  </div>

                  <div className="p-4 space-y-3">
                    {roundOptions.length === 0 ? (
                      <div className="text-sm text-gray-700">No rounds found for this tour.</div>
                    ) : (
                      <>
                        <div className="text-xs font-semibold text-gray-700">Select round</div>

                        <div className="rounded-2xl border border-gray-200 overflow-hidden">
                          <div className="divide-y">
                            {roundOptions.map((r) => {
                              const selected = ttSelectedRoundId === r.id;
                              return (
                                <button
                                  key={r.id}
                                  type="button"
                                  onClick={async () => {
                                    const rid = r.id;
                                    setTtSelectedRoundId(rid);
                                    setTtError("");
                                    setTtMsg("");
                                    setTtGroups([]);
                                    setTtAddTargetGroupNo(1);
                                    if (rid) await loadManualTeeTimes(rid);
                                  }}
                                  className={`w-full px-3 py-3 text-left ${
                                    selected ? "bg-gray-900 text-white" : "bg-white text-gray-900 active:bg-gray-50"
                                  }`}
                                >
                                  <div className="text-sm font-semibold">{formatRoundLine(r)}</div>
                                  {selected ? <div className="mt-1 text-[11px] text-white/80">Selected</div> : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {!ttSelectedRoundId ? (
                          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                            Choose a round to create or edit tee time groups.
                          </div>
                        ) : (
                          <>
                            {ttLoading ? (
                              <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">Loading groups…</div>
                            ) : null}

                            {ttError ? (
                              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{ttError}</div>
                            ) : null}

                            {ttMsg ? <div className="text-sm text-green-700">{ttMsg}</div> : null}

                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={ttAddGroup}
                                disabled={ttLoading || ttSaving}
                                className={`h-10 rounded-xl px-4 text-sm font-semibold border shadow-sm ${
                                  ttLoading || ttSaving
                                    ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                    : "border-gray-200 bg-white text-gray-900 active:bg-gray-50"
                                }`}
                              >
                                + Add group
                              </button>

                              <button
                                type="button"
                                onClick={ttSave}
                                disabled={ttLoading || ttSaving}
                                className={`h-10 rounded-xl px-4 text-sm font-semibold border shadow-sm ${
                                  ttLoading || ttSaving
                                    ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                    : "border-gray-900 bg-gray-900 text-white active:bg-gray-800"
                                }`}
                              >
                                {ttSaving ? "Saving…" : "Save groups"}
                              </button>
                            </div>

                            <div className="rounded-2xl border border-gray-200 overflow-hidden">
                              <div className="grid grid-cols-12 gap-0 border-b bg-gray-50">
                                <div className="col-span-7 px-2 py-2 text-[11px] font-semibold text-gray-700">Unassigned players</div>
                                <div className="col-span-5 px-2 py-2 text-[11px] font-semibold text-gray-700 text-right">Add to…</div>
                              </div>

                              <div className="p-3 space-y-2">
                                {ttGroups.length === 0 ? (
                                  <div className="text-sm text-gray-700">
                                    No groups yet. Tap <span className="font-medium">Add group</span> to begin.
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-xs text-gray-600">Target group for adding players</div>
                                    <select
                                      className="h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-900"
                                      value={ttAddTargetGroupNo}
                                      onChange={(e) => setTtAddTargetGroupNo(Number(e.target.value))}
                                      disabled={ttLoading || ttSaving || ttGroups.length === 0}
                                    >
                                      {ttGroups
                                        .slice()
                                        .sort((a, b) => a.groupNo - b.groupNo)
                                        .map((g) => (
                                          <option key={g.key} value={g.groupNo}>
                                            Group {g.groupNo}
                                          </option>
                                        ))}
                                    </select>
                                  </div>
                                )}

                                <div className="divide-y rounded-xl border border-gray-200 overflow-hidden">
                                  {ttUnassigned.length === 0 ? (
                                    <div className="p-3 text-sm text-gray-700">All players are assigned to a group.</div>
                                  ) : (
                                    ttUnassigned.map((p) => (
                                      <div key={p.id} className="p-3 flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                          <div className="truncate text-sm font-semibold text-gray-900">{p.name}</div>
                                        </div>

                                        <button
                                          type="button"
                                          disabled={ttGroups.length === 0 || ttSaving || ttLoading}
                                          onClick={() => ttAddPlayerToGroup(p.id, ttAddTargetGroupNo)}
                                          className={`h-9 rounded-lg px-3 text-sm font-semibold border shadow-sm ${
                                            ttGroups.length === 0 || ttSaving || ttLoading
                                              ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                              : "border-gray-900 bg-gray-900 text-white active:bg-gray-800"
                                          }`}
                                        >
                                          Add
                                        </button>
                                      </div>
                                    ))
                                  )}
                                </div>

                                <div className="text-[11px] text-gray-500">
                                  Tip: this simple flow is mobile-safe (no drag/drop). Use “Move up/down” within groups to set seat order.
                                </div>
                              </div>
                            </div>

                            <div className="space-y-3">
                              {ttGroups
                                .slice()
                                .sort((a, b) => a.groupNo - b.groupNo)
                                .map((g, idx, arr) => {
                                  const count = g.playerIds.length;
                                  const over = count > 4;

                                  return (
                                    <div key={g.key} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                                      <div className="p-3 border-b flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                          <div className="text-sm font-semibold text-gray-900">
                                            Group {g.groupNo}{" "}
                                            <span className={`text-xs ${over ? "text-amber-700" : "text-gray-500"}`}>
                                              ({count} player{count === 1 ? "" : "s"})
                                            </span>
                                          </div>
                                          <div className="mt-1 text-[11px] text-gray-600">
                                            Typical is 4-ball (sometimes 3-ball/2-ball). We won’t block larger groups, but it may not be intended.
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-2">
                                          <button
                                            type="button"
                                            onClick={() => ttMoveGroup(g.groupNo, "up")}
                                            disabled={ttSaving || ttLoading || g.groupNo === 1}
                                            className={`h-9 rounded-lg border px-2 text-xs font-semibold shadow-sm ${
                                              ttSaving || ttLoading || g.groupNo === 1
                                                ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                                : "border-gray-200 bg-white text-gray-900 active:bg-gray-50"
                                            }`}
                                          >
                                            ↑
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() => ttMoveGroup(g.groupNo, "down")}
                                            disabled={ttSaving || ttLoading || g.groupNo === arr.length}
                                            className={`h-9 rounded-lg border px-2 text-xs font-semibold shadow-sm ${
                                              ttSaving || ttLoading || g.groupNo === arr.length
                                                ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                                : "border-gray-200 bg-white text-gray-900 active:bg-gray-50"
                                            }`}
                                          >
                                            ↓
                                          </button>

                                          <button
                                            type="button"
                                            onClick={() => ttDeleteGroup(g.groupNo)}
                                            disabled={ttSaving || ttLoading}
                                            className={`h-9 rounded-lg border px-3 text-xs font-semibold shadow-sm ${
                                              ttSaving || ttLoading
                                                ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                                : "border-red-200 bg-white text-red-700 active:bg-red-50"
                                            }`}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </div>

                                      {g.playerIds.length === 0 ? (
                                        <div className="p-3 text-sm text-gray-700">No players in this group yet.</div>
                                      ) : (
                                        <div className="divide-y">
                                          {g.playerIds.map((pid) => {
                                            const name = playerNameById.get(pid) ?? pid;
                                            const isFirst = g.playerIds[0] === pid;
                                            const isLast = g.playerIds[g.playerIds.length - 1] === pid;

                                            return (
                                              <div key={pid} className="p-3 flex items-center justify-between gap-2">
                                                <div className="min-w-0">
                                                  <div className="truncate text-sm font-semibold text-gray-900">{name}</div>
                                                  <div className="text-[11px] text-gray-500">Seat {g.playerIds.indexOf(pid) + 1}</div>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                  <button
                                                    type="button"
                                                    onClick={() => ttMovePlayerWithinGroup(g.groupNo, pid, "up")}
                                                    disabled={ttSaving || ttLoading || isFirst}
                                                    className={`h-9 rounded-lg border px-2 text-xs font-semibold shadow-sm ${
                                                      ttSaving || ttLoading || isFirst
                                                        ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                                        : "border-gray-200 bg-white text-gray-900 active:bg-gray-50"
                                                    }`}
                                                  >
                                                    ↑
                                                  </button>

                                                  <button
                                                    type="button"
                                                    onClick={() => ttMovePlayerWithinGroup(g.groupNo, pid, "down")}
                                                    disabled={ttSaving || ttLoading || isLast}
                                                    className={`h-9 rounded-lg border px-2 text-xs font-semibold shadow-sm ${
                                                      ttSaving || ttLoading || isLast
                                                        ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                                        : "border-gray-200 bg-white text-gray-900 active:bg-gray-50"
                                                    }`}
                                                  >
                                                    ↓
                                                  </button>

                                                  <button
                                                    type="button"
                                                    onClick={() => ttRemovePlayer(g.groupNo, pid)}
                                                    disabled={ttSaving || ttLoading}
                                                    className={`h-9 rounded-lg border px-3 text-xs font-semibold shadow-sm ${
                                                      ttSaving || ttLoading
                                                        ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                                                        : "border-gray-200 bg-white text-gray-900 active:bg-gray-50"
                                                    }`}
                                                  >
                                                    Remove
                                                  </button>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
