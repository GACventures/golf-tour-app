"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

type Tee = "M" | "F";

type CourseRel = { name: string };

type Round = {
  id: string;
  name: string;
  tour_id?: string | null;
  course_id: string | null;
  is_locked?: boolean | null;
  courses?: CourseRel | CourseRel[] | null;
};

type ParRow = { course_id: string; hole_number: number; par: number; stroke_index: number; tee?: Tee };

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number | null;
  tee?: Tee | null;
};

type PlayerRow = { id: string; name: string; start_handicap?: number | null; gender?: Tee | null };

type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean | null;
  updated_at?: string | null;
};

type RoundGroupRow = {
  id: string;
  round_id: string;
  group_no: number;
  tee_time: string | null;
  start_hole: number | null;
  notes: string | null;
};

type RoundGroupPlayerRow = {
  id: string;
  round_id: string;
  group_id: string;
  player_id: string;
  seat: number | null;
};

function asSingle<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function fmtTs(ts?: string | null) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString();
}

function rawDisplay(strokes: number | null, pickup?: boolean | null): string {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  return String(strokes);
}

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function normalizeTimeInput(v: string | null | undefined) {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, 5) : "";
}

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function RoundPage() {
  const params = useParams<{ id: string }>();
  const roundId = (params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [round, setRound] = useState<Round | null>(null);

  // pars are now tee-aware; we keep both maps in memory
  const [parsByTee, setParsByTee] = useState<Record<Tee, ParRow[]>>({ M: [], F: [] });

  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [playersById, setPlayersById] = useState<Record<string, PlayerRow>>({});
  const [scoresByKey, setScoresByKey] = useState<Record<string, ScoreRow>>({});
  const [recent, setRecent] = useState<ScoreRow[]>([]);

  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  // NEW: tee time setup state
  const [roundGroups, setRoundGroups] = useState<RoundGroupRow[]>([]);
  const [roundGroupPlayers, setRoundGroupPlayers] = useState<RoundGroupPlayerRow[]>([]);
  const [groupCountDraft, setGroupCountDraft] = useState("");
  const [teeTimeDraftByGroupNo, setTeeTimeDraftByGroupNo] = useState<Record<number, string>>({});
  const [groupSetupBusy, setGroupSetupBusy] = useState(false);
  const [groupSetupMsg, setGroupSetupMsg] = useState("");

  const isLocked = round?.is_locked === true;

  async function loadAll() {
    if (!roundId) return;

    setLoading(true);
    setErrorMsg("");
    setSyncMsg("");
    setGroupSetupMsg("");

    try {
      // 1) Round
      const { data: rData, error: rErr } = await supabase
        .from("rounds")
        .select("id,name,tour_id,course_id,is_locked,courses(name)")
        .eq("id", roundId)
        .single();

      if (rErr) throw rErr;
      const r = rData as unknown as Round;

      // 2) Pars (both tees)
      const nextParsByTee: Record<Tee, ParRow[]> = { M: [], F: [] };
      if (r.course_id) {
        const { data, error } = await supabase
          .from("pars")
          .select("course_id,hole_number,par,stroke_index,tee")
          .eq("course_id", r.course_id)
          .in("tee", ["M", "F"])
          .order("hole_number", { ascending: true });

        if (error) throw error;

        const rows = (data ?? []) as any[];
        for (const row of rows) {
          const tee = normalizeTee(row.tee) as Tee;
          nextParsByTee[tee].push({
            course_id: String(row.course_id),
            hole_number: Number(row.hole_number),
            par: Number(row.par),
            stroke_index: Number(row.stroke_index),
            tee,
          });
        }
      }

      // 3) Round players
      const { data: rpData, error: rpErr } = await supabase
        .from("round_players")
        .select("round_id,player_id,playing,playing_handicap,tee")
        .eq("round_id", roundId);

      if (rpErr) throw rpErr;

      const rpRows: RoundPlayerRow[] = (rpData ?? []).map((x: any) => ({
        round_id: String(x.round_id),
        player_id: String(x.player_id),
        playing: x.playing === true,
        playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
        tee: x.tee ? normalizeTee(x.tee) : null,
      }));

      const ids = Array.from(new Set(rpRows.map((x) => x.player_id))).filter(Boolean);

      // 4) Players
      const map: Record<string, PlayerRow> = {};
      if (ids.length > 0) {
        const { data: pData, error: pErr } = await supabase
          .from("players")
          .select("id,name,start_handicap,gender")
          .in("id", ids);

        if (pErr) throw pErr;

        for (const p of pData ?? []) {
          const id = String((p as any).id);
          map[id] = {
            id,
            name: String((p as any).name),
            start_handicap: Number.isFinite(Number((p as any).start_handicap))
              ? Number((p as any).start_handicap)
              : null,
            gender: (p as any).gender ? normalizeTee((p as any).gender) : null,
          };
        }
      }

      // 5) Scores
      let sRows: ScoreRow[] = [];
      if (ids.length > 0) {
        const { data: sData, error: sErr } = await supabase
          .from("scores")
          .select("round_id,player_id,hole_number,strokes,pickup,updated_at")
          .eq("round_id", roundId)
          .in("player_id", ids);

        if (sErr) throw sErr;
        sRows = (sData ?? []) as ScoreRow[];
      }

      const byKey: Record<string, ScoreRow> = {};
      for (const row of sRows) {
        const pid = String(row.player_id);
        const h = Number(row.hole_number);
        byKey[`${pid}:${h}`] = row;
      }

      // 6) Recent
      let recentRows: ScoreRow[] = [];
      if (ids.length > 0) {
        const { data: recData, error: recErr } = await supabase
          .from("scores")
          .select("round_id,player_id,hole_number,strokes,pickup,updated_at")
          .eq("round_id", roundId)
          .in("player_id", ids)
          .order("updated_at", { ascending: false })
          .limit(12);

        if (recErr) throw recErr;
        recentRows = (recData ?? []) as ScoreRow[];
      }

      // 7) Round groups
      const { data: rgData, error: rgErr } = await supabase
        .from("round_groups")
        .select("id,round_id,group_no,tee_time,start_hole,notes")
        .eq("round_id", roundId)
        .order("group_no", { ascending: true });

      if (rgErr) throw rgErr;

      const loadedGroups = ((rgData ?? []) as any[]).map((g) => ({
        id: String(g.id),
        round_id: String(g.round_id),
        group_no: Number(g.group_no),
        tee_time: g.tee_time == null ? null : String(g.tee_time),
        start_hole: g.start_hole == null ? null : Number(g.start_hole),
        notes: g.notes == null ? null : String(g.notes),
      })) as RoundGroupRow[];

      // 8) Round group players
      let loadedGroupPlayers: RoundGroupPlayerRow[] = [];
      if (loadedGroups.length > 0) {
        const groupIds = loadedGroups.map((g) => g.id);
        const { data: rgpData, error: rgpErr } = await supabase
          .from("round_group_players")
          .select("id,round_id,group_id,player_id,seat")
          .eq("round_id", roundId)
          .in("group_id", groupIds);

        if (rgpErr) throw rgpErr;

        loadedGroupPlayers = ((rgpData ?? []) as any[]).map((x) => ({
          id: String(x.id),
          round_id: String(x.round_id),
          group_id: String(x.group_id),
          player_id: String(x.player_id),
          seat: x.seat == null ? null : Number(x.seat),
        }));
      }

      setRound(r);
      setParsByTee(nextParsByTee);
      setRoundPlayers(rpRows);
      setPlayersById(map);
      setScoresByKey(byKey);
      setRecent(recentRows);
      setRoundGroups(loadedGroups);
      setRoundGroupPlayers(loadedGroupPlayers);
      setGroupCountDraft(loadedGroups.length > 0 ? String(loadedGroups.length) : "");
      setTeeTimeDraftByGroupNo(
        loadedGroups.reduce<Record<number, string>>((acc, g) => {
          acc[g.group_no] = normalizeTimeInput(g.tee_time);
          return acc;
        }, {})
      );
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to load round.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  const courseName = useMemo(() => {
    const c = asSingle(round?.courses);
    return c?.name ?? "(no course)";
  }, [round]);

  const holeInfoByNumberByTee = useMemo(() => {
    const makeMap = (rows: ParRow[]) => {
      const by: Record<number, { par: number; si: number }> = {};
      for (const p of rows) by[p.hole_number] = { par: p.par, si: p.stroke_index };
      return by;
    };

    return {
      M: makeMap(parsByTee.M),
      F: makeMap(parsByTee.F),
    };
  }, [parsByTee]);

  const playersSorted = useMemo(() => {
    const arr = [...roundPlayers];
    arr.sort((a, b) => (playersById[a.player_id]?.name ?? "").localeCompare(playersById[b.player_id]?.name ?? ""));
    return arr;
  }, [roundPlayers, playersById]);

  const membersCountByGroupId = useMemo(() => {
    const out: Record<string, number> = {};
    for (const gp of roundGroupPlayers) {
      out[gp.group_id] = (out[gp.group_id] ?? 0) + 1;
    }
    return out;
  }, [roundGroupPlayers]);

  function teeForPlayer(pid: string): Tee {
    const rp = roundPlayers.find((x) => x.player_id === pid);
    const override = rp?.tee ? normalizeTee(rp.tee) : null;
    if (override) return override;

    const g = playersById[pid]?.gender ? normalizeTee(playersById[pid]?.gender) : null;
    return g ?? "M";
  }

  function pointsFor(pid: string, hole: number): number {
    const tee = teeForPlayer(pid);
    const info = holeInfoByNumberByTee[tee]?.[hole];
    if (!info?.par || !info?.si) return 0;

    const rp = roundPlayers.find((x) => x.player_id === pid);
    const hcp = Number.isFinite(Number(rp?.playing_handicap)) ? Number(rp?.playing_handicap) : 0;

    const row = scoresByKey[`${pid}:${hole}`];
    const raw = row?.pickup ? "P" : row?.strokes === null || row?.strokes === undefined ? "" : String(row?.strokes ?? "");

    return netStablefordPointsForHole({
      rawScore: raw,
      par: info.par,
      strokeIndex: info.si,
      playingHandicap: hcp,
    });
  }

  function totalPoints(pid: string): number {
    let sum = 0;
    for (let h = 1; h <= 18; h++) sum += pointsFor(pid, h);
    return sum;
  }

  async function togglePlaying(pid: string, next: boolean) {
    if (!roundId) return;
    if (isLocked) return;

    setRoundPlayers((prev) => prev.map((rp) => (rp.player_id === pid ? { ...rp, playing: next } : rp)));

    const { error } = await supabase
      .from("round_players")
      .update({ playing: next })
      .eq("round_id", roundId)
      .eq("player_id", pid);

    if (error) {
      setRoundPlayers((prev) => prev.map((rp) => (rp.player_id === pid ? { ...rp, playing: !next } : rp)));
      alert(error.message);
    }
  }

  async function syncPlayersFromTourIntoRound() {
    if (!round?.tour_id) {
      setSyncMsg("This round has no tour_id; cannot sync players.");
      return;
    }
    if (isLocked) {
      setSyncMsg("Round is locked; cannot sync players.");
      return;
    }

    setSyncBusy(true);
    setSyncMsg("");

    try {
      const { data: tourPlayers, error: tpErr } = await supabase
        .from("players")
        .select("id,start_handicap,gender")
        .eq("tour_id", round.tour_id);

      if (tpErr) throw tpErr;

      const tourIds = (tourPlayers ?? []).map((p: any) => String(p.id));
      const existing = new Set(roundPlayers.map((rp) => rp.player_id));

      const missing = tourIds.filter((id) => !existing.has(id));
      if (missing.length === 0) {
        setSyncMsg("No missing players — round already has all tour players.");
        return;
      }

      const byIdStartHcp = new Map<string, number | null>();
      const byIdGender = new Map<string, Tee>();
      for (const p of tourPlayers ?? []) {
        const id = String((p as any).id);
        const sh = Number.isFinite(Number((p as any).start_handicap)) ? Number((p as any).start_handicap) : null;
        byIdStartHcp.set(id, sh);
        byIdGender.set(id, (p as any).gender ? normalizeTee((p as any).gender) : "M");
      }

      const rows = missing.map((pid) => ({
        round_id: roundId,
        player_id: pid,
        playing: true,
        playing_handicap: byIdStartHcp.get(pid) ?? 0,
        tee: byIdGender.get(pid) ?? "M",
      }));

      const { error: insErr } = await supabase.from("round_players").insert(rows);
      if (insErr) throw insErr;

      setSyncMsg(`Added ${missing.length} player(s) into this round.`);
      await loadAll();
    } catch (e: any) {
      setSyncMsg(e?.message ?? "Failed to sync players.");
    } finally {
      setSyncBusy(false);
    }
  }

  async function saveTeeTimeSetup() {
    if (!roundId || !isLikelyUuid(roundId)) {
      setGroupSetupMsg("Invalid round id.");
      return;
    }
    if (isLocked) {
      setGroupSetupMsg("Round is locked; cannot edit tee time setup.");
      return;
    }

    const targetCount = Number(groupCountDraft);
    if (!Number.isFinite(targetCount) || !Number.isInteger(targetCount) || targetCount < 0) {
      setGroupSetupMsg("Number of groups must be a whole number 0 or greater.");
      return;
    }

    setGroupSetupBusy(true);
    setGroupSetupMsg("");
    setErrorMsg("");

    try {
      const existingByNo = new Map<number, RoundGroupRow>();
      for (const g of roundGroups) existingByNo.set(g.group_no, g);

      const memberCountByGroupId: Record<string, number> = {};
      for (const gp of roundGroupPlayers) {
        memberCountByGroupId[gp.group_id] = (memberCountByGroupId[gp.group_id] ?? 0) + 1;
      }

      const groupsToDelete = roundGroups.filter((g) => g.group_no > targetCount);
      const groupsWithPlayers = groupsToDelete.filter((g) => (memberCountByGroupId[g.id] ?? 0) > 0);

      if (groupsWithPlayers.length > 0) {
        throw new Error(
          `Cannot reduce to ${targetCount} groups because group(s) ${groupsWithPlayers
            .map((g) => g.group_no)
            .join(", ")} still have players assigned. Remove players first.`
        );
      }

      // update existing kept groups
      for (const g of roundGroups.filter((x) => x.group_no <= targetCount)) {
        const nextTime = normalizeTimeInput(teeTimeDraftByGroupNo[g.group_no] ?? "");
        const payload = {
          tee_time: nextTime || null,
          start_hole: g.start_hole ?? 1,
        };

        const { error } = await supabase.from("round_groups").update(payload).eq("id", g.id);
        if (error) throw error;
      }

      // insert missing groups up to targetCount
      const groupsToInsert: Array<{
        round_id: string;
        group_no: number;
        tee_time: string | null;
        start_hole: number;
        notes: string | null;
      }> = [];

      for (let groupNo = 1; groupNo <= targetCount; groupNo++) {
        if (existingByNo.has(groupNo)) continue;
        groupsToInsert.push({
          round_id: roundId,
          group_no: groupNo,
          tee_time: normalizeTimeInput(teeTimeDraftByGroupNo[groupNo] ?? "") || null,
          start_hole: 1,
          notes: "Manual: Round page tee setup",
        });
      }

      if (groupsToInsert.length > 0) {
        const { error } = await supabase.from("round_groups").insert(groupsToInsert);
        if (error) throw error;
      }

      // delete extra empty groups
      if (groupsToDelete.length > 0) {
        const deleteIds = groupsToDelete.map((g) => g.id);
        const { error } = await supabase.from("round_groups").delete().in("id", deleteIds);
        if (error) throw error;
      }

      setGroupSetupMsg("Tee time setup saved.");
      await loadAll();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to save tee time setup.");
    } finally {
      setGroupSetupBusy(false);
    }
  }

  if (loading) return <div className="p-4">Loading round…</div>;

  if (errorMsg) {
    return (
      <div className="p-4 space-y-2">
        <div className="font-bold text-red-600">Error</div>
        <div>{errorMsg}</div>
        <Link className="underline" href="/tours">
          Back to tours
        </Link>
      </div>
    );
  }

  if (!round) return <div className="p-4">Round not found.</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-2xl font-bold">{round.name}</div>
          <div className="text-sm opacity-70">Course: {courseName}</div>
          <div className="text-sm">
            Status:{" "}
            <span className={isLocked ? "text-red-600 font-semibold" : "text-green-700 font-semibold"}>
              {isLocked ? "Locked" : "Open"}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <Link className="underline text-sm" href={`/rounds/${roundId}/mobile`}>
            Mobile selection
          </Link>
          <Link className="underline text-sm" href={`/rounds/${roundId}/groups`}>
            Playing groups (this round)
          </Link>

          {round.tour_id ? (
            <Link className="underline text-sm" href={`/tours/${round.tour_id}/groups`}>
              Tour groups overview (all rounds)
            </Link>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border bg-white p-3 space-y-3">
        <div className="font-semibold">Tee time setup</div>
        <div className="text-sm opacity-70">
          Set the number of groups and tee times for this round. Groups can exist before players are assigned.
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs font-semibold opacity-70 mb-1">Number of groups</div>
            <input
              type="number"
              min={0}
              step={1}
              value={groupCountDraft}
              onChange={(e) => setGroupCountDraft(e.target.value)}
              disabled={groupSetupBusy || isLocked}
              className="w-28 rounded-md border px-3 py-2 text-sm"
            />
          </div>

          <button
            onClick={saveTeeTimeSetup}
            disabled={groupSetupBusy || isLocked}
            className="rounded-md px-3 py-2 text-sm text-white bg-black disabled:opacity-50"
          >
            {groupSetupBusy ? "Saving…" : "Save tee time setup"}
          </button>

          {groupSetupMsg ? <div className="text-sm opacity-80">{groupSetupMsg}</div> : null}
        </div>

        {Number(groupCountDraft) > 0 ? (
          <div className="space-y-2 pt-2">
            {Array.from({ length: Math.max(0, Number(groupCountDraft) || 0) }, (_, i) => i + 1).map((groupNo) => {
              const existing = roundGroups.find((g) => g.group_no === groupNo) ?? null;
              const membersCount = existing ? membersCountByGroupId[existing.id] ?? 0 : 0;

              return (
                <div key={groupNo} className="flex flex-wrap items-center gap-3 rounded border p-3">
                  <div className="w-24 text-sm font-semibold">Group {groupNo}</div>

                  <div>
                    <div className="text-xs font-semibold opacity-70 mb-1">Tee time</div>
                    <input
                      type="time"
                      value={teeTimeDraftByGroupNo[groupNo] ?? ""}
                      onChange={(e) =>
                        setTeeTimeDraftByGroupNo((prev) => ({
                          ...prev,
                          [groupNo]: normalizeTimeInput(e.target.value),
                        }))
                      }
                      disabled={groupSetupBusy || isLocked}
                      className="rounded-md border px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="text-sm opacity-70">
                    Players: {membersCount > 0 ? membersCount : "TBD"}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border bg-white p-3 space-y-2">
        <div className="font-semibold">Round players</div>
        <div className="text-sm opacity-70">
          If you added players to the tour after this round was created, click below to add missing players into this round.
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button
            onClick={syncPlayersFromTourIntoRound}
            disabled={syncBusy || isLocked}
            className="rounded-md px-3 py-2 text-sm text-white bg-black disabled:opacity-50"
          >
            {syncBusy ? "Adding…" : "Add missing tour players to this round"}
          </button>
          {syncMsg ? <div className="text-sm opacity-80">{syncMsg}</div> : null}
        </div>
      </div>

      <div className="rounded-lg border bg-white p-3">
        <div className="font-semibold mb-2">Recent score updates</div>
        {recent.length === 0 ? (
          <div className="text-sm opacity-70">No scores yet.</div>
        ) : (
          <div className="space-y-1 text-sm">
            {recent.map((r) => {
              const name = playersById[String(r.player_id)]?.name ?? String(r.player_id);
              const disp = rawDisplay(r.strokes, r.pickup);
              return (
                <div key={`${r.player_id}:${r.hole_number}:${r.updated_at ?? ""}`} className="flex justify-between gap-3">
                  <div className="truncate">
                    <span className="font-medium">{name}</span> — Hole {r.hole_number}:{" "}
                    <span className="font-semibold">{disp || "—"}</span>
                  </div>
                  <div className="opacity-60 whitespace-nowrap">{fmtTs(r.updated_at)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="min-w-[1200px] w-full text-sm">
          <thead className="bg-slate-100">
            <tr>
              <th className="sticky left-0 bg-slate-100 z-10 text-left p-2 border-r">Player</th>
              <th className="text-center p-2 border-r">Tee</th>
              <th className="text-center p-2 border-r">HCP</th>
              <th className="text-center p-2 border-r">Playing</th>
              {Array.from({ length: 18 }).map((_, i) => (
                <th key={i} className="text-center p-2 border-r">
                  {i + 1}
                </th>
              ))}
              <th className="text-center p-2">Total pts</th>
            </tr>

            <tr>
              <th className="sticky left-0 bg-slate-100 z-10 text-left p-2 border-r opacity-70">Par / SI (M)</th>
              <th className="p-2 border-r"></th>
              <th className="p-2 border-r"></th>
              <th className="p-2 border-r"></th>
              {Array.from({ length: 18 }).map((_, i) => {
                const h = i + 1;
                const info = holeInfoByNumberByTee.M[h] ?? { par: 0, si: 0 };
                return (
                  <th key={`m-${h}`} className="text-center p-2 border-r opacity-70">
                    {info.par || "—"} / {info.si || "—"}
                  </th>
                );
              })}
              <th className="p-2"></th>
            </tr>

            <tr>
              <th className="sticky left-0 bg-slate-100 z-10 text-left p-2 border-r opacity-70">Par / SI (F)</th>
              <th className="p-2 border-r"></th>
              <th className="p-2 border-r"></th>
              <th className="p-2 border-r"></th>
              {Array.from({ length: 18 }).map((_, i) => {
                const h = i + 1;
                const info = holeInfoByNumberByTee.F[h] ?? { par: 0, si: 0 };
                return (
                  <th key={`f-${h}`} className="text-center p-2 border-r opacity-70">
                    {info.par || "—"} / {info.si || "—"}
                  </th>
                );
              })}
              <th className="p-2"></th>
            </tr>
          </thead>

          <tbody>
            {playersSorted.map((rp) => {
              const pid = rp.player_id;
              const name = playersById[pid]?.name ?? pid;
              const tee = teeForPlayer(pid);

              return (
                <tr key={pid} className="border-t">
                  <td className="sticky left-0 bg-white z-10 p-2 border-r font-medium whitespace-nowrap">{name}</td>

                  <td className="text-center p-2 border-r font-semibold">{tee}</td>

                  <td className="text-center p-2 border-r">
                    {Number.isFinite(Number(rp.playing_handicap)) ? rp.playing_handicap : 0}
                  </td>

                  <td className="text-center p-2 border-r">
                    <input
                      type="checkbox"
                      checked={rp.playing}
                      disabled={isLocked}
                      onChange={(e) => togglePlaying(pid, e.target.checked)}
                    />
                  </td>

                  {Array.from({ length: 18 }).map((_, i) => {
                    const h = i + 1;
                    const row = scoresByKey[`${pid}:${h}`];
                    const disp = rawDisplay(row?.strokes ?? null, row?.pickup ?? null);
                    const pts = pointsFor(pid, h);

                    return (
                      <td key={h} className="text-center p-2 border-r">
                        <div className="font-semibold">{disp || "—"}</div>
                        <div className="text-xs opacity-60">{pts} pts</div>
                      </td>
                    );
                  })}

                  <td className="text-center p-2 font-bold">{totalPoints(pid)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex gap-4 text-sm">
        <Link className="underline" href="/tours">
          Tours
        </Link>
        <Link className="underline" href={`/rounds/${roundId}/mobile`}>
          Mobile
        </Link>
        <Link className="underline" href={`/rounds/${roundId}/groups`}>
          Groups
        </Link>
        {round.tour_id ? (
          <Link className="underline" href={`/tours/${round.tour_id}/groups`}>
            Tour overview
          </Link>
        ) : null}
      </div>
    </div>
  );
}