"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RoundRow = {
  id: string;
  round_no: number | null;
  round_date?: string | null; // may not exist
  played_on?: string | null; // may not exist
  created_at: string | null;
  courses?: { name: string } | { name: string }[] | null;
};

type TeeTimeGroupRow = {
  id: string;
  round_id: string;
  group_no: number;
  notes: string | null;
};

type TourGroupRow = {
  id: string;
  name: string | null;
  scope?: string | null;
  type?: string | null;
};

type MatchFormat = "INDIVIDUAL_MATCHPLAY" | "BETTERBALL_MATCHPLAY" | "INDIVIDUAL_STABLEFORD";

type SettingsRow = {
  id: string;
  tour_id: string;
  round_id: string;
  group_a_id: string;
  group_b_id: string;
  format: MatchFormat;
  double_points: boolean;
  created_at: string;
  updated_at: string;
};

type PlayerRow = { id: string; name: string };

type MatchRow = {
  id: string;
  match_no: number;
  match_round_match_players?: Array<{ side: "A" | "B"; slot: number; player_id: string }>;
};

type MatchSetupRow = {
  match_no: number; // 1..N
  A1: string;
  A2: string;
  B1: string;
  B2: string;
};

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isMissingColumnError(msg: string, column: string) {
  const m = String(msg ?? "").toLowerCase();
  const c = column.toLowerCase();
  return m.includes("does not exist") && (m.includes(`.${c}`) || m.includes(`"${c}"`) || m.includes(` ${c} `));
}

