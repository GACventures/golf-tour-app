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
  created_at: string | null;
  course_id: string | null;
  courses?: { name: string } | { name: string }[] | null;
};

type PlayerRow = {
  id: string;
  name: string;
  gender?: string | null;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean | null;
  playing_handicap: number | null;
};

type GroupMemberRow = {
  group_id: string;
  player_id: string;
  position: number | null;
  players?: { id: string; name: string; gender?: string | null } | null;
};

type ParRow = {
  course_id: string;
  hole_number: number;
  tee: Tee;
  par: number;
  stroke_index: number;
};

type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean | null;
};

type Shade = "ace" | "eagle" | "birdie" | "par" | "bogey" | "dbogey" | "none";

/**
 * Blue palette (distinct shades)
 * (DO NOT CHANGE — keep scorebox colours)
 */
const BLUE_ACE = "#082B5C";
const BLUE_EAGLE = "#1757D6";
const BLUE_BIRDIE = "#4DA3FF";

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function asSingle<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function parseDateForDisplay(s: string | null | undefined): Date | null {
  if (!s) return null;
  const raw = String(s).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const iso = isDateOnly ? `${raw}T00:00:00.000Z` : raw;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateAuMelbourne(iso: string | null | undefined) {
  const d = parseDateForDisplay(iso);
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

function normalizeRawScore(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  const n = Number(strokes);
  return Number.isFinite(n) ? String(n) : "";
}

function shadeForGross(gross: number | null, pickup: boolean | null | undefined, par: number): Shade {
  if (pickup) return "dbogey";
  if (!Number.isFinite(Number(gross))) return "none";

  const diff = Number(gross) - Number(par);
  if (diff <= -3) return "ace";
  if (diff === -2) return "eagle";
  if (diff === -1) return "birdie";
  if (diff === 0) return "par";
  if (diff === 1) return "bogey";
  return "dbogey";
}

function blueStyleForShade(s: Shade): React.CSSProperties | undefined {
  if (s === "ace") return { backgroundColor: BLUE_ACE, color: "white" };
  if (s === "eagle") return { backgroundColor: BLUE_EAGLE, color: "white" };
  if (s === "birdie") return { backgroundColor: BLUE_BIRDIE, color: "white" };
  return undefined;
}

function GrossBox({ shade, label }: { shade: Shade; label: string | number }) {
  const isBlue = shade === "ace" || shade === "eagle" || shade === "birdie";

  // keep scorebox colours unchanged
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

function NetCell({
  value,
  contributes,
  tie,
}: {
  value: number;
  contributes: boolean;
  tie: boolean;
}) {
  // DOTTED border indicates contribution (around stableford)
  // If TIE (same stableford), also add a SOLID outline around both.
  const base = "inline-flex min-w-[34px] justify-center rounded-md px-2 py-1 text-sm font-extrabold";
  const dotted = contributes ? "border-2 border-dotted border-gray-900" : "border border-transparent";
  const tieOutline = contributes && tie ? "outline outline-2 outline-gray-900" : "";

  return <span className={`${base} ${dotted} ${tieOutline}`}>{value}</span>;
}

export default function MobilePairRoundDetailPage() {
  const params = useParams<{ id?: string; groupId?: string; roundId?: string }>();
  const router = useRouter();

  const tourId = String(params?.id ?? "").trim();
  const groupId = String(params?.groupId ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [round, setRound] = useState<RoundRow | null>(null);

  const [p1, setP1] = useState<PlayerRow | null>(null);
  const [p2, setP2] = useState<PlayerRow | null>(null);

  const [hcp1, setHcp1] = useState<number>(0);
  const [hcp2, setHcp2] = useState<number>(0);

  const [pars, setPars] = useState<ParRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);

  function goBack() {
    // go back to leaderboards (pairs tab can be re-selected there)
    if (tourId) router.push(`/m/tours/${tourId}/leaderboards`);
    else router.push(`/m`);
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

        // Pair members (join players)
        const { data: gmData, error: gmErr } = await supabase
          .from("tour_group_members")
          .select("group_id,player_id,position,players(id,name,gender)")
          .eq("group_id", groupId);
        if (gmErr) throw gmErr;

        const members = (gmData ?? []) as GroupMemberRow[];
        members.sort((a, b) => (a.position ?? 999) - (b.position ?? 999) || a.player_id.localeCompare(b.player_id));

        const ids = members.map((m) => String(m.player_id)).filter(Boolean);
        const pid1 = ids[0] ?? "";
        const pid2 = ids[1] ?? "";

        if (!pid1 || !pid2) {
          throw new Error("This pair does not have exactly 2 members.");
        }

        const pl1 = members.find((m) => String(m.player_id) === pid1)?.players ?? null;
        const pl2 = members.find((m) => String(m.player_id) === pid2)?.players ?? null;

        // Round players (playing_handicap)
        const { data: rpData, error: rpErr } = await supabase
          .from("round_players")
          .select("round_id,player_id,playing,playing_handicap")
          .eq("round_id", roundId)
          .in("player_id", [pid1, pid2]);
        if (rpErr) throw rpErr;

        const rpRows = (rpData ?? []) as RoundPlayerRow[];
        const rp1 = rpRows.find((x) => String(x.player_id) === pid1);
        const rp2 = rpRows.find((x) => String(x.player_id) === pid2);

        const ph1 = Number.isFinite(Number(rp1?.playing_handicap)) ? Number(rp1?.playing_handicap) : 0;
        const ph2 = Number.isFinite(Number(rp2?.playing_handicap)) ? Number(rp2?.playing_handicap) : 0;

        // Scores for both players
        const { data: sData, error: sErr } = await supabase
          .from("scores")
          .select("round_id,player_id,hole_number,strokes,pickup")
          .eq("round_id", roundId)
          .in("player_id", [pid1, pid2]);
        if (sErr) throw sErr;

        // Pars for course (both tees)
        let parRows: ParRow[] = [];
        if (courseId) {
          const { data: pData, error: pErr } = await supabase
            .from("pars")
            .select("course_id,hole_number,tee,par,stroke_index")
            .eq("course_id", courseId)
            .in("tee", ["M", "F"])
            .order("hole_number", { ascending: true });
          if (pErr) throw pErr;

          parRows = (pData ?? []).map((x: any) => ({
            course_id: String(x.course_id),
            hole_number: Number(x.hole_number),
            tee: normalizeTee(x.tee),
            par: Number(x.par),
            stroke_index: Number(x.stroke_index),
          }));
        }

        if (cancelled) return;

        setRound(rData as any);

        setP1({
          id: String(pl1?.id ?? pid1),
          name: String(pl1?.name ?? pid1),
          gender: (pl1 as any)?.gender ?? null,
        });
        setP2({
          id: String(pl2?.id ?? pid2),
          name: String(pl2?.name ?? pid2),
          gender: (pl2 as any)?.gender ?? null,
        });

        setHcp1(ph1);
        setHcp2(ph2);

        setScores((sData ?? []) as any);
        setPars(parRows);
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

  const parsByTeeHole = useMemo(() => {
    const m = new Map<Tee, Map<number, { par: number; si: number }>>();
    m.set("M", new Map());
    m.set("F", new Map());
    for (const r of pars) {
      if (!m.has(r.tee)) m.set(r.tee, new Map());
      m.get(r.tee)!.set(Number(r.hole_number), { par: Number(r.par), si: Number(r.stroke_index) });
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

  const computed = useMemo(() => {
    const pid1 = p1?.id ?? "";
    const pid2 = p2?.id ?? "";

    const tee1: Tee = normalizeTee(p1?.gender);
    const tee2: Tee = normalizeTee(p2?.gender);

    const holes = Array.from({ length: 18 }, (_, i) => i + 1).map((hole) => {
      const pr1 = parsByTeeHole.get(tee1)?.get(hole);
      const pr2 = parsByTeeHole.get(tee2)?.get(hole);

      const sc1 = pid1 ? scoreByPlayerHole.get(pid1)?.get(hole) : undefined;
      const sc2 = pid2 ? scoreByPlayerHole.get(pid2)?.get(hole) : undefined;

      const pickup1 = sc1?.pickup === true;
      const pickup2 = sc2?.pickup === true;

      const gross1 = Number.isFinite(Number(sc1?.strokes)) ? Number(sc1?.strokes) : null;
      const gross2 = Number.isFinite(Number(sc2?.strokes)) ? Number(sc2?.strokes) : null;

      const raw1 = normalizeRawScore(sc1?.strokes ?? null, sc1?.pickup ?? null);
      const raw2 = normalizeRawScore(sc2?.strokes ?? null, sc2?.pickup ?? null);

      const par1 = Number(pr1?.par ?? 0);
      const si1 = Number(pr1?.si ?? 0);

      const par2 = Number(pr2?.par ?? 0);
      const si2 = Number(pr2?.si ?? 0);

      const net1 =
        raw1 && par1 > 0 && si1 > 0
          ? netStablefordPointsForHole({
              rawScore: raw1,
              par: par1,
              strokeIndex: si1,
              playingHandicap: hcp1,
            })
          : 0;

      const net2 =
        raw2 && par2 > 0 && si2 > 0
          ? netStablefordPointsForHole({
              rawScore: raw2,
              par: par2,
              strokeIndex: si2,
              playingHandicap: hcp2,
            })
          : 0;

      const better = Math.max(net1, net2);
      const tie = net1 === net2;

      const c1 = net1 === better;
      const c2 = net2 === better;

      const shade1 = par1 > 0 && (pickup1 || gross1 !== null) ? shadeForGross(gross1, pickup1, par1) : "none";
      const shade2 = par2 > 0 && (pickup2 || gross2 !== null) ? shadeForGross(gross2, pickup2, par2) : "none";

      return {
        hole,
        gross1,
        gross2,
        pickup1,
        pickup2,
        net1,
        net2,
        better,
        c1,
        c2,
        tie,
        shade1,
        shade2,
      };
    });

    const sum = (arr: typeof holes) => {
      const gross1 = arr.reduce((s, x) => s + (Number.isFinite(Number(x.gross1)) ? Number(x.gross1) : 0), 0);
      const gross2 = arr.reduce((s, x) => s + (Number.isFinite(Number(x.gross2)) ? Number(x.gross2) : 0), 0);
      const net1 = arr.reduce((s, x) => s + (Number.isFinite(Number(x.net1)) ? Number(x.net1) : 0), 0);
      const net2 = arr.reduce((s, x) => s + (Number.isFinite(Number(x.net2)) ? Number(x.net2) : 0), 0);
      const better = arr.reduce((s, x) => s + (Number.isFinite(Number(x.better)) ? Number(x.better) : 0), 0);
      return { gross1, gross2, net1, net2, better };
    };

    const front = holes.slice(0, 9);
    const back = holes.slice(9);

    const contribTotal = holes.reduce((s, x) => {
      // Contribution line: sum of all stableford scores that contributed (count both on ties)
      const add1 = x.c1 ? x.net1 : 0;
      const add2 = x.c2 ? x.net2 : 0;
      return s + add1 + add2;
    }, 0);

    return {
      holes,
      front,
      back,
      out: sum(front),
      inn: sum(back),
      total: sum(holes),
      contribTotal,
    };
  }, [p1?.id, p2?.id, p1?.gender, p2?.gender, hcp1, hcp2, parsByTeeHole, scoreByPlayerHole]);

  const headerTitle = useMemo(() => {
    const courseName = safeCourseName(round?.courses);
    const roundNo = typeof round?.round_no === "number" && round.round_no ? `Round ${round.round_no}` : "Round";
    const rname = (round?.name ?? "").trim();
    return `${rname || roundNo}${courseName ? ` – ${courseName}` : ""}`;
  }, [round]);

  const dateText = useMemo(() => {
    const iso = round?.played_on ?? round?.created_at ?? null;
    return formatDateAuMelbourne(iso);
  }, [round?.played_on, round?.created_at]);

  const pairName = useMemo(() => {
    const n1 = p1?.name ?? "(player 1)";
    const n2 = p2?.name ?? "(player 2)";
    return `${n1} / ${n2}`;
  }, [p1?.name, p2?.name]);

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

        {errorMsg ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorMsg}</div>
        ) : null}

        {loading ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">Loading…</div>
        ) : (
          <>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-lg font-extrabold text-slate-900 truncate">{pairName}</div>
              <div className="mt-1 text-sm text-slate-700">
                HCP:{" "}
                <span className="font-semibold text-slate-900">
                  {p1?.name ?? "P1"} [{hcp1}]
                </span>{" "}
                ·{" "}
                <span className="font-semibold text-slate-900">
                  {p2?.name ?? "P2"} [{hcp2}]
                </span>
              </div>
            </div>

            {/* Table */}
            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full border-collapse">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700">
                      Hole
                    </th>

                    <th className="border-b border-slate-200 px-3 py-2 text-center text-xs font-semibold text-slate-700">
                      {p1?.name ?? "Player 1"} (Gross)
                    </th>
                    <th className="border-b border-slate-200 px-3 py-2 text-center text-xs font-semibold text-slate-700">
                      {p1?.name ?? "Player 1"} (Net)
                    </th>

                    <th className="border-b border-slate-200 px-3 py-2 text-center text-xs font-semibold text-slate-700">
                      {p2?.name ?? "Player 2"} (Gross)
                    </th>
                    <th className="border-b border-slate-200 px-3 py-2 text-center text-xs font-semibold text-slate-700">
                      {p2?.name ?? "Player 2"} (Net)
                    </th>

                    <th className="border-b border-slate-200 px-3 py-2 text-center text-xs font-semibold text-slate-700">
                      Better Ball
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {computed.holes.map((h) => {
                    const g1Label = h.pickup1 ? "P" : h.gross1 ?? "";
                    const g2Label = h.pickup2 ? "P" : h.gross2 ?? "";

                    return (
                      <tr key={h.hole} className="border-b last:border-b-0">
                        <td className="px-3 py-2 text-left text-sm font-semibold text-slate-900">{h.hole}</td>

                        {/* P1 gross (coloured) */}
                        <td className="px-3 py-2 text-center">
                          <div className="inline-flex items-center justify-center">
                            <GrossBox shade={h.shade1} label={g1Label} />
                          </div>
                        </td>

                        {/* P1 net (dotted if contributes; dotted+solid outline if tie) */}
                        <td className="px-3 py-2 text-center">
                          <NetCell value={h.net1} contributes={h.c1} tie={h.tie} />
                        </td>

                        {/* P2 gross (coloured) */}
                        <td className="px-3 py-2 text-center">
                          <div className="inline-flex items-center justify-center">
                            <GrossBox shade={h.shade2} label={g2Label} />
                          </div>
                        </td>

                        {/* P2 net */}
                        <td className="px-3 py-2 text-center">
                          <NetCell value={h.net2} contributes={h.c2} tie={h.tie} />
                        </td>

                        {/* Better ball */}
                        <td className="px-3 py-2 text-center">
                          <span className="inline-flex min-w-[34px] justify-center rounded-md bg-slate-100 px-2 py-1 text-sm font-extrabold text-slate-900">
                            {h.better}
                          </span>
                        </td>
                      </tr>
                    );
                  })}

                  {/* OUT */}
                  <tr className="bg-slate-50 border-t border-slate-200">
                    <td className="px-3 py-2 text-left text-sm font-extrabold text-slate-900">Out</td>
                    <td className="px-3 py-2 text-center text-sm font-extrabold">{computed.out.gross1}</td>
                    <td className="px-3 py-2 text-center text-sm font-extrabold">{computed.out.net1}</td>
                    <td className="px-3 py-2 text-center text-sm font-extrabold">{computed.out.gross2}</td>
                    <td className="px-3 py-2 text-center text-sm font-extrabold">{computed.out.net2}</td>
                    <td className="px-3 py-2 text-center text-sm font-extrabold">{computed.out.better}</td>
                  </tr>

                  {/* IN */}
                  <tr className="bg-slate-50">
                    <td className="px-3 py-2 text-left text-sm font-extrabold text-slate-900">In</td>
                    <td className="px-3 py-2 text-center text-sm font-extrabold">{computed.inn.gross1}</td>
                    <td className="px-3 py-2 text-center text-sm font-extrabold">{computed.inn.net1}</td>
                    <td className="px-3 py-2 text-center text-sm font-extrabold">{computed.inn.gross2}</td>
                    <td className="px-3 py-2 text-center text-sm font-extrabold">{computed.inn.net2}</td>
                    <td className="px-3 py-2 text-center text-sm font-extrabold">{computed.inn.better}</td>
                  </tr>

                  {/* TOTAL */}
                  <tr className="bg-slate-100 border-t border-slate-200">
                    <td className="px-3 py-2 text-left text-sm font-extrabold text-slate-900">Total</td>
                    <td className="px-3 py-2 text-center text-sm font-extrabold">{computed.total.gross1}</td>
                    <td className="px-3 py-2 text-center text-sm font-extrabold">{computed.total.net1}</td>
                    <td className="px-3 py-2 text-center text-sm font-extrabold">{computed.total.gross2}</td>
                    <td className="px-3 py-2 text-center text-sm font-extrabold">{computed.total.net2}</td>
                    <td className="px-3 py-2 text-center text-sm font-extrabold">{computed.total.better}</td>
                  </tr>

                  {/* Contribution row: ONLY stableford total (as requested) */}
                  <tr className="bg-white border-t border-slate-200">
                    <td className="px-3 py-2 text-left text-sm font-extrabold text-slate-900">Contrib</td>
                    <td className="px-3 py-2 text-center text-sm text-slate-400">—</td>
                    <td className="px-3 py-2 text-center text-sm text-slate-400">—</td>
                    <td className="px-3 py-2 text-center text-sm text-slate-400">—</td>
                    <td className="px-3 py-2 text-center text-sm text-slate-400">—</td>
                    <td className="px-3 py-2 text-center">
                      <span className="inline-flex min-w-[34px] justify-center rounded-md border-2 border-dotted border-gray-900 px-2 py-1 text-sm font-extrabold text-slate-900">
                        {computed.contribTotal}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Legend */}
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
              <div className="rounded-md px-3 py-2 text-sm font-bold border border-slate-300 bg-slate-50 text-slate-900">
                Contribution (Net){" "}
                <span className="ml-2 inline-block w-3 h-3 align-middle rounded-sm border-2 border-dotted border-gray-900" />
              </div>
              <div className="rounded-md px-3 py-2 text-sm font-bold border border-slate-300 bg-slate-50 text-slate-900">
                Tie (same Net){" "}
                <span className="ml-2 inline-block w-3 h-3 align-middle rounded-sm border-2 border-dotted border-gray-900 outline outline-2 outline-gray-900" />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function safeCourseName(courses: RoundRow["courses"]): string {
  const c = asSingle(courses as any);
  const n = String((c as any)?.name ?? "").trim();
  return n || "";
}
