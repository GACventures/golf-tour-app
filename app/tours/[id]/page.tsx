// app/tours/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { supabase } from "@/lib/supabaseClient";

type Tour = {
  id: string;
  name: string;
  start_date: string | null; // YYYY-MM-DD
  end_date: string | null; // YYYY-MM-DD
};

type Course = { id: string; name: string; tour_id: string | null };

type Player = { id: string; name: string; start_handicap: number | null };

type TourPlayerRow = {
  tour_id: string;
  player_id: string;
  starting_handicap: number | null; // tour override
  players: Player | Player[] | null; // global
};

type Round = {
  id: string;
  tour_id: string;
  course_id: string | null;
  name: string | null;
  round_no: number | null;
  created_at: string | null;
  played_on: string | null; // date
};

type RoundGroup = { id: string; round_id: string; tee_time: string | null };

type TourGroupRow = {
  id: string;
  tour_id: string;
  scope: "tour" | "round";
  type: "pair" | "team";
  name: string | null;
  round_id: string | null;
  created_at?: string | null;
};

type TourGroupMemberRow = { group_id: string; player_id: string };

type TourGroupingSettings = {
  tour_id: string;

  default_team_best_m: number | null;

  individual_mode: "ALL" | "BEST_N" | string;
  individual_best_n: number | null;
  individual_final_required: boolean;

  pair_mode: "ALL" | "BEST_Q" | string;
  pair_best_q: number | null;
  pair_final_required: boolean;
};

function normalizePlayerJoin(val: any): Player | null {
  if (!val) return null;
  const p = Array.isArray(val) ? val[0] : val;
  if (!p) return null;

  const id = p.id != null ? String(p.id) : "";
  const name = p.name != null ? String(p.name) : "";
  const sh = Number.isFinite(Number(p.start_handicap)) ? Number(p.start_handicap) : null;

  if (!id) return null;
  return { id, name: name || "(missing player)", start_handicap: sh };
}

