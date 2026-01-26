"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Tee = "M" | "F";

type RoundRow = {
  id: string;
  created_at: string | null;
  round_no?: number | null;
  courses?: { name: string } | { name: string }[] | null;
};

type RoundGroupRow = {
  id: string;
  group_no: number;
  tee_time: string | null;
  start_hole: number | null;
  notes?: string | null;
};

type GroupPlayerRow = {
  group_id: string;
  player_id: string;
  seat: number | null;
  players?: { name: string | null; gender?: Tee | null } | { name: string | null; gender?: Tee | null }[] | null;
};

type PlayerRow = {
  id: string;
  name: string;
  gender: Tee;
};

// NOTE: PostgREST can return relationship as object OR array.
// We accept both and normalize with asSingle().
type TourPlayerJoinRow = {
  player_id: string;
  players:
    | { id: string; name: string | null; gender?: Tee | null }
    | { id: string; name: string | null; gender?: Tee | null }[]
    | null;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number | string | null;
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

function asSingle<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function courseName(r: RoundRow | null) {
  const c: any = r?.courses;
  if (!c) return "";
  if (Array.isArray(c)) return c?.[0]?.name ?? "";
  return c?.name ?? "";
}

function parseDate(s: string | null) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(d: Date | null) {
  if (!d) return "";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function ordinal(n: number) {
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 13) return `${n}th`;
  const m10 = n % 10;
  if (m10 === 1) return `${n}st`;
  if (m10 === 2) return `${n}nd`;
  if (m10 === 3) return `${n}rd`;
  return `${n}th`;
}

function fmtTime(t: string | null) {
  if (!t) return "";
  const s = String(t).trim();
  if (s.length >= 5) return s.slice(0, 5);
  return s;
}

function playerName(p: any) {
  if (!p) return "Player";
  if (Array.isArray(p)) return p?.[0]?.name ?? "Player";
  return p?.name ?? "Player";
}

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
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

// Supabase often caps at 1000 rows per request, so fetch in pages.
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

function safeStr(v: any, fallback: string) {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

type GenerationDiagnostics = {
  ranAtIso: string;
  tourId: string;
  roundId: string;
  finalRoundId: string;
  groupsCreated: number;
  playersUsed: number;
  maleCount: number;
  femaleCount: number;
  leftoversMale: number;
  leftoversFemale: number;
  notes: string[];
  groups: Array<{
    groupNo: number;
    groupId?: string;
    seats: Array<{ seat: number; playerId: string; name: string; gender: Tee; tourTotal: number }>;
  }>;
};

export default function MobileRoundTeeTimesPage() {
  const params = useParams<{ id: string; roundId: string }>();
  const tourId = String(params?.id ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();

  const [round, setRound] = useState<RoundRow | null>(null);
  const [roundIndex, setRoundIndex] = useState<number | null>(null);

  const [groups, setGroups] = useState<RoundGroupRow[]>([]);
  const [members, setMembers] = useState<GroupPlayerRow[]>([]);
  const [hcpByPlayer, setHcpByPlayer] = useState<Record<string, number>>({});

  const [finalRoundId, setFinalRoundId] = useState<string>("");

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diag, setDiag] = useState<GenerationDiagnostics | null>(null);

  const isFinalRound = !!finalRoundId && roundId === finalRoundId;

  async function loadTeeTimes() {
    setLoading(true);
    setErrorMsg("");

    const { data: allRounds, error: allRoundsErr } = await supabase
      .from("rounds")
      .select("id,round_no,created_at")
      .eq("tour_id", tourId)
      .order("round_no", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (allRoundsErr) {
      setErrorMsg(allRoundsErr.message);
      setLoading(false);
      return;
    }

    const rr = (allRounds ?? []) as any[];
    const idx = rr.findIndex((r: any) => String(r.id) === roundId) + 1;
    setRoundIndex(idx > 0 ? idx : null);

    const last = rr.length ? rr[rr.length - 1] : null;
    setFinalRoundId(last ? String(last.id) : "");

    const { data: rData, error: rErr } = await supabase
      .from("rounds")
      .select("id,created_at,round_no,courses(name)")
      .eq("id", roundId)
      .single();

    if (rErr) {
      setErrorMsg(rErr.message);
      setLoading(false);
      return;
    }
    setRound(rData as RoundRow);

    const { data: gData, error: gErr } = await supabase
      .from("round_groups")
      .select("id,group_no,tee_time,start_hole,notes")
      .eq("round_id", roundId)
      .order("group_no", { ascending: true });

    if (gErr) {
      setErrorMsg(gErr.message);
      setLoading(false);
      return;
    }
    setGroups((gData ?? []) as RoundGroupRow[]);

    const groupIds = (gData ?? []).map((g: any) => String(g.id));

    if (groupIds.length) {
      const { data: mData, error: mErr } = await supabase
        .from("round_group_players")
        .select("group_id,player_id,seat,players(name,gender)")
        .in("group_id", groupIds)
        .order("seat", { ascending: true, nullsFirst: true });

      if (mErr) {
        setErrorMsg(mErr.message);
        setLoading(false);
        return;
      }
      setMembers((mData ?? []) as GroupPlayerRow[]);
    } else {
      setMembers([]);
    }

    const { data: rpData, error: rpErr } = await supabase
      .from("round_players")
      .select("player_id,playing_handicap")
      .eq("round_id", roundId);

    if (rpErr) {
      setErrorMsg(rpErr.message);
      setLoading(false);
      return;
    }

    const map: Record<string, number> = {};
    for (const r of (rpData ?? []) as any[]) {
      const n = Number(r.playing_handicap);
      if (Number.isFinite(n)) map[String(r.player_id)] = n;
    }
    setHcpByPlayer(map);

    setLoading(false);
  }

  useEffect(() => {
    if (!tourId || !roundId) return;
    if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId)) return;

    let alive = true;
    (async () => {
      try {
        await loadTeeTimes();
      } finally {
        if (!alive) return;
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId, roundId]);

  const membersByGroup = useMemo(() => {
    const map: Record<string, GroupPlayerRow[]> = {};
    for (const m of members) {
      if (!map[m.group_id]) map[m.group_id] = [];
      map[m.group_id].push(m);
    }
    for (const gid of Object.keys(map)) {
      map[gid].sort((a, b) => {
        const as = a.seat ?? 9999;
        const bs = b.seat ?? 9999;
        if (as !== bs) return as - bs;
        const an = safeStr(asSingle(a.players as any)?.name, "");
        const bn = safeStr(asSingle(b.players as any)?.name, "");
        if (an !== bn) return an.localeCompare(bn);
        return String(a.player_id).localeCompare(String(b.player_id));
      });
    }
    return map;
  }, [members]);

  const roundDate = fmtDate(parseDate(round?.created_at ?? null));
  const course = courseName(round);

  async function generateFinalRoundTeeTimes() {
    setGenError("");
    setDiag(null);

    if (!tourId || !roundId || !isLikelyUuid(tourId) || !isLikelyUuid(roundId)) {
      setGenError("Invalid tourId or roundId in route.");
      return;
    }
    if (!finalRoundId) {
      setGenError("Could not determine final round id for this tour.");
      return;
    }
    if (roundId !== finalRoundId) {
      setGenError("This generator only runs on the final round tee-times page.");
      return;
    }

    setGenerating(true);

    try {
      const { data: roundsData, error: roundsErr } = await supabase
        .from("rounds")
        .select("id,round_no,created_at,course_id")
        .eq("tour_id", tourId)
        .order("round_no", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });

      if (roundsErr) throw roundsErr;

      const rounds = (roundsData ?? []) as any[];
      if (!rounds.length) throw new Error("No rounds found for this tour.");

      const roundIds = rounds.map((r) => String(r.id));
      const courseIds = Array.from(new Set(rounds.map((r) => r.course_id).filter(Boolean))).map((x) => String(x));

      const { data: tpData, error: tpErr } = await supabase
        .from("tour_players")
        .select("player_id,players(id,name,gender)")
        .eq("tour_id", tourId)
        .order("name", { ascending: true, foreignTable: "players" });

      if (tpErr) throw tpErr;

      const joined = (tpData ?? []) as unknown as TourPlayerJoinRow[];

      const players: PlayerRow[] = joined
        .map((row) => asSingle(row.players))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({
          id: String(p.id),
          name: safeStr(p.name, "(unnamed)"),
          gender: normalizeTee(p.gender),
        }));

      if (!players.length) throw new Error("No players found for this tour.");

      const playerIds = players.map((p) => p.id);

      const { data: rpData, error: rpErr } = await supabase
        .from("round_players")
        .select("round_id,player_id,playing,playing_handicap")
        .in("round_id", roundIds)
        .in("player_id", playerIds);

      if (rpErr) throw rpErr;

      const roundPlayers: RoundPlayerRow[] = (rpData ?? []).map((x: any) => ({
        round_id: String(x.round_id),
        player_id: String(x.player_id),
        playing: x.playing === true,
        playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
      }));

      const rpByRoundPlayer = new Map<string, RoundPlayerRow>();
      for (const rp of roundPlayers) rpByRoundPlayer.set(`${rp.round_id}|${rp.player_id}`, rp);

      const pars: ParRow[] = [];
      if (courseIds.length) {
        const { data: pData, error: pErr } = await supabase
          .from("pars")
          .select("course_id,hole_number,tee,par,stroke_index")
          .in("course_id", courseIds)
          .in("tee", ["M", "F"])
          .order("course_id", { ascending: true })
          .order("hole_number", { ascending: true });

        if (pErr) throw pErr;

        for (const x of (pData ?? []) as any[]) {
          pars.push({
            course_id: String(x.course_id),
            hole_number: Number(x.hole_number),
            tee: normalizeTee(x.tee),
            par: Number(x.par),
            stroke_index: Number(x.stroke_index),
          });
        }
      }

      const parsByCourseTeeHole = new Map<string, Map<Tee, Map<number, { par: number; si: number }>>>();
      for (const p of pars) {
        if (!parsByCourseTeeHole.has(p.course_id)) parsByCourseTeeHole.set(p.course_id, new Map());
        const byTee = parsByCourseTeeHole.get(p.course_id)!;
        if (!byTee.has(p.tee)) byTee.set(p.tee, new Map());
        byTee.get(p.tee)!.set(p.hole_number, { par: p.par, si: p.stroke_index });
      }

      const scores = await fetchAllScores(roundIds, playerIds);
      const scoreByRoundPlayerHole = new Map<string, ScoreRow>();
      for (const s of scores) scoreByRoundPlayerHole.set(`${s.round_id}|${s.player_id}|${Number(s.hole_number)}`, s);

      const tourTotals: Array<{ playerId: string; name: string; gender: Tee; tourTotal: number }> = [];

      for (const p of players) {
        let total = 0;

        for (const r of rounds) {
          const rid = String(r.id);
          const rp = rpByRoundPlayer.get(`${rid}|${p.id}`);
          if (!rp?.playing) continue;

          const courseId = String(r.course_id ?? "");
          if (!courseId) continue;

          const tee = normalizeTee(p.gender);
          const parsMap = parsByCourseTeeHole.get(courseId)?.get(tee);
          if (!parsMap) continue;

          const hcp = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0;

          for (let h = 1; h <= 18; h++) {
            const pr = parsMap.get(h);
            if (!pr) continue;

            const sc = scoreByRoundPlayerHole.get(`${rid}|${p.id}|${h}`);
            if (!sc) continue;

            const raw = normalizeRawScore(sc.strokes, sc.pickup);
            total += netStablefordPointsForHole({
              rawScore: raw,
              par: pr.par,
              strokeIndex: pr.si,
              playingHandicap: hcp,
            });
          }
        }

        tourTotals.push({ playerId: p.id, name: p.name, gender: p.gender, tourTotal: total });
      }

      tourTotals.sort((a, b) => b.tourTotal - a.tourTotal || a.name.localeCompare(b.name));

      const malesBestToWorst = tourTotals.filter((x) => normalizeTee(x.gender) !== "F");
      const femalesBestToWorst = tourTotals.filter((x) => normalizeTee(x.gender) === "F");

      const maleCount = malesBestToWorst.length;
      const femaleCount = femalesBestToWorst.length;

      const fullGroups = Math.floor(Math.min(maleCount, femaleCount) / 2);

      if (fullGroups <= 0) {
        throw new Error(
          `Not enough players to form 2M+2F groups. Men=${maleCount}, Women=${femaleCount}. Need at least 2 of each.`
        );
      }

      const builtGroups: Array<{
        groupNo: number;
        seats: Array<{ seat: number; playerId: string; name: string; gender: Tee; tourTotal: number }>;
      }> = [];

      for (let i = 0; i < fullGroups; i++) {
        const m1 = malesBestToWorst[maleCount - 1 - i * 2];
        const m2 = malesBestToWorst[maleCount - 2 - i * 2];
        const f1 = femalesBestToWorst[femaleCount - 1 - i * 2];
        const f2 = femalesBestToWorst[femaleCount - 2 - i * 2];

        builtGroups.push({
          groupNo: i + 1,
          seats: [
            { seat: 1, playerId: m1.playerId, name: m1.name, gender: "M", tourTotal: m1.tourTotal },
            { seat: 2, playerId: m2.playerId, name: m2.name, gender: "M", tourTotal: m2.tourTotal },
            { seat: 3, playerId: f1.playerId, name: f1.name, gender: "F", tourTotal: f1.tourTotal },
            { seat: 4, playerId: f2.playerId, name: f2.name, gender: "F", tourTotal: f2.tourTotal },
          ],
        });
      }

      const leftoversMale = maleCount - fullGroups * 2;
      const leftoversFemale = femaleCount - fullGroups * 2;

      const notes: string[] = [];
      if (leftoversMale !== 0 || leftoversFemale !== 0) {
        notes.push(
          `Leftovers not included in 2+2 groups: Men=${leftoversMale}, Women=${leftoversFemale} (generator creates only full 2M+2F groups).`
        );
      }

      const { error: delPlayersErr } = await supabase.from("round_group_players").delete().eq("round_id", roundId);
      if (delPlayersErr) throw delPlayersErr;

      const { error: delGroupsErr } = await supabase.from("round_groups").delete().eq("round_id", roundId);
      if (delGroupsErr) throw delGroupsErr;

      const nowIso = new Date().toISOString();

      const insertGroupsPayload = builtGroups.map((g) => ({
        round_id: roundId,
        group_no: g.groupNo,
        tee_time: null as any,
        start_hole: 1,
        notes: "Generated from Individual leaderboard (worst→best; 2M+2F).",
        updated_at: nowIso,
      }));

      const { data: insertedGroups, error: insGroupsErr } = await supabase
        .from("round_groups")
        .insert(insertGroupsPayload)
        .select("id,group_no")
        .order("group_no", { ascending: true });

      if (insGroupsErr) throw insGroupsErr;

      const groupIdByNo = new Map<number, string>();
      for (const row of (insertedGroups ?? []) as any[]) groupIdByNo.set(Number(row.group_no), String(row.id));

      const playersInsertPayload: Array<{ round_id: string; group_id: string; player_id: string; seat: number }> = [];

      for (const g of builtGroups) {
        const gid = groupIdByNo.get(g.groupNo);
        if (!gid) throw new Error(`Failed to map inserted group id for group_no=${g.groupNo}`);

        for (const s of g.seats) {
          playersInsertPayload.push({
            round_id: roundId,
            group_id: gid,
            player_id: s.playerId,
            seat: s.seat,
          });
        }
      }

      const { error: insPlayersErr } = await supabase.from("round_group_players").insert(playersInsertPayload);
      if (insPlayersErr) throw insPlayersErr;

      const diagOut: GenerationDiagnostics = {
        ranAtIso: nowIso,
        tourId,
        roundId,
        finalRoundId,
        groupsCreated: builtGroups.length,
        playersUsed: builtGroups.length * 4,
        maleCount,
        femaleCount,
        leftoversMale,
        leftoversFemale,
        notes,
        groups: builtGroups.map((g) => ({
          groupNo: g.groupNo,
          groupId: groupIdByNo.get(g.groupNo),
          seats: g.seats,
        })),
      };

      setDiag(diagOut);
      setShowDiagnostics(true);

      await loadTeeTimes();
    } catch (e: any) {
      setGenError(e?.message ?? "Failed to generate tee times.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      <div className="border-b bg-white">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="text-base font-semibold">Tee times</div>
        </div>
      </div>

      <div className="border-b bg-gray-50">
        <div className="mx-auto max-w-md px-4 py-3 text-sm font-semibold text-gray-800">
          {roundIndex ? `Round ${roundIndex}` : "Round"} · {roundDate} · {course}
        </div>

        <div className="mx-auto max-w-md px-4 pb-3">
          <div className="space-y-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-3 text-xs text-gray-700">
              <div className="font-semibold text-gray-900">Final round tee-time generator (Japan Tour)</div>
              <div className="mt-1">
                Rule: Groups of <span className="font-semibold">2 men + 2 women</span>, ordered{" "}
                <span className="font-semibold">worst → best</span> using the current Individual leaderboard tour totals.
              </div>

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={generateFinalRoundTeeTimes}
                  disabled={!isFinalRound || generating || loading}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold border ${
                    !isFinalRound || generating || loading
                      ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                      : "bg-gray-900 text-white border-gray-900 hover:bg-gray-800 active:bg-gray-700"
                  }`}
                >
                  {generating ? "Generating..." : "Generate Final Round Tee Times"}
                </button>

                <button
                  type="button"
                  onClick={() => setShowDiagnostics((v) => !v)}
                  className="rounded-xl px-3 py-2 text-sm font-semibold border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100"
                >
                  Diagnostics {showDiagnostics ? "▲" : "▼"}
                </button>
              </div>

              {!isFinalRound ? (
                <div className="mt-2 text-[11px] text-gray-600">
                  This button is enabled only on the tour’s final round tee-times page.
                </div>
              ) : null}

              {genError ? <div className="mt-2 text-sm text-red-700">{genError}</div> : null}
            </div>

            {showDiagnostics ? (
              <div className="rounded-2xl border border-gray-200 bg-white p-3 text-[11px] text-gray-800">
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-gray-700">
                  <div>
                    tourId: <span className="font-semibold text-gray-900 break-all">{tourId}</span>
                  </div>
                  <div>
                    roundId: <span className="font-semibold text-gray-900 break-all">{roundId}</span>
                  </div>
                  <div>
                    finalRoundId: <span className="font-semibold text-gray-900 break-all">{finalRoundId || "—"}</span>
                  </div>
                  <div>
                    isFinalRound: <span className="font-semibold text-gray-900">{isFinalRound ? "YES" : "NO"}</span>
                  </div>
                </div>

                {diag ? (
                  <div className="mt-3 space-y-2">
                    <div className="rounded-xl border border-gray-200 bg-gray-50 p-2">
                      <div className="font-semibold text-gray-900">Last generation</div>
                      <div className="mt-1">
                        ranAt: <span className="font-semibold">{diag.ranAtIso}</span> · groupsCreated:{" "}
                        <span className="font-semibold">{diag.groupsCreated}</span> · playersUsed:{" "}
                        <span className="font-semibold">{diag.playersUsed}</span>
                      </div>
                      <div className="mt-1">
                        men: <span className="font-semibold">{diag.maleCount}</span> · women:{" "}
                        <span className="font-semibold">{diag.femaleCount}</span> · leftovers M/F:{" "}
                        <span className="font-semibold">
                          {diag.leftoversMale}/{diag.leftoversFemale}
                        </span>
                      </div>
                      {diag.notes.length ? (
                        <div className="mt-1 text-gray-700">
                          {diag.notes.map((n, i) => (
                            <div key={i}>• {n}</div>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      {diag.groups.map((g) => (
                        <div key={g.groupNo} className="rounded-xl border border-gray-200 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-semibold text-gray-900">
                              Group {g.groupNo} {g.groupId ? <span className="text-gray-500">({g.groupId})</span> : null}
                            </div>
                            <div className="text-gray-600">DB: round_groups + round_group_players(seat)</div>
                          </div>

                          <div className="mt-2 space-y-1">
                            {g.seats
                              .slice()
                              .sort((a, b) => a.seat - b.seat)
                              .map((s) => (
                                <div key={`${g.groupNo}-${s.seat}`} className="flex justify-between gap-3">
                                  <div className="min-w-0">
                                    <span className="font-semibold">Seat {s.seat}:</span>{" "}
                                    <span className="font-semibold text-gray-900">{s.name}</span>{" "}
                                    <span className="text-gray-600">({s.gender})</span>
                                    <div className="text-[10px] text-gray-500 break-all">player_id: {s.playerId}</div>
                                  </div>
                                  <div className="text-right text-gray-700 whitespace-nowrap">
                                    TourTotal: <span className="font-semibold">{s.tourTotal}</span>
                                  </div>
                                </div>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-gray-600">No generation run yet in this session.</div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-md px-4 pt-4 pb-28">
        {loading ? (
          <div className="space-y-3">
            <div className="h-24 rounded-xl bg-gray-100" />
            <div className="h-24 rounded-xl bg-gray-100" />
          </div>
        ) : errorMsg ? (
          <div className="text-sm text-red-700">{errorMsg}</div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-gray-600">No tee times set.</div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const timeLabel = fmtTime(g.tee_time) || "TBD";
              const title = `Group ${g.group_no} — ${timeLabel}`;
              const startHole = g.start_hole ? `Starting Hole: ${ordinal(g.start_hole)}` : "";

              return (
                <div key={g.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <div className="text-sm font-extrabold">{title}</div>
                    {startHole ? (
                      <div className="mt-1 text-xs font-semibold text-gray-600">{startHole}</div>
                    ) : null}
                    {g.notes ? <div className="mt-1 text-[11px] text-gray-500">{g.notes}</div> : null}
                  </div>

                  <div className="px-4 py-3 space-y-2">
                    {(membersByGroup[g.id] ?? []).map((m) => {
                      const hcp = hcpByPlayer[m.player_id];
                      const seat = m.seat ?? null;

                      return (
                        <div key={m.player_id} className="text-sm font-semibold">
                          {seat !== null ? (
                            <span className="mr-2 inline-flex w-14 justify-center rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-extrabold text-gray-700">
                              Seat {seat}
                            </span>
                          ) : null}
                          {playerName(m.players)}
                          {Number.isFinite(hcp) ? ` (${hcp})` : ""}
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
    </div>
  );
}
