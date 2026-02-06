// app/m/tours/[id]/matches/format/[roundId]/page.tsx
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

type GroupRow = { id: string; name: string | null };

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

type GroupMemberRow = {
  player_id: string;
  position: number | null;
  players: PlayerRow | PlayerRow[] | null;
};

type MatchRow = {
  id: string;
  match_no: number;
  match_round_match_players?: Array<{ side: "A" | "B"; slot: number; player_id: string }>;
};

type MatchSetupRow = {
  match_no: number; // 1..N
  // for INDIVIDUAL: only A1/B1 used
  A1: string;
  A2: string; // used for BETTERBALL slot=2
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

function isPlayerJoin(val: any): PlayerRow | null {
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

export default function MatchesFormatRoundDetailPage() {
  const params = useParams<{ id?: string; roundId?: string }>();
  const tourId = String(params?.id ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  const [errorMsg, setErrorMsg] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  const [round, setRound] = useState<RoundRow | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [existing, setExisting] = useState<SettingsRow | null>(null);

  // settings form state
  const [format, setFormat] = useState<MatchFormat>("INDIVIDUAL_MATCHPLAY");
  const [groupAId, setGroupAId] = useState<string>("");
  const [groupBId, setGroupBId] = useState<string>("");
  const [doublePoints, setDoublePoints] = useState<boolean>(false);

  // team members (derived from selected groups)
  const [teamALoading, setTeamALoading] = useState(false);
  const [teamBLoading, setTeamBLoading] = useState(false);
  const [teamA, setTeamA] = useState<PlayerRow[]>([]);
  const [teamB, setTeamB] = useState<PlayerRow[]>([]);

  // match setup
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchSaving, setMatchSaving] = useState(false);
  const [matchMsg, setMatchMsg] = useState("");
  const [matchErr, setMatchErr] = useState("");
  const [matchSetup, setMatchSetup] = useState<MatchSetupRow[]>([]);
  const [loadedMatchCount, setLoadedMatchCount] = useState<number>(0);

  const settingsDirty = useMemo(() => {
    if (!existing) return Boolean(groupAId && groupBId);
    return (
      existing.format !== format ||
      existing.group_a_id !== groupAId ||
      existing.group_b_id !== groupBId ||
      (existing.double_points === true) !== (doublePoints === true)
    );
  }, [existing, format, groupAId, groupBId, doublePoints]);

  const roundTitle = useMemo(() => {
    const rn = round?.round_no;
    const label = rn != null ? `Round ${rn}` : "Round";
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

    if (!existing) return 0;
    if (existing.format === "INDIVIDUAL_STABLEFORD") return 0;
    if (existing.format === "INDIVIDUAL_MATCHPLAY") return Math.max(0, min);
    // BETTERBALL
    return Math.max(0, Math.floor(min / 2));
  }, [existing, teamA.length, teamB.length]);

  const matchSetupEnabled = useMemo(() => {
    // only allow match setup when settings exist and there are no pending changes (so we don’t mismatch round settings)
    if (!existing) return false;
    if (settingsDirty) return false;
    if (existing.format === "INDIVIDUAL_STABLEFORD") return false;
    return isLikelyUuid(existing.id);
  }, [existing, settingsDirty]);

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

        // 2) Tour groups (fixed for tour => round_id is null)
        const { data: gRows, error: gErr } = await supabase
          .from("tour_groups")
          .select("id,name")
          .eq("tour_id", tourId)
          .is("round_id", null)
          .order("name", { ascending: true });
        if (gErr) throw gErr;

        // 3) Existing settings (one per round)
        const { data: sRow, error: sErr } = await supabase
          .from("match_round_settings")
          .select("id,tour_id,round_id,group_a_id,group_b_id,format,double_points,created_at,updated_at")
          .eq("round_id", roundId)
          .maybeSingle();
        if (sErr) throw sErr;

        if (!alive) return;

        setRound(rRow as any);
        setGroups((gRows ?? []) as any);

        const ex = (sRow ?? null) as any as SettingsRow | null;
        setExisting(ex);

        if (ex) {
          setFormat(ex.format);
          setGroupAId(ex.group_a_id);
          setGroupBId(ex.group_b_id);
          setDoublePoints(ex.double_points === true);
        } else {
          // defaults: first two groups if present
          const arr = (gRows ?? []) as any[];
          const a = arr?.[0]?.id ? String(arr[0].id) : "";
          const b = arr?.[1]?.id ? String(arr[1].id) : "";
          setGroupAId(a);
          setGroupBId(b);
          setDoublePoints(false);
          setFormat("INDIVIDUAL_MATCHPLAY");
        }
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

  // Load team members whenever we have saved settings (or chosen groups)
  useEffect(() => {
    if (!isLikelyUuid(tourId)) return;
    if (!isLikelyUuid(groupAId) || !isLikelyUuid(groupBId)) return;

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
          .map((r: any) => isPlayerJoin(r.players))
          .filter(Boolean) as any;

        if (!alive) return;

        if (which === "A") setTeamA(players);
        else setTeamB(players);
      } catch (e: any) {
        if (!alive) return;
        // Keep it simple: surface as a banner in match section later
        if (which === "A") setTeamA([]);
        else setTeamB([]);
      } finally {
        if (!alive) return;
        if (which === "A") setTeamALoading(false);
        else setTeamBLoading(false);
      }
    }

    void loadTeam(groupAId, "A");
    void loadTeam(groupBId, "B");

    return () => {
      alive = false;
    };
  }, [tourId, groupAId, groupBId]);

  // Load existing matches + player assignments whenever settings are saved and not dirty
  useEffect(() => {
    if (!existing) {
      setMatchSetup([]);
      setLoadedMatchCount(0);
      return;
    }
    if (!matchSetupEnabled) {
      // if you change settings (dirty), we hide/disable match setup and clear messages but keep selections until saved
      setMatchMsg("");
      setMatchErr("");
      return;
    }

    let alive = true;

    async function loadMatches() {
      setMatchLoading(true);
      setMatchMsg("");
      setMatchErr("");

      try {
        const { data, error } = await supabase
          .from("match_round_matches")
          .select("id,match_no,match_round_match_players(side,slot,player_id)")
          .eq("settings_id", existing.id)
          .order("match_no", { ascending: true });

        if (error) throw error;

        const rows = (data ?? []) as any as MatchRow[];
        const maxNo = rows.reduce((m, r) => Math.max(m, Number(r.match_no) || 0), 0);

        // Build matchSetup array sized to max(matchCount, maxNo) so existing assignments show even if team sizes changed
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
  }, [existing?.id, matchSetupEnabled, matchCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const canSaveSettings = useMemo(() => {
    if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId)) return false;
    if (!isLikelyUuid(groupAId) || !isLikelyUuid(groupBId)) return false;
    if (groupAId === groupBId) return false;
    return settingsDirty && !savingSettings;
  }, [tourId, roundId, groupAId, groupBId, settingsDirty, savingSettings]);

  async function saveSettings() {
    setSavingSettings(true);
    setErrorMsg("");
    setSaveMsg("");
    setMatchMsg("");
    setMatchErr("");

    try {
      const payload = {
        tour_id: tourId,
        round_id: roundId,
        group_a_id: groupAId,
        group_b_id: groupBId,
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

      // After settings save, ensure matchSetup resets to the new required size (but loadMatches effect will run)
      if (saved.format === "INDIVIDUAL_STABLEFORD") {
        setMatchSetup([]);
        setLoadedMatchCount(0);
      }
    } catch (e: any) {
      const msg = String(e?.message ?? "Save failed.");
      if (msg.toLowerCase().includes("match_round_settings_groups_distinct")) {
        setErrorMsg("Team A and Team B must be different.");
      } else if (msg.toLowerCase().includes("match_round_settings_format_check")) {
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

    // Consider it dirty if we have any non-empty selection, or the loaded count differs from required matchCount.
    // (We deliberately keep it simple: save recreates.)
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

    // Basic validation: for INDIVIDUAL require A1/B1 for each match
    if (existing.format === "INDIVIDUAL_MATCHPLAY") {
      for (let i = 0; i < matchCount; i++) {
        const m = matchSetup[i];
        if (!m) return false;
        if (!isLikelyUuid(m.A1) || !isLikelyUuid(m.B1)) return false;
      }
    }

    // BETTERBALL: require A1,A2,B1,B2 for each match
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

    try {
      // 0) sanity
      const fmt = existing.format;
      const count = matchCount;

      if (fmt === "INDIVIDUAL_STABLEFORD") {
        setMatchMsg("No player setup needed for Individual stableford.");
        setMatchSaving(false);
        return;
      }

      // 1) Load existing match ids for this settings_id
      const { data: oldMatches, error: oldErr } = await supabase
        .from("match_round_matches")
        .select("id")
        .eq("settings_id", existing.id);
      if (oldErr) throw oldErr;

      const oldIds = (oldMatches ?? []).map((r: any) => String(r.id)).filter(Boolean);

      // 2) Delete players then matches (wipe + recreate is simplest)
      if (oldIds.length > 0) {
        const { error: delPlayersErr } = await supabase
          .from("match_round_match_players")
          .delete()
          .in("match_id", oldIds);
        if (delPlayersErr) throw delPlayersErr;

        const { error: delMatchesErr } = await supabase.from("match_round_matches").delete().in("id", oldIds);
        if (delMatchesErr) throw delMatchesErr;
      }

      // 3) Insert match_round_matches for 1..count
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

      // 4) Insert match_round_match_players
      const playersToInsert: Array<{ match_id: string; side: "A" | "B"; slot: number; player_id: string }> = [];

      for (let i = 0; i < count; i++) {
        const m = matchSetup[i];
        const matchId = idByNo.get(i + 1);
        if (!m || !matchId) continue;

        // always slot 1
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

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-10">
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold">Matches – Format</div>
            <div className="truncate text-sm text-gray-500">{roundTitle || "Configure this round"}</div>
          </div>

          <Link
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm active:bg-gray-50"
            href={`/m/tours/${tourId}/matches/format`}
          >
            Back
          </Link>
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
              </div>
            </section>

            {/* Teams + double points */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Teams</div>
                <div className="mt-1 text-xs text-gray-600">Select the two tour groups competing this round.</div>
              </div>

              <div className="p-4 space-y-3">
                {groups.length < 2 ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    This tour has fewer than 2 groups in <span className="font-semibold">tour_groups</span>.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Team A</label>
                        <select
                          className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-sm"
                          value={groupAId}
                          onChange={(e) => {
                            setSaveMsg("");
                            setErrorMsg("");
                            setMatchMsg("");
                            setMatchErr("");
                            setGroupAId(e.target.value);
                          }}
                        >
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {safeText(g.name, "(unnamed)")}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Team B</label>
                        <select
                          className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-sm"
                          value={groupBId}
                          onChange={(e) => {
                            setSaveMsg("");
                            setErrorMsg("");
                            setMatchMsg("");
                            setMatchErr("");
                            setGroupBId(e.target.value);
                          }}
                        >
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {safeText(g.name, "(unnamed)")}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {groupAId === groupBId ? <div className="text-xs text-red-700">Team A and Team B must be different.</div> : null}

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
                  </>
                )}
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
                <div className="mt-1 text-xs text-gray-600">
                  Assign players to matches for this round. (Saved settings required.)
                </div>
              </div>

              <div className="p-4 space-y-3">
                {!existing ? (
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
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">Loading match setup…</div>
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
                      <div className="text-xs text-gray-600">
                        {matchSetupDirty ? "Changes pending" : "No changes"}
                      </div>

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
          </>
        )}
      </main>
    </div>
  );
}