function safeText(v: any, fallback = "") {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function getCourseName(r: RoundRow | null) {
  if (!r) return "";
  const c: any = r.courses;
  if (!c) return "";
  if (Array.isArray(c)) return c?.[0]?.name ?? "";
  return c?.name ?? "";
}

function pickBestRoundDateISO(r: RoundRow | null): string | null {
  if (!r) return null;
  return (r as any).round_date ?? (r as any).played_on ?? r.created_at ?? null;
}

function parseDateForDisplay(s: string | null): Date | null {
  if (!s) return null;
  const raw = String(s).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const iso = isDateOnly ? `${raw}T00:00:00.000Z` : raw;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtAuMelbourneDate(d: Date | null): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}`.replace(/\s+/g, " ");
}

function formatLabel(f: MatchFormat) {
  if (f === "INDIVIDUAL_MATCHPLAY") return "Individual matchplay";
  if (f === "BETTERBALL_MATCHPLAY") return "Better ball matchplay";
  return "Individual stableford";
}

function normalizePlayerJoin(val: any): PlayerRow | null {
  if (!val) return null;
  const p = Array.isArray(val) ? val[0] : val;
  if (!p?.id) return null;
  return { id: String(p.id), name: safeText(p.name, "(unnamed)") };
}

function makeEmptyMatchSetup(count: number): MatchSetupRow[] {
  const n = Math.max(0, Math.floor(count));
  return Array.from({ length: n }, (_, i) => ({
    match_no: i + 1,
    A1: "",
    A2: "",
    B1: "",
    B2: "",
  }));
}

const OVERRIDE_NOTES = "Manual: Matches order override";

export default function MatchesFormatRoundDetailPage() {
  const params = useParams<{ id?: string; roundId?: string }>();
  const tourId = String(params?.id ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  const [errorMsg, setErrorMsg] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  const [round, setRound] = useState<RoundRow | null>(null);

  // Tour fixed teams (must be exactly 2)
  const [teamGroups, setTeamGroups] = useState<TourGroupRow[]>([]);
  const [teamsWarn, setTeamsWarn] = useState("");

  // team members (derived from fixed groups)
  const [teamALoading, setTeamALoading] = useState(false);
  const [teamBLoading, setTeamBLoading] = useState(false);
  const [teamA, setTeamA] = useState<PlayerRow[]>([]);
  const [teamB, setTeamB] = useState<PlayerRow[]>([]);

  // existing settings record for this round
  const [existing, setExisting] = useState<SettingsRow | null>(null);

  // settings form state
  const [format, setFormat] = useState<MatchFormat>("INDIVIDUAL_MATCHPLAY");
  const [doublePoints, setDoublePoints] = useState<boolean>(false);

  // match setup
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchSaving, setMatchSaving] = useState(false);
  const [matchMsg, setMatchMsg] = useState("");
  const [matchErr, setMatchErr] = useState("");
  const [matchSetup, setMatchSetup] = useState<MatchSetupRow[]>([]);
  const [loadedMatchCount, setLoadedMatchCount] = useState<number>(0);

  // tee-time override toggle
  const [teeOverrideLoading, setTeeOverrideLoading] = useState(false);
  const [teeOverrideSaving, setTeeOverrideSaving] = useState(false);
  const [teeOverrideErr, setTeeOverrideErr] = useState("");
  const [teeOverrideMsg, setTeeOverrideMsg] = useState("");
  const [teeOverrideEnabled, setTeeOverrideEnabled] = useState(false);

  const teamAGroup = teamGroups[0] ?? null;
  const teamBGroup = teamGroups[1] ?? null;

  const teamsReady = useMemo(() => {
    return isLikelyUuid(teamAGroup?.id ?? "") && isLikelyUuid(teamBGroup?.id ?? "");
  }, [teamAGroup?.id, teamBGroup?.id]);

  const settingsDirty = useMemo(() => {
    if (!teamsReady) return false;
    if (!existing) return true; // format + double points need saving before match setup can exist
    const aId = teamAGroup?.id ?? "";
    const bId = teamBGroup?.id ?? "";
    return (
      existing.format !== format ||
      (existing.double_points === true) !== (doublePoints === true) ||
      existing.group_a_id !== aId ||
      existing.group_b_id !== bId
    );
  }, [existing, format, doublePoints, teamsReady, teamAGroup?.id, teamBGroup?.id]);

  const roundTitle = useMemo(() => {
    const rn = round?.round_no;
    const label = rn !=null ? `Round ${rn}` : "Round";
    const d = fmtAuMelbourneDate(parseDateForDisplay(pickBestRoundDateISO(round)));
    const course = getCourseName(round);
    const bits = [label, d || "", course || ""].filter(Boolean);
    return bits.join(" · ");
  }, [round]);

  // Compute required number of matches based on format + team sizes
  const matchCount = useMemo(() => {
    const a = teamA.length;
    const b = teamB.length;
    const min = Math.min(a, b);

    const fmt = existing?.format ?? format;
    if (!teamsReady) return 0;
    if (fmt === "INDIVIDUAL_STABLEFORD") return 0;
    if (fmt === "INDIVIDUAL_MATCHPLAY") return Math.max(0, min);
    // BETTERBALL
    return Math.max(0, Math.floor(min / 2));
  }, [existing?.format, format, teamA.length, teamB.length, teamsReady]);

  const matchSetupEnabled = useMemo(() => {
    if (!teamsReady) return false;
    if (!existing) return false;
    if (settingsDirty) return false;
    if (existing.format === "INDIVIDUAL_STABLEFORD") return false;
    return isLikelyUuid(existing.id);
  }, [existing, settingsDirty, teamsReady]);

  useEffect(() => {
    if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId)) return;

    let alive = true;

    async function fetchRound(selectCols: string) {
      return supabase.from("rounds").select(selectCols).eq("id", roundId).single();
    }

    async function load() {
      setLoading(true);
      setErrorMsg("");
      setSaveMsg("");
      setMatchMsg("");
      setMatchErr("");
      setTeamsWarn("");
      setTeeOverrideErr("");
      setTeeOverrideMsg("");
      setTeeOverrideEnabled(false);

      try {
        // 1) Round meta with column-fallback (round_date may not exist)
        const baseCols = "id,round_no,created_at,courses(name)";
        const cols1 = `${baseCols},round_date,played_on`;
        const cols2 = `${baseCols},played_on`;

        let rRow: any = null;

        const r1 = await fetchRound(cols1);
        if (r1.error) {
          if (isMissingColumnError(r1.error.message, "round_date")) {
            const r2 = await fetchRound(cols2);
            if (r2.error) {
              if (isMissingColumnError(r2.error.message, "played_on")) {
                const r3 = await fetchRound(baseCols);
                if (r3.error) throw r3.error;
                rRow = r3.data;
              } else {
                throw r2.error;
              }
            } else {
              rRow = r2.data;
            }
          } else {
            throw r1.error;
          }
        } else {
          rRow = r1.data;
        }

        // 2) Load TOUR TEAMS (must be exactly 2).
        // We filter to scope="tour" and type="team" (same schema used elsewhere).
        const { data: gRows, error: gErr } = await supabase
          .from("tour_groups")
          .select("id,name,scope,type")
          .eq("tour_id", tourId)
          .eq("scope", "tour")
          .eq("type", "team")
          .order("name", { ascending: true });

        if (gErr) throw gErr;

        const teams = (gRows ?? []) as any as TourGroupRow[];

        // 3) Existing settings (one per round)
        const { data: sRow, error: sErr } = await supabase
          .from("match_round_settings")
          .select("id,tour_id,round_id,group_a_id,group_b_id,format,double_points,created_at,updated_at")
          .eq("round_id", roundId)
          .maybeSingle();
        if (sErr) throw sErr;

        // 4) Detect tee override based on existing round_groups notes
        const { data: rg, error: rgErr } = await supabase
          .from("round_groups")
          .select("id,round_id,group_no,notes")
          .eq("round_id", roundId)
          .order("group_no", { ascending: true });

        if (rgErr) throw rgErr;

        const overrideOn = (rg ?? []).some((x: any) => String(x?.notes ?? "") === OVERRIDE_NOTES);

        if (!alive) return;

        setRound(rRow as any);
        setTeamGroups(teams);

        if (teams.length !== 2) {
          setTeamsWarn(
            `Matches require exactly 2 tour teams (tour_groups where scope='tour' and type='team'). Found ${teams.length}.`
          );
        } else {
          setTeamsWarn("");
        }

        const ex = (sRow ?? null) as any as SettingsRow | null;
        setExisting(ex);

        if (ex) {
          setFormat(ex.format);
          setDoublePoints(ex.double_points === true);
        } else {
          setDoublePoints(false);
          setFormat("INDIVIDUAL_MATCHPLAY");
        }

        setTeeOverrideEnabled(overrideOn);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load match format setup.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [tourId, roundId]);

  // Load team members whenever the fixed 2 teams are available
  useEffect(() => {
    if (!isLikelyUuid(tourId)) return;
    if (!teamsReady) {
      setTeamA([]);
      setTeamB([]);
      return;
    }

    const aId = teamAGroup?.id ?? "";
    const bId = teamBGroup?.id ?? "";
    if (!isLikelyUuid(aId) || !isLikelyUuid(bId)) return;

    let alive = true;

    async function loadTeam(groupId: string, which: "A" | "B") {
      if (which === "A") {
        setTeamALoading(true);
        setTeamA([]);
      } else {
        setTeamBLoading(true);
        setTeamB([]);
      }

      try {
        const { data, error } = await supabase
          .from("tour_group_members")
          .select("player_id,position,players(id,name)")
          .eq("group_id", groupId)
          .order("position", { ascending: true, nullsFirst: true });

        if (error) throw error;

        const players: PlayerRow[] = (data ?? [])
          .map((r: any) => normalizePlayerJoin(r.players))
          .filter(Boolean) as any;

        if (!alive) return;

        if (which === "A") setTeamA(players);
        else setTeamB(players);
      } catch {
        if (!alive) return;
        if (which === "A") setTeamA([]);
        else setTeamB([]);
      } finally {
        if (!alive) return;
        if (which === "A") setTeamALoading(false);
        else setTeamBLoading(false);
      }
    }

    void loadTeam(aId, "A");
    void loadTeam(bId, "B");

    return () => {
      alive = false;
    };
  }, [tourId, teamsReady, teamAGroup?.id, teamBGroup?.id]);

  // Load matches setup when settings are saved + valid
  useEffect(() => {
    if (!existing) {
      setMatchSetup([]);
      setLoadedMatchCount(0);
      return;
    }
    if (!matchSetupEnabled) {
      setMatchMsg("");
      setMatchErr("");
      return;
    }

    const settingsId = existing.id;
    if (!isLikelyUuid(settingsId)) return;

    let alive = true;

    async function loadMatches() {
      setMatchLoading(true);
      setMatchMsg("");
      setMatchErr("");

      try {
        const { data, error } = await supabase
          .from("match_round_matches")
          .select("id,match_no,match_round_match_players(side,slot,player_id)")
          .eq("settings_id", settingsId)
          .order("match_no", { ascending: true });

        if (error) throw error;

        const rows = (data ?? []) as any as MatchRow[];
        const maxNo = rows.reduce((m, r) => Math.max(m, Number(r.match_no) || 0), 0);

        const size = Math.max(matchCount, maxNo);
        const next = makeEmptyMatchSetup(size);

        for (const mr of rows) {
          const mn = Number(mr.match_no);
          if (!(mn >= 1 && mn <= size)) continue;

          const ms = next[mn - 1];
          const assigns = (mr.match_round_match_players ?? []) as any[];

          for (const a of assigns) {
            const side = String(a.side ?? "").toUpperCase();
            const slot = Number(a.slot);
            const pid = String(a.player_id ?? "");

            if (!pid) continue;
            if (side === "A" && slot === 1) ms.A1 = pid;
            if (side === "A" && slot === 2) ms.A2 = pid;
            if (side === "B" && slot === 1) ms.B1 = pid;
            if (side === "B" && slot === 2) ms.B2 = pid;
          }
        }

        if (!alive) return;
        setMatchSetup(next);
        setLoadedMatchCount(size);
      } catch (e: any) {
        if (!alive) return;
        setMatchErr(e?.message ?? "Failed to load matches for this round.");
        setMatchSetup([]);
        setLoadedMatchCount(0);
      } finally {
        if (alive) setMatchLoading(false);
      }
    }

    void loadMatches();

    return () => {
      alive = false;
    };
  }, [existing, matchSetupEnabled, matchCount]);

  const canSaveSettings = useMemo(() => {
    if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId)) return false;
    if (!teamsReady) return false;
    if (teamsWarn) return false;
    return settingsDirty && !savingSettings;
  }, [tourId, roundId, teamsReady, teamsWarn, settingsDirty, savingSettings]);

  async function saveSettings() {
    if (!teamsReady) return;

    setSavingSettings(true);
    setErrorMsg("");
    setSaveMsg("");
    setMatchMsg("");
    setMatchErr("");

    try {
      const aId = teamAGroup?.id ?? "";
      const bId = teamBGroup?.id ?? "";

      if (!isLikelyUuid(aId) || !isLikelyUuid(bId) || aId === bId) {
        throw new Error("Tour teams are not configured correctly (need 2 distinct team groups).");
      }

      const payload = {
        tour_id: tourId,
        round_id: roundId,
        group_a_id: aId,
        group_b_id: bId,
        format,
        double_points: doublePoints === true,
      };

      const { data, error } = await supabase
        .from("match_round_settings")
        .upsert(payload, { onConflict: "round_id" })
        .select("id,tour_id,round_id,group_a_id,group_b_id,format,double_points,created_at,updated_at")
        .single();

      if (error) throw error;

      const saved = data as any as SettingsRow;
      setExisting(saved);
      setSaveMsg(`Saved: ${formatLabel(saved.format)}${saved.double_points ? " (double points)" : ""}.`);

      if (saved.format === "INDIVIDUAL_STABLEFORD") {
        setMatchSetup([]);
        setLoadedMatchCount(0);
      }
    } catch (e: any) {
      const msg = String(e?.message ?? "Save failed.");
      if (msg.toLowerCase().includes("match_round_settings_format_check")) {
        setErrorMsg("Invalid format value (does not match database constraint).");
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setSavingSettings(false);
    }
  }

  function setMatchCell(matchNo: number, key: keyof Omit<MatchSetupRow, "match_no">, value: string) {
    setMatchSetup((prev) =>
      prev.map((m) => {
        if (m.match_no !== matchNo) return m;
        return { ...m, [key]: value };
      })
    );
  }

  const matchSetupDirty = useMemo(() => {
    if (!matchSetupEnabled) return false;
    if (existing?.format === "INDIVIDUAL_STABLEFORD") return false;

    const hasAny =
      matchSetup.some((m) => m.A1 || m.B1 || m.A2 || m.B2) || (matchCount > 0 && loadedMatchCount !== matchCount);

    return hasAny;
  }, [matchSetupEnabled, matchSetup, loadedMatchCount, matchCount, existing?.format]);

  const matchSetupSaveEnabled = useMemo(() => {
    if (!matchSetupEnabled) return false;
    if (matchSaving || matchLoading) return false;
    if (!existing) return false;
    if (existing.format === "INDIVIDUAL_STABLEFORD") return false;
    if (teamA.length === 0 || teamB.length === 0) return false;
    if (matchCount <= 0) return false;

    if (existing.format === "INDIVIDUAL_MATCHPLAY") {
      for (let i = 0; i < matchCount; i++) {
        const m = matchSetup[i];
        if (!m) return false;
        if (!isLikelyUuid(m.A1) || !isLikelyUuid(m.B1)) return false;
      }
    }

    if (existing.format === "BETTERBALL_MATCHPLAY") {
      for (let i = 0; i < matchCount; i++) {
        const m = matchSetup[i];
        if (!m) return false;
        if (!isLikelyUuid(m.A1) || !isLikelyUuid(m.A2) || !isLikelyUuid(m.B1) || !isLikelyUuid(m.B2)) return false;
        if (m.A1 === m.A2) return false;
        if (m.B1 === m.B2) return false;
      }
    }

    return true;
  }, [matchSetupEnabled, matchSaving, matchLoading, existing, teamA.length, teamB.length, matchCount, matchSetup]);

  async function saveMatchSetup() {
    if (!existing) return;

    setMatchSaving(true);
    setMatchMsg("");
    setMatchErr("");
    setTeeOverrideErr("");
    setTeeOverrideMsg("");

    try {
      const fmt = existing.format;
      const count = matchCount;

      if (fmt === "INDIVIDUAL_STABLEFORD") {
        setMatchMsg("No player setup needed for Individual stableford.");
        setMatchSaving(false);
        return;
      }

      const { data: oldMatches, error: oldErr } = await supabase
        .from("match_round_matches")
        .select("id")
        .eq("settings_id", existing.id);
      if (oldErr) throw oldErr;

      const oldIds = (oldMatches ?? []).map((r: any) => String(r.id)).filter(Boolean);

      if (oldIds.length > 0) {
        const { error: delPlayersErr } = await supabase.from("match_round_match_players").delete().in("match_id", oldIds);
        if (delPlayersErr) throw delPlayersErr;

        const { error: delMatchesErr } = await supabase.from("match_round_matches").delete().in("id", oldIds);
        if (delMatchesErr) throw delMatchesErr;
      }

      const toInsertMatches = Array.from({ length: count }, (_, i) => ({
        settings_id: existing.id,
        match_no: i + 1,
      }));

      const { data: newMatches, error: insMErr } = await supabase
        .from("match_round_matches")
        .insert(toInsertMatches)
        .select("id,match_no");
      if (insMErr) throw insMErr;

      const idByNo = new Map<number, string>();
      (newMatches ?? []).forEach((r: any) => idByNo.set(Number(r.match_no), String(r.id)));

      const playersToInsert: Array<{ match_id: string; side: "A" | "B"; slot: number; player_id: string }> = [];

      for (let i = 0; i < count; i++) {
        const m = matchSetup[i];
        const matchId = idByNo.get(i + 1);
        if (!m || !matchId) continue;

        playersToInsert.push({ match_id: matchId, side: "A", slot: 1, player_id: m.A1 });
        playersToInsert.push({ match_id: matchId, side: "B", slot: 1, player_id: m.B1 });

        if (fmt === "BETTERBALL_MATCHPLAY") {
          playersToInsert.push({ match_id: matchId, side: "A", slot: 2, player_id: m.A2 });
          playersToInsert.push({ match_id: matchId, side: "B", slot: 2, player_id: m.B2 });
        }
      }

      const { error: insPErr } = await supabase.from("match_round_match_players").insert(playersToInsert);
      if (insPErr) throw insPErr;

      setMatchMsg(`Saved ${count} match${count === 1 ? "" : "es"} setup.`);
      setLoadedMatchCount(count);
    } catch (e: any) {
      setMatchErr(e?.message ?? "Failed to save match setup.");
    } finally {
      setMatchSaving(false);
    }
  }

  async function fetchOverrideGroupsForRound(): Promise<TeeTimeGroupRow[]> {
    const { data, error } = await supabase
      .from("round_groups")
      .select("id,round_id,group_no,notes")
      .eq("round_id", roundId)
      .order("group_no", { ascending: true });

    if (error) throw error;

    return ((data ?? []) as any[]).map((x) => ({
      id: String((x as any).id),
      round_id: String((x as any).round_id),
      group_no: Number((x as any).group_no),
      notes: (x as any).notes == null ? null : String((x as any).notes),
    }));
  }

  async function clearAllRoundGroups(rid: string) {
    const delM = await supabase.from("round_group_players").delete().eq("round_id", rid);
    if (delM.error) throw delM.error;

    const delG = await supabase.from("round_groups").delete().eq("round_id", rid);
    if (delG.error) throw delG.error;
  }

  async function buildAndPersistMatchOrderTeeTimes() {
    if (!existing) throw new Error("Save settings first.");
    if (!matchSetupEnabled) throw new Error("Match setup not enabled yet.");
    if (existing.format === "INDIVIDUAL_STABLEFORD") throw new Error("Tee-time override not applicable for Stableford.");
    if (matchCount <= 0) throw new Error("No matches available to build tee-time order.");

    // Pull matches and assignments from DB (source of truth)
    const { data, error } = await supabase
      .from("match_round_matches")
      .select("id,match_no,match_round_match_players(side,slot,player_id)")
      .eq("settings_id", existing.id)
      .order("match_no", { ascending: true });

    if (error) throw error;

    const rows = (data ?? []) as any as MatchRow[];
    const byNo = new Map<number, MatchRow>();
    for (const r of rows) byNo.set(Number(r.match_no), r);

    // Validate: require matches 1..matchCount present and assigned
    const orderedMatchPlayers: Array<{ matchNo: number; playerIds: string[] }> = [];

    for (let i = 1; i <= matchCount; i++) {
      const mr = byNo.get(i);
      if (!mr) throw new Error(`Missing match ${i} in database. Save match setup again.`);
      const assigns = (mr.match_round_match_players ?? []) as any[];
      const getPid = (side: "A" | "B", slot: number) => {
        const a = assigns.find((x) => String(x.side).toUpperCase() === side && Number(x.slot) === slot);
        return a ? String(a.player_id ?? "") : "";
      };

      if (existing.format === "INDIVIDUAL_MATCHPLAY") {
        const a1 = getPid("A", 1);
        const b1 = getPid("B", 1);
        if (!isLikelyUuid(a1) || !isLikelyUuid(b1)) throw new Error(`Match ${i} is incomplete. Save match setup again.`);
        orderedMatchPlayers.push({ matchNo: i, playerIds: [a1, b1] });
      } else {
        const a1 = getPid("A", 1);
        const a2 = getPid("A", 2);
        const b1 = getPid("B", 1);
        const b2 = getPid("B", 2);
        if (!isLikelyUuid(a1) || !isLikelyUuid(a2) || !isLikelyUuid(b1) || !isLikelyUuid(b2)) {
          throw new Error(`Match ${i} is incomplete. Save match setup again.`);
        }
        orderedMatchPlayers.push({ matchNo: i, playerIds: [a1, a2, b1, b2] });
      }
    }

    // Build groups in required order
    const groupsOut: string[][] = [];
    if (existing.format === "INDIVIDUAL_MATCHPLAY") {
      // Group = two matches (up to 4 players total)
      for (let i = 0; i < orderedMatchPlayers.length; i += 2) {
        const m1 = orderedMatchPlayers[i];
        const m2 = orderedMatchPlayers[i + 1];
        const ids = [...(m1?.playerIds ?? []), ...(m2?.playerIds ?? [])].filter(Boolean);
        groupsOut.push(ids);
      }
    } else {
      // BETTERBALL: group = one match
      for (const m of orderedMatchPlayers) groupsOut.push(m.playerIds);
    }

    // Replace any existing groupings for the round (idempotent)
    await clearAllRoundGroups(roundId);

    const groupRows = groupsOut.map((_, i) => ({
      round_id: roundId,
      group_no: i + 1,
      start_hole: 1,
      tee_time: null,
      notes: OVERRIDE_NOTES,
    }));

    const { data: insertedGroups, error: insGErr } = await supabase.from("round_groups").insert(groupRows).select("id,group_no");
    if (insGErr) throw insGErr;

    const idByNo = new Map<number, string>();
    for (const g of insertedGroups ?? []) idByNo.set(Number((g as any).group_no), String((g as any).id));

    const memberRows: Array<{ round_id: string; group_id: string; player_id: string; seat: number }> = [];
    groupsOut.forEach((grp, i) => {
      const groupId = idByNo.get(i + 1);
      if (!groupId) return;
      grp.forEach((pid, seatIdx) => {
        memberRows.push({
          round_id: roundId,
          group_id: groupId,
          player_id: pid,
          seat: seatIdx + 1,
        });
      });
    });

    const { error: insMErr } = await supabase.from("round_group_players").insert(memberRows);
    if (insMErr) throw insMErr;
  }

  async function onToggleTeeOverride(nextOn: boolean) {
    setTeeOverrideSaving(true);
    setTeeOverrideErr("");
    setTeeOverrideMsg("");

    try {
      if (nextOn) {
        await buildAndPersistMatchOrderTeeTimes();
        setTeeOverrideEnabled(true);
        setTeeOverrideMsg("Saved: tee-time groups overridden by match order.");
      } else {
        // Only clear if current groups look like OUR override groups
        const current = await fetchOverrideGroupsForRound();
        const isOverride = current.length > 0 && current.every((g) => String(g.notes ?? "") === OVERRIDE_NOTES);

        if (isOverride) {
          await clearAllRoundGroups(roundId);
          setTeeOverrideMsg("Removed: match-order tee-time override groups cleared.");
        } else {
          setTeeOverrideMsg("Override turned off (no override groups were cleared).");
        }

        setTeeOverrideEnabled(false);
      }
    } catch (e: any) {
      setTeeOverrideErr(e?.message ?? "Failed to update tee-time override.");
    } finally {
      setTeeOverrideSaving(false);
    }
  }

  // lightweight re-check when page loads (or after save actions you do manually)
  useEffect(() => {
    if (!isLikelyUuid(roundId)) return;
    let alive = true;

    async function checkOverride() {
      setTeeOverrideLoading(true);
      setTeeOverrideErr("");
      try {
        const rows = await fetchOverrideGroupsForRound();
        const overrideOn = rows.some((x) => String(x.notes ?? "") === OVERRIDE_NOTES);
        if (!alive) return;
        setTeeOverrideEnabled(overrideOn);
      } catch (e: any) {
        if (!alive) return;
        setTeeOverrideErr(e?.message ?? "Failed to check tee-time override state.");
      } finally {
        if (alive) setTeeOverrideLoading(false);
      }
    }

    void checkOverride();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900 pb-10">
        <div className="mx-auto w-full max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">Missing or invalid tour/round id in route.</div>
          <div className="mt-4">
            <Link className="underline text-sm" href={`/m/tours/${safeText(tourId)}/matches/format`}>
              Back
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const pillBase = "flex-1 h-10 rounded-xl border text-sm font-semibold flex items-center justify-center";
  const pillActive = "border-gray-900 bg-gray-900 text-white";
  const pillIdle = "border-gray-200 bg-white text-gray-900";

  // kept (logic), even though UI section is removed
  const teamsSummary = useMemo(() => {
    if (!teamsReady) return "";
    const aName = safeText(teamAGroup?.name, "Team A");
    const bName = safeText(teamBGroup?.name, "Team B");
    return `${aName} vs ${bName}`;
  }, [teamsReady, teamAGroup?.name, teamBGroup?.name]);

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-10">
      {/* Tee-times style header (3-band) */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur">
        {/* Band 1: tour name + home */}
        <div className="border-b border-slate-200">
          <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">Tour</div>
            </div>

            <Link
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm active:bg-slate-50"
              href={`/m/tours/${tourId}`}
            >
              Home
            </Link>
          </div>
        </div>

        {/* Band 2: page title + back */}
        <div className="border-b border-slate-200">
          <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-base font-semibold text-slate-900">Matches – Format</div>
            </div>

            <Link
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm active:bg-slate-50"
              href={`/m/tours/${tourId}/matches/format`}
            >
              Back
            </Link>
          </div>
        </div>

        {/* Band 3: round meta */}
        <div className="border-b border-slate-200 bg-slate-50">
          <div className="mx-auto w-full max-w-md px-4 py-2">
            <div className="truncate text-sm font-semibold text-slate-800">{roundTitle || "Configure this round"}</div>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4 space-y-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-24 rounded-2xl border bg-white" />
            <div className="h-24 rounded-2xl border bg-white" />
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorMsg}</div>
        ) : (
          <>
            {/* Format */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Format</div>
                <div className="mt-1 text-xs text-gray-600">Choose the scoring format for this round.</div>
              </div>

              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`${pillBase} ${format === "INDIVIDUAL_MATCHPLAY" ? pillActive : pillIdle}`}
                    onClick={() => {
                      setSaveMsg("");
                      setErrorMsg("");
                      setMatchMsg("");
                      setMatchErr("");
                      setTeeOverrideErr("");
                      setTeeOverrideMsg("");
                      setFormat("INDIVIDUAL_MATCHPLAY");
                    }}
                    aria-pressed={format === "INDIVIDUAL_MATCHPLAY"}
                  >
                    Ind Matchplay
                  </button>

                  <button
                    type="button"
                    className={`${pillBase} ${format === "BETTERBALL_MATCHPLAY" ? pillActive : pillIdle}`}
                    onClick={() => {
                      setSaveMsg("");
                      setErrorMsg("");
                      setMatchMsg("");
                      setMatchErr("");
                      setTeeOverrideErr("");
                      setTeeOverrideMsg("");
                      setFormat("BETTERBALL_MATCHPLAY");
                    }}
                    aria-pressed={format === "BETTERBALL_MATCHPLAY"}
                  >
                    Better Ball
                  </button>

                  <button
                    type="button"
                    className={`${pillBase} ${format === "INDIVIDUAL_STABLEFORD" ? pillActive : pillIdle}`}
                    onClick={() => {
                      setSaveMsg("");
                      setErrorMsg("");
                      setMatchMsg("");
                      setMatchErr("");
                      setTeeOverrideErr("");
                      setTeeOverrideMsg("");
                      setFormat("INDIVIDUAL_STABLEFORD");
                    }}
                    aria-pressed={format === "INDIVIDUAL_STABLEFORD"}
                  >
                    Stableford
                  </button>
                </div>

                <div className="text-xs text-gray-600">
                  Selected: <span className="font-semibold text-gray-900">{formatLabel(format)}</span>
                </div>

                {/* Double points */}
                <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">Double points</div>
                    <div className="text-xs text-gray-600">If enabled, match points for this round are doubled.</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSaveMsg("");
                      setErrorMsg("");
                      setMatchMsg("");
                      setMatchErr("");
                      setTeeOverrideErr("");
                      setTeeOverrideMsg("");
                      setDoublePoints((v) => !v);
                    }}
                    className={`h-9 w-20 rounded-xl border text-sm font-semibold shadow-sm ${
                      doublePoints ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-900"
                    }`}
                    aria-pressed={doublePoints}
                  >
                    {doublePoints ? "On" : "Off"}
                  </button>
                </div>
              </div>
            </section>

            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-gray-600">{settingsDirty ? "Change pending" : "No pending change"}</div>

              <button
                type="button"
                onClick={saveSettings}
                disabled={!canSaveSettings}
                className={`h-10 rounded-xl px-4 text-sm font-semibold border shadow-sm ${
                  !canSaveSettings
                    ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "border-gray-900 bg-gray-900 text-white active:bg-gray-800"
                }`}
              >
                {savingSettings ? "Saving…" : "Save settings"}
              </button>
            </div>

            {saveMsg ? <div className="text-sm text-green-700">{saveMsg}</div> : null}

            {/* Match setup */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Match setup</div>
                <div className="mt-1 text-xs text-gray-600">Assign players to matches for this round. (Saved settings required.)</div>
              </div>

              <div className="p-4 space-y-3">
                {!teamsReady || teamsWarn ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    Configure exactly two tour teams before enabling matches for this round.
                  </div>
                ) : !existing ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                    Save settings above to start match setup.
                  </div>
                ) : settingsDirty ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    You have unsaved settings changes. Save settings above before editing match setup.
                  </div>
                ) : existing.format === "INDIVIDUAL_STABLEFORD" ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                    Individual stableford does not require match player assignments.
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-gray-600">
                        Team A:{" "}
                        <span className="font-semibold text-gray-900">
                          {teamALoading ? "Loading…" : `${teamA.length} player${teamA.length === 1 ? "" : "s"}`}
                        </span>{" "}
                        · Team B:{" "}
                        <span className="font-semibold text-gray-900">
                          {teamBLoading ? "Loading…" : `${teamB.length} player${teamB.length === 1 ? "" : "s"}`}
                        </span>
                      </div>

                      <div className="text-xs text-gray-600">
                        Matches: <span className="font-semibold text-gray-900">{matchCount}</span>
                      </div>
                    </div>

                    {Math.min(teamA.length, teamB.length) === 0 ? (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        One of the teams has no players in <span className="font-semibold">tour_group_members</span>.
                      </div>
                    ) : matchCount === 0 ? (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                        Not enough players to create matches for this format.
                      </div>
                    ) : matchLoading ? (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                        Loading match setup…
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {teamA.length !== teamB.length ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                            Teams have different sizes. Match count uses the smaller team (min).
                          </div>
                        ) : null}

                        {Array.from({ length: matchCount }).map((_, idx) => {
                          const row = matchSetup[idx] ?? { match_no: idx + 1, A1: "", A2: "", B1: "", B2: "" };
                          const isBetterBall = existing.format === "BETTERBALL_MATCHPLAY";

                          return (
                            <div key={idx} className="rounded-2xl border border-gray-200 bg-white p-3">
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-semibold text-gray-900">Match {idx + 1}</div>
                                <div className="text-[11px] text-gray-500">
                                  {existing.format === "INDIVIDUAL_MATCHPLAY" ? "1 v 1" : "2 v 2"}
                                </div>
                              </div>

                              <div className="mt-3 grid grid-cols-2 gap-3">
                                <div>
                                  <div className="text-xs font-semibold text-gray-700 mb-1">Team A</div>
                                  <select
                                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-sm"
                                    value={row.A1}
                                    onChange={(e) => setMatchCell(idx + 1, "A1", e.target.value)}
                                  >
                                    <option value="">Select player…</option>
                                    {teamA.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name}
                                      </option>
                                    ))}
                                  </select>

                                  {isBetterBall ? (
                                    <select
                                      className="mt-2 h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-sm"
                                      value={row.A2}
                                      onChange={(e) => setMatchCell(idx + 1, "A2", e.target.value)}
                                    >
                                      <option value="">Select 2nd player…</option>
                                      {teamA.map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {p.name}
                                        </option>
                                      ))}
                                    </select>
                                  ) : null}

                                  {isBetterBall && row.A1 && row.A2 && row.A1 === row.A2 ? (
                                    <div className="mt-1 text-[11px] text-red-700">Players must be different.</div>
                                  ) : null}
                                </div>

                                <div>
                                  <div className="text-xs font-semibold text-gray-700 mb-1">Team B</div>
                                  <select
                                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-sm"
                                    value={row.B1}
                                    onChange={(e) => setMatchCell(idx + 1, "B1", e.target.value)}
                                  >
                                    <option value="">Select player…</option>
                                    {teamB.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.name}
                                      </option>
                                    ))}
                                  </select>

                                  {isBetterBall ? (
                                    <select
                                      className="mt-2 h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-sm"
                                      value={row.B2}
                                      onChange={(e) => setMatchCell(idx + 1, "B2", e.target.value)}
                                    >
                                      <option value="">Select 2nd player…</option>
                                      {teamB.map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {p.name}
                                        </option>
                                      ))}
                                    </select>
                                  ) : null}

                                  {isBetterBall && row.B1 && row.B2 && row.B1 === row.B2 ? (
                                    <div className="mt-1 text-[11px] text-red-700">Players must be different.</div>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-gray-600">{matchSetupDirty ? "Changes pending" : "No changes"}</div>

                      <button
                        type="button"
                        onClick={saveMatchSetup}
                        disabled={!matchSetupSaveEnabled}
                        className={`h-10 rounded-xl px-4 text-sm font-semibold border shadow-sm ${
                          !matchSetupSaveEnabled
                            ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                            : "border-gray-900 bg-gray-900 text-white active:bg-gray-800"
                        }`}
                      >
                        {matchSaving ? "Saving…" : "Save match setup"}
                      </button>
                    </div>

                    {matchErr ? (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{matchErr}</div>
                    ) : null}
                    {matchMsg ? <div className="text-sm text-green-700">{matchMsg}</div> : null}
                  </>
                )}
              </div>
            </section>

            {/* Tee-time override toggle */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Tee times override</div>
                <div className="mt-1 text-xs text-gray-600">When enabled, tee-time groups for this round are rewritten in match order.</div>
              </div>

              <div className="p-4 space-y-3">
                {teeOverrideLoading ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">Checking current override…</div>
                ) : null}

                {existing?.format === "INDIVIDUAL_STABLEFORD" ? (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">Not applicable for Individual stableford.</div>
                ) : (
                  <>
                    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-900">Override by match order</div>
                        <div className="text-xs text-gray-600">
                          {format === "INDIVIDUAL_MATCHPLAY" ? (
                            <>Group 1 = Match 1 + Match 2, Group 2 = Match 3 + Match 4, …</>
                          ) : (
                            <>Group 1 = Match 1, Group 2 = Match 2, …</>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => onToggleTeeOverride(!teeOverrideEnabled)}
                        disabled={
                          teeOverrideSaving ||
                          !existing ||
                          settingsDirty ||
                          !matchSetupEnabled ||
                          matchLoading ||
                          matchSaving ||
                          matchCount <= 0 ||
                          teamsWarn.length > 0
                        }
                        className={`h-9 w-20 rounded-xl border text-sm font-semibold shadow-sm ${
                          teeOverrideEnabled ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-900"
                        } ${teeOverrideSaving ? "opacity-60" : ""}`}
                        aria-pressed={teeOverrideEnabled}
                        title={
                          !existing
                            ? "Save settings first"
                            : settingsDirty
                            ? "Save settings first"
                            : !matchSetupEnabled
                            ? "Match setup must be saved"
                            : matchCount <= 0
                            ? "No matches available"
                            : teamsWarn
                            ? "Tour must have exactly two teams"
                            : ""
                        }
                      >
                        {teeOverrideSaving ? "…" : teeOverrideEnabled ? "On" : "Off"}
                      </button>
                    </div>

                    {teeOverrideErr ? (
                      <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{teeOverrideErr}</div>
                    ) : null}
                    {teeOverrideMsg ? <div className="text-sm text-green-700">{teeOverrideMsg}</div> : null}
                  </>
                )}
              </div>
            </section>

            {/* (kept for logic/debug only; not displayed) */}
            {teamsSummary ? null : null}
          </>
        )}
      </main>
    </div>
  );
}
