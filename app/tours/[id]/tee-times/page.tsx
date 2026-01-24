// app/tours/[id]/tee-times/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

import {
  generateRound1PreferPairs,
  generateFairMix,
  generateJapanR246,
  generateMixed2M2F_Fair,
  generateJapanRound7Seeded,
  type Tee,
  type Pair,
} from "@/lib/teeTimes/japanTourTeeTimes";

type Tour = { id: string; name: string };

type RoundRow = {
  id: string;
  tour_id: string;
  name: string;
  round_no: number | null;
  course_id: string | null;
  created_at?: string | null;
};

type PlayerRow = { id: string; name: string; gender: Tee; start_handicap: number | null };

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean | null;
  playing_handicap: number | null;
  tee: Tee;
};

type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean | null;
};

type RoundGroup = {
  id: string;
  round_id: string;
  group_no: number;
  start_hole: number;
  tee_time: string | null;
  notes: string | null;
};

type RoundGroupPlayer = {
  id: string;
  round_id: string;
  group_id: string;
  player_id: string;
  seat: number | null;
};

const JAPAN_TOUR_ID = "a2d8ba33-e0e8-48a6-aff4-37a71bf29988";

function fmtTs(ts?: string | null) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString();
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function labelFromNotes(notes?: string | null) {
  const n = (notes ?? "").toLowerCase();
  if (!n) return "";
  if (n.includes("japan")) return "Japan";
  if (n.includes("round 1")) return "Round 1";
  if (n.includes("fair")) return "Fair mix";
  if (n.includes("final")) return "Final";
  if (n.includes("auto:")) return "Auto";
  return "Manual";
}

function roundLabelFromGroups(rGroups: RoundGroup[]) {
  const labels = rGroups.map((g) => labelFromNotes(g.notes)).filter(Boolean);
  if (labels.length === 0) return "";

  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);

  const pref = new Map<string, number>([
    ["Japan", 6],
    ["Fair mix", 5],
    ["Round 1", 4],
    ["Final", 3],
    ["Auto", 2],
    ["Manual", 1],
  ]);

  const topCount = sorted[0][1];
  const tied = sorted.filter((x) => x[1] === topCount).map((x) => x[0]);
  tied.sort((a, b) => (pref.get(b) ?? 0) - (pref.get(a) ?? 0));

  return tied[0] ?? sorted[0][0];
}

function rawScoreFor(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  return String(strokes);
}

