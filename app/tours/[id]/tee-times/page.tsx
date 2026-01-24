// app/tours/[id]/tee-times/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

type Tee = "M" | "F";

type Tour = { id: string; name: string };

type RoundRow = {
  id: string;
  tour_id: string;
  name: string;
  round_no: number | null;
  course_id: string | null;
  created_at?: string | null;
};

// ✅ PlayerRow includes gender (used to set round_players.tee + tee-based pars)
type PlayerRow = { id: string; name: string; gender: Tee; start_handicap: number | null };

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean | null;
  playing_handicap: number | null;
  tee: Tee; // ✅ must be present / non-null in DB
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

type Pair = { a: string; b: string };

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function fmtTs(ts?: string | null) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString();
}

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function buildGroupSizes(nPlayers: number): number[] {
  const sizes: number[] = [];
  if (nPlayers <= 0) return sizes;

  const mod = nPlayers % 4;
  if (mod === 0) {
    for (let i = 0; i < nPlayers / 4; i++) sizes.push(4);
    return sizes;
  }
  if (mod === 3) {
    sizes.push(3);
    const remaining = nPlayers - 3;
    for (let i = 0; i < remaining / 4; i++) sizes.push(4);
    return sizes;
  }
  if (mod === 2) {
    sizes.push(3, 3);
    const remaining = nPlayers - 6;
    for (let i = 0; i < remaining / 4; i++) sizes.push(4);
    return sizes;
  }
  if (nPlayers >= 9) {
    sizes.push(3, 3, 3);
    const remaining = nPlayers - 9;
    for (let i = 0; i < remaining / 4; i++) sizes.push(4);
    return sizes;
  }
  // fallback
  sizes.push(3);
  let rem = nPlayers - 3;
  while (rem >= 4) {
    sizes.push(4);
    rem -= 4;
  }
  if (rem > 0) sizes.push(rem);
  return sizes;
}

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function coPlayCountMatrix(pastGroups: string[][]): Map<string, number> {
  const m = new Map<string, number>();
  for (const grp of pastGroups) {
    for (let i = 0; i < grp.length; i++) {
      for (let j = i + 1; j < grp.length; j++) {
        const key = pairKey(grp[i], grp[j]);
        m.set(key, (m.get(key) ?? 0) + 1);
      }
    }
  }
  return m;
}

function groupScore(group: string[], candidate: string, matrix: Map<string, number>) {
  let s = 0;
  for (const p of group) s += matrix.get(pairKey(p, candidate)) ?? 0;
  return s;
}

function generateFairMix(playerIds: string[], pastGroups: string[][]) {
  const sizes = buildGroupSizes(playerIds.length);
  const matrix = coPlayCountMatrix(pastGroups);

  const remaining = new Set(playerIds);
  const groups: string[][] = [];

  for (const size of sizes) {
    const seed = shuffle(Array.from(remaining))[0];
    if (!seed) break;

    const g: string[] = [seed];
    remaining.delete(seed);

    while (g.length < size) {
      const candidates = Array.from(remaining);
      if (candidates.length === 0) break;

      let best = candidates[0];
      let bestScore = groupScore(g, best, matrix);

      for (let i = 1; i < candidates.length; i++) {
        const c = candidates[i];
        const sc = groupScore(g, c, matrix);
        if (sc < bestScore) {
          bestScore = sc;
          best = c;
        }
      }

      g.push(best);
      remaining.delete(best);
    }

    groups.push(g);
  }

  return groups;
}

function generateRound1PreferPairs(playerIds: string[], pairs: Pair[]) {
  const sizes = buildGroupSizes(playerIds.length);
  const unassigned = new Set(playerIds);
  const validPairs = pairs.filter((p) => unassigned.has(p.a) && unassigned.has(p.b));

  const groups: string[][] = [];
  while (groups.length < sizes.length) groups.push([]);

  // Fill by pairs first
  for (const pr of validPairs) {
    if (!unassigned.has(pr.a) || !unassigned.has(pr.b)) continue;

    for (let gi = 0; gi < groups.length; gi++) {
      if (groups[gi].length + 2 <= sizes[gi]) {
        groups[gi].push(pr.a, pr.b);
        unassigned.delete(pr.a);
        unassigned.delete(pr.b);
        break;
      }
    }
  }

  // Fill remaining randomly
  const remaining = shuffle(Array.from(unassigned));
  let k = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const target = sizes[gi];
    while (groups[gi].length < target && k < remaining.length) {
      groups[gi].push(remaining[k++]);
    }
  }

  return groups;
}

