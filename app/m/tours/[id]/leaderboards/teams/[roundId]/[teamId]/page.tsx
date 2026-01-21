"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Tee = "M" | "F";

type RoundRow = {
  id: string;
  tour_id: string;
  round_no: number | null;
  name: string | null;
  course_id: string | null;
  created_at: string | null;
  played_on?: string | null;
  round_date?: string | null;
  courses?: { name: string } | { name: string }[] | null;
};

type PlayerRow = {
  id: string;
  name: string;
  gender?: Tee | null;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number | null;
};

type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean | null;
};

type ParRow = {
  course_id: string;
  hole_number: number;
  tee: Tee;
  par: number;
  stroke_index: number;
};

type TourGroupingSettingsRow = {
  tour_id: string;
  default_team_best_m: number | null;
};

type TourGroupRow = {
  id: string;
  tour_id: string;
  scope: "tour" | "round";
  type: "team" | "pair";
  name: string | null;
  team_index?: number | null;
};

type TourGroupMemberRow = {
  group_id: string;
  player_id: string;
  position: number | null;
};

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function safeName(v: any, fallback: string) {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function asSingle<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function clampInt(n: number, min: number, max: number) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function normalizeRawScore(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  const n = Number(strokes);
  return Number.isFinite(n) ? String(n) : "";
}

// Stableford (net) per hole
function netStablefordPointsForHole(params: {
  rawScore: string; // "" | "P" | "number"
  par: number;
  strokeIndex: number;
  playingHandicap: number;
}) {
  const { rawScore, par, strokeIndex, playingHandicap } = params;

  const raw = String(rawScore ?? "").trim().toUpperCase();
  if (!raw) return 0;
  if (raw === "P") return 0;

  const strokes = Number(raw);
  if (!Number.isFinite(strokes)) return 0;

  const hcp = Math.max(0, Math.floor(Number(playingHandicap) || 0));
  const base = Math.floor(hcp / 18);
  const rem = hcp % 18;
  const extra = strokeIndex <= rem ? 1 : 0;
  const shotsReceived = base + extra;

  const net = strokes - shotsReceived;
  const pts = 2 + (par - net);
  return Math.max(0, Math.min(pts, 10));
}

// ✅ IMPORTANT: Supabase/PostgREST often caps at 1000 rows per request.
// This helper fetches ALL score rows in pages.
async function fetchAllScores(roundIds: string[], playerIds: string[]): Promise<ScoreRow[]> {
  const pageSize = 1000;
  let from = 0;
  const out: ScoreRow[] = [];

  while (true) {
    const to = from + pageSize - 1;

    const { data, error } = await supabase
      .from("scores")
      .select("round_id,player_id,hole_number,strokes,pickup")
      .in("round_id", roundIds)
      .in("player_id", playerIds)
      .order("round_id", { ascending: true })
      .order("player_id", { ascending: true })
      .order("hole_number", { ascending: true })
      .range(from, to);

    if (error) throw error;

    const rows = (data ?? []) as any[];
    out.push(
      ...rows.map((x) => ({
        round_id: String(x.round_id),
        player_id: String(x.player_id),
        hole_number: Number(x.hole_number),
        strokes: x.strokes === null || x.strokes === undefined ? null : Number(x.strokes),
        pickup: x.pickup === true ? true : x.pickup === false ? false : (x.pickup ?? null),
      }))
    );

    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return out;
}

export default function MobileTeamRoundDetailPage() {
  const params = useParams<{ id?: string; roundId?: string; teamId?: string }>();

  const tourId = String(params?.id ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();
  const teamId = String(params?.teamId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [round, setRound] = useState<RoundRow | null>(null);
  const [team, setTeam] = useState<TourGroupRow | null>(null);
  const [members, setMembers] = useState<TourGroupMemberRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);
  const [bestY, setBestY] = useState(1);

  useEffect(() => {
    if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId) || !isLikelyUuid(teamId)) return;

    let alive = true;

    async function loadAll() {
      setLoading(true);
      setErrorMsg("");

      try {
        // Team rule Y
        const { data: sData, error: sErr } = await supabase
          .from("tour_grouping_settings")
          .select("tour_id,default_team_best_m")
          .eq("tour_id", tourId)
          .maybeSingle();
        if (sErr) throw sErr;

        const settings = (sData ?? null) as TourGroupingSettingsRow | null;
        const y = Number.isFinite(Number(settings?.default_team_best_m)) ? Number(settings?.default_team_best_m) : 1;
        if (!alive) return;
        setBestY(clampInt(y, 1, 99));

        // Round (to get course_id)
        const baseRoundCols = "id,tour_id,round_no,name,course_id,created_at,courses(name),played_on,round_date";
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select(baseRoundCols)
          .eq("id", roundId)
          .eq("tour_id", tourId)
          .single();
        if (rErr) throw rErr;

        if (!alive) return;
        setRound(rData as unknown as RoundRow);

        const courseId = String((rData as any)?.course_id ?? "").trim();
        if (!courseId) {
          throw new Error("Round has no course_id.");
        }

        // Team + members
        const { data: tData, error: tErr } = await supabase
          .from("tour_groups")
          .select("id,tour_id,scope,type,name,team_index")
          .eq("id", teamId)
          .eq("tour_id", tourId)
          .eq("scope", "tour")
          .eq("type", "team")
          .single();
        if (tErr) throw tErr;

        const { data: mData, error: mErr } = await supabase
          .from("tour_group_members")
          .select("group_id,player_id,position")
          .eq("group_id", teamId)
          .order("position", { ascending: true, nullsFirst: true });
        if (mErr) throw mErr;

        if (!alive) return;
        setTeam(tData as TourGroupRow);
        setMembers((mData ?? []) as TourGroupMemberRow[]);

        const memberPlayerIds = (mData ?? []).map((x: any) => String(x.player_id)).filter(Boolean);

        // Players (via tour_players join players)
        const { data: tpData, error: tpErr } = await supabase
          .from("tour_players")
          .select("tour_id,player_id,players(id,name,gender)")
          .eq("tour_id", tourId)
          .in("player_id", memberPlayerIds)
          .order("name", { ascending: true, foreignTable: "players" });
        if (tpErr) throw tpErr;

        const ps: PlayerRow[] = (tpData ?? [])
          .map((row: any) => row.players)
          .filter(Boolean)
          .map((p: any) => ({
            id: String(p.id),
            name: safeName(p.name, "(unnamed)"),
            gender: p.gender ? normalizeTee(p.gender) : null,
          }));

        if (!alive) return;
        setPlayers(ps);

        // round_players for this round + these players
        if (memberPlayerIds.length > 0) {
          const { data: rpData, error: rpErr } = await supabase
            .from("round_players")
            .select("round_id,player_id,playing,playing_handicap")
            .eq("round_id", roundId)
            .in("player_id", memberPlayerIds);
          if (rpErr) throw rpErr;

          const rpRows: RoundPlayerRow[] = (rpData ?? []).map((x: any) => ({
            round_id: String(x.round_id),
            player_id: String(x.player_id),
            playing: x.playing === true,
            playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
          }));

          if (!alive) return;
          setRoundPlayers(rpRows);
        } else {
          setRoundPlayers([]);
        }

        // scores for this round + these players
        if (memberPlayerIds.length > 0) {
          const allScores = await fetchAllScores([roundId], memberPlayerIds);
          if (!alive) return;
          setScores(allScores);
        } else {
          setScores([]);
        }

        // pars for this course (both tees)
        const { data: pData, error: pErr } = await supabase
          .from("pars")
          .select("course_id,hole_number,tee,par,stroke_index")
          .eq("course_id", courseId)
          .in("tee", ["M", "F"])
          .order("hole_number", { ascending: true });
        if (pErr) throw pErr;

        const pr: ParRow[] = (pData ?? []).map((x: any) => ({
          course_id: String(x.course_id),
          hole_number: Number(x.hole_number),
          tee: normalizeTee(x.tee),
          par: Number(x.par),
          stroke_index: Number(x.stroke_index),
        }));

        if (!alive) return;
        setPars(pr);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load team round detail.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    void loadAll();

    return () => {
      alive = false;
    };
  }, [tourId, roundId, teamId]);

  const backHref = `/m/tours/${tourId}/leaderboards`;

  const playerById = useMemo(() => {
    const m = new Map<string, PlayerRow>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const rpByPlayer = useMemo(() => {
    const m = new Map<string, RoundPlayerRow>();
    for (const rp of roundPlayers) m.set(rp.player_id, rp);
    return m;
  }, [roundPlayers]);

  const scoreByPlayerHole = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    for (const s of scores) m.set(`${s.player_id}|${Number(s.hole_number)}`, s);
    return m;
  }, [scores]);

  const parsByTeeHole = useMemo(() => {
    const m = new Map<Tee, Map<number, { par: number; si: number }>>();
    for (const p of pars) {
      if (!m.has(p.tee)) m.set(p.tee, new Map());
      m.get(p.tee)!.set(p.hole_number, { par: p.par, si: p.stroke_index });
    }
    return m;
  }, [pars]);

  // Ordered team player ids: by member position, then by name (stable)
  const orderedPlayerIds = useMemo(() => {
    const ids = members.map((m) => String(m.player_id)).filter(Boolean);
    const pos = new Map<string, number>();
    members.forEach((m) => pos.set(String(m.player_id), Number.isFinite(Number(m.position)) ? Number(m.position) : 999));

    return [...ids].sort((a, b) => {
      const pa = pos.get(a) ?? 999;
      const pb = pos.get(b) ?? 999;
      if (pa !== pb) return pa - pb;
      const na = safeName(playerById.get(a)?.name, a);
      const nb = safeName(playerById.get(b)?.name, b);
      return na.localeCompare(nb);
    });
  }, [members, playerById]);

  const teamTitle = useMemo(() => {
    const nm = String(team?.name ?? "").trim();
    if (nm) return nm;
    const idx = Number.isFinite(Number((team as any)?.team_index)) ? Number((team as any)?.team_index) : null;
    if (idx !== null) return `Team ${idx}`;
    return "Team";
  }, [team]);

  const roundLabel = useMemo(() => {
    const n = round?.round_no ?? null;
    const cn = safeName(asSingle(round?.courses)?.name, "(course)");
    return n ? `Round ${n} · ${cn}` : `Round · ${cn}`;
  }, [round]);

  // Compute per-player per-hole points and all highlight/total rules
  const model = useMemo(() => {
    const Y = clampInt(bestY, 1, 99);

    // points[playerId][hole] = number | null (null = no score/par data)
    const points = new Map<string, Map<number, number | null>>();
    // zeroRecorded[playerId][hole] = boolean (true only if score exists and points==0)
    const zeroRecorded = new Map<string, Map<number, boolean>>();

    for (const pid of orderedPlayerIds) {
      points.set(pid, new Map());
      zeroRecorded.set(pid, new Map());

      const pl = playerById.get(pid);
      const tee: Tee = normalizeTee(pl?.gender);
      const parsMap = parsByTeeHole.get(tee);

      for (let h = 1; h <= 18; h++) {
        const pr = parsMap?.get(h);
        const sc = scoreByPlayerHole.get(`${pid}|${h}`);
        const rp = rpByPlayer.get(pid);

        // If no par data, or not playing, or no score => show blank (null)
        if (!pr || !rp?.playing || !sc) {
          points.get(pid)!.set(h, null);
          zeroRecorded.get(pid)!.set(h, false);
          continue;
        }

        const raw = normalizeRawScore(sc.strokes, sc.pickup);
        const hcp = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0;

        const pts = netStablefordPointsForHole({
          rawScore: raw,
          par: pr.par,
          strokeIndex: pr.si,
          playingHandicap: hcp,
        });

        points.get(pid)!.set(h, pts);
        zeroRecorded.get(pid)!.set(h, pts === 0);
      }
    }

    // For each hole:
    // - Determine "counted set": all positive scores >= cutoff (Nth best), including ties
    // - Determine "boxed counted set": only first N (by orderedPlayerIds) among the counted set
    // - Zero boxes: any recorded zero
    const countedByHole = new Map<number, Set<string>>();
    const boxedCountedByHole = new Map<number, Set<string>>();
    const boxedZeroByHole = new Map<number, Set<string>>();
    const teamHoleTotal = new Map<number, number>();

    for (let h = 1; h <= 18; h++) {
      // Gather positive scores
      const positives: Array<{ pid: string; pts: number; orderIdx: number }> = [];
      let zeroCount = 0;

      orderedPlayerIds.forEach((pid, idx) => {
        const v = points.get(pid)?.get(h);
        const zr = zeroRecorded.get(pid)?.get(h) === true;

        if (zr) zeroCount += 1;
        if (typeof v === "number" && v > 0) positives.push({ pid, pts: v, orderIdx: idx });
      });

      positives.sort((a, b) => b.pts - a.pts || a.orderIdx - b.orderIdx);

      const cutoffPts = positives.length >= Y ? positives[Y - 1].pts : null;

      const counted = new Set<string>();
      if (cutoffPts !== null) {
        for (const x of positives) {
          if (x.pts >= cutoffPts) counted.add(x.pid);
        }
      } else {
        // fewer than Y positives: all positives count
        for (const x of positives) counted.add(x.pid);
      }

      // Box only first Y among counted, by existing ordering
      const boxedCounted = new Set<string>();
      for (const pid of orderedPlayerIds) {
        if (counted.has(pid)) {
          boxedCounted.add(pid);
          if (boxedCounted.size >= Y) break;
        }
      }

      // Box zeros (recorded zeros only)
      const boxedZero = new Set<string>();
      for (const pid of orderedPlayerIds) {
        if (zeroRecorded.get(pid)?.get(h) === true) boxedZero.add(pid);
      }

      // Team hole total = sum(counted positive scores) - zeroCount
      let holeSum = 0;
      for (const pid of counted) {
        const v = points.get(pid)?.get(h);
        if (typeof v === "number" && v > 0) holeSum += v;
      }
      holeSum -= zeroCount;

      countedByHole.set(h, counted);
      boxedCountedByHole.set(h, boxedCounted);
      boxedZeroByHole.set(h, boxedZero);
      teamHoleTotal.set(h, holeSum);
    }

    // Player totals:
    // - sum of counted positive scores (including ties) across holes
    // - minus 1 for each recorded zero (any hole with pts==0 where a score exists)
    const playerTotal = new Map<string, number>();
    for (const pid of orderedPlayerIds) {
      let sum = 0;

      for (let h = 1; h <= 18; h++) {
        const v = points.get(pid)?.get(h);
        const zr = zeroRecorded.get(pid)?.get(h) === true;

        if (zr) sum -= 1;

        if (typeof v === "number" && v > 0) {
          const counted = countedByHole.get(h);
          if (counted?.has(pid)) sum += v;
        }
      }

      playerTotal.set(pid, sum);
    }

    const teamTotal = Array.from(teamHoleTotal.values()).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);

    return {
      Y,
      points,
      countedByHole,
      boxedCountedByHole,
      boxedZeroByHole,
      teamHoleTotal,
      playerTotal,
      teamTotal,
    };
  }, [bestY, orderedPlayerIds, playerById, parsByTeeHole, scoreByPlayerHole, rpByPlayer, members]);

  if (!tourId || !isLikelyUuid(tourId) || !roundId || !isLikelyUuid(roundId) || !teamId || !isLikelyUuid(teamId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900">
        <div className="mx-auto max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">
            Missing or invalid route parameters.
            <div className="mt-2">
              <Link className="underline" href="/m">
                Go to mobile home
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <Link href={backHref} className="text-sm font-semibold text-gray-900 underline">
              Back
            </Link>
            <div className="text-xs text-gray-600 whitespace-nowrap">
              Best {model.Y} positives / hole · Zeros −1
            </div>
          </div>

          <div className="mt-2">
            <div className="text-base font-extrabold text-gray-900">{teamTitle}</div>
            <div className="mt-1 text-sm text-gray-700">{roundLabel}</div>
            <div className="mt-1 text-xs text-gray-600">Team total (this round): {model.teamTotal}</div>
          </div>

          <div className="mt-2 text-[11px] text-gray-600">
            <span className="inline-flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm border-2 border-emerald-600" />
              Boxed = counted (first {model.Y})
            </span>
            <span className="ml-4 inline-flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-sm border-2 border-rose-600" />
              Boxed = zero
            </span>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-5 w-56 rounded bg-gray-100" />
            <div className="h-64 rounded-2xl border bg-white" />
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorMsg}</div>
        ) : orderedPlayerIds.length === 0 ? (
          <div className="rounded-2xl border p-4 text-sm text-gray-700">No players found for this team.</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-[980px] border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="sticky left-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700">
                    Player
                  </th>
                  {Array.from({ length: 18 }).map((_, i) => (
                    <th
                      key={i + 1}
                      className="border-b border-gray-200 px-2 py-2 text-center text-xs font-semibold text-gray-700"
                    >
                      {i + 1}
                    </th>
                  ))}
                  <th className="border-b border-gray-200 px-3 py-2 text-center text-xs font-semibold text-gray-700">
                    Total
                  </th>
                </tr>
              </thead>

              <tbody>
                {orderedPlayerIds.map((pid) => {
                  const name = safeName(playerById.get(pid)?.name, pid);
                  const total = model.playerTotal.get(pid) ?? 0;

                  return (
                    <tr key={pid} className="border-b last:border-b-0">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap">
                        {name}
                      </td>

                      {Array.from({ length: 18 }).map((_, idx) => {
                        const h = idx + 1;
                        const v = model.points.get(pid)?.get(h);
                        const showCountedBox = model.boxedCountedByHole.get(h)?.has(pid) === true;
                        const showZeroBox = model.boxedZeroByHole.get(h)?.has(pid) === true;

                        const base =
                          "inline-flex min-w-[32px] justify-center rounded-sm px-1.5 py-1 text-sm font-semibold";
                        const boxedCounted = `${base} border-2 border-emerald-600`;
                        const boxedZero = `${base} border-2 border-rose-600`;
                        const plain = `${base} border border-transparent`;

                        const cls = showZeroBox ? boxedZero : showCountedBox ? boxedCounted : plain;

                        return (
                          <td key={h} className="px-2 py-2 text-center text-sm text-gray-900">
                            {v === null ? <span className="text-gray-300">—</span> : <span className={cls}>{v}</span>}
                          </td>
                        );
                      })}

                      <td className="px-3 py-2 text-center text-sm font-extrabold text-gray-900">
                        <span className="inline-flex min-w-[44px] justify-center rounded-md bg-yellow-100 px-2 py-1">
                          {total}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {/* Team per-hole totals row */}
                <tr className="bg-gray-50">
                  <td className="sticky left-0 z-10 bg-gray-50 border-t border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700">
                    Team
                  </td>
                  {Array.from({ length: 18 }).map((_, idx) => {
                    const h = idx + 1;
                    const v = model.teamHoleTotal.get(h) ?? 0;
                    return (
                      <td
                        key={h}
                        className="border-t border-gray-200 px-2 py-2 text-center text-sm font-extrabold text-gray-900"
                      >
                        {v}
                      </td>
                    );
                  })}
                  <td className="border-t border-gray-200 px-3 py-2 text-center text-sm font-extrabold text-gray-900">
                    {model.teamTotal}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
