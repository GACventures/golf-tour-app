"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

type Tee = "M" | "F";

type RoundRow = {
  id: string;
  tour_id: string;
  name: string | null;
  round_no: number | null;
  played_on: string | null;
  created_at: string | null;
  course_id: string | null;
  courses?: { name: string } | { name: string }[] | null;
};

type Player = {
  id: string;
  name: string;
  gender?: string | null;
};

type GroupMemberRowRaw = {
  group_id: string;
  player_id: string;
  position: number | null;
  players?: any; // supabase nested (object or array)
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean | null;
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

type Shade = "ace" | "eagle" | "birdie" | "par" | "bogey" | "dbogey" | "none";

/* ----------------------------------
   Colour helpers (same as individual)
----------------------------------- */
const BLUE_ACE = "#082B5C";
const BLUE_EAGLE = "#1757D6";
const BLUE_BIRDIE = "#4DA3FF";

function blueStyleForShade(s: Shade): React.CSSProperties | undefined {
  if (s === "ace") return { backgroundColor: BLUE_ACE, color: "white" };
  if (s === "eagle") return { backgroundColor: BLUE_EAGLE, color: "white" };
  if (s === "birdie") return { backgroundColor: BLUE_BIRDIE, color: "white" };
  return undefined;
}

function shadeForGross(gross: number | null, pickup: boolean, par: number): Shade {
  if (pickup) return "dbogey";
  if (gross === null) return "none";
  if (!Number.isFinite(gross)) return "none";

  const diff = gross - par;
  if (diff <= -3) return "ace";
  if (diff === -2) return "eagle";
  if (diff === -1) return "birdie";
  if (diff === 0) return "par";
  if (diff === 1) return "bogey";
  return "dbogey";
}

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function asSingle<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function normalizeRawScore(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  const n = Number(strokes);
  return Number.isFinite(n) ? String(n) : "";
}

function sumNumericOrZero(values: Array<number | null | undefined>) {
  let s = 0;
  for (const v of values) {
    const n = Number(v);
    if (Number.isFinite(n)) s += n;
  }
  return s;
}

function cellBaseClasses() {
  return "h-10 min-w-[52px] px-2 flex items-center justify-end rounded-md text-sm font-extrabold";
}

function GrossBox({
  shade,
  label,
}: {
  shade: Shade;
  label: string;
}) {
  const isBlue = shade === "ace" || shade === "eagle" || shade === "birdie";

  const base = cellBaseClasses();
  const cls =
    shade === "par"
      ? `${base} bg-white text-gray-900 border border-gray-300`
      : shade === "bogey"
      ? `${base} bg-[#f8cfcf] text-gray-900`
      : shade === "dbogey"
      ? `${base} bg-[#c0392b] text-white`
      : `${base} bg-transparent text-gray-900 border border-transparent`;

  return (
    <div className={cls} style={isBlue ? blueStyleForShade(shade) : undefined}>
      {label}
    </div>
  );
}

function PointsBox({
  value,
  contributed,
  tied,
}: {
  value: number;
  contributed: boolean;
  tied: boolean;
}) {
  const base = cellBaseClasses();

  // Stableford cell itself is NOT coloured; only outline rules apply.
  // - contributed => dashed outline
  // - tied + contributed => solid outline (around both)
  const outline = tied
    ? "border-2 border-gray-900"
    : contributed
    ? "border-2 border-dashed border-gray-600"
    : "border border-transparent";

  return <div className={`${base} bg-white text-gray-900 ${outline}`}>{value}</div>;
}

export default function PairsRoundDetailPage() {
  const params = useParams<{ id?: string; groupId?: string; roundId?: string }>();
  const router = useRouter();

  const tourId = String(params?.id ?? "").trim();
  const groupId = String(params?.groupId ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [round, setRound] = useState<RoundRow | null>(null);
  const [members, setMembers] = useState<Player[]>([]);

  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);

  function goBack() {
    // back to leaderboards (pairs tab)
    router.push(`/m/tours/${tourId}/leaderboards`);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!tourId || !groupId || !roundId) return;

      setLoading(true);
      setErrorMsg("");

      try {
        // Round
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,tour_id,name,round_no,played_on,created_at,course_id,courses(name)")
          .eq("id", roundId)
          .eq("tour_id", tourId)
          .single();
        if (rErr) throw rErr;

        const courseId = String((rData as any)?.course_id ?? "");

        // Group members (+ players)
        const { data: gmData, error: gmErr } = await supabase
          .from("tour_group_members")
          .select("group_id,player_id,position,players(id,name,gender)")
          .eq("group_id", groupId);

        if (gmErr) throw gmErr;

        const gm = (gmData ?? []) as unknown as GroupMemberRowRaw[];
        gm.sort(
          (a, b) =>
            (a.position ?? 999) - (b.position ?? 999) ||
            String(a.player_id).localeCompare(String(b.player_id))
        );

        const ppl: Player[] = gm
          .map((row) => {
            const pl = asSingle(row.players) as any;
            const id = String(pl?.id ?? row.player_id);
            const name = String(pl?.name ?? "(player)");
            const gender = pl?.gender ?? null;
            return { id, name, gender };
          })
          .filter((x) => !!x.id);

        // We only support 2-player pairs for this page
        const pair = ppl.slice(0, 2);

        // round_players for those 2 players
        const playerIds = pair.map((p) => p.id);
        const rpRes =
          playerIds.length > 0
            ? await supabase
                .from("round_players")
                .select("round_id,player_id,playing,playing_handicap")
                .eq("round_id", roundId)
                .in("player_id", playerIds)
            : { data: [], error: null as any };

        if (rpRes.error) throw rpRes.error;

        // scores for those 2 players
        const scRes =
          playerIds.length > 0
            ? await supabase
                .from("scores")
                .select("round_id,player_id,hole_number,strokes,pickup")
                .eq("round_id", roundId)
                .in("player_id", playerIds)
            : { data: [], error: null as any };

        if (scRes.error) throw scRes.error;

        // pars for course (both tees)
        const prRes =
          courseId
            ? await supabase
                .from("pars")
                .select("course_id,hole_number,tee,par,stroke_index")
                .eq("course_id", courseId)
                .in("tee", ["M", "F"])
                .order("hole_number", { ascending: true })
            : { data: [], error: null as any };

        if (prRes.error) throw prRes.error;

        if (cancelled) return;

        setRound(rData as any);
        setMembers(pair);
        setRoundPlayers((rpRes.data ?? []) as any);
        setScores((scRes.data ?? []) as any);
        setPars((prRes.data ?? []) as any);
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.message ?? "Failed to load pair round detail.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [tourId, groupId, roundId]);

  const courseName = useMemo(() => {
    const c = asSingle(round?.courses as any)?.name;
    return String(c ?? "").trim();
  }, [round]);

  const dateText = useMemo(() => formatDate(round?.played_on ?? null), [round?.played_on]);

  const parsByTeeHole = useMemo(() => {
    const m = new Map<Tee, Map<number, { par: number; si: number }>>();
    for (const p of pars) {
      const tee = normalizeTee((p as any).tee);
      if (!m.has(tee)) m.set(tee, new Map());
      m.get(tee)!.set(Number((p as any).hole_number), {
        par: Number((p as any).par),
        si: Number((p as any).stroke_index),
      });
    }
    return m;
  }, [pars]);

  const rpByPlayer = useMemo(() => {
    const m = new Map<string, RoundPlayerRow>();
    for (const rp of roundPlayers) m.set(String(rp.player_id), rp);
    return m;
  }, [roundPlayers]);

  const scoreByPlayerHole = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    for (const s of scores) m.set(`${s.player_id}|${Number(s.hole_number)}`, s);
    return m;
  }, [scores]);

  const computed = useMemo(() => {
    const p1 = members[0] ?? null;
    const p2 = members[1] ?? null;

    const p1Tee: Tee = normalizeTee(p1?.gender);
    const p2Tee: Tee = normalizeTee(p2?.gender);

    const p1Pars = parsByTeeHole.get(p1Tee);
    const p2Pars = parsByTeeHole.get(p2Tee);

    const p1Hcp = Number.isFinite(Number(rpByPlayer.get(p1?.id ?? "")?.playing_handicap))
      ? Number(rpByPlayer.get(p1?.id ?? "")?.playing_handicap)
      : 0;

    const p2Hcp = Number.isFinite(Number(rpByPlayer.get(p2?.id ?? "")?.playing_handicap))
      ? Number(rpByPlayer.get(p2?.id ?? "")?.playing_handicap)
      : 0;

    const holes = Array.from({ length: 18 }, (_, i) => i + 1).map((hole) => {
      // For Better Ball, we use each player's own tee pars for net stableford.
      const p1Par = Number(p1Pars?.get(hole)?.par ?? 0);
      const p1Si = Number(p1Pars?.get(hole)?.si ?? 0);

      const p2Par = Number(p2Pars?.get(hole)?.par ?? 0);
      const p2Si = Number(p2Pars?.get(hole)?.si ?? 0);

      const s1 = p1 ? scoreByPlayerHole.get(`${p1.id}|${hole}`) : undefined;
      const s2 = p2 ? scoreByPlayerHole.get(`${p2.id}|${hole}`) : undefined;

      const p1Pickup = s1?.pickup === true;
      const p2Pickup = s2?.pickup === true;

      const p1Gross = Number.isFinite(Number(s1?.strokes)) ? Number(s1?.strokes) : null;
      const p2Gross = Number.isFinite(Number(s2?.strokes)) ? Number(s2?.strokes) : null;

      const p1Raw = normalizeRawScore(s1?.strokes ?? null, s1?.pickup ?? null);
      const p2Raw = normalizeRawScore(s2?.strokes ?? null, s2?.pickup ?? null);

      const p1Pts =
        p1Raw && p1Par > 0 && p1Si > 0
          ? netStablefordPointsForHole({
              rawScore: p1Raw,
              par: p1Par,
              strokeIndex: p1Si,
              playingHandicap: p1Hcp,
            })
          : 0;

      const p2Pts =
        p2Raw && p2Par > 0 && p2Si > 0
          ? netStablefordPointsForHole({
              rawScore: p2Raw,
              par: p2Par,
              strokeIndex: p2Si,
              playingHandicap: p2Hcp,
            })
          : 0;

      const bb = Math.max(p1Pts, p2Pts);

      const tie = bb > 0 && p1Pts === bb && p2Pts === bb;

      const p1Contrib = bb > 0 && p1Pts === bb;
      const p2Contrib = bb > 0 && p2Pts === bb;

      // Shading based on gross strokes vs par (use THAT player's par)
      const p1Shade = p1Par > 0 ? shadeForGross(p1Gross, p1Pickup, p1Par) : "none";
      const p2Shade = p2Par > 0 ? shadeForGross(p2Gross, p2Pickup, p2Par) : "none";

      return {
        hole,

        p1: { par: p1Par, si: p1Si, gross: p1Gross, pickup: p1Pickup, net: p1Pts, shade: p1Shade, contrib: p1Contrib },
        p2: { par: p2Par, si: p2Si, gross: p2Gross, pickup: p2Pickup, net: p2Pts, shade: p2Shade, contrib: p2Contrib },

        bb,
        tie,
      };
    });

    function split(arr: typeof holes, start: number, end: number) {
      return arr.slice(start, end);
    }
    const front = split(holes, 0, 9);
    const back = split(holes, 9, 18);

    const sumGross = (arr: typeof holes, which: "p1" | "p2") =>
      sumNumericOrZero(arr.map((h) => (h[which].pickup ? 0 : h[which].gross)));

    const sumNet = (arr: typeof holes, which: "p1" | "p2") => sumNumericOrZero(arr.map((h) => h[which].net));
    const sumBB = (arr: typeof holes) => sumNumericOrZero(arr.map((h) => h.bb));

    const contribNet = (arr: typeof holes, which: "p1" | "p2") =>
      sumNumericOrZero(arr.map((h) => (h[which].contrib ? h[which].net : 0)));

    return {
      holes,
      front,
      back,
      totals: {
        out: {
          p1Gross: sumGross(front, "p1"),
          p1Net: sumNet(front, "p1"),
          p2Gross: sumGross(front, "p2"),
          p2Net: sumNet(front, "p2"),
          bb: sumBB(front),
        },
        inn: {
          p1Gross: sumGross(back, "p1"),
          p1Net: sumNet(back, "p1"),
          p2Gross: sumGross(back, "p2"),
          p2Net: sumNet(back, "p2"),
          bb: sumBB(back),
        },
        total: {
          p1Gross: sumGross(holes, "p1"),
          p1Net: sumNet(holes, "p1"),
          p2Gross: sumGross(holes, "p2"),
          p2Net: sumNet(holes, "p2"),
          bb: sumBB(holes),
        },
        contrib: {
          // Contribution totals are the sum of dotted (contributing) NET cells.
          // If tie -> both count, because both will be "contrib".
          p1Net: contribNet(holes, "p1"),
          p2Net: contribNet(holes, "p2"),
        },
      },
    };
  }, [members, parsByTeeHole, rpByPlayer, scoreByPlayerHole]);

  const title = useMemo(() => {
    const rn = typeof round?.round_no === "number" && round.round_no ? `Round ${round.round_no}` : "Round";
    const nm = String(round?.name ?? "").trim();
    const head = nm || rn;

    const pairName = members.length
      ? members.map((m) => m.name).join(" / ")
      : "Pair";

    const c = courseName ? ` · ${courseName}` : "";
    return `${pairName}${c} · ${head}`;
  }, [round, members, courseName]);

  const p1 = members[0] ?? null;
  const p2 = members[1] ?? null;

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      <main className="mx-auto w-full max-w-md px-4 py-4 pb-24">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-semibold">Pairs · Round Detail</div>
            <div className="mt-1 truncate text-sm text-gray-700">{title}</div>
            {dateText ? <div className="mt-1 text-sm text-gray-500">{dateText}</div> : null}
          </div>

          <button
            type="button"
            onClick={goBack}
            className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm font-semibold hover:bg-gray-200 active:bg-gray-300"
          >
            Back
          </button>
        </div>

        {errorMsg ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMsg}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">Loading…</div>
        ) : members.length < 2 ? (
          <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
            This page expects a pair with exactly 2 players. Found: {members.length}.
            <div className="mt-2">
              <Link className="underline" href={`/m/tours/${tourId}/leaderboards`}>
                Go back to leaderboards
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
            {/* Header row */}
            <div className="grid grid-cols-[56px_1fr_1fr_1fr_1fr_1fr] bg-gray-50 text-[11px] font-extrabold text-gray-700 border-b border-gray-200">
              <div className="px-2 py-2 text-left">Hole</div>

              {/* P1 block */}
              <div className="px-2 py-2 text-right">Gross</div>
              <div className="px-2 py-2 text-right border-r-2 border-gray-200">
                Net
                <div className="font-semibold text-[10px] text-gray-500 truncate">
                  {p1?.name ?? "P1"}
                </div>
              </div>

              {/* P2 block */}
              <div className="px-2 py-2 text-right">Gross</div>
              <div className="px-2 py-2 text-right border-r-2 border-gray-200">
                Net
                <div className="font-semibold text-[10px] text-gray-500 truncate">
                  {p2?.name ?? "P2"}
                </div>
              </div>

              {/* BB */}
              <div className="px-2 py-2 text-right">Better Ball</div>
            </div>

            {/* Hole rows */}
            <div className="divide-y divide-gray-100">
              {computed.holes.map((h) => {
                const p1GrossLabel = h.p1.pickup ? "P" : h.p1.gross === null ? "" : String(h.p1.gross);
                const p2GrossLabel = h.p2.pickup ? "P" : h.p2.gross === null ? "" : String(h.p2.gross);

                return (
                  <div
                    key={h.hole}
                    className="grid grid-cols-[56px_1fr_1fr_1fr_1fr_1fr] items-center px-2 py-1"
                  >
                    <div className="text-left text-sm font-extrabold text-gray-900">
                      {h.hole}
                    </div>

                    {/* P1 gross (coloured) */}
                    <div className="flex justify-end">
                      <GrossBox shade={h.p1.shade} label={p1GrossLabel} />
                    </div>

                    {/* P1 net (dotted if contributes) */}
                    <div className="flex justify-end border-r-2 border-gray-200 pr-2">
                      <PointsBox value={h.p1.net} contributed={h.p1.contrib} tied={h.tie && h.p1.contrib} />
                    </div>

                    {/* P2 gross (coloured) */}
                    <div className="flex justify-end">
                      <GrossBox shade={h.p2.shade} label={p2GrossLabel} />
                    </div>

                    {/* P2 net (dotted if contributes) */}
                    <div className="flex justify-end border-r-2 border-gray-200 pr-2">
                      <PointsBox value={h.p2.net} contributed={h.p2.contrib} tied={h.tie && h.p2.contrib} />
                    </div>

                    {/* Better ball */}
                    <div className="flex justify-end">
                      <div className={`${cellBaseClasses()} bg-yellow-50 text-gray-900 border border-yellow-200`}>
                        {h.bb}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Totals rows */}
            <div className="border-t border-gray-200 bg-white">
              {[
                { label: "Out", t: computed.totals.out },
                { label: "In", t: computed.totals.inn },
                { label: "Total", t: computed.totals.total },
              ].map((row) => (
                <div
                  key={row.label}
                  className="grid grid-cols-[56px_1fr_1fr_1fr_1fr_1fr] items-center px-2 py-2 border-t border-gray-100"
                >
                  <div className="text-left text-sm font-extrabold text-gray-900">{row.label}</div>

                  <div className="flex justify-end">
                    <div className={`${cellBaseClasses()} bg-gray-50 text-gray-900 border border-gray-200`}>
                      {row.t.p1Gross}
                    </div>
                  </div>

                  <div className="flex justify-end border-r-2 border-gray-200 pr-2">
                    <div className={`${cellBaseClasses()} bg-gray-50 text-gray-900 border border-gray-200`}>
                      {row.t.p1Net}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <div className={`${cellBaseClasses()} bg-gray-50 text-gray-900 border border-gray-200`}>
                      {row.t.p2Gross}
                    </div>
                  </div>

                  <div className="flex justify-end border-r-2 border-gray-200 pr-2">
                    <div className={`${cellBaseClasses()} bg-gray-50 text-gray-900 border border-gray-200`}>
                      {row.t.p2Net}
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <div className={`${cellBaseClasses()} bg-yellow-100 text-gray-900 border border-yellow-200`}>
                      {row.t.bb}
                    </div>
                  </div>
                </div>
              ))}

              {/* Contribution row (NET ONLY in each player's NET column; BB column blank) */}
              <div className="grid grid-cols-[56px_1fr_1fr_1fr_1fr_1fr] items-center px-2 py-2 border-t-2 border-gray-200 bg-white">
                <div className="text-left text-sm font-extrabold text-gray-900">Contrib</div>

                {/* P1 gross blank */}
                <div className="flex justify-end">
                  <div className={`${cellBaseClasses()} bg-white text-gray-900 border border-transparent`}></div>
                </div>

                {/* P1 net contrib */}
                <div className="flex justify-end border-r-2 border-gray-200 pr-2">
                  <div className={`${cellBaseClasses()} bg-white text-gray-900 border-2 border-dashed border-gray-600`}>
                    {computed.totals.contrib.p1Net}
                  </div>
                </div>

                {/* P2 gross blank */}
                <div className="flex justify-end">
                  <div className={`${cellBaseClasses()} bg-white text-gray-900 border border-transparent`}></div>
                </div>

                {/* P2 net contrib */}
                <div className="flex justify-end border-r-2 border-gray-200 pr-2">
                  <div className={`${cellBaseClasses()} bg-white text-gray-900 border-2 border-dashed border-gray-600`}>
                    {computed.totals.contrib.p2Net}
                  </div>
                </div>

                {/* Better Ball blank (per your requirement) */}
                <div className="flex justify-end">
                  <div className={`${cellBaseClasses()} bg-white text-gray-900 border border-transparent`}></div>
                </div>
              </div>
            </div>

            {/* Small legend */}
            <div className="border-t border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-700">
              <div className="font-semibold text-gray-900">Legend</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <div className="rounded-md px-3 py-2 font-bold border border-gray-300 bg-white">
                  Gross colouring: Ace/Albatross{" "}
                  <span className="ml-2 inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: BLUE_ACE }} />
                </div>
                <div className="rounded-md px-3 py-2 font-bold border border-gray-300 bg-white">
                  Eagle{" "}
                  <span className="ml-2 inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: BLUE_EAGLE }} />
                </div>
                <div className="rounded-md px-3 py-2 font-bold border border-gray-300 bg-white">
                  Birdie{" "}
                  <span className="ml-2 inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: BLUE_BIRDIE }} />
                </div>
                <div className="rounded-md px-3 py-2 font-bold border border-gray-300 bg-white">
                  Par{" "}
                  <span className="ml-2 inline-block h-3 w-3 rounded-sm border border-gray-300 bg-white" />
                </div>
                <div className="rounded-md px-3 py-2 font-bold border border-gray-300 bg-white">
                  Bogey{" "}
                  <span className="ml-2 inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: "#f8cfcf" }} />
                </div>
                <div className="rounded-md px-3 py-2 font-bold border border-gray-300 bg-white">
                  D. Bogey+ / Pickup{" "}
                  <span className="ml-2 inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: "#c0392b" }} />
                </div>
                <div className="rounded-md px-3 py-2 font-bold border border-gray-300 bg-white">
                  Contributing net{" "}
                  <span className="ml-2 inline-block h-3 w-3 rounded-sm border-2 border-dashed border-gray-600 bg-white" />
                </div>
                <div className="rounded-md px-3 py-2 font-bold border border-gray-300 bg-white">
                  Tie (both count){" "}
                  <span className="ml-2 inline-block h-3 w-3 rounded-sm border-2 border-gray-900 bg-white" />
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