function rawScoreFor(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  return String(strokes);
}

function labelFromNotes(notes?: string | null) {
  const n = (notes ?? "").toLowerCase();
  if (!n) return "";
  if (n.includes("round 1")) return "Round 1";
  if (n.includes("japan")) return "Japan rules";
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
    ["Japan rules", 6],
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

  // Tour pairs (optional; used to seed Round 1)
  const [tourPairs, setTourPairs] = useState<Pair[]>([]);
  const [pairWarn, setPairWarn] = useState("");

  // Tiny round_no editor state
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

  // ✅ “tour snapshot” handicap map (from tour_players)
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

  // ✅ For a given (round,player) get the *per-round* handicap if present, else tour snapshot.
  function hcpForRoundPlayer(roundId: string, playerId: string) {
    const rp = (roundPlayersByRound.get(roundId) ?? []).find((x) => x.player_id === playerId);
    const h = rp?.playing_handicap;
    if (Number.isFinite(Number(h))) return Number(h);
    return playerHcpById.get(playerId) ?? 0;
  }

  // ✅ For a given (round,player) choose tee:
  // prefer round_players.tee; else player gender; else 'M'
  function teeForRoundPlayer(roundId: string, playerId: string): Tee {
    const rp = (roundPlayersByRound.get(roundId) ?? []).find((x) => x.player_id === playerId);
    if (rp?.tee) return normalizeTee(rp.tee);
    return playerGenderById.get(playerId) ?? "M";
  }

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

      // ✅ players in tour from tour_players join (include gender)
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

      // Tour pairs (optional; may be blocked by RLS if not logged in)
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

    const { data: insertedGroups, error: insGErr } = await supabase
      .from("round_groups")
      .insert(groupRows)
      .select("id,group_no");
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
    const { data, error } = await supabase
      .from("round_group_players")
      .select("round_id,group_id,player_id")
      .in("round_id", roundIds);
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

  // ✅ ensure round_players rows exist (and set tee + handicap on insert only)
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
      tee: playerGenderById.get(pid) ?? "M", // ✅ prevents NULL tee
    }));

    const { error: insErr } = await supabase.from("round_players").insert(rows);
    if (insErr) throw insErr;
  }

  async function computeLeaderboardToDate(tourRounds: RoundRow[], upToRoundIds: string[], playerIds: string[]) {
    const eligibleRounds = tourRounds.filter((r) => upToRoundIds.includes(r.id) && !!r.course_id);
    if (!eligibleRounds.length) return playerIds;

    const courseIds = Array.from(new Set(eligibleRounds.map((r) => r.course_id as string)));

    // ✅ Tee-based pars
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

    // ✅ Need both handicap + tee
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

      const t = normalizeTee((rp as any).tee);
      teeByRoundPlayer.set(`${rid}|${pid}`, t);
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

    const totals = new Map<string, number>();
    for (const pid of playerIds) totals.set(pid, 0);

    for (const r of eligibleRounds) {
      const rid = r.id;
      const cid = courseByRound.get(rid);
      if (!cid) continue;

      for (const pid of playerIds) {
        let sum = totals.get(pid) ?? 0;

        const hcp = hcpByRoundPlayer.get(`${rid}|${pid}`) ?? (playerHcpById.get(pid) ?? 0);

        // tee preference: round_players.tee -> player gender -> M
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

    return [...playerIds].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
  }

  function playerIdsForRound(roundId: string) {
    const rp = roundPlayersByRound.get(roundId) ?? [];
    const playing = rp.filter((x) => x.playing === true).map((x) => x.player_id);

    if (playing.length > 0) return playing;
    return players.map((p) => p.id);
  }

  // -------------------------
  // JAPAN TOUR 7-ROUND RULES
  // -------------------------

  function isJapanTourName(name: string | null | undefined) {
    const s = String(name ?? "").toLowerCase();
    return s.includes("japan");
  }

  function splitByGender(ids: string[]) {
    const ms: string[] = [];
    const fs: string[] = [];
    for (const pid of ids) {
      const g = playerGenderById.get(pid) ?? "M";
      (g === "F" ? fs : ms).push(pid);
    }
    return { ms, fs };
  }

  function buildGroups2M2F(ids: string[], pastGroups: string[][]) {
    const { ms, fs } = splitByGender(ids);
    if (ms.length % 2 !== 0 || fs.length % 2 !== 0) return null;
    if (ms.length / 2 !== fs.length / 2) return null; // expect same # groups

    const gCount = ms.length / 2;
    const matrix = coPlayCountMatrix(pastGroups);

    const mRem = new Set(ms);
    const fRem = new Set(fs);

    const groups: string[][] = [];

    // Greedy: build each group by picking (M,M,F,F) with minimal repeat score
    for (let gi = 0; gi < gCount; gi++) {
      const g: string[] = [];

      // pick first male seed
      const mSeed = shuffle(Array.from(mRem))[0];
      if (!mSeed) return null;
      g.push(mSeed);
      mRem.delete(mSeed);

      // pick second male minimizing repeats with current group
      {
        const candidates = Array.from(mRem);
        if (candidates.length === 0) return null;
        let best = candidates[0];
        let bestScore = groupScore(g, best, matrix);
        for (let i = 1; i < candidates.length; i++) {
          const c = candidates[i];
          const sc = groupScore(g, c, matrix);
          if (sc < bestScore) {
            bestScore = sc;
            best = c;
          }
        }
        g.push(best);
        mRem.delete(best);
      }

      // pick first female minimizing repeats
      {
        const candidates = Array.from(fRem);
        if (candidates.length === 0) return null;
        let best = candidates[0];
        let bestScore = groupScore(g, best, matrix);
        for (let i = 1; i < candidates.length; i++) {
          const c = candidates[i];
          const sc = groupScore(g, c, matrix);
          if (sc < bestScore) {
            bestScore = sc;
            best = c;
          }
        }
        g.push(best);
        fRem.delete(best);
      }

      // pick second female minimizing repeats
      {
        const candidates = Array.from(fRem);
        if (candidates.length === 0) return null;
        let best = candidates[0];
        let bestScore = groupScore(g, best, matrix);
        for (let i = 1; i < candidates.length; i++) {
          const c = candidates[i];
          const sc = groupScore(g, c, matrix);
          if (sc < bestScore) {
            bestScore = sc;
            best = c;
          }
        }
        g.push(best);
        fRem.delete(best);
      }

      groups.push(g);
    }

    return groups;
  }

  function buildGroupsRound2_4_6(ids: string[], pastGroups: string[][], mixedUsedM: Set<string>, mixedUsedF: Set<string>) {
    // Intended for Japan Tour: 5 groups of 4 with 10M/10F
    const { ms, fs } = splitByGender(ids);
    if (ms.length !== fs.length) return null;
    if (ms.length % 2 !== 0) return null;

    const groupCount = ids.length / 4;
    if (!Number.isInteger(groupCount) || groupCount < 3) return null;

    // We want: 2 all-M groups, 2 all-F groups, 1 mixed 2M2F (when 5 groups)
    // If groupCount differs, we still create:
    // - 1 mixed group
    // - as many all-M/all-F groups as possible, then fill remaining with fair mix
    const matrix = coPlayCountMatrix(pastGroups);

    const mAvail = shuffle(ms);
    const fAvail = shuffle(fs);

    const pickTwo = (arr: string[], used: Set<string>) => {
      // pick two not in used if possible
      const notUsed = arr.filter((x) => !used.has(x));
      if (notUsed.length >= 2) return [notUsed[0], notUsed[1]];
      if (arr.length >= 2) return [arr[0], arr[1]];
      return null;
    };

    // Choose mixed group members with "no repeat mixed participation across rounds 2/4/6"
    const mMix = pickTwo(mAvail, mixedUsedM);
    const fMix = pickTwo(fAvail, mixedUsedF);
    if (!mMix || !fMix) return null;

    // Remove picked from pools
    const mPool = mAvail.filter((x) => x !== mMix[0] && x !== mMix[1]);
    const fPool = fAvail.filter((x) => x !== fMix[0] && x !== fMix[1]);

    // mark used (so next R2/4/6 mixed group rotates)
    mixedUsedM.add(mMix[0]);
    mixedUsedM.add(mMix[1]);
    mixedUsedF.add(fMix[0]);
    mixedUsedF.add(fMix[1]);

    const groupsOut: string[][] = [];

    // Add all-M groups first (target 2 if enough)
    while (groupsOut.length < groupCount && mPool.length >= 4 && groupsOut.filter((g) => g.every((p) => (playerGenderById.get(p) ?? "M") === "M")).length < 2) {
      groupsOut.push([mPool.shift()!, mPool.shift()!, mPool.shift()!, mPool.shift()!]);
    }

    // Add all-F groups (target 2 if enough)
    while (groupsOut.length < groupCount && fPool.length >= 4 && groupsOut.filter((g) => g.every((p) => (playerGenderById.get(p) ?? "M") === "F")).length < 2) {
      groupsOut.push([fPool.shift()!, fPool.shift()!, fPool.shift()!, fPool.shift()!]);
    }

    // Add the mixed group
    if (groupsOut.length < groupCount) {
      groupsOut.push([mMix[0], mMix[1], fMix[0], fMix[1]]);
    }

    // Fill remaining slots with a gender-aware fair mix if possible; else generic fair mix
    const remainingIds = [...mPool, ...fPool];
    const already = new Set(groupsOut.flat());
    const remaining = remainingIds.filter((x) => !already.has(x));

    // Try to make remaining groups as 2M2F where possible, using pastGroups matrix
    const needGroups = groupCount - groupsOut.length;
    if (needGroups > 0) {
      const candidate = buildGroups2M2F(remaining, pastGroups);
      if (candidate && candidate.length === needGroups) {
        groupsOut.push(...candidate);
      } else {
        // fallback to generic fair mix (respects group sizes)
        const fm = generateFairMix(remaining, pastGroups);
        groupsOut.push(...fm.slice(0, needGroups));
      }
    }

    // Light touch: within each group, reorder to minimize repeats (optional)
    for (let gi = 0; gi < groupsOut.length; gi++) {
      const g = groupsOut[gi];
      // sort by "how many repeats with others" (lower first)
      g.sort((a, b) => groupScore(g.filter((x) => x !== a), a, matrix) - groupScore(g.filter((x) => x !== b), b, matrix));
      groupsOut[gi] = g;
    }

    return groupsOut;
  }

  function buildFinalRound7Seeded(ids: string[], orderedDesc: string[]) {
    // Round 7: each group 2M2F; best players must be in FINAL group.
    const { ms, fs } = splitByGender(ids);

    const malesDesc = orderedDesc.filter((pid) => (playerGenderById.get(pid) ?? "M") === "M");
    const femalesDesc = orderedDesc.filter((pid) => (playerGenderById.get(pid) ?? "M") === "F");

    if (malesDesc.length < 2 || femalesDesc.length < 2) return null;
    if (malesDesc.length % 2 !== 0 || femalesDesc.length % 2 !== 0) return null;

    const groupCount = Math.min(malesDesc.length / 2, femalesDesc.length / 2);

    // To put BEST in last group: take WORST first.
    const malesWorstFirst = [...malesDesc].reverse();
    const femalesWorstFirst = [...femalesDesc].reverse();

    const groups: string[][] = [];
    for (let gi = 0; gi < groupCount; gi++) {
      const m1 = malesWorstFirst.shift();
      const m2 = malesWorstFirst.shift();
      const f1 = femalesWorstFirst.shift();
      const f2 = femalesWorstFirst.shift();
      if (!m1 || !m2 || !f1 || !f2) break;
      groups.push([m1, m2, f1, f2]);
    }

    return groups.length ? groups : null;
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

      const tourIsJapan = isJapanTourName(tour?.name);

      if (tourIsJapan && sorted.length !== 7) {
        setInfoMsg(`Japan rules expected 7 rounds, but found ${sorted.length}. Using standard generator.`);
      }

      const allPlayerIds = players.map((p) => p.id);

      // Track “mixed group participation” across rounds 2/4/6 (rule: no one repeats)
      const mixedUsedM = new Set<string>();
      const mixedUsedF = new Set<string>();

      const generatedRoundIds: string[] = [];

      // If not Japan: keep legacy behavior (pairs -> fair mix -> final seeded)
      if (!tourIsJapan || sorted.length !== 7) {
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const penultimate = sorted.length >= 2 ? sorted[sorted.length - 2] : null;

        // Round 1
        {
          const ids = playerIdsForRound(first.id);
          await ensureRoundPlayers(first.id, ids);
          const gen = generateRound1PreferPairs(ids, tourPairs);
          await persistRoundGroups(first.id, gen, "Auto: Round 1 (prefer tour pairs)");
          generatedRoundIds.push(first.id);
        }

        // Middle rounds
        for (let i = 1; i < sorted.length - 1; i++) {
          const r = sorted[i];
          const ids = playerIdsForRound(r.id);
          await ensureRoundPlayers(r.id, ids);

          const pastGroups = await fetchPastGroupsUpTo(generatedRoundIds);
          const gen = generateFairMix(ids, pastGroups);

          await persistRoundGroups(r.id, gen, "Auto: Fair mix (non-final)");
          generatedRoundIds.push(r.id);
        }

        // Final round
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
            const ordered = await computeLeaderboardToDate(sorted, upToIds, finalIds);

            // Legacy: best seeded into LAST groups (already does that)
            const sizes = buildGroupSizes(ordered.length);
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
        return;
      }

      // ---------------------------
      // JAPAN TOUR (7 rounds exact)
      // ---------------------------
      // Round mapping by round_no if present, else by order:
      const byNo = new Map<number, RoundRow>();
      for (const r of sorted) if (Number.isFinite(Number(r.round_no))) byNo.set(Number(r.round_no), r);

      const getRound = (n: number) => byNo.get(n) ?? sorted[n - 1];

      // R1: each pair stays together; 2 pairs per tee time (i.e. group size 4 of (pair,pair))
      {
        const r1 = getRound(1);
        const ids = playerIdsForRound(r1.id);
        await ensureRoundPlayers(r1.id, ids);
        const gen = generateRound1PreferPairs(ids, tourPairs);
        await persistRoundGroups(r1.id, gen, "Auto: Japan rules (Round 1: pairs together, 2 pairs per group)");
        generatedRoundIds.push(r1.id);
      }

      // R2, R4, R6: 2 all-M groups, 2 all-F groups, 1 mixed (2M2F); mixed participants cannot repeat across 2/4/6
      for (const n of [2, 4, 6]) {
        const r = getRound(n);
        const ids = playerIdsForRound(r.id);
        await ensureRoundPlayers(r.id, ids);

        const pastGroups = await fetchPastGroupsUpTo(generatedRoundIds);

        const gen = buildGroupsRound2_4_6(ids, pastGroups, mixedUsedM, mixedUsedF);
        if (!gen) {
          // fallback to fair mix if composition not possible
          const fallback = generateFairMix(ids, pastGroups);
          await persistRoundGroups(r.id, fallback, `Auto: Japan rules (Round ${n} fallback: fair mix)`);
        } else {
          await persistRoundGroups(r.id, gen, `Auto: Japan rules (Round ${n}: 2M groups, 2F groups, 1 mixed 2M2F)`);
        }

        generatedRoundIds.push(r.id);
      }

      // R3, R5: each group 2M2F (and fair mix overall)
      for (const n of [3, 5]) {
        const r = getRound(n);
        const ids = playerIdsForRound(r.id);
        await ensureRoundPlayers(r.id, ids);

        const pastGroups = await fetchPastGroupsUpTo(generatedRoundIds);

        const gen = buildGroups2M2F(ids, pastGroups);
        if (!gen) {
          const fallback = generateFairMix(ids, pastGroups);
          await persistRoundGroups(r.id, fallback, `Auto: Japan rules (Round ${n} fallback: fair mix)`);
        } else {
          await persistRoundGroups(r.id, gen, `Auto: Japan rules (Round ${n}: every group 2M2F)`);
        }

        generatedRoundIds.push(r.id);
      }

      // R7: each group 2M2F; seeded by leaderboard-to-date; BEST in FINAL group
      {
        const r7 = getRound(7);
        const ids = playerIdsForRound(r7.id);
        await ensureRoundPlayers(r7.id, ids);

        const upToIds = sorted
          .map((r) => r.id)
          .filter((rid) => rid !== r7.id);

        // If no prior scores, still create 2M2F fair mix
        const anyScores = await penultimateHasAnyScores(getRound(6).id);
        if (!anyScores) {
          const pastGroups = await fetchPastGroupsUpTo(generatedRoundIds);
          const gen = buildGroups2M2F(ids, pastGroups) ?? generateFairMix(ids, pastGroups);
          await persistRoundGroups(r7.id, gen, "Auto: Japan rules (Round 7 fallback: 2M2F fair mix; no leaderboard yet)");
        } else {
          const ordered = await computeLeaderboardToDate(sorted, upToIds, ids);
          const gen = buildFinalRound7Seeded(ids, ordered);
          if (!gen) {
            const pastGroups = await fetchPastGroupsUpTo(generatedRoundIds);
            const fallback = buildGroups2M2F(ids, pastGroups) ?? generateFairMix(ids, pastGroups);
            await persistRoundGroups(r7.id, fallback, "Auto: Japan rules (Round 7 fallback: 2M2F fair mix)");
          } else {
            await persistRoundGroups(r7.id, gen, "Auto: Japan rules (Round 7: leaderboard-seeded; best in final group)");
          }
        }

        generatedRoundIds.push(r7.id);
      }

      setInfoMsg("Generated Japan Tour tee-time groups for Rounds 1–7.");
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

  if (!tourId || !isLikelyUuid(tourId)) {
    return (
      <main className="mx-auto max-w-5xl p-4">
        <div className="rounded-xl border p-3 text-sm">
          Missing or invalid tour id in route.
          <div className="mt-2">
            <Link className="underline" href="/tours">
              Back to tours
            </Link>
          </div>
        </div>
      </main>
    );
  }

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
          This page manages <span className="font-medium">round_groups</span> (tee-time groupings). Pairs/Teams for
          competitions live on the separate “Pairs &amp; Teams” page.
        </div>
      </header>

      <div className="flex items-start justify-between gap-4">
        <div className="text-sm text-gray-600">Generate and review groupings for each round.</div>

        <div className="flex flex-col items-end gap-2">
          <button onClick={loadAll} disabled={busy} className="rounded-xl border px-3 py-2 text-sm disabled:opacity-50">
            Refresh
          </button>

          <button
            onClick={onGenerateTourAllAtOnce}
            disabled={busy || rounds.length === 0}
            className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            title="Japan tours (name contains 'Japan') use 7-round Japan rules; others use pairs->fairmix->final seeded"
          >
            {busy ? "Generating…" : "Generate tee-time groups for entire tour"}
          </button>
        </div>
      </div>

      {infoMsg ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{infoMsg}</div>
      ) : null}
      {pairWarn ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{pairWarn}</div>
      ) : null}

      <section className="rounded-2xl border p-4 space-y-2 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Fairness summary (from saved tee-time groups)</h2>
          <div className="text-sm opacity-70">Pairs tracked: {fairness.totalPairsTracked}</div>
        </div>

        <div className="text-sm opacity-80">
          Max times any pair has played together: <span className="font-semibold">{fairness.max}</span>
          {" · "}
          Average pair repeats: <span className="font-semibold">{fairness.avg.toFixed(2)}</span>
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

                      <div className="mt-1 text-sm">
                        <Link className="underline" href={`/rounds/${r.id}`}>
                          Open round
                        </Link>
                        {" · "}
                        <Link className="underline" href={`/rounds/${r.id}/groups`}>
                          Open round groups
                        </Link>
                      </div>

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
                            title="Save round number"
                          >
                            {saving ? "Saving…" : "Save"}
                          </button>

                          {err ? (
                            <span className="text-xs text-red-700">{err}</span>
                          ) : (
                            <span className="text-xs opacity-70">Blank clears</span>
                          )}
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
                              {mem.map((m) => {
                                const name = playerNameById.get(m.player_id) ?? "(unknown player)";
                                const tee = teeForRoundPlayer(g.round_id, m.player_id);
                                const hcp = hcpForRoundPlayer(g.round_id, m.player_id);

                                return (
                                  <div key={m.id} className="flex justify-between gap-3">
                                    <div className="truncate">
                                      {name}{" "}
                                      <span className="text-xs opacity-60">
                                        ({tee} · HCP {hcp})
                                      </span>
                                    </div>
                                    <div className="opacity-60 whitespace-nowrap">Seat {m.seat ?? "—"}</div>
                                  </div>
                                );
                              })}
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