function clampIntOrNull(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

function parseDateOnly(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(value: string | null) {
  if (!value) return "TBD";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// IMPORTANT: for rounds display — if played_on missing, show TBC (not created_at)
function fmtRoundPlayedOn(played_on: string | null) {
  if (!played_on) return "TBC";
  const d = new Date(played_on);
  if (Number.isNaN(d.getTime())) return String(played_on);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtRuleIndividual(s: TourGroupingSettings | null) {
  if (!s) return "All rounds";
  const mode = String(s.individual_mode ?? "ALL").toUpperCase();
  if (mode !== "BEST_N") return "All rounds";
  const n = Number.isFinite(Number(s.individual_best_n)) ? Number(s.individual_best_n) : 0;
  const fr = s.individual_final_required === true;
  if (n > 0) return fr ? `Best ${n} rounds (Final required)` : `Best ${n} rounds`;
  return fr ? "Best N rounds (Final required)" : "Best N rounds";
}

function fmtRulePairs(s: TourGroupingSettings | null) {
  if (!s) return "All rounds";
  const mode = String(s.pair_mode ?? "ALL").toUpperCase();
  if (mode !== "BEST_Q") return "All rounds";
  const q = Number.isFinite(Number(s.pair_best_q)) ? Number(s.pair_best_q) : 0;
  const fr = s.pair_final_required === true;
  if (q > 0) return fr ? `Best ${q} rounds (Final required)` : `Best ${q} rounds`;
  return fr ? "Best Q rounds (Final required)" : "Best Q rounds";
}

function fmtRuleTeams(s: TourGroupingSettings | null) {
  const y = Number.isFinite(Number(s?.default_team_best_m)) ? Number(s?.default_team_best_m) : 1;
  return `Best ${y} per hole, −1 per zero (all rounds)`;
}

export default function TourPage() {
  const params = useParams<{ id: string }>();
  const tourId = params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [coursesById, setCoursesById] = useState<Record<string, Course>>({});
  const [tourPlayers, setTourPlayers] = useState<TourPlayerRow[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [roundTeeTimeByRoundId, setRoundTeeTimeByRoundId] = useState<Record<string, string>>({});

  const [tourGroups, setTourGroups] = useState<TourGroupRow[]>([]);
  const [tourGroupMembers, setTourGroupMembers] = useState<TourGroupMemberRow[]>([]);
  const [eventSettings, setEventSettings] = useState<TourGroupingSettings | null>(null);

  // Rename tour UI state
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [nameMsg, setNameMsg] = useState<string>("");

  // NEW: Tour dates editing
  const [editingDates, setEditingDates] = useState(false);
  const [startDateDraft, setStartDateDraft] = useState<string>(""); // YYYY-MM-DD or ""
  const [endDateDraft, setEndDateDraft] = useState<string>(""); // YYYY-MM-DD or ""
  const [datesSaving, setDatesSaving] = useState(false);
  const [datesMsg, setDatesMsg] = useState<string>("");

  // Starting handicaps
  const [hcpDraftByPlayerId, setHcpDraftByPlayerId] = useState<Record<string, string>>({});
  const [hcpSaving, setHcpSaving] = useState(false);
  const [hcpMsg, setHcpMsg] = useState<string>("");

  async function loadAll() {
    setLoading(true);
    setError("");
    setNameMsg("");
    setDatesMsg("");
    setHcpMsg("");

    try {
      // Tour (include start/end dates)
      const { data: tourData, error: tourErr } = await supabase
        .from("tours")
        .select("id,name,start_date,end_date")
        .eq("id", tourId)
        .maybeSingle();

      if (tourErr) throw new Error(tourErr.message);
      if (!tourData) throw new Error("Tour not found (or you do not have access).");

      const t = tourData as Tour;
      setTour(t);
      setNameDraft(t.name ?? "");
      setStartDateDraft(t.start_date ?? "");
      setEndDateDraft(t.end_date ?? "");

      // Settings
      const { data: sData, error: sErr } = await supabase
        .from("tour_grouping_settings")
        .select(
          "tour_id, default_team_best_m, individual_mode, individual_best_n, individual_final_required, pair_mode, pair_best_q, pair_final_required"
        )
        .eq("tour_id", tourId)
        .maybeSingle();

      if (sErr) throw new Error(sErr.message);
      setEventSettings((sData ?? null) as TourGroupingSettings | null);

      // Rounds (need played_on)
      const { data: roundData, error: roundErr } = await supabase
        .from("rounds")
        .select("id,tour_id,course_id,name,round_no,created_at,played_on")
        .eq("tour_id", tourId)
        .order("created_at", { ascending: true });

      if (roundErr) throw new Error(roundErr.message);

      const roundList = (roundData ?? []) as Round[];
      setRounds(roundList);

      // Courses referenced by rounds
      const courseIds = Array.from(new Set(roundList.map((r) => r.course_id).filter(Boolean))) as string[];
      if (courseIds.length) {
        const { data: cData, error: cErr } = await supabase.from("courses").select("id,name,tour_id").in("id", courseIds);
        if (cErr) throw new Error(cErr.message);

        const map: Record<string, Course> = {};
        for (const c of cData ?? []) {
          const id = String((c as any).id);
          map[id] = { id, name: String((c as any).name), tour_id: (c as any).tour_id ?? null };
        }
        setCoursesById(map);
      } else {
        setCoursesById({});
      }

      // Tee times: earliest from round_groups
      const roundIds = roundList.map((r) => r.id);
      if (roundIds.length) {
        const { data: rgData, error: rgErr } = await supabase
          .from("round_groups")
          .select("id,round_id,tee_time")
          .in("round_id", roundIds);

        if (rgErr) throw new Error(rgErr.message);

        const earliest: Record<string, string> = {};
        for (const row of (rgData ?? []) as any[]) {
          const rid = String(row.round_id);
          const tt = row.tee_time ? String(row.tee_time) : "";
          if (!tt) continue;
          if (!earliest[rid] || tt < earliest[rid]) earliest[rid] = tt;
        }
        setRoundTeeTimeByRoundId(earliest);
      } else {
        setRoundTeeTimeByRoundId({});
      }

      // Tour players
      const { data: tpData, error: tpErr } = await supabase
        .from("tour_players")
        .select("tour_id,player_id,starting_handicap, players(id,name,start_handicap)")
        .eq("tour_id", tourId)
        .order("name", { ascending: true, foreignTable: "players" });

      if (tpErr) throw new Error(tpErr.message);

      const normalizedTP: TourPlayerRow[] = (tpData ?? []).map((row: any) => {
        const playerObj = normalizePlayerJoin(row.players);

        const starting_handicap =
          row.starting_handicap == null
            ? null
            : Number.isFinite(Number(row.starting_handicap))
            ? Number(row.starting_handicap)
            : null;

        return {
          tour_id: String(row.tour_id),
          player_id: String(row.player_id),
          starting_handicap,
          players: playerObj,
        };
      });

      setTourPlayers(normalizedTP);

      // init drafts (prefer tour override if present, else global)
      const draft: Record<string, string> = {};
      for (const r of normalizedTP) {
        const p = normalizePlayerJoin(r.players);
        if (!p) continue;

        const tourVal = r.starting_handicap;
        const globalVal = p.start_handicap;

        const effective =
          tourVal !== null && tourVal !== undefined
            ? tourVal
            : globalVal !== null && globalVal !== undefined
            ? globalVal
            : 0;

        draft[p.id] = String(effective);
      }
      setHcpDraftByPlayerId(draft);

      // Pairs/Teams groups (tour scope)
      const { data: gData, error: gErr } = await supabase
        .from("tour_groups")
        .select("id,tour_id,scope,type,name,round_id,created_at")
        .eq("tour_id", tourId)
        .eq("scope", "tour")
        .in("type", ["pair", "team"])
        .order("type", { ascending: true })
        .order("created_at", { ascending: true });

      if (gErr) throw new Error(gErr.message);

      const glist = (gData ?? []) as TourGroupRow[];
      setTourGroups(glist);

      const groupIds = glist.map((g) => g.id);
      if (!groupIds.length) {
        setTourGroupMembers([]);
        setLoading(false);
        return;
      }

      const { data: mData, error: mErr } = await supabase
        .from("tour_group_members")
        .select("group_id,player_id")
        .in("group_id", groupIds);

      if (mErr) throw new Error(mErr.message);

      setTourGroupMembers((mData ?? []) as TourGroupMemberRow[]);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  const playersInThisTour = useMemo(() => {
    return (tourPlayers ?? [])
      .map((r) => {
        const p = normalizePlayerJoin(r.players);
        if (!p) return null;

        const global = Number.isFinite(Number(p.start_handicap)) ? Number(p.start_handicap) : 0;
        const override = r.starting_handicap;
        const effective = override !== null && override !== undefined ? override : global;

        return {
          id: p.id,
          name: p.name,
          globalStart: global,
          overrideStart: override,
          effectiveStart: effective,
        };
      })
      .filter(Boolean) as Array<{
      id: string;
      name: string;
      globalStart: number;
      overrideStart: number | null;
      effectiveStart: number;
    }>;
  }, [tourPlayers]);

  const playerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of playersInThisTour) m.set(p.id, p.name);
    return m;
  }, [playersInThisTour]);

  const membersByGroup = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const row of tourGroupMembers) {
      if (!m.has(row.group_id)) m.set(row.group_id, []);
      m.get(row.group_id)!.push(row.player_id);
    }
    return m;
  }, [tourGroupMembers]);

  const tourPairs = useMemo(() => tourGroups.filter((g) => g.scope === "tour" && g.type === "pair"), [tourGroups]);
  const tourTeams = useMemo(() => tourGroups.filter((g) => g.scope === "tour" && g.type === "team"), [tourGroups]);

  function labelForGroup(g: TourGroupRow) {
    const fallback = `${g.type === "pair" ? "Pair" : "Team"} ${g.id.slice(0, 6)}`;
    const ids = membersByGroup.get(g.id) ?? [];

    const storedName = (g.name ?? "").trim();
    if (storedName) return storedName;

    if (g.type === "pair" && ids.length >= 2) {
      const a = playerNameById.get(ids[0]) ?? ids[0];
      const b = playerNameById.get(ids[1]) ?? ids[1];
      return `${a} / ${b}`;
    }

    return fallback;
  }

  function membersLabel(g: TourGroupRow) {
    const ids = membersByGroup.get(g.id) ?? [];
    if (!ids.length) return "—";
    return ids.map((pid) => playerNameById.get(pid) ?? pid).join(g.type === "pair" ? " / " : ", ");
  }

  // --- Tour date suggestion defaults ---
  const suggestedTourStartEnd = useMemo(() => {
    const played = rounds
      .map((r) => r.played_on)
      .filter(Boolean)
      .map((s) => String(s));

    if (!played.length) return { start: null as string | null, end: null as string | null };

    // ISO date strings compare lexicographically correctly
    played.sort();
    return { start: played[0] ?? null, end: played[played.length - 1] ?? null };
  }, [rounds]);

  const effectiveTourStart = (tour?.start_date ?? "").trim() || suggestedTourStartEnd.start;
  const effectiveTourEnd = (tour?.end_date ?? "").trim() || suggestedTourStartEnd.end;

  const tourDatesLabel = useMemo(() => {
    if (!effectiveTourStart && !effectiveTourEnd) return "TBD";
    if (effectiveTourStart && effectiveTourEnd) {
      if (effectiveTourStart === effectiveTourEnd) return fmtDate(effectiveTourStart);
      return `${fmtDate(effectiveTourStart)} – ${fmtDate(effectiveTourEnd)}`;
    }
    if (effectiveTourStart) return fmtDate(effectiveTourStart);
    return fmtDate(effectiveTourEnd);
  }, [effectiveTourStart, effectiveTourEnd]);

  async function saveTourName() {
    setNameMsg("");
    const next = nameDraft.trim();
    if (!next) {
      setNameMsg("Name cannot be blank.");
      return;
    }
    if (!tourId) return;

    setNameSaving(true);
    try {
      const { error: upErr } = await supabase.from("tours").update({ name: next }).eq("id", tourId);
      if (upErr) throw new Error(upErr.message);

      setTour((prev) => (prev ? { ...prev, name: next } : prev));
      setEditingName(false);
      setNameMsg("Saved ✓");
    } catch (e: any) {
      setNameMsg(e?.message ?? "Failed to save.");
    } finally {
      setNameSaving(false);
    }
  }

  function cancelEditName() {
    setEditingName(false);
    setNameMsg("");
    setNameDraft(tour?.name ?? "");
  }

  async function saveTourDates() {
    setDatesMsg("");
    if (!tourId) return;

    const s = startDateDraft.trim() || null;
    const e = endDateDraft.trim() || null;

    // If both set, ensure order
    if (s && e) {
      const sd = parseDateOnly(s);
      const ed = parseDateOnly(e);
      if (!sd || !ed) {
        setDatesMsg("Please enter valid dates.");
        return;
      }
      if (sd.getTime() > ed.getTime()) {
        setDatesMsg("Start date must be on/before end date.");
        return;
      }
    } else {
      // validate whichever exists
      if (s && !parseDateOnly(s)) {
        setDatesMsg("Start date is invalid.");
        return;
      }
      if (e && !parseDateOnly(e)) {
        setDatesMsg("End date is invalid.");
        return;
      }
    }

    setDatesSaving(true);
    try {
      const { error: upErr } = await supabase.from("tours").update({ start_date: s, end_date: e }).eq("id", tourId);
      if (upErr) throw new Error(upErr.message);

      setTour((prev) => (prev ? { ...prev, start_date: s, end_date: e } : prev));
      setEditingDates(false);
      setDatesMsg("Saved ✓");
    } catch (ex: any) {
      setDatesMsg(ex?.message ?? "Failed to save dates.");
    } finally {
      setDatesSaving(false);
    }
  }

  function cancelEditDates() {
    setEditingDates(false);
    setDatesMsg("");
    setStartDateDraft(tour?.start_date ?? "");
    setEndDateDraft(tour?.end_date ?? "");
  }

  async function saveStartingHandicaps() {
    setHcpMsg("");
    if (!tourId) return;

    setHcpSaving(true);
    try {
      // Store NULL when equals global, so default uses global
      const payload = playersInThisTour.map((p) => {
        const draftStr = hcpDraftByPlayerId[p.id] ?? "";
        const draft = clampIntOrNull(draftStr);

        if (draft === null) {
          return { tour_id: tourId, player_id: p.id, starting_handicap: null };
        }
        if (draft === p.globalStart) {
          return { tour_id: tourId, player_id: p.id, starting_handicap: null };
        }
        return { tour_id: tourId, player_id: p.id, starting_handicap: draft };
      });

      const { error: upErr } = await supabase.from("tour_players").upsert(payload, {
        onConflict: "tour_id,player_id",
      });
      if (upErr) throw new Error(upErr.message);

      setHcpMsg("Saved ✓");
      await loadAll();
    } catch (e: any) {
      setHcpMsg(e?.message ?? "Failed to save starting handicaps.");
    } finally {
      setHcpSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 16 }}>Loading tour…</div>;

  if (error)
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: "crimson", fontWeight: 700 }}>Error</div>
        <div style={{ marginTop: 8 }}>{error}</div>
      </div>
    );

  return (
    <div style={{ padding: 16 }}>
      {/* Title row + edit */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        {!editingName ? (
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>{tour?.name ?? "Tour"}</h1>

            {/* Tour dates summary + edit */}
            <div style={{ marginTop: 6, color: "#444", fontSize: 13, fontWeight: 700 }}>
              Dates: <span style={{ fontWeight: 800 }}>{tourDatesLabel}</span>
              {!tour?.start_date || !tour?.end_date ? (
                <span style={{ marginLeft: 8, fontWeight: 600, color: "#666" }}>
                  (default based on rounds)
                </span>
              ) : null}
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => {
                  setNameDraft(tour?.name ?? "");
                  setEditingName(true);
                  setNameMsg("");
                }}
                style={btnThin}
              >
                Edit name
              </button>

              <button
                type="button"
                onClick={() => {
                  setStartDateDraft(tour?.start_date ?? (suggestedTourStartEnd.start ?? ""));
                  setEndDateDraft(tour?.end_date ?? (suggestedTourStartEnd.end ?? ""));
                  setEditingDates(true);
                  setDatesMsg("");
                }}
                style={btnThin}
              >
                Edit dates
              </button>

              {(nameMsg || datesMsg) && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 12,
                    color: (nameMsg + datesMsg).startsWith("Saved") ? "#2e7d32" : "crimson",
                  }}
                >
                  {nameMsg || datesMsg}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div style={{ width: "min(520px, 100%)" }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Edit tour name</h1>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Tour name"
                style={inputWide}
                disabled={nameSaving}
              />
              <button type="button" onClick={() => void saveTourName()} disabled={nameSaving} style={btnPrimary(nameSaving)}>
                {nameSaving ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={cancelEditName} disabled={nameSaving} style={btnThin}>
                Cancel
              </button>
            </div>

            {nameMsg && (
              <div style={{ marginTop: 8, fontSize: 12, color: nameMsg.startsWith("Saved") ? "#2e7d32" : "crimson" }}>
                {nameMsg}
              </div>
            )}
          </div>
        )}

        {editingDates ? (
          <div style={{ width: "min(560px, 100%)" }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Edit tour dates</h2>
            <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
              Suggested default:{" "}
              <strong>
                {suggestedTourStartEnd.start ? fmtDate(suggestedTourStartEnd.start) : "TBD"}
              </strong>{" "}
              {" – "}
              <strong>
                {suggestedTourStartEnd.end ? fmtDate(suggestedTourStartEnd.end) : "TBD"}
              </strong>
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end" }}>
              <div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>Start date</div>
                <input
                  type="date"
                  value={startDateDraft}
                  onChange={(e) => setStartDateDraft(e.target.value)}
                  style={inputDate}
                  disabled={datesSaving}
                />
              </div>

              <div>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>End date</div>
                <input
                  type="date"
                  value={endDateDraft}
                  onChange={(e) => setEndDateDraft(e.target.value)}
                  style={inputDate}
                  disabled={datesSaving}
                />
              </div>

              <button type="button" onClick={() => void saveTourDates()} disabled={datesSaving} style={btnPrimary(datesSaving)}>
                {datesSaving ? "Saving…" : "Save dates"}
              </button>
              <button type="button" onClick={cancelEditDates} disabled={datesSaving} style={btnThin}>
                Cancel
              </button>
            </div>

            {datesMsg && (
              <div style={{ marginTop: 8, fontSize: 12, color: datesMsg.startsWith("Saved") ? "#2e7d32" : "crimson" }}>
                {datesMsg}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* Players */}
      <h2 style={{ marginTop: 24, fontSize: 18, fontWeight: 700 }}>Players</h2>

      <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ color: "#333" }}>
          Total: <strong>{playersInThisTour.length}</strong>
        </div>

        <Link href={`/tours/${tourId}/players`}>Manage players (this tour) →</Link>

        <button
          type="button"
          onClick={() => void saveStartingHandicaps()}
          disabled={hcpSaving || playersInThisTour.length === 0}
          style={btnThin}
        >
          {hcpSaving ? "Saving…" : "Save starting handicaps"}
        </button>

        {hcpMsg && <div style={{ fontSize: 12, color: hcpMsg.startsWith("Saved") ? "#2e7d32" : "crimson" }}>{hcpMsg}</div>}
      </div>

      {playersInThisTour.length === 0 ? (
        <div style={{ marginTop: 8, color: "#555" }}>No players yet.</div>
      ) : (
        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 760, width: "100%" }}>
            <thead>
              <tr>
                <th style={thLeft}>Player</th>
                <th style={thRight}>Global start</th>
                <th style={thRight}>Tour start (editable)</th>
                <th style={thRight}>Effective</th>
              </tr>
            </thead>
            <tbody>
              {playersInThisTour.map((p) => {
                const draft = hcpDraftByPlayerId[p.id] ?? String(p.effectiveStart);
                const draftNum = clampIntOrNull(draft);
                const effective = draftNum === null ? p.globalStart : draftNum;
                const isOverride = draftNum !== null && draftNum !== p.globalStart;

                return (
                  <tr key={p.id}>
                    <td style={tdLeft}>
                      <div style={{ fontWeight: 700 }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: "#666" }}>{isOverride ? "Using tour override" : "Using global"}</div>
                    </td>
                    <td style={tdRight}>{p.globalStart}</td>
                    <td style={tdRight}>
                      <input
                        value={draft}
                        onChange={(e) => setHcpDraftByPlayerId((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        placeholder={`${p.globalStart}`}
                        style={inputSmallRight}
                        disabled={hcpSaving}
                      />
                      <div style={{ fontSize: 11, color: "#777", marginTop: 4 }}>Blank = global</div>
                    </td>
                    <td style={tdRight}>{effective}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Events */}
      <h2 style={{ marginTop: 24, fontSize: 18, fontWeight: 700 }}>Events</h2>
      <div style={{ marginTop: 8, color: "#333" }}>
        <div>
          <strong>Individual</strong> — Stableford total &nbsp;·&nbsp; <span style={{ color: "#555" }}>{fmtRuleIndividual(eventSettings)}</span>
        </div>
        <div style={{ marginTop: 6 }}>
          <strong>Pairs</strong> — Better Ball Stableford &nbsp;·&nbsp; <span style={{ color: "#555" }}>{fmtRulePairs(eventSettings)}</span>
        </div>
        <div style={{ marginTop: 6 }}>
          <strong>Teams</strong> — {fmtRuleTeams(eventSettings)}
        </div>

        <div style={{ marginTop: 10 }}>
          <Link href={`/tours/${tourId}/events/manage`}>Manage events →</Link>
        </div>
      </div>

      {/* Pairs & Teams */}
      <h2 style={{ marginTop: 24, fontSize: 18, fontWeight: 700 }}>Pairs &amp; Teams</h2>
      <div style={{ marginTop: 8 }}>
        <div style={{ color: "#333" }}>
          Pairs: <strong>{tourPairs.length}</strong> &nbsp;|&nbsp; Teams: <strong>{tourTeams.length}</strong>
        </div>

        {tourPairs.length === 0 && tourTeams.length === 0 ? (
          <div style={{ marginTop: 6, color: "#555" }}>No pairs or teams yet.</div>
        ) : (
          <div style={{ marginTop: 10 }}>
            {tourPairs.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Pairs</div>
                <ul style={{ marginTop: 0 }}>
                  {tourPairs.map((g) => (
                    <li key={g.id}>
                      <strong>{labelForGroup(g)}</strong> <span style={{ color: "#666" }}>({membersLabel(g)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tourTeams.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Teams</div>
                <ul style={{ marginTop: 0 }}>
                  {tourTeams.map((g) => (
                    <li key={g.id}>
                      <strong>{labelForGroup(g)}</strong> <span style={{ color: "#666" }}>({membersLabel(g)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          <Link href={`/tours/${tourId}/groups`}>Manage pairs &amp; teams →</Link>
        </div>
      </div>

      {/* Rounds */}
      <h2 style={{ marginTop: 24, fontSize: 18, fontWeight: 700 }}>Rounds</h2>
      <div style={{ marginTop: 8, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ color: "#333" }}>
          Total: <strong>{rounds.length}</strong>
        </div>
        <Link href={`/tours/${tourId}/rounds`}>Manage rounds →</Link>
      </div>

      {rounds.length === 0 ? (
        <div style={{ marginTop: 8, color: "#555" }}>No rounds yet.</div>
      ) : (
        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 860, width: "100%" }}>
            <thead>
              <tr>
                <th style={thLeft}>Round</th>
                <th style={thLeft}>Course</th>
                <th style={thLeft}>Date</th>
                <th style={thLeft}>Tee time</th>
                <th style={thLeft}>Links</th>
              </tr>
            </thead>
            <tbody>
              {rounds.map((r, idx) => {
                const roundNo = r.round_no ?? idx + 1;
                const courseName = r.course_id ? coursesById[r.course_id]?.name : null;
                const dateLabel = fmtRoundPlayedOn(r.played_on); // <-- TBC if null
                const tee = roundTeeTimeByRoundId[r.id] ?? "—";

                return (
                  <tr key={r.id}>
                    <td style={tdLeft}>
                      <div style={{ fontWeight: 800 }}>Round {roundNo}</div>
                      {r.name?.trim() ? <div style={{ fontSize: 12, color: "#666" }}>{r.name.trim()}</div> : null}
                    </td>
                    <td style={tdLeft}>{courseName ?? (r.course_id ?? "—")}</td>
                    <td style={tdLeft}>{dateLabel}</td>
                    <td style={tdLeft}>{tee}</td>
                    <td style={tdLeft}>
                      <Link href={`/rounds/${r.id}`}>Open</Link>
                      <span style={{ color: "#bbb" }}> · </span>
                      <Link href={`/rounds/${r.id}/groups`}>Groupings</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
            Date shows <strong>TBC</strong> unless <code>rounds.played_on</code> is set.
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
            Tee time shown is the earliest tee time from round groups (if any).
          </div>
        </div>
      )}
    </div>
  );
}

const btnThin: React.CSSProperties = {
  padding: "6px 10px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "white",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
};

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #111",
    background: disabled ? "#f5f5f5" : "#111",
    color: disabled ? "#111" : "white",
    cursor: disabled ? "default" : "pointer",
    fontSize: 14,
    fontWeight: 800,
  };
}

const inputWide: React.CSSProperties = {
  flex: "1 1 280px",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #ccc",
  fontSize: 14,
};

const inputDate: React.CSSProperties = {
  padding: "9px 10px",
  borderRadius: 10,
  border: "1px solid #ccc",
  fontSize: 14,
};

const inputSmallRight: React.CSSProperties = {
  width: 90,
  padding: "6px 8px",
  borderRadius: 10,
  border: "1px solid #ccc",
  textAlign: "right",
};

const thLeft: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #ddd",
  whiteSpace: "nowrap",
};

const thRight: React.CSSProperties = {
  textAlign: "right",
  padding: "10px 8px",
  borderBottom: "1px solid #ddd",
  whiteSpace: "nowrap",
};

const tdLeft: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #eee",
  verticalAlign: "top",
};

const tdRight: React.CSSProperties = {
  textAlign: "right",
  padding: "10px 8px",
  borderBottom: "1px solid #eee",
  verticalAlign: "top",
};
