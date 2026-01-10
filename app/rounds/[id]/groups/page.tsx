"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

type Round = {
  id: string;
  name: string | null; // allow null
  tour_id?: string | null;
  course_id: string | null;
  created_at?: string | null; // NEW
  courses?: { name: string } | null;
};

type PlayerBase = { id: string; name: string; start_handicap?: number | null };

type RoundPlayer = {
  round_id: string;
  player_id: string;
  playing: boolean | null;
  playing_handicap: number | null;
};

type ParRow = { course_id: string; hole_number: number; par: number; stroke_index: number };

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
  tee_time: string | null;
  start_hole: number;
  notes: string | null;
};

type RoundGroupPlayer = {
  id: string;
  round_id: string;
  group_id: string;
  player_id: string;
  seat: number | null;
};

type Pair = { a: string; b: string }; // player ids

function shuffle<T>(arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
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
  // mod === 1
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

function generateRound1PreferPairs(playerIds: string[], pairs: Pair[]) {
  const sizes = buildGroupSizes(playerIds.length);
  const unassigned = new Set(playerIds);

  const validPairs = pairs.filter((p) => unassigned.has(p.a) && unassigned.has(p.b));

  const groups: string[][] = [];
  while (groups.length < sizes.length) groups.push([]);

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

function generateFinalSeeded(leaderboardDesc: string[], totalPlayers: number) {
  const sizes = buildGroupSizes(totalPlayers);
  const groups: string[][] = sizes.map(() => []);
  let idx = 0;

  for (let gi = groups.length - 1; gi >= 0; gi--) {
    const target = sizes[gi];
    for (let k = 0; k < target; k++) {
      const pid = leaderboardDesc[idx++];
      if (!pid) break;
      groups[gi].push(pid);
    }
  }

  return groups;
}

function rawScoreFor(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  return String(strokes);
}

export default function RoundGroupsPage() {
  const params = useParams();
  const roundId = String((params as any)?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [infoMsg, setInfoMsg] = useState<string>("");

  const [round, setRound] = useState<Round | null>(null);
  const [players, setPlayers] = useState<PlayerBase[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayer[]>([]);
  const [groups, setGroups] = useState<RoundGroup[]>([]);
  const [members, setMembers] = useState<RoundGroupPlayer[]>([]);
  const [tourPairs, setTourPairs] = useState<Pair[]>([]);
  const [tourPairWarn, setTourPairWarn] = useState<string>("");

  // NEW: for friendly “Round 1/2/3” fallback
  const [tourRounds, setTourRounds] = useState<{ id: string; name: string | null; created_at: string | null }[]>([]);

  const rpByPlayerId = useMemo(() => {
    const m = new Map<string, RoundPlayer>();
    for (const rp of roundPlayers) m.set(rp.player_id, rp);
    return m;
  }, [roundPlayers]);

  const playingPlayers = useMemo(() => {
    const ids = roundPlayers.filter((rp) => rp.playing).map((rp) => rp.player_id);
    const set = new Set(ids);

    const list = players
      .filter((p) => set.has(p.id))
      .map((p) => {
        const rp = rpByPlayerId.get(p.id);
        const effectiveHcp =
          (Number.isFinite(Number(rp?.playing_handicap)) ? Number(rp?.playing_handicap) : null) ??
          (Number.isFinite(Number(p.start_handicap)) ? Number(p.start_handicap) : null) ??
          0;

        return {
          id: p.id,
          name: p.name,
          hcp: effectiveHcp,
        };
      });

    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [players, roundPlayers, rpByPlayerId]);

  const playerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.id, p.name);
    return m;
  }, [players]);

  const playerHcpById = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of players) {
      const rp = rpByPlayerId.get(p.id);
      const effectiveHcp =
        (Number.isFinite(Number(rp?.playing_handicap)) ? Number(rp?.playing_handicap) : null) ??
        (Number.isFinite(Number(p.start_handicap)) ? Number(p.start_handicap) : null) ??
        0;
      m.set(p.id, effectiveHcp);
    }
    return m;
  }, [players, rpByPlayerId]);

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

  const roundDisplayName = useMemo(() => {
    const explicit = (round?.name ?? "").trim();
    if (explicit) return explicit;

    // If no name in DB, use Round N based on created_at order in tour
    const tid = round?.tour_id ?? null;
    if (!tid) return `Round`;

    const ordered = [...tourRounds].sort((a, b) => {
      const aa = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return aa - bb;
    });

    const idx = ordered.findIndex((r) => r.id === round?.id);
    if (idx >= 0) return `Round ${idx + 1}`;

    // last resort, but never show UUID
    return "Round";
  }, [round?.id, round?.name, round?.tour_id, tourRounds]);

  async function loadAll() {
    if (!roundId) return;
    setLoading(true);
    setErrorMsg("");
    setInfoMsg("");
    setTourPairWarn("");

    try {
      const { data: roundData, error: roundErr } = await supabase
        .from("rounds")
        .select("id,name,tour_id,course_id,created_at,courses(name)")
        .eq("id", roundId)
        .single();
      if (roundErr) throw roundErr;

      const r = roundData as any as Round;
      setRound(r);

      // NEW: load all rounds in tour for fallback naming
      if (r.tour_id) {
        const { data: trData, error: trErr } = await supabase
          .from("rounds")
          .select("id,name,created_at")
          .eq("tour_id", r.tour_id)
          .order("created_at", { ascending: true });

        if (!trErr) {
          setTourRounds((trData ?? []) as any);
        } else {
          setTourRounds([]);
        }
      } else {
        setTourRounds([]);
      }

      const { data: rpData, error: rpErr } = await supabase
        .from("round_players")
        .select("round_id,player_id,playing,playing_handicap")
        .eq("round_id", roundId);
      if (rpErr) throw rpErr;

      const rpRows: RoundPlayer[] = (rpData ?? []).map((x: any) => ({
        round_id: String(x.round_id),
        player_id: String(x.player_id),
        playing: x.playing === true,
        playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
      }));
      setRoundPlayers(rpRows);

      const ids = rpRows.map((r) => r.player_id);
      if (ids.length) {
        const { data: pData, error: pErr } = await supabase
          .from("players")
          .select("id,name,start_handicap")
          .in("id", ids);
        if (pErr) throw pErr;

        const pRows: PlayerBase[] = (pData ?? []).map((p: any) => ({
          id: String(p.id),
          name: String(p.name),
          start_handicap: Number.isFinite(Number(p.start_handicap)) ? Number(p.start_handicap) : null,
        }));
        setPlayers(pRows);
      } else {
        setPlayers([]);
      }

      const { data: gData, error: gErr } = await supabase
        .from("round_groups")
        .select("id,round_id,group_no,tee_time,start_hole,notes")
        .eq("round_id", roundId)
        .order("group_no", { ascending: true });
      if (gErr) throw gErr;
      setGroups((gData ?? []) as RoundGroup[]);

      const { data: mData, error: mErr } = await supabase
        .from("round_group_players")
        .select("id,round_id,group_id,player_id,seat")
        .eq("round_id", roundId);
      if (mErr) throw mErr;
      setMembers((mData ?? []) as RoundGroupPlayer[]);

      // Tour pairs
      const tourId = (roundData as any)?.tour_id as string | null | undefined;
      if (tourId) {
        const { data: tg, error: tgErr } = await supabase
          .from("tour_groups")
          .select("id,tour_id,scope,type")
          .eq("tour_id", tourId)
          .eq("scope", "tour")
          .eq("type", "pair");

        if (tgErr) {
          setTourPairs([]);
          setTourPairWarn(`Tour pairs not available (likely RLS / not logged in): ${tgErr.message}`);
        } else {
          const groupIds = (tg ?? []).map((x: any) => x.id);
          if (groupIds.length) {
            const { data: mem, error: memErr } = await supabase
              .from("tour_group_members")
              .select("group_id,player_id")
              .in("group_id", groupIds);

            if (memErr) {
              setTourPairs([]);
              setTourPairWarn(`Tour pair members not available: ${memErr.message}`);
            } else {
              const byGroup = new Map<string, string[]>();
              for (const row of mem ?? []) {
                const gid = String((row as any).group_id);
                const pid = String((row as any).player_id);
                if (!byGroup.has(gid)) byGroup.set(gid, []);
                byGroup.get(gid)!.push(pid);
              }

              const pairs: Pair[] = [];
              for (const arr of byGroup.values()) {
                if (arr.length >= 2) pairs.push({ a: arr[0], b: arr[1] });
              }
              setTourPairs(pairs);
            }
          } else {
            setTourPairs([]);
          }
        }
      } else {
        setTourPairs([]);
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to load groups.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  async function clearExistingRoundGroups() {
    const delM = await supabase.from("round_group_players").delete().eq("round_id", roundId);
    if (delM.error) throw delM.error;

    const delG = await supabase.from("round_groups").delete().eq("round_id", roundId);
    if (delG.error) throw delG.error;
  }

  async function persistGeneratedGroups(gen: string[][], note: string) {
    setBusy(true);
    setErrorMsg("");
    setInfoMsg("");

    try {
      await clearExistingRoundGroups();

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

      setInfoMsg("Groups generated successfully.");
      await loadAll();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to generate groups.");
    } finally {
      setBusy(false);
    }
  }

  async function fetchPastRoundGroupsForFairness(tourId: string | null | undefined) {
    if (!tourId) return [];

    const { data: roundsData, error: rErr } = await supabase.from("rounds").select("id,tour_id").eq("tour_id", tourId);
    if (rErr) throw rErr;

    const otherRoundIds = (roundsData ?? [])
      .map((r: any) => String(r.id))
      .filter((id) => id !== roundId);

    if (!otherRoundIds.length) return [];

    const { data: rgp, error: rgpErr } = await supabase
      .from("round_group_players")
      .select("round_id,group_id,player_id")
      .in("round_id", otherRoundIds);

    if (rgpErr) throw rgpErr;

    const byRoundGroup = new Map<string, string[]>();
    for (const row of rgp ?? []) {
      const k = `${String((row as any).round_id)}|${String((row as any).group_id)}`;
      if (!byRoundGroup.has(k)) byRoundGroup.set(k, []);
      byRoundGroup.get(k)!.push(String((row as any).player_id));
    }

    return Array.from(byRoundGroup.values());
  }

  async function computeLeaderboardToDate(tourId: string, currentRoundId: string) {
    // Sum stableford points across all rounds in tour excluding current round.
    const { data: tourRounds, error: trErr } = await supabase.from("rounds").select("id,tour_id,course_id").eq("tour_id", tourId);
    if (trErr) throw trErr;

    const prior = (tourRounds ?? []).filter((r: any) => r.id !== currentRoundId && r.course_id);
    if (!prior.length) return playingPlayers.map((p) => p.id);

    const courseIds = Array.from(new Set(prior.map((r: any) => r.course_id)));
    const { data: parsData, error: pErr } = await supabase
      .from("pars")
      .select("course_id,hole_number,par,stroke_index")
      .in("course_id", courseIds);

    if (pErr) throw pErr;

    const parsByCourseHole = new Map<string, Map<number, { par: number; si: number }>>();
    for (const row of parsData ?? []) {
      const cid = String((row as any).course_id);
      const hole = Number((row as any).hole_number);
      const par = Number((row as any).par);
      const si = Number((row as any).stroke_index);
      if (!parsByCourseHole.has(cid)) parsByCourseHole.set(cid, new Map());
      parsByCourseHole.get(cid)!.set(hole, { par, si });
    }

    const priorIds = prior.map((r: any) => String(r.id));
    const playingPlayerIds = playingPlayers.map((p) => p.id);

    const { data: scoresData, error: sErr } = await supabase
      .from("scores")
      .select("round_id,player_id,hole_number,strokes,pickup")
      .in("round_id", priorIds)
      .in("player_id", playingPlayerIds);

    if (sErr) throw sErr;

    const courseByRound = new Map<string, string>();
    for (const r of prior) courseByRound.set(String(r.id), String(r.course_id));

    const scoresByKey = new Map<string, ScoreRow>();
    for (const sc of scoresData ?? []) {
      const key = `${String((sc as any).round_id)}|${String((sc as any).player_id)}|${Number((sc as any).hole_number)}`;
      scoresByKey.set(key, sc as any);
    }

    const totals = new Map<string, number>();
    for (const p of playingPlayers) totals.set(p.id, 0);

    for (const r of prior) {
      const rid = String(r.id);
      const cid = courseByRound.get(rid);
      if (!cid) continue;

      const parsMap = parsByCourseHole.get(cid);
      if (!parsMap) continue;

      for (const p of playingPlayers) {
        let sum = totals.get(p.id) ?? 0;
        const hcp = playerHcpById.get(p.id) ?? 0;

        for (let hole = 1; hole <= 18; hole++) {
          const pr = parsMap.get(hole);
          if (!pr) continue;

          const sc = scoresByKey.get(`${rid}|${p.id}|${hole}`);
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

        totals.set(p.id, sum);
      }
    }

    return [...playingPlayers]
      .sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0) || a.name.localeCompare(b.name))
      .map((p) => p.id);
  }

  async function onGenerateRound1() {
    const ids = playingPlayers.map((p) => p.id);
    const gen = generateRound1PreferPairs(ids, tourPairs);
    await persistGeneratedGroups(gen, "Auto: Round 1 (prefer tour pairs)");
  }

  async function onGenerateFair() {
    const ids = playingPlayers.map((p) => p.id);
    const tourId = round?.tour_id ?? null;
    const past = await fetchPastRoundGroupsForFairness(tourId ?? undefined);
    const gen = generateFairMix(ids, past);
    await persistGeneratedGroups(gen, "Auto: Fair mix (non-final)");
  }

  async function onGenerateFinal() {
    const tourId = round?.tour_id;
    if (!tourId) {
      setErrorMsg("This round has no tour_id available; cannot compute leaderboard seeding.");
      return;
    }
    const ordered = await computeLeaderboardToDate(tourId, roundId);
    const gen = generateFinalSeeded(ordered, playingPlayers.length);
    await persistGeneratedGroups(gen, "Auto: Final round (leaderboard-seeded)");
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-4xl p-4">
        <div className="text-sm opacity-70">Loading…</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Playing Groups</h1>
          <div className="text-sm opacity-80">
            Round: <span className="font-medium">{roundDisplayName}</span>
            {round?.courses?.name ? (
              <>
                {" "}
                · Course: <span className="font-medium">{round.courses.name}</span>
              </>
            ) : null}
          </div>
          <div className="text-xs opacity-60 mt-1">All groups start on the 1st tee (no shotgun start).</div>

          <div className="mt-2 flex gap-3 text-sm">
            <Link className="underline opacity-80 hover:opacity-100" href={`/rounds/${roundId}`}>
              Back to round
            </Link>
            <Link className="underline opacity-80 hover:opacity-100" href={`/rounds/${roundId}/mobile`}>
              Mobile
            </Link>
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <button onClick={loadAll} disabled={busy} className="rounded-xl border px-3 py-2 text-sm disabled:opacity-50">
            Refresh
          </button>
        </div>
      </div>

      {errorMsg ? <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">{errorMsg}</div> : null}

      {infoMsg ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{infoMsg}</div>
      ) : null}

      {tourPairWarn ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{tourPairWarn}</div>
      ) : null}

      <section className="rounded-2xl border p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">Auto-generate</div>
            <div className="text-sm opacity-70">Groups of 4 where possible, otherwise a mix of 4s and 3s. Leaders go out last in the final round.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onGenerateRound1}
              disabled={busy || playingPlayers.length === 0}
              className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
              title="Prefer tour pairs where possible"
            >
              Generate Round 1
            </button>
            <button
              onClick={onGenerateFair}
              disabled={busy || playingPlayers.length === 0}
              className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
              title="Reduce repeat pairings based on past round groups"
            >
              Generate Fair Mix
            </button>
            <button
              onClick={onGenerateFinal}
              disabled={busy || playingPlayers.length === 0}
              className="rounded-xl bg-black px-4 py-2 text-white disabled:opacity-50"
              title="Seed by points-to-date so leaders tee off last"
            >
              Generate Final Round
            </button>
          </div>
        </div>

        <div className="text-xs opacity-60">Generating clears any existing groups for this round and regenerates them (manual override comes later).</div>
      </section>

      <section className="rounded-2xl border p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Current groups</h2>
          <div className="text-sm opacity-70">Playing players: {playingPlayers.length}</div>
        </div>

        {groups.length === 0 ? (
          <div className="text-sm opacity-70">No groups yet. Use the buttons above to generate.</div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const mem = membersByGroup.get(g.id) ?? [];
              return (
                <div key={g.id} className="rounded-2xl border p-4">
                  <div className="text-lg font-semibold">Group {g.group_no}</div>
                  <div className="text-xs opacity-70">Tee: 1st · Members: {mem.length} · Note: {g.notes ?? "—"}</div>

                  <div className="mt-3 space-y-2">
                    {mem.map((m) => {
                      const name = playerNameById.get(m.player_id) ?? m.player_id;
                      const hcp = playerHcpById.get(m.player_id) ?? 0;
                      return (
                        <div key={m.id} className="flex items-center justify-between rounded-xl border p-3">
                          <div>
                            <div className="font-medium">{name}</div>
                            <div className="text-xs opacity-70">HC: {hcp}</div>
                          </div>
                          <div className="text-xs opacity-60">Seat {m.seat ?? "-"}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border p-4 space-y-2">
        <h3 className="font-semibold">Tour pairs (used for Round 1 where possible)</h3>
        {tourPairs.length === 0 ? (
          <div className="text-sm opacity-70">No tour pairs available.</div>
        ) : (
          <div className="text-sm opacity-80 space-y-1">
            {tourPairs.map((pr, idx) => (
              <div key={idx}>{(playerNameById.get(pr.a) ?? pr.a) + " + " + (playerNameById.get(pr.b) ?? pr.b)}</div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
