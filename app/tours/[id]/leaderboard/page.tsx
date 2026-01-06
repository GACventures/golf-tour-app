"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

import { runCompetition } from "@/lib/competitions/engine";
import { competitionCatalog } from "@/lib/competitions/catalog";
import type { TourCompetitionContext, TourRoundContext } from "@/lib/competitions/types";

import { resolveEntities, type LeaderboardEntity } from "@/lib/competitions/entities/resolveEntities";

type Tour = { id: string; name: string };
type Round = { id: string; tour_id: string; course_id: string; created_at: string | null };
type Player = { id: string; tour_id: string; name: string };

type ParRow = { course_id: string; hole_number: number; par: number; stroke_index: number };

type RoundPlayer = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number; // ✅ must exist in DB now
};

type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean;
};

type LeaderRow = {
  playerId: string;
  playerName: string;
  perRound: Record<string, number | null>;
  total: number;
};

type EntityLeaderRow = {
  entityId: string;
  label: string;
  membersLabel: string;
  perRound: Record<string, number | null>;
  total: number;
};

function round2(n: number) {
  return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
}

function isPercentStatKey(k: string) {
  return k.endsWith("_pct") || k.endsWith("_percent");
}

function formatStatValue(key: string, val: number | string) {
  if (typeof val === "number") {
    if (isPercentStatKey(key)) return `${round2(val)}%`;
    if (key.includes("avg") || key.includes("average")) return round2(val).toFixed(2);
    if (Number.isInteger(val)) return String(val);
    return round2(val).toFixed(2);
  }
  return String(val);
}

function titleCaseKey(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/\bPct\b/i, "%");
}

function sumBestN(values: Array<number | null | undefined>, n: number): number {
  const k = Math.max(0, Math.floor(n));
  if (k === 0) return 0;
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  nums.sort((a, b) => b - a);
  return nums.slice(0, k).reduce((s, v) => s + v, 0);
}

function bestNWithOptionalFinal(opts: {
  perRoundById: Record<string, number | null>;
  roundIdsInOrder: string[];
  n: number;
  mustIncludeFinal: boolean;
}): number {
  const n = Math.max(1, Math.floor(opts.n || 1));
  const ids = opts.roundIdsInOrder;
  const finalId = ids.length ? ids[ids.length - 1] : null;
  if (!finalId) return 0;

  const per = opts.perRoundById;

  if (!opts.mustIncludeFinal) {
    return sumBestN(ids.map((id) => per[id]), n);
  }

  const rest = Math.max(0, n - 1);
  const finalVal = per[finalId];
  const others = ids.filter((id) => id !== finalId).map((id) => per[id]);

  // If final not played, use best N−1
  if (finalVal === null) return sumBestN(others, rest);

  return finalVal + sumBestN(others, rest);
}