export default function TourTeeTimesPage() {
  const params = useParams<{ id: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [infoMsg, setInfoMsg] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [groups, setGroups] = useState<RoundGroup[]>([]);
  const [members, setMembers] = useState<RoundGroupPlayer[]>([]);

  const [tourPairs, setTourPairs] = useState<Pair[]>([]);
  const [pairWarn, setPairWarn] = useState("");

  const [roundNoDraft, setRoundNoDraft] = useState<Record<string, string>>({});
  const [roundNoSaving, setRoundNoSaving] = useState<Record<string, boolean>>({});
  const [roundNoErr, setRoundNoErr] = useState<Record<string, string>>({});

  const playerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.id, p.name);
    return m;
  }, [players]);

  const playerGenderById = useMemo(() => {
    const m = new Map<string, Tee>();
    for (const p of players) m.set(p.id, normalizeTee(p.gender));
    return m;
  }, [players]);

  const playerHcpById = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of players) m.set(p.id, Number.isFinite(Number(p.start_handicap)) ? Number(p.start_handicap) : 0);
    return m;
  }, [players]);

  const roundPlayersByRound = useMemo(() => {
    const m = new Map<string, RoundPlayerRow[]>();
    for (const rp of roundPlayers) {
      if (!m.has(rp.round_id)) m.set(rp.round_id, []);
      m.get(rp.round_id)!.push(rp);
    }
    return m;
  }, [roundPlayers]);

  const groupsByRound = useMemo(() => {
    const m = new Map<string, RoundGroup[]>();
    for (const g of groups) {
      if (!m.has(g.round_id)) m.set(g.round_id, []);
      m.get(g.round_id)!.push(g);
    }
    for (const [rid, arr] of m.entries()) {
      arr.sort((a, b) => a.group_no - b.group_no);
      m.set(rid, arr);
    }
    return m;
  }, [groups]);

  const membersByGroup = useMemo(() => {
    const m = new Map<string, RoundGroupPlayer[]>();
    for (const mem of members) {
      if (!m.has(mem.group_id)) m.set(mem.group_id, []);
      m.get(mem.group_id)!.push(mem);
    }
    for (const [gid, arr] of m.entries()) {
      arr.sort((a, b) => (a.seat ?? 999) - (b.seat ?? 999));
      m.set(gid, arr);
    }
    return m;
  }, [members]);

  async function loadAll() {
    if (!tourId) return;
    setLoading(true);
    setErrorMsg("");
    setInfoMsg("");
    setPairWarn("");

    try {
      const { data: tData, error: tErr } = await supabase.from("tours").select("id,name").eq("id", tourId).single();
      if (tErr) throw tErr;
      setTour(tData as Tour);

      const { data: rData, error: rErr } = await supabase
        .from("rounds")
        .select("id,tour_id,name,round_no,course_id,created_at")
        .eq("tour_id", tourId)
        .order("round_no", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
      if (rErr) throw rErr;

      const roundRows = (rData ?? []) as RoundRow[];
      setRounds(roundRows);

      setRoundNoDraft((prev) => {
        const next = { ...prev };
        for (const r of roundRows) {
          if (next[r.id] === undefined) next[r.id] = r.round_no === null ? "" : String(r.round_no);
        }
        return next;
      });

      const { data: tpData, error: tpErr } = await supabase
        .from("tour_players")
        .select("player_id, starting_handicap, players(id,name,gender)")
        .eq("tour_id", tourId)
        .order("name", { ascending: true, foreignTable: "players" });
      if (tpErr) throw tpErr;

      const playerRows: PlayerRow[] = (tpData ?? [])
        .map((r: any) => {
          const pid = String(r.players?.id ?? r.player_id);
          const nm = String(r.players?.name ?? "(missing name)");
          const g = normalizeTee(r.players?.gender);
          return {
            id: pid,
            name: nm,
            gender: g,
            start_handicap: Number.isFinite(Number(r.starting_handicap)) ? Number(r.starting_handicap) : null,
          };
        })
        .filter((p) => !!p.id);

      setPlayers(playerRows);

      const roundIds = roundRows.map((r) => r.id);
      if (roundIds.length === 0) {
        setRoundPlayers([]);
        setGroups([]);
        setMembers([]);
      } else {
        const { data: rpData, error: rpErr } = await supabase
          .from("round_players")
          .select("round_id,player_id,playing,playing_handicap,tee")
          .in("round_id", roundIds);
        if (rpErr) throw rpErr;

        setRoundPlayers(
          (rpData ?? []).map((rp: any) => ({
            round_id: String(rp.round_id),
            player_id: String(rp.player_id),
            playing: rp.playing === true,
            playing_handicap: Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : null,
            tee: normalizeTee(rp.tee),
          }))
        );

        const { data: gData, error: gErr } = await supabase
          .from("round_groups")
          .select("id,round_id,group_no,start_hole,tee_time,notes")
          .in("round_id", roundIds)
          .order("round_id", { ascending: true })
          .order("group_no", { ascending: true });
        if (gErr) throw gErr;
        setGroups((gData ?? []) as RoundGroup[]);

        const { data: mData, error: mErr } = await supabase
          .from("round_group_players")
          .select("id,round_id,group_id,player_id,seat")
          .in("round_id", roundIds);
        if (mErr) throw mErr;
        setMembers((mData ?? []) as RoundGroupPlayer[]);
      }

      const { data: tg, error: tgErr } = await supabase
        .from("tour_groups")
        .select("id,tour_id,scope,type")
        .eq("tour_id", tourId)
        .eq("scope", "tour")
        .eq("type", "pair");

      if (tgErr) {
        setTourPairs([]);
        setPairWarn(`Tour pairs not available: ${tgErr.message}`);
      } else {
        const groupIds = (tg ?? []).map((x: any) => x.id);
        if (!groupIds.length) {
          setTourPairs([]);
        } else {
          const { data: mem, error: memErr } = await supabase
            .from("tour_group_members")
            .select("group_id,player_id")
            .in("group_id", groupIds);

          if (memErr) {
            setTourPairs([]);
            setPairWarn(`Tour pair members not available: ${memErr.message}`);
          } else {
            const byGroup = new Map<string, string[]>();
            for (const r of mem ?? []) {
              const gid = String((r as any).group_id);
              const pid = String((r as any).player_id);
              if (!byGroup.has(gid)) byGroup.set(gid, []);
              byGroup.get(gid)!.push(pid);
            }
            const pairs: Pair[] = [];
            for (const arr of byGroup.values()) if (arr.length >= 2) pairs.push({ a: arr[0], b: arr[1] });
            setTourPairs(pairs);
          }
        }
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to load tee-time groupings overview.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  const fairness = useMemo(() => {
    const groupMemberLists: string[][] = [];
    for (const g of groups) {
      const mem = membersByGroup.get(g.id) ?? [];
      const ids = mem.map((m) => m.player_id).filter(Boolean);
      if (ids.length >= 2) groupMemberLists.push(ids);
    }

    const counts = new Map<string, number>();
    for (const grp of groupMemberLists) {
      for (let i = 0; i < grp.length; i++) {
        for (let j = i + 1; j < grp.length; j++) {
          const k = pairKey(grp[i], grp[j]);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      }
    }

    const items = Array.from(counts.entries()).map(([k, n]) => ({ k, n }));
    items.sort((a, b) => b.n - a.n || a.k.localeCompare(b.k));

    const max = items.length ? items[0].n : 0;
    const avg = items.length ? items.reduce((s, x) => s + x.n, 0) / items.length : 0;

    const top = items.slice(0, 12).map((x) => {
      const [a, b] = x.k.split("|");
      return {
        aName: playerNameById.get(a) ?? a,
        bName: playerNameById.get(b) ?? b,
        n: x.n,
      };
    });

    return { max, avg, top, totalPairsTracked: items.length };
  }, [groups, membersByGroup, playerNameById]);

  async function clearRoundGroups(roundId: string) {
    const delM = await supabase.from("round_group_players").delete().eq("round_id", roundId);
    if (delM.error) throw delM.error;

    const delG = await supabase.from("round_groups").delete().eq("round_id", roundId);
    if (delG.error) throw delG.error;
  }

  async function persistRoundGroups(roundId: string, gen: string[][], note: string) {
    await clearRoundGroups(roundId);

    const groupRows = gen.map((_, i) => ({
      round_id: roundId,
      group_no: i + 1,
      start_hole: 1,
      notes: note,
    }));

    const { data: insertedGroups, error: insGErr } = await supabase.from("round_groups").insert(groupRows).select("id,group_no");
    if (insGErr) throw insGErr;

    const idByNo = new Map<number, string>();
    for (const g of insertedGroups ?? []) idByNo.set((g as any).group_no, (g as any).id);

    const memberRows: any[] = [];
    gen.forEach((grp, i) => {
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

  async function fetchPastGroupsUpTo(roundIds: string[]) {
    if (!roundIds.length) return [];
    const { data, error } = await supabase.from("round_group_players").select("round_id,group_id,player_id").in("round_id", roundIds);
    if (error) throw error;

    const byRoundGroup = new Map<string, string[]>();
    for (const row of data ?? []) {
      const k = `${String((row as any).round_id)}|${String((row as any).group_id)}`;
      if (!byRoundGroup.has(k)) byRoundGroup.set(k, []);
      byRoundGroup.get(k)!.push(String((row as any).player_id));
    }

    return Array.from(byRoundGroup.values());
  }

  async function penultimateHasAnyScores(roundId: string) {
    const { data, error } = await supabase.from("scores").select("round_id").eq("round_id", roundId).limit(1);
    if (error) throw error;
    return (data ?? []).length > 0;
  }

  async function ensureRoundPlayers(roundId: string, playerIds: string[]) {
    const ids = Array.from(new Set(playerIds)).filter(Boolean);
    if (!ids.length) return;

    const { data: existing, error: exErr } = await supabase
      .from("round_players")
      .select("round_id,player_id,playing,playing_handicap,tee")
      .eq("round_id", roundId)
      .in("player_id", ids);

    if (exErr) throw exErr;

    const have = new Set<string>((existing ?? []).map((r: any) => String(r.player_id)));
    const missing = ids.filter((pid) => !have.has(pid));
    if (!missing.length) return;

    const rows = missing.map((pid) => ({
      round_id: roundId,
      player_id: pid,
      playing: true,
      playing_handicap: playerHcpById.get(pid) ?? 0,
      tee: playerGenderById.get(pid) ?? "M",
    }));

    const { error: insErr } = await supabase.from("round_players").insert(rows);
    if (insErr) throw insErr;
  }

  function playerIdsForRound(roundId: string) {
    const rp = roundPlayersByRound.get(roundId) ?? [];
    const playing = rp.filter((x) => x.playing === true).map((x) => x.player_id);
    if (playing.length > 0) return playing;
    return players.map((p) => p.id);
  }

  async function computeTotalsToDate(tourRounds: RoundRow[], upToRoundIds: string[], playerIds: string[]) {
    const eligibleRounds = tourRounds.filter((r) => upToRoundIds.includes(r.id) && !!r.course_id);
    const totals = new Map<string, number>();
    for (const pid of playerIds) totals.set(pid, 0);
    if (!eligibleRounds.length) return totals;

    const courseIds = Array.from(new Set(eligibleRounds.map((r) => r.course_id as string)));

    const { data: parsData, error: pErr } = await supabase
      .from("pars")
      .select("course_id,tee,hole_number,par,stroke_index")
      .in("course_id", courseIds);
    if (pErr) throw pErr;

    const parsByCourseTeeHole = new Map<string, Map<Tee, Map<number, { par: number; si: number }>>>();
    for (const row of parsData ?? []) {
      const cid = String((row as any).course_id);
      const tee = normalizeTee((row as any).tee);
      const hole = Number((row as any).hole_number);
      const par = Number((row as any).par);
      const si = Number((row as any).stroke_index);

      if (!parsByCourseTeeHole.has(cid)) parsByCourseTeeHole.set(cid, new Map());
      const byTee = parsByCourseTeeHole.get(cid)!;
      if (!byTee.has(tee)) byTee.set(tee, new Map());
      byTee.get(tee)!.set(hole, { par, si });
    }

    const roundIds = eligibleRounds.map((r) => r.id);

    const { data: rpData, error: rpErr } = await supabase
      .from("round_players")
      .select("round_id,player_id,playing_handicap,tee")
      .in("round_id", roundIds)
      .in("player_id", playerIds);
    if (rpErr) throw rpErr;

    const hcpByRoundPlayer = new Map<string, number>();
    const teeByRoundPlayer = new Map<string, Tee>();
    for (const rp of rpData ?? []) {
      const rid = String((rp as any).round_id);
      const pid = String((rp as any).player_id);
      const h = Number((rp as any).playing_handicap);
      if (Number.isFinite(h)) hcpByRoundPlayer.set(`${rid}|${pid}`, h);
      teeByRoundPlayer.set(`${rid}|${pid}`, normalizeTee((rp as any).tee));
    }

    const { data: scoresData, error: sErr } = await supabase
      .from("scores")
      .select("round_id,player_id,hole_number,strokes,pickup")
      .in("round_id", roundIds)
      .in("player_id", playerIds);
    if (sErr) throw sErr;

    const courseByRound = new Map<string, string>();
    for (const r of eligibleRounds) courseByRound.set(r.id, String(r.course_id));

    const scoresByKey = new Map<string, ScoreRow>();
    for (const sc of scoresData ?? []) {
      const key = `${String((sc as any).round_id)}|${String((sc as any).player_id)}|${Number((sc as any).hole_number)}`;
      scoresByKey.set(key, sc as any);
    }

    for (const r of eligibleRounds) {
      const rid = r.id;
      const cid = courseByRound.get(rid);
      if (!cid) continue;

      for (const pid of playerIds) {
        let sum = totals.get(pid) ?? 0;

        const hcp = hcpByRoundPlayer.get(`${rid}|${pid}`) ?? (playerHcpById.get(pid) ?? 0);
        const tee = teeByRoundPlayer.get(`${rid}|${pid}`) ?? (playerGenderById.get(pid) ?? "M");

        const parsMap =
          parsByCourseTeeHole.get(cid)?.get(tee) ??
          parsByCourseTeeHole.get(cid)?.get("M") ??
          parsByCourseTeeHole.get(cid)?.get("F");
        if (!parsMap) continue;

        for (let hole = 1; hole <= 18; hole++) {
          const pr = parsMap.get(hole);
          if (!pr) continue;

          const sc = scoresByKey.get(`${rid}|${pid}|${hole}`);
          if (!sc) continue;

          const raw = rawScoreFor(sc.strokes, sc.pickup);

          const pts = netStablefordPointsForHole({
            rawScore: raw,
            par: pr.par,
            strokeIndex: pr.si,
            playingHandicap: hcp,
          });

          sum += pts;
        }

        totals.set(pid, sum);
      }
    }

    return totals;
  }

  async function onGenerateJapanTourAllAtOnce(sorted: RoundRow[]) {
    const roundsByNo = new Map<number, RoundRow>();
    for (const r of sorted) if (typeof r.round_no === "number") roundsByNo.set(r.round_no, r);

    if (sorted.length !== 7) throw new Error("Japan generator expects exactly 7 rounds for this tour.");
    for (let n = 1; n <= 7; n++) if (!roundsByNo.get(n)) throw new Error("Japan generator requires round_no set for all rounds 1..7.");

    const usedMixedM = new Set<string>();
    const usedMixedF = new Set<string>();
    const generatedRoundIds: string[] = [];

    // Round 1
    {
      const r1 = roundsByNo.get(1)!;
      const ids = playerIdsForRound(r1.id);
      await ensureRoundPlayers(r1.id, ids);
      const gen = generateRound1PreferPairs(ids, tourPairs);
      await persistRoundGroups(r1.id, gen, "Auto: Japan Round 1 (prefer tour pairs)");
      generatedRoundIds.push(r1.id);
    }

    // Rounds 2..6
    for (const rn of [2, 3, 4, 5, 6]) {
      const rr = roundsByNo.get(rn)!;
      const ids = playerIdsForRound(rr.id);
      await ensureRoundPlayers(rr.id, ids);

      const pastGroups = await fetchPastGroupsUpTo(generatedRoundIds);

      if (rn === 2 || rn === 4 || rn === 6) {
        const res = generateJapanR246(ids, playerGenderById, pastGroups, usedMixedM, usedMixedF);
        await persistRoundGroups(
          rr.id,
          res.groups,
          `Auto: Japan Round ${rn} (2 all-M, 2 all-F, 1 mixed 2M2F)${res.warning ? " · WARN: " + res.warning : ""}`
        );
        generatedRoundIds.push(rr.id);
        continue;
      }

      if (rn === 3 || rn === 5) {
        const males = ids.filter((pid) => (playerGenderById.get(pid) ?? "M") === "M");
        const females = ids.filter((pid) => (playerGenderById.get(pid) ?? "M") === "F");

        // Prefer 2M2F generator; fall back if structure doesn't fit.
        if (males.length === females.length) {
          const gen = generateMixed2M2F_Fair(males, females, pastGroups);
          await persistRoundGroups(rr.id, gen, `Auto: Japan Round ${rn} (all groups 2M2F; fair mix)`);
        } else {
          const genFallback = generateFairMix(ids, pastGroups);
          await persistRoundGroups(rr.id, genFallback, `Auto: Japan Round ${rn} (fallback fair mix; could not enforce 2M2F)`);
        }

        generatedRoundIds.push(rr.id);
        continue;
      }
    }

    // Round 7 seeded by leaderboard to date (rounds 1..6), BEST in final group
    {
      const r7 = roundsByNo.get(7)!;
      const ids = playerIdsForRound(r7.id);
      await ensureRoundPlayers(r7.id, ids);

      const upToIds = [1, 2, 3, 4, 5, 6].map((n) => roundsByNo.get(n)!.id);
      const totals = await computeTotalsToDate(sorted, upToIds, ids);

      const seeded = generateJapanRound7Seeded(ids, playerGenderById, totals);
      if (!seeded) {
        const pastGroups = await fetchPastGroupsUpTo(generatedRoundIds);
        const genFallback = generateFairMix(ids, pastGroups);
        await persistRoundGroups(r7.id, genFallback, "Auto: Japan Round 7 (fallback fair mix; could not enforce 2M2F seeding)");
      } else {
        await persistRoundGroups(r7.id, seeded, "Auto: Japan Round 7 (2M2F; seeded by leaderboard; BEST in final group)");
      }
    }

    setInfoMsg("Generated Japan Tour tee-time groups for rounds 1–7.");
  }

  async function onGenerateTourAllAtOnce() {
    setBusy(true);
    setErrorMsg("");
    setInfoMsg("");

    try {
      const sorted = [...rounds].sort((a, b) => {
        const an = a.round_no ?? 999999;
        const bn = b.round_no ?? 999999;
        if (an !== bn) return an - bn;
        return (a.created_at ?? "").localeCompare(b.created_at ?? "");
      });

      if (sorted.length === 0) {
        setInfoMsg("No rounds in tour.");
        return;
      }

      if (tourId === JAPAN_TOUR_ID) {
        await onGenerateJapanTourAllAtOnce(sorted);
        await loadAll();
        return;
      }

      // ---- existing default behaviour ----
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const penultimate = sorted.length >= 2 ? sorted[sorted.length - 2] : null;

      const generatedRoundIds: string[] = [];

      {
        const ids = playerIdsForRound(first.id);
        await ensureRoundPlayers(first.id, ids);
        const gen = generateRound1PreferPairs(ids, tourPairs);
        await persistRoundGroups(first.id, gen, "Auto: Round 1 (prefer tour pairs)");
        generatedRoundIds.push(first.id);
      }

      for (let i = 1; i < sorted.length - 1; i++) {
        const r = sorted[i];
        const ids = playerIdsForRound(r.id);
        await ensureRoundPlayers(r.id, ids);
        const pastGroups = await fetchPastGroupsUpTo(generatedRoundIds);
        const gen = generateFairMix(ids, pastGroups);
        await persistRoundGroups(r.id, gen, "Auto: Fair mix (non-final)");
        generatedRoundIds.push(r.id);
      }

      if (!penultimate) {
        setInfoMsg("Generated Round 1 only (tour has a single round).");
      } else {
        const ready = await penultimateHasAnyScores(penultimate.id);
        if (!ready) {
          setInfoMsg("Generated Round 1 + middle rounds. Final round NOT generated yet (no scores found for penultimate round).");
        } else {
          const finalIds = playerIdsForRound(last.id);
          await ensureRoundPlayers(last.id, finalIds);

          const upToIds = sorted.slice(0, sorted.length - 1).map((r) => r.id);
          const totals = await computeTotalsToDate(sorted, upToIds, finalIds);

          const ordered = [...finalIds].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0) || a.localeCompare(b));

          // simple seeded, best later groups
          const sizes = ordered.length % 4 === 0 ? Array(ordered.length / 4).fill(4) : [4];
          const groupsFinal: string[][] = sizes.map(() => []);
          let idx = 0;
          for (let gi = groupsFinal.length - 1; gi >= 0; gi--) {
            const target = sizes[gi];
            for (let k = 0; k < target; k++) {
              const pid = ordered[idx++];
              if (!pid) break;
              groupsFinal[gi].push(pid);
            }
          }

          await persistRoundGroups(last.id, groupsFinal, "Auto: Final round (leaderboard-seeded)");
          setInfoMsg("Generated Round 1 + middle rounds + Final round.");
        }
      }

      await loadAll();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to generate tee-time groups.");
    } finally {
      setBusy(false);
    }
  }

  async function saveRoundNo(roundId: string) {
    const draft = (roundNoDraft[roundId] ?? "").trim();

    let nextNo: number | null = null;
    if (draft !== "") {
      const n = Number(draft);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        setRoundNoErr((prev) => ({ ...prev, [roundId]: "Round # must be a positive whole number (or blank)." }));
        return;
      }
      nextNo = n;
    }

    setRoundNoErr((prev) => ({ ...prev, [roundId]: "" }));
    setRoundNoSaving((prev) => ({ ...prev, [roundId]: true }));

    const { error } = await supabase.from("rounds").update({ round_no: nextNo }).eq("id", roundId);

    if (error) {
      setRoundNoErr((prev) => ({ ...prev, [roundId]: error.message }));
      setRoundNoSaving((prev) => ({ ...prev, [roundId]: false }));
      return;
    }

    setRounds((prev) => prev.map((r) => (r.id === roundId ? { ...r, round_no: nextNo } : r)));
    setRoundNoSaving((prev) => ({ ...prev, [roundId]: false }));
  }

  const sortedRounds = useMemo(() => {
    return [...rounds].sort((a, b) => {
      const an = a.round_no ?? 999999;
      const bn = b.round_no ?? 999999;
      if (an !== bn) return an - bn;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });
  }, [rounds]);

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl p-4">
        <div className="text-sm opacity-70">Loading…</div>
      </main>
    );
  }

  if (errorMsg) {
    return (
      <main className="mx-auto max-w-5xl p-4 space-y-2">
        <div className="font-bold text-red-600">Error</div>
        <div>{errorMsg}</div>
        <div className="text-sm">
          <Link className="underline" href="/tours">
            Back to tours
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-4 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Tee-time groupings</h1>
        <div className="text-sm text-gray-600">{tour?.name ?? tourId}</div>
        <div className="mt-1 text-xs text-gray-500">
          This page manages <span className="font-medium">round_groups</span> (tee-time groupings). Pairs/Teams for competitions live on the separate “Pairs &amp; Teams” page.
        </div>
      </header>

      <div className="flex items-start justify-between gap-4">
        <div className="text-sm text-gray-600">
          Generate and review groupings for each round.
          {tourId === JAPAN_TOUR_ID ? (
            <div className="mt-1 text-xs text-gray-500">
              Japan Tour: custom 7-round rules are used when you generate.
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-end gap-2">
          <button onClick={loadAll} disabled={busy} className="rounded-xl border px-3 py-2 text-sm disabled:opacity-50">
            Refresh
          </button>

          <button
            onClick={onGenerateTourAllAtOnce}
            disabled={busy || rounds.length === 0}
            className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {busy ? "Generating…" : "Generate tee-time groups for entire tour"}
          </button>
        </div>
      </div>

      {infoMsg ? <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{infoMsg}</div> : null}
      {pairWarn ? <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{pairWarn}</div> : null}

      <section className="rounded-2xl border p-4 space-y-2 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Fairness summary (from saved tee-time groups)</h2>
          <div className="text-sm opacity-70">Pairs tracked: {fairness.totalPairsTracked}</div>
        </div>

        <div className="text-sm opacity-80">
          Max times any pair has played together: <span className="font-semibold">{fairness.max}</span> · Average pair repeats:{" "}
          <span className="font-semibold">{fairness.avg.toFixed(2)}</span>
        </div>

        {fairness.top.length === 0 ? (
          <div className="text-sm opacity-70">No group data yet.</div>
        ) : (
          <div className="mt-2 space-y-1 text-sm">
            <div className="font-medium">Most repeated pairs</div>
            {fairness.top.map((x, idx) => (
              <div key={idx} className="flex justify-between gap-3">
                <div className="truncate">
                  {x.aName} + {x.bName}
                </div>
                <div className="opacity-70 whitespace-nowrap">{x.n}x</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Rounds</h2>
          <div className="text-sm opacity-70">Total rounds: {sortedRounds.length}</div>
        </div>

        {sortedRounds.length === 0 ? (
          <div className="rounded-2xl border p-4 text-sm opacity-70 bg-white">No rounds in this tour yet.</div>
        ) : (
          <div className="space-y-3">
            {sortedRounds.map((r) => {
              const rGroups = groupsByRound.get(r.id) ?? [];
              const label = roundLabelFromGroups(rGroups);

              const draft = roundNoDraft[r.id] ?? (r.round_no === null ? "" : String(r.round_no));
              const saving = roundNoSaving[r.id] === true;
              const err = roundNoErr[r.id] ?? "";

              return (
                <div key={r.id} className="rounded-2xl border p-4 bg-white space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-lg font-semibold truncate">
                          {r.round_no ? `Round ${r.round_no}: ` : ""}
                          {r.name}
                        </div>
                        {label ? <span className="text-xs rounded-full border px-2 py-0.5 opacity-80">{label}</span> : null}
                      </div>

                      <div className="text-xs opacity-60">{r.created_at ? <>Created: {fmtTs(r.created_at)}</> : null}</div>

                      <div className="mt-3 rounded-lg border bg-yellow-50 p-2">
                        <div className="text-xs font-semibold">Round number (sorting key)</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                          <input
                            inputMode="numeric"
                            className="w-24 rounded-md border px-2 py-1 bg-white"
                            value={draft}
                            onChange={(e) => {
                              setRoundNoDraft((prev) => ({ ...prev, [r.id]: e.target.value }));
                              setRoundNoErr((prev) => ({ ...prev, [r.id]: "" }));
                            }}
                            placeholder="(blank)"
                          />
                          <button
                            type="button"
                            onClick={() => saveRoundNo(r.id)}
                            disabled={saving}
                            className="rounded-md bg-black px-3 py-1 text-white disabled:opacity-50"
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>

                          {err ? <span className="text-xs text-red-700">{err}</span> : <span className="text-xs opacity-70">Blank clears</span>}
                        </div>
                      </div>
                    </div>

                    <div className="text-sm opacity-70 whitespace-nowrap">Groups: {rGroups.length}</div>
                  </div>

                  {rGroups.length === 0 ? (
                    <div className="text-sm opacity-70">No tee-time groups saved for this round.</div>
                  ) : (
                    <div className="space-y-3">
                      {rGroups.map((g) => {
                        const mem = membersByGroup.get(g.id) ?? [];
                        return (
                          <div key={g.id} className="rounded-xl border p-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-semibold">Group {g.group_no}</div>
                                <div className="text-xs opacity-60">
                                  Start hole: {g.start_hole} · Tee time: {g.tee_time ?? "—"}
                                  {g.notes ? <> · {g.notes}</> : null}
                                </div>
                              </div>
                              <div className="text-xs opacity-60 whitespace-nowrap">Members: {mem.length}</div>
                            </div>

                            <div className="mt-2 space-y-1 text-sm">
                              {mem.map((m) => (
                                <div key={m.id} className="flex justify-between gap-3">
                                  <div className="truncate">{playerNameById.get(m.player_id) ?? "(unknown player)"}</div>
                                  <div className="opacity-60 whitespace-nowrap">Seat {m.seat ?? "—"}</div>
                                </div>
                              ))}
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
        )}
      </section>
    </main>
  );
}
