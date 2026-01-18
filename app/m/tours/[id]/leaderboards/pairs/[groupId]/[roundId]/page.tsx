"use client";

import React, { useEffect, useMemo, useState } from "react";
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
  course_id: string | null;
  courses?: { name: string } | null;
};

type GroupMemberRow = {
  group_id: string;
  player_id: string;
  position: number | null;
  players?: { id: string; name: string; gender?: string | null } | { id: string; name: string; gender?: string | null }[] | null;
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

function shadeForGross(gross: number | null, pickup: boolean | null | undefined, par: number): Shade {
  // ✅ Null-safe + matches earlier conventions
  if (pickup) return "dbogey";
  if (gross === null || gross === undefined) return "none";
  if (!Number.isFinite(Number(gross))) return "none";

  const diff = Number(gross) - Number(par);
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

function sumNums(vals: Array<number>) {
  return vals.reduce((s, x) => s + (Number.isFinite(Number(x)) ? Number(x) : 0), 0);
}

/* ----------------------------------
   UI components
----------------------------------- */
function GrossBox({
  shade,
  label,
}: {
  shade: Shade;
  label: string | number;
}) {
  const isBlue = shade === "ace" || shade === "eagle" || shade === "birdie";

  const base = "min-w-[28px] px-1.5 py-0.5 rounded text-center text-sm font-extrabold";

  const className =
    shade === "par"
      ? `${base} bg-white text-gray-900 border border-gray-300`
      : shade === "bogey"
      ? `${base} bg-[#f8cfcf] text-gray-900`
      : shade === "dbogey"
      ? `${base} bg-[#c0392b] text-white`
      : `${base} bg-transparent text-gray-900`;

  return (
    <div className={className} style={isBlue ? blueStyleForShade(shade) : undefined}>
      {label}
    </div>
  );
}

function StablefordCell({
  value,
  contributes,
  tieBox,
}: {
  value: number;
  contributes: boolean;
  tieBox: boolean;
}) {
  // tieBox = solid box around BOTH players (implemented as outer solid)
  // contributes = dotted box around stableford score (inner dotted)
  const outer =
    tieBox ? "inline-flex rounded-md border-2 border-slate-700 p-[2px]" : "inline-flex rounded-md border border-transparent p-[2px]";
  const inner =
    contributes
      ? "inline-flex min-w-[36px] justify-end rounded-md border-2 border-dotted border-slate-700 px-2 py-1 text-sm font-extrabold"
      : "inline-flex min-w-[36px] justify-end rounded-md border border-transparent px-2 py-1 text-sm font-semibold";

  return (
    <span className={outer}>
      <span className={inner}>{value}</span>
    </span>
  );
}

/* ----------------------------------
   Page
----------------------------------- */
export default function MobilePairsRoundDetailPage() {
  const params = useParams<{ id?: string; groupId?: string; roundId?: string }>();
  const router = useRouter();

  const tourId = String(params?.id ?? "").trim();
  const groupId = String(params?.groupId ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [round, setRound] = useState<RoundRow | null>(null);
  const [members, setMembers] = useState<Array<{ id: string; name: string; gender?: string | null }>>([]);
  const [hcps, setHcps] = useState<Map<string, number>>(new Map());

  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);

  function goBack() {
    // back to leaderboards page (pairs tab is inside)
    if (tourId) router.push(`/m/tours/${tourId}/leaderboards`);
    else router.push(`/m`);
  }

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!tourId || !groupId || !roundId) return;

      setLoading(true);
      setErrorMsg("");

      try {
        // Round (with course)
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,tour_id,name,round_no,played_on,course_id,courses(name)")
          .eq("id", roundId)
          .eq("tour_id", tourId)
          .single();
        if (rErr) throw rErr;

        const courseId = String((rData as any)?.course_id ?? "");

        // Group members (pair)
        const { data: gmData, error: gmErr } = await supabase
          .from("tour_group_members")
          .select("group_id,player_id,position,players(id,name,gender)")
          .eq("group_id", groupId);
        if (gmErr) throw gmErr;

        const gm = (gmData ?? []) as unknown as GroupMemberRow[];
        gm.sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || String(a.player_id).localeCompare(String(b.player_id)));

        const mem = gm
          .map((row) => {
            const pl = asSingle((row as any).players) as any;
            return {
              id: String(row.player_id),
              name: String(pl?.name ?? "(player)"),
              gender: (pl?.gender as any) ?? null,
            };
          })
          .filter((x) => !!x.id);

        // enforce pair = first 2
        const mem2 = mem.slice(0, 2);
        const playerIds = mem2.map((m) => m.id);

        // round_players (hcp)
        let hcpMap = new Map<string, number>();
        if (playerIds.length) {
          const { data: rpData, error: rpErr } = await supabase
            .from("round_players")
            .select("round_id,player_id,playing,playing_handicap")
            .eq("round_id", roundId)
            .in("player_id", playerIds);
          if (rpErr) throw rpErr;

          for (const row of (rpData ?? []) as any[]) {
            const pid = String(row.player_id);
            const h = Number.isFinite(Number(row.playing_handicap)) ? Number(row.playing_handicap) : 0;
            hcpMap.set(pid, h);
          }
        }

        // scores (pair players)
        let sc: ScoreRow[] = [];
        if (playerIds.length) {
          const { data: sData, error: sErr } = await supabase
            .from("scores")
            .select("round_id,player_id,hole_number,strokes,pickup")
            .eq("round_id", roundId)
            .in("player_id", playerIds);
          if (sErr) throw sErr;
          sc = (sData ?? []) as any;
        }

        // pars (both tees) for course
        let pr: ParRow[] = [];
        if (courseId) {
          const { data: pData, error: pErr } = await supabase
            .from("pars")
            .select("course_id,hole_number,tee,par,stroke_index")
            .eq("course_id", courseId)
            .in("tee", ["M", "F"])
            .order("hole_number", { ascending: true });
          if (pErr) throw pErr;

          pr = (pData ?? []).map((x: any) => ({
            course_id: String(x.course_id),
            hole_number: Number(x.hole_number),
            tee: normalizeTee(x.tee),
            par: Number(x.par),
            stroke_index: Number(x.stroke_index),
          }));
        }

        if (!alive) return;

        setRound(rData as any);
        setMembers(mem2);
        setHcps(hcpMap);
        setScores(sc);
        setPars(pr);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load pair round detail.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [tourId, groupId, roundId]);

  const parsByTeeHole = useMemo(() => {
    const m = new Map<Tee, Map<number, { par: number; si: number }>>();
    m.set("M", new Map());
    m.set("F", new Map());

    for (const p of pars) {
      if (!m.has(p.tee)) m.set(p.tee, new Map());
      m.get(p.tee)!.set(p.hole_number, { par: p.par, si: p.stroke_index });
    }
    return m;
  }, [pars]);

  const scoreByPlayerHole = useMemo(() => {
    const m = new Map<string, Map<number, ScoreRow>>();
    for (const s of scores) {
      const pid = String(s.player_id);
      if (!m.has(pid)) m.set(pid, new Map());
      m.get(pid)!.set(Number(s.hole_number), s);
    }
    return m;
  }, [scores]);

  const headerTitle = useMemo(() => {
    const courseName = round?.courses?.name ? ` – ${round.courses.name}` : "";
    const roundNo = typeof round?.round_no === "number" && round.round_no ? `Round ${round.round_no}` : "Round";
    const rname = (round?.name ?? "").trim();
    return `${rname || roundNo}${courseName}`;
  }, [round]);

  const dateText = useMemo(() => formatDate(round?.played_on ?? null), [round?.played_on]);

  const p1 = members[0] ?? null;
  const p2 = members[1] ?? null;

  const tableRows = useMemo(() => {
    const holes = [];

    const p1Id = p1?.id ?? "";
    const p2Id = p2?.id ?? "";
    const p1Tee: Tee = normalizeTee(p1?.gender);
    const p2Tee: Tee = normalizeTee(p2?.gender);

    const p1Pars = parsByTeeHole.get(p1Tee) ?? new Map();
    const p2Pars = parsByTeeHole.get(p2Tee) ?? new Map();

    const p1Hcp = hcps.get(p1Id) ?? 0;
    const p2Hcp = hcps.get(p2Id) ?? 0;

    for (let hole = 1; hole <= 18; hole++) {
      const pr1 = p1Pars.get(hole);
      const pr2 = p2Pars.get(hole);

      // if we have no pars, we can’t compute properly
      const parForColour = pr1?.par ?? pr2?.par ?? 0;

      const s1 = p1Id ? scoreByPlayerHole.get(p1Id)?.get(hole) : undefined;
      const s2 = p2Id ? scoreByPlayerHole.get(p2Id)?.get(hole) : undefined;

      const p1Pickup = s1?.pickup === true;
      const p2Pickup = s2?.pickup === true;

      const p1Gross = Number.isFinite(Number(s1?.strokes)) ? Number(s1?.strokes) : null;
      const p2Gross = Number.isFinite(Number(s2?.strokes)) ? Number(s2?.strokes) : null;

      const p1Raw = normalizeRawScore(s1?.strokes ?? null, s1?.pickup ?? null);
      const p2Raw = normalizeRawScore(s2?.strokes ?? null, s2?.pickup ?? null);

      const p1Pts =
        pr1 && pr1.par > 0 && pr1.si > 0 && p1Raw
          ? netStablefordPointsForHole({
              rawScore: p1Raw,
              par: pr1.par,
              strokeIndex: pr1.si,
              playingHandicap: p1Hcp,
            })
          : 0;

      const p2Pts =
        pr2 && pr2.par > 0 && pr2.si > 0 && p2Raw
          ? netStablefordPointsForHole({
              rawScore: p2Raw,
              par: pr2.par,
              strokeIndex: pr2.si,
              playingHandicap: p2Hcp,
            })
          : 0;

      const bb = Math.max(p1Pts, p2Pts);

      const tie = p1Pts === p2Pts && bb > 0;
      const p1Contrib = tie ? bb > 0 : p1Pts === bb && bb > 0;
      const p2Contrib = tie ? bb > 0 : p2Pts === bb && bb > 0;

      const p1Shade = shadeForGross(p1Gross, p1Pickup, parForColour);
      const p2Shade = shadeForGross(p2Gross, p2Pickup, parForColour);

      // contribution sum: add stableford of any player who contributed; if tie, add both
      const contribSum = (p1Contrib ? p1Pts : 0) + (p2Contrib ? p2Pts : 0);

      holes.push({
        hole,
        parForColour,

        p1Gross,
        p1Pickup,
        p1Pts,
        p1Shade,
        p1Contrib,

        p2Gross,
        p2Pickup,
        p2Pts,
        p2Shade,
        p2Contrib,

        tie,
        bb,
        contribSum,
      });
    }

    return holes;
  }, [p1, p2, parsByTeeHole, scoreByPlayerHole, hcps]);

  const totals = useMemo(() => {
    const front = tableRows.slice(0, 9);
    const back = tableRows.slice(9, 18);

    const mk = (arr: typeof tableRows) => {
      return {
        p1Pts: sumNums(arr.map((x) => x.p1Pts)),
        p2Pts: sumNums(arr.map((x) => x.p2Pts)),
        bb: sumNums(arr.map((x) => x.bb)),
        contrib: sumNums(arr.map((x) => x.contribSum)),
      };
    };

    return {
      front: mk(front),
      back: mk(back),
      total: mk(tableRows),
    };
  }, [tableRows]);

  return (
    <div className="bg-white text-slate-900 min-h-dvh">
      <main className="mx-auto w-full max-w-md px-4 py-4 pb-24">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-semibold">Pairs · Round Detail</div>
            <div className="mt-1 truncate text-sm text-slate-700">{headerTitle}</div>
            {dateText ? <div className="mt-1 text-sm text-slate-500">{dateText}</div> : null}
          </div>

          <button
            type="button"
            onClick={goBack}
            className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm font-semibold hover:bg-slate-200 active:bg-slate-300"
          >
            Back
          </button>
        </div>

        {p1 && p2 ? (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="text-sm font-extrabold text-slate-900">
              {p1.name}{" "}
              <span className="font-semibold text-slate-500">· HCP {hcps.get(p1.id) ?? 0}</span>
            </div>
            <div className="mt-1 text-sm font-extrabold text-slate-900">
              {p2.name}{" "}
              <span className="font-semibold text-slate-500">· HCP {hcps.get(p2.id) ?? 0}</span>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            This group does not have two members yet.
          </div>
        )}

        {errorMsg ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorMsg}</div>
        ) : null}

        {loading ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">Loading…</div>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="px-2 py-2 text-left text-xs font-semibold text-slate-700">Hole</th>
                  <th className="px-2 py-2 text-center text-xs font-semibold text-slate-700">{p1?.name ?? "P1"} G</th>
                  <th className="px-2 py-2 text-center text-xs font-semibold text-slate-700">{p1?.name ?? "P1"} Pts</th>
                  <th className="px-2 py-2 text-center text-xs font-semibold text-slate-700">{p2?.name ?? "P2"} G</th>
                  <th className="px-2 py-2 text-center text-xs font-semibold text-slate-700">{p2?.name ?? "P2"} Pts</th>
                  <th className="px-2 py-2 text-center text-xs font-semibold text-slate-700">BB</th>
                </tr>
              </thead>

              <tbody>
                {tableRows.map((r) => {
                  const p1GrossLabel = r.p1Pickup ? "P" : r.p1Gross ?? "";
                  const p2GrossLabel = r.p2Pickup ? "P" : r.p2Gross ?? "";

                  return (
                    <tr key={r.hole} className="border-b last:border-b-0">
                      <td className="px-2 py-2 text-sm font-semibold text-slate-900">{r.hole}</td>

                      {/* P1 gross (coloured) */}
                      <td className="px-2 py-2">
                        <div className="flex justify-center">
                          <GrossBox shade={r.p1Shade} label={p1GrossLabel} />
                        </div>
                      </td>

                      {/* P1 stableford (dotted if contributes; solid outer if tie) */}
                      <td className="px-2 py-2">
                        <div className="flex justify-center">
                          <StablefordCell value={r.p1Pts} contributes={r.p1Contrib} tieBox={r.tie} />
                        </div>
                      </td>

                      {/* P2 gross (coloured) */}
                      <td className="px-2 py-2">
                        <div className="flex justify-center">
                          <GrossBox shade={r.p2Shade} label={p2GrossLabel} />
                        </div>
                      </td>

                      {/* P2 stableford */}
                      <td className="px-2 py-2">
                        <div className="flex justify-center">
                          <StablefordCell value={r.p2Pts} contributes={r.p2Contrib} tieBox={r.tie} />
                        </div>
                      </td>

                      {/* Better ball stableford */}
                      <td className="px-2 py-2 text-center text-sm font-extrabold text-slate-900">{r.bb}</td>
                    </tr>
                  );
                })}

                {/* Totals: Front 9 */}
                <tr className="border-t bg-slate-50">
                  <td className="px-2 py-2 text-sm font-extrabold text-slate-900">Out</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-center text-sm font-extrabold">{totals.front.p1Pts}</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-center text-sm font-extrabold">{totals.front.p2Pts}</td>
                  <td className="px-2 py-2 text-center text-sm font-extrabold">{totals.front.bb}</td>
                </tr>

                {/* Totals: Back 9 */}
                <tr className="bg-slate-50">
                  <td className="px-2 py-2 text-sm font-extrabold text-slate-900">In</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-center text-sm font-extrabold">{totals.back.p1Pts}</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-center text-sm font-extrabold">{totals.back.p2Pts}</td>
                  <td className="px-2 py-2 text-center text-sm font-extrabold">{totals.back.bb}</td>
                </tr>

                {/* Totals: Total */}
                <tr className="bg-slate-50 border-b">
                  <td className="px-2 py-2 text-sm font-extrabold text-slate-900">Total</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-center text-sm font-extrabold">{totals.total.p1Pts}</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-center text-sm font-extrabold">{totals.total.p2Pts}</td>
                  <td className="px-2 py-2 text-center text-sm font-extrabold">{totals.total.bb}</td>
                </tr>

                {/* Contribution line: ONLY total shown in stableford score column (we show it under BB) */}
                <tr>
                  <td className="px-2 py-2 text-sm font-semibold text-slate-700">Contrib</td>
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2" />
                  <td className="px-2 py-2 text-center text-sm font-extrabold text-slate-900">{totals.total.contrib}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Legend (gross colouring) */}
        <div className="mt-4 flex flex-wrap gap-2">
          <div className="rounded-md px-3 py-2 text-sm font-bold border border-slate-300 bg-slate-50 text-slate-900">
            Ace/Albatross{" "}
            <span className="ml-2 inline-block w-3 h-3 align-middle rounded-sm" style={{ backgroundColor: BLUE_ACE }} />
          </div>
          <div className="rounded-md px-3 py-2 text-sm font-bold border border-slate-300 bg-slate-50 text-slate-900">
            Eagle{" "}
            <span className="ml-2 inline-block w-3 h-3 align-middle rounded-sm" style={{ backgroundColor: BLUE_EAGLE }} />
          </div>
          <div className="rounded-md px-3 py-2 text-sm font-bold border border-slate-300 bg-slate-50 text-slate-900">
            Birdie{" "}
            <span className="ml-2 inline-block w-3 h-3 align-middle rounded-sm" style={{ backgroundColor: BLUE_BIRDIE }} />
          </div>
          <div className="rounded-md px-3 py-2 text-sm font-bold border border-slate-300 bg-slate-50 text-slate-900">
            Par <span className="ml-2 inline-block w-3 h-3 align-middle rounded-sm bg-white border border-slate-300" />
          </div>
          <div className="rounded-md px-3 py-2 text-sm font-bold border border-slate-300 bg-slate-50 text-slate-900">
            Bogey <span className="ml-2 inline-block w-3 h-3 align-middle rounded-sm" style={{ backgroundColor: "#f8cfcf" }} />
          </div>
          <div className="rounded-md px-3 py-2 text-sm font-bold border border-slate-300 bg-slate-50 text-slate-900">
            D. Bogey + <span className="ml-2 inline-block w-3 h-3 align-middle rounded-sm" style={{ backgroundColor: "#c0392b" }} />
          </div>
        </div>

        <div className="mt-3 text-xs text-slate-600">
          Note: Gross strokes are coloured by gross vs par. Dotted boxes indicate which player score(s) contributed to the Better Ball.
          If both players tied on Stableford for a hole, both scores are boxed.
        </div>
      </main>
    </div>
  );
}