export default function TourLeaderboardPage() {
  const params = useParams<{ id: string }>();
  const tourId = params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const [tourName, setTourName] = useState<string>("");
  const [rounds, setRounds] = useState<Round[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayer[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);

  const [excludeIncomplete, setExcludeIncomplete] = useState(true);

  // Individual best N rounds
  const [useBestN, setUseBestN] = useState(false);
  const [bestN, setBestN] = useState(3);
  const [bestNMustIncludeFinal, setBestNMustIncludeFinal] = useState(false);

  // Pair best N rounds
  const [useBestNForPairs, setUseBestNForPairs] = useState(false);
  const [bestNPairs, setBestNPairs] = useState(3);
  const [bestNPairsMustIncludeFinal, setBestNPairsMustIncludeFinal] = useState(false);

  // Team setting: M
  const [teamBestM, setTeamBestM] = useState<number>(2);
  const [savingTeamBestM, setSavingTeamBestM] = useState(false);
  const [teamBestMMsg, setTeamBestMMsg] = useState<string>("");

  const tourCompetitions = useMemo(() => competitionCatalog.filter((c) => c.scope === "tour"), []);
  const [selectedCompId, setSelectedCompId] = useState(tourCompetitions[0]?.id ?? "tour_napoleon_par3_avg");

  const [entities, setEntities] = useState<LeaderboardEntity[]>([]);
  const [entityMembersById, setEntityMembersById] = useState<Record<string, string[]>>({});
  const [entityLabelsById, setEntityLabelsById] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      const { data: tour, error: tourErr } = await supabase.from("tours").select("id,name").eq("id", tourId).single();
      if (cancelled) return;
      if (tourErr) {
        setError(tourErr.message);
        setLoading(false);
        return;
      }
      setTourName((tour as Tour).name);

      // team settings (M)
      {
        const { data: sData, error: sErr } = await supabase
          .from("tour_grouping_settings")
          .select("default_team_best_m")
          .eq("tour_id", tourId)
          .maybeSingle();

        if (cancelled) return;

        if (!sErr) {
          const m = Number((sData as any)?.default_team_best_m);
          if (Number.isFinite(m) && m >= 1 && m <= 10) setTeamBestM(m);
        }
      }

      const { data: roundData, error: roundsErr } = await supabase
        .from("rounds")
        .select("id,tour_id,course_id,created_at")
        .eq("tour_id", tourId)
        .order("created_at", { ascending: true });

      if (cancelled) return;
      if (roundsErr) {
        setError(roundsErr.message);
        setLoading(false);
        return;
      }
      const roundList = (roundData ?? []) as Round[];
      setRounds(roundList);

      const { data: playerData, error: playersErr } = await supabase
        .from("players")
        .select("id,tour_id,name")
        .eq("tour_id", tourId)
        .order("name", { ascending: true });

      if (cancelled) return;
      if (playersErr) {
        setError(playersErr.message);
        setLoading(false);
        return;
      }
      setPlayers((playerData ?? []) as Player[]);

      const roundIds = roundList.map((r) => r.id);
      const courseIds = Array.from(new Set(roundList.map((r) => r.course_id)));

      if (roundIds.length === 0) {
        setPars([]);
        setRoundPlayers([]);
        setScores([]);
        setLoading(false);
        return;
      }

      const { data: parsData, error: parsErr } = await supabase
        .from("pars")
        .select("course_id,hole_number,par,stroke_index")
        .in("course_id", courseIds);

      if (cancelled) return;
      if (parsErr) {
        setError(parsErr.message);
        setLoading(false);
        return;
      }
      setPars((parsData ?? []) as ParRow[]);

      // ✅ IMPORTANT: use DB playing_handicap (source of truth)
      const { data: rpData, error: rpErr } = await supabase
        .from("round_players")
        .select("round_id,player_id,playing,playing_handicap")
        .in("round_id", roundIds)
        .eq("playing", true);

      if (cancelled) return;
      if (rpErr) {
        setError(rpErr.message);
        setLoading(false);
        return;
      }

      // If some rows have null playing_handicap, treat as 0 to avoid crashes (but ideally never null)
      const rp = (rpData ?? []).map((x: any) => ({
        ...x,
        playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : 0,
      })) as RoundPlayer[];
      setRoundPlayers(rp);

      const { data: scoreData, error: scoreErr } = await supabase
        .from("scores")
        .select("round_id,player_id,hole_number,strokes,pickup")
        .in("round_id", roundIds);

      if (cancelled) return;
      if (scoreErr) {
        setError(scoreErr.message);
        setLoading(false);
        return;
      }
      setScores((scoreData ?? []) as ScoreRow[]);

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [tourId]);

  // Resolve entities whenever selection changes (pair/team)
  useEffect(() => {
    let cancelled = false;

    async function loadEntities() {
      const def = tourCompetitions.find((c) => c.id === selectedCompId);
      const kind = (def?.kind ?? "individual") as "individual" | "pair" | "team";

      const res = await resolveEntities({ tourId, scope: "tour", kind });
      if (cancelled) return;

      const list = res.entities ?? [];
      setEntities(list);

      const membersById: Record<string, string[]> = {};
      const labelsById: Record<string, string> = {};
      for (const e of list) {
        membersById[e.entityId] = e.memberPlayerIds;
        labelsById[e.entityId] = e.name;
      }
      setEntityMembersById(membersById);
      setEntityLabelsById(labelsById);
    }

    loadEntities();
    return () => {
      cancelled = true;
    };
  }, [tourId, selectedCompId, tourCompetitions]);

  const { roundHeaders, leaderboardRows, derived, roundIdsInOrder } = useMemo(() => {
    const courseHole: Record<string, Record<number, { par: number; si: number }>> = {};
    for (const p of pars) {
      if (!courseHole[p.course_id]) courseHole[p.course_id] = {};
      courseHole[p.course_id][p.hole_number] = { par: p.par, si: p.stroke_index };
    }

    // ✅ round -> player -> playing_handicap (from DB)
    const rpMap: Record<string, Record<string, number>> = {};
    for (const rp of roundPlayers) {
      if (!rpMap[rp.round_id]) rpMap[rp.round_id] = {};
      rpMap[rp.round_id][rp.player_id] = rp.playing_handicap ?? 0;
    }

    // round -> player -> hole -> rawScore
    const scoreMap: Record<string, Record<string, Record<number, string>>> = {};
    for (const s of scores) {
      const isPickup = (s as any).pickup === true;
      const raw = isPickup
        ? "P"
        : s.strokes === null || s.strokes === undefined
        ? ""
        : String(s.strokes).trim().toUpperCase();

      if (!scoreMap[s.round_id]) scoreMap[s.round_id] = {};
      if (!scoreMap[s.round_id][s.player_id]) scoreMap[s.round_id][s.player_id] = {};
      scoreMap[s.round_id][s.player_id][s.hole_number] = raw;
    }

    function isRoundComplete(roundId: string): boolean {
      const playingRows = roundPlayers.filter((rp) => rp.round_id === roundId);
      if (playingRows.length === 0) return false;

      for (const rp of playingRows) {
        for (let hole = 1; hole <= 18; hole++) {
          const raw = scoreMap[roundId]?.[rp.player_id]?.[hole] ?? "";
          if (!raw) return false;
        }
      }
      return true;
    }

    const eligibleRounds = excludeIncomplete ? rounds.filter((r) => isRoundComplete(r.id)) : rounds;

    const roundHeaders = eligibleRounds.map((r, idx) => ({
      id: r.id,
      label: `R${idx + 1}`,
      courseId: r.course_id,
    }));

    const roundIdsInOrder = roundHeaders.map((x) => x.id);

    const rows: LeaderRow[] = players.map((pl) => {
      const perRound: Record<string, number | null> = {};
      let totalAllRounds = 0;

      for (const r of roundHeaders) {
        const hcp = rpMap[r.id]?.[pl.id];

        // If not playing in this round => null
        if (hcp === undefined) {
          perRound[r.id] = null;
          continue;
        }

        const holeInfo = courseHole[r.courseId];
        if (!holeInfo) {
          perRound[r.id] = 0;
          continue;
        }

        let roundTotal = 0;
        for (let hole = 1; hole <= 18; hole++) {
          const info = holeInfo[hole];
          if (!info) continue;

          const raw = scoreMap[r.id]?.[pl.id]?.[hole] ?? "";

          roundTotal += netStablefordPointsForHole({
            rawScore: raw,
            par: info.par,
            strokeIndex: info.si,
            playingHandicap: hcp,
          });
        }

        perRound[r.id] = roundTotal;
        totalAllRounds += roundTotal;
      }

      let finalTotal = totalAllRounds;
      if (useBestN) {
        finalTotal = bestNWithOptionalFinal({
          perRoundById: perRound,
          roundIdsInOrder,
          n: bestN,
          mustIncludeFinal: bestNMustIncludeFinal,
        });
      }

      return { playerId: pl.id, playerName: pl.name, perRound, total: finalTotal };
    });

    rows.sort((a, b) => (b.total !== a.total ? b.total - a.total : a.playerName.localeCompare(b.playerName)));

    return { roundHeaders, leaderboardRows: rows, derived: { courseHole, rpMap, scoreMap, eligibleRounds }, roundIdsInOrder };
  }, [rounds, players, pars, roundPlayers, scores, excludeIncomplete, useBestN, bestN, bestNMustIncludeFinal]);

  const selectedDef = useMemo(
    () => tourCompetitions.find((c) => c.id === selectedCompId) ?? null,
    [tourCompetitions, selectedCompId]
  );

  const isGroupComp = selectedDef?.kind === "pair" || selectedDef?.kind === "team";

  const entityLeaderboard = useMemo((): { rows: EntityLeaderRow[]; hasAny: boolean } => {
    if (!isGroupComp || !selectedDef) return { rows: [], hasAny: false };

    const { courseHole, rpMap, scoreMap } = derived;

    const playerNameById: Record<string, string> = {};
    for (const p of players) playerNameById[p.id] = p.name;

    const netPts = (roundId: string, courseId: string, playerId: string, hole: number) => {
      const hcp = rpMap[roundId]?.[playerId];
      if (hcp === undefined) return 0;

      const info = courseHole[courseId]?.[hole];
      if (!info) return 0;

      const raw = scoreMap[roundId]?.[playerId]?.[hole] ?? "";
      return netStablefordPointsForHole({
        rawScore: raw,
        par: info.par,
        strokeIndex: info.si,
        playingHandicap: hcp,
      });
    };

    const compId = selectedDef.id ?? "";
    const isBestBall = compId === "tour_pair_best_ball_stableford" || compId.includes("pair_best_ball");
    const isTeamCustom = compId === "tour_team_best_m_minus_zeros" || compId.includes("team_best_m_minus_zeros");
    const m = Math.max(1, Math.floor(teamBestM || 1));

    const computeEntityRoundTotal = (entity: LeaderboardEntity, roundId: string, courseId: string): number | null => {
      const anyPlayed = entity.memberPlayerIds.some((pid) => derived.rpMap[roundId]?.[pid] !== undefined);
      if (!anyPlayed) return null;

      let roundTotal = 0;

      for (let hole = 1; hole <= 18; hole++) {
        const ptsByMember = entity.memberPlayerIds.map((pid) => netPts(roundId, courseId, pid, hole));

        if (selectedDef.kind === "pair" && isBestBall) {
          roundTotal += ptsByMember.length ? Math.max(...ptsByMember) : 0;
          continue;
        }

        if (selectedDef.kind === "team" && isTeamCustom) {
          const zeros = ptsByMember.filter((p) => p === 0).length;
          const topM = ptsByMember
            .slice()
            .sort((a, b) => b - a)
            .slice(0, Math.min(m, ptsByMember.length))
            .reduce((s, v) => s + v, 0);

          roundTotal += topM - zeros;
          continue;
        }

        roundTotal += ptsByMember.reduce((s, v) => s + v, 0);
      }

      return roundTotal;
    };

    const rows: EntityLeaderRow[] = (entities ?? []).map((e) => {
      const perRound: Record<string, number | null> = {};
      let totalAllRounds = 0;

      for (const rh of roundHeaders) {
        const v = computeEntityRoundTotal(e, rh.id, rh.courseId);
        perRound[rh.id] = v;
        totalAllRounds += v ?? 0;
      }

      let total = totalAllRounds;

      // Apply best-N to PAIRS (as per your requirement)
      if (selectedDef.kind === "pair" && useBestNForPairs) {
        total = bestNWithOptionalFinal({
          perRoundById: perRound,
          roundIdsInOrder,
          n: bestNPairs,
          mustIncludeFinal: bestNPairsMustIncludeFinal,
        });
      }

      const membersLabel = e.memberPlayerIds.map((pid) => playerNameById[pid] ?? pid).join(" / ");

      return { entityId: e.entityId, label: e.name, membersLabel, perRound, total };
    });

    rows.sort((a, b) => (b.total !== a.total ? b.total - a.total : a.label.localeCompare(b.label)));
    return { rows, hasAny: rows.length > 0 };
  }, [
    isGroupComp,
    selectedDef,
    derived,
    players,
    entities,
    roundHeaders,
    teamBestM,
    roundIdsInOrder,
    useBestNForPairs,
    bestNPairs,
    bestNPairsMustIncludeFinal,
  ]);

  const { compDef, compResult, compColumns } = useMemo(() => {
    const def = tourCompetitions.find((c) => c.id === selectedCompId) ?? null;
    if (!def) return { compDef: null as any, compResult: null as any, compColumns: [] as string[] };

    const { courseHole, rpMap, scoreMap, eligibleRounds } = derived;

    const tourRounds: TourRoundContext[] = eligibleRounds.map((r) => {
      const holeInfo = courseHole[r.course_id] ?? {};
      const parsByHole = Array.from({ length: 18 }, (_, i) => holeInfo[i + 1]?.par ?? 0);
      const strokeIndexByHole = Array.from({ length: 18 }, (_, i) => holeInfo[i + 1]?.si ?? 0);

      const scoresMatrix: Record<string, string[]> = {};
      for (const pl of players) {
        const arr = Array(18).fill("");
        for (let hole = 1; hole <= 18; hole++) arr[hole - 1] = scoreMap[r.id]?.[pl.id]?.[hole] ?? "";
        scoresMatrix[pl.id] = arr;
      }

      const playedInThisRound = (playerId: string) => rpMap[r.id]?.[playerId] !== undefined;

      const isComplete = (playerId: string) => {
        if (!playedInThisRound(playerId)) return true;
        const arr = scoresMatrix[playerId] ?? Array(18).fill("");
        for (let i = 0; i < 18; i++) if (!String(arr[i] ?? "").trim()) return false;
        return true;
      };

      const netPointsForHoleFn = (playerId: string, holeIndex: number) => {
        const hcp = rpMap[r.id]?.[playerId];
        if (hcp === undefined) return 0;
        const par = parsByHole[holeIndex];
        const si = strokeIndexByHole[holeIndex];
        const raw = (scoresMatrix[playerId]?.[holeIndex] ?? "").toString();
        if (!par || !si) return 0;

        return netStablefordPointsForHole({
          rawScore: raw,
          par,
          strokeIndex: si,
          playingHandicap: hcp,
        });
      };

      return {
        roundId: r.id,
        roundName: r.id,
        holes: Array.from({ length: 18 }, (_, i) => i + 1),
        parsByHole,
        strokeIndexByHole,
        scores: Object.fromEntries(players.map((pl) => [pl.id, scoresMatrix[pl.id] ?? Array(18).fill("")])),
        netPointsForHole: netPointsForHoleFn,
        isComplete,
      };
    });

    const playedAny = (playerId: string) => tourRounds.some((tr) => (derived.rpMap[tr.roundId]?.[playerId] ?? undefined) !== undefined);

    const ctx: TourCompetitionContext = {
      scope: "tour",
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        playing: playedAny(p.id),
        playing_handicap: 0, // not used for tour comps; per-round hcp is via netPointsForHole()
      })),
      rounds: tourRounds,
    };

    (ctx as any).entityMembersById = entityMembersById;
    (ctx as any).entityLabelsById = entityLabelsById;
    (ctx as any).entities = (entities ?? []).map((e) => ({ entityId: e.entityId, label: e.name, memberPlayerIds: e.memberPlayerIds }));
    (ctx as any).team_best_m = Math.max(1, Math.floor(teamBestM || 1));

    const result = runCompetition(def, ctx);

    const keySet = new Set<string>();
    for (const row of result.rows) for (const k of Object.keys(row.stats ?? {})) keySet.add(k);

    const preferred = ["members", "holes_played", "points_total", "avg_points", "zero_count", "zero_pct", "four_plus_count", "four_plus_pct", "eclectic_total"];
    const keys = Array.from(keySet);
    keys.sort((a, b) => {
      const ia = preferred.indexOf(a);
      const ib = preferred.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      return a.localeCompare(b);
    });

    return { compDef: def, compResult: result, compColumns: keys };
  }, [tourCompetitions, selectedCompId, derived, players, entityMembersById, entityLabelsById, entities, teamBestM]);

  async function saveTeamBestM(next: number) {
    setTeamBestMMsg("");
    setSavingTeamBestM(true);

    const payload: any = { tour_id: tourId, default_team_best_m: next, updated_at: new Date().toISOString() };
    const { error: upErr } = await supabase.from("tour_grouping_settings").upsert(payload, { onConflict: "tour_id" });

    setSavingTeamBestM(false);
    if (upErr) {
      setTeamBestMMsg(`Save failed: ${upErr.message}`);
      return;
    }
    setTeamBestMMsg("Saved ✓");
    setTimeout(() => setTeamBestMMsg(""), 1500);
  }

  if (loading) return <div style={{ padding: 16 }}>Loading leaderboard…</div>;

  if (error)
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: "crimson", fontWeight: 700 }}>Error</div>
        <div style={{ marginTop: 8 }}>{error}</div>
      </div>
    );

  const needsEntities = selectedDef?.kind === "pair" || selectedDef?.kind === "team";
  const hasAnyEntities = (entities ?? []).length > 0;

  const entityHeaderLabel = selectedDef?.kind === "pair" ? "Pair" : selectedDef?.kind === "team" ? "Team" : "Player";

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Link href={`/tours/${tourId}`}>← Back to Tour</Link>
        <span style={{ color: "#bbb" }}>•</span>
        <Link href={`/tours/${tourId}/groups`}>Manage pairs/teams</Link>
        <span style={{ color: "#bbb" }}>•</span>
        <Link href={`/tours/${tourId}/handicaps`}>Handicap validation</Link>
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Tour Leaderboard</h1>

      <div style={{ marginTop: 6, color: "#555" }}>
        {tourName} — Net Stableford
      </div>

      <div style={{ marginTop: 10, marginBottom: 10 }}>
        <label style={{ fontSize: 14 }}>
          <input type="checkbox" checked={excludeIncomplete} onChange={(e) => setExcludeIncomplete(e.target.checked)} style={{ marginRight: 6 }} />
          Exclude incomplete rounds
        </label>
      </div>

      {/* Individual best-N */}
      <div style={{ marginBottom: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ fontSize: 14 }}>
          <input type="checkbox" checked={useBestN} onChange={(e) => setUseBestN(e.target.checked)} style={{ marginRight: 6 }} />
          Individual: use best N rounds
        </label>

        {useBestN && (
          <>
            <label style={{ fontSize: 14 }}>
              N:&nbsp;
              <input type="number" min={1} max={50} value={bestN} onChange={(e) => setBestN(Math.max(1, Number(e.target.value) || 1))} style={{ width: 70, padding: 4 }} />
            </label>

            <label style={{ fontSize: 14 }}>
              <input type="checkbox" checked={bestNMustIncludeFinal} onChange={(e) => setBestNMustIncludeFinal(e.target.checked)} style={{ marginRight: 6 }} />
              Must include final (if not played, uses best N−1)
            </label>
          </>
        )}
      </div>

      {/* Competitions */}
      <div style={{ marginTop: 14, marginBottom: 16, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>Competitions</div>

          <select value={selectedCompId} onChange={(e) => setSelectedCompId(e.target.value)} style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid #ccc" }}>
            {tourCompetitions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Pair best-N options */}
        {selectedDef?.kind === "pair" && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #eee" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Pair settings</div>
            <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 13 }}>
                <input type="checkbox" checked={useBestNForPairs} onChange={(e) => setUseBestNForPairs(e.target.checked)} style={{ marginRight: 6 }} />
                Use best N rounds for pairs
              </label>

              {useBestNForPairs && (
                <>
                  <label style={{ fontSize: 13 }}>
                    N:&nbsp;
                    <input type="number" min={1} max={50} value={bestNPairs} onChange={(e) => setBestNPairs(Math.max(1, Number(e.target.value) || 1))} style={{ width: 70, padding: 4 }} />
                  </label>

                  <label style={{ fontSize: 13 }}>
                    <input type="checkbox" checked={bestNPairsMustIncludeFinal} onChange={(e) => setBestNPairsMustIncludeFinal(e.target.checked)} style={{ marginRight: 6 }} />
                    Must include final (if not played, uses best N−1)
                  </label>
                </>
              )}
            </div>
          </div>
        )}

        {/* Team setting M */}
        {selectedDef?.kind === "team" && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #eee" }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Team settings</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ fontSize: 13 }}>
                Best M per hole:&nbsp;
                <input type="number" min={1} max={10} value={teamBestM} onChange={(e) => setTeamBestM(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} style={{ width: 70, padding: 4 }} />
              </label>

              <button
                type="button"
                onClick={() => saveTeamBestM(teamBestM)}
                disabled={savingTeamBestM}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ccc", background: savingTeamBestM ? "#f7f7f7" : "white" }}
              >
                {savingTeamBestM ? "Saving…" : "Save"}
              </button>

              {teamBestMMsg && <div style={{ fontSize: 12, color: teamBestMMsg.startsWith("Save failed") ? "crimson" : "#2e7d32" }}>{teamBestMMsg}</div>}
            </div>
          </div>
        )}

        {needsEntities && !hasAnyEntities ? (
          <div style={{ marginTop: 10, color: "#666" }}>No {selectedDef?.kind === "pair" ? "pairs" : "teams"} found yet.</div>
        ) : isGroupComp ? (
          entityLeaderboard.rows.length === 0 ? (
            <div style={{ marginTop: 10, color: "#666" }}>No eligible entries yet.</div>
          ) : (
            <div style={{ marginTop: 10, overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", minWidth: 820, width: "100%" }}>
                <thead>
                  <tr>
                    <th style={thLeft}>{entityHeaderLabel}</th>
                    {roundHeaders.map((r) => (
                      <th key={r.id} style={thRight}>
                        {r.label}
                      </th>
                    ))}
                    <th style={thRight}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {entityLeaderboard.rows.map((row) => (
                    <tr key={row.entityId}>
                      <td style={tdLeft}>
                        <div style={{ fontWeight: 700 }}>{row.label}</div>
                        <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{row.membersLabel}</div>
                      </td>
                      {roundHeaders.map((r) => (
                        <td key={r.id} style={tdRight}>
                          {row.perRound[r.id] === null ? "—" : row.perRound[r.id]}
                        </td>
                      ))}
                      <td style={{ ...tdRight, fontWeight: 800 }}>{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <div style={{ marginTop: 10, overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", minWidth: 700, width: "100%" }}>
              <thead>
                <tr>
                  <th style={thLeft}>Player</th>
                  {compColumns.map((k) => (
                    <th key={k} style={thRight}>
                      {titleCaseKey(k)}
                    </th>
                  ))}
                  <th style={thRight}>Score</th>
                </tr>
              </thead>
              <tbody>
                {compResult.rows.map((r) => {
                  const stats = r.stats ?? {};
                  return (
                    <tr key={r.entryId}>
                      <td style={tdLeft}>{r.label}</td>
                      {compColumns.map((k) => (
                        <td key={k} style={tdRight}>
                          {formatStatValue(k, (stats as any)[k] ?? "")}
                        </td>
                      ))}
                      <td style={{ ...tdRight, fontWeight: 800 }}>{round2(r.total).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Main leaderboard */}
      {roundHeaders.length === 0 ? (
        <div>No rounds yet for this tour{excludeIncomplete ? " (or none complete yet)." : "."}</div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 700, width: "100%" }}>
            <thead>
              <tr>
                <th style={thLeft}>Player</th>
                {roundHeaders.map((r) => (
                  <th key={r.id} style={thRight}>
                    {r.label}
                  </th>
                ))}
                <th style={thRight}>Total</th>
              </tr>
            </thead>
            <tbody>
              {leaderboardRows.map((row) => (
                <tr key={row.playerId}>
                  <td style={tdLeft}>{row.playerName}</td>
                  {roundHeaders.map((r) => (
                    <td key={r.id} style={tdRight}>
                      {row.perRound[r.id] === null ? "—" : row.perRound[r.id]}
                    </td>
                  ))}
                  <td style={{ ...tdRight, fontWeight: 700 }}>{row.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 12, color: "#666", fontSize: 13 }}>“—” means the player wasn’t selected (playing) for that round.</div>
    </div>
  );
}

const thLeft: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #ddd",
  position: "sticky",
  left: 0,
  background: "white",
  zIndex: 1,
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
  position: "sticky",
  left: 0,
  background: "white",
};

const tdRight: React.CSSProperties = {
  textAlign: "right",
  padding: "10px 8px",
  borderBottom: "1px solid #eee",
};
