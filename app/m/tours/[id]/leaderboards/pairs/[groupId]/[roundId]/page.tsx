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
  course_id: string | null;
  courses?: { name: string } | null;
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

type PlayerRow = {
  id: string;
  name: string;
  gender?: Tee | null;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean | null;
  playing_handicap: number | null;
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

function grossBoxClassForShade(shade: Shade) {
  // keep scorebox colours unchanged (same convention as your player scorecard)
  const base = "min-w-[34px] px-2 py-1 rounded text-center text-sm font-extrabold";
  if (shade === "par") return `${base} bg-white text-gray-900 border border-gray-300`;
  if (shade === "bogey") return `${base} bg-[#f8cfcf] text-gray-900`;
  if (shade === "dbogey") return `${base} bg-[#c0392b] text-white`;
  // ace/eagle/birdie handled via inline style (blue palette)
  return `${base} bg-transparent text-gray-900`;
}

function ScoreBoxGross(props: { shade: Shade; label: string }) {
  const { shade, label } = props;
  const isBlue = shade === "ace" || shade === "eagle" || shade === "birdie";
  return (
    <div className={grossBoxClassForShade(shade)} style={isBlue ? blueStyleForShade(shade) : undefined}>
      {label}
    </div>
  );
}

function ScoreBoxNet(props: { value: number; dotted?: boolean; tie?: boolean }) {
  const { value, dotted, tie } = props;

  const base = "min-w-[34px] px-2 py-1 rounded text-center text-sm font-extrabold bg-white text-gray-900";
  const dottedCls = dotted ? " outline outline-2 outline-offset-[-2px] outline-dotted outline-gray-900" : "";
  const tieCls = tie ? " border-2 border-gray-900" : " border border-gray-300";

  return <div className={`${base}${tieCls}${dottedCls}`}>{value}</div>;
}

function normalizeRawScore(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  const n = Number(strokes);
  return Number.isFinite(n) ? String(n) : "";
}

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function PairRoundDetailPage() {
  const params = useParams<{ id?: string; groupId?: string; roundId?: string }>();
  const router = useRouter();

  const tourId = String(params?.id ?? "").trim();
  const groupId = String(params?.groupId ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [round, setRound] = useState<RoundRow | null>(null);
  const [pairPlayers, setPairPlayers] = useState<PlayerRow[]>([]);
  const [rpRows, setRpRows] = useState<RoundPlayerRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);

  function goBack() {
    if (tourId) router.push(`/m/tours/${tourId}/leaderboards`);
    else router.push(`/m`);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setErrorMsg("");

      try {
        if (!tourId || !roundId || !groupId) throw new Error("Missing route params.");
        if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId) || !isLikelyUuid(groupId)) {
          throw new Error("Invalid id in route.");
        }

        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,tour_id,name,round_no,played_on,course_id,courses(name)")
          .eq("id", roundId)
          .eq("tour_id", tourId)
          .single();
        if (rErr) throw rErr;

        const courseId = String((rData as any)?.course_id ?? "");
        if (!courseId) throw new Error("Round missing course_id.");

        const { data: mData, error: mErr } = await supabase
          .from("tour_group_members")
          .select("group_id,player_id,position,players(id,name,gender)")
          .eq("group_id", groupId)
          .order("position", { ascending: true, nullsFirst: true });
        if (mErr) throw mErr;

        const members = (mData ?? [])
          .map((x: any) => ({
            id: String(x.players?.id ?? x.player_id),
            name: String(x.players?.name ?? "(player)"),
            gender: x.players?.gender ? normalizeTee(x.players.gender) : null,
            pos: Number.isFinite(Number(x.position)) ? Number(x.position) : 999,
          }))
          .filter((x: any) => !!x.id)
          .sort((a: any, b: any) => a.pos - b.pos);

        const p2 = members.slice(0, 2).map((x: any) => ({ id: x.id, name: x.name, gender: x.gender as any }));
        if (p2.length < 2) throw new Error("This pair does not have 2 members.");

        const playerIds = p2.map((p) => p.id);

        const { data: rpData, error: rpErr } = await supabase
          .from("round_players")
          .select("round_id,player_id,playing,playing_handicap")
          .eq("round_id", roundId)
          .in("player_id", playerIds);
        if (rpErr) throw rpErr;

        const { data: pData, error: pErr } = await supabase
          .from("pars")
          .select("course_id,hole_number,tee,par,stroke_index")
          .eq("course_id", courseId)
          .in("tee", ["M", "F"])
          .order("hole_number", { ascending: true });
        if (pErr) throw pErr;

        const { data: sData, error: sErr } = await supabase
          .from("scores")
          .select("round_id,player_id,hole_number,strokes,pickup")
          .eq("round_id", roundId)
          .in("player_id", playerIds);
        if (sErr) throw sErr;

        if (cancelled) return;

        setRound(rData as any);
        setPairPlayers(p2);
        setRpRows((rpData ?? []) as any);
        setPars(
          (pData ?? []).map((x: any) => ({
            course_id: String(x.course_id),
            hole_number: Number(x.hole_number),
            tee: normalizeTee(x.tee),
            par: Number(x.par),
            stroke_index: Number(x.stroke_index),
          }))
        );
        setScores((sData ?? []) as any);
      } catch (e: any) {
        if (!cancelled) setErrorMsg(e?.message ?? "Failed to load pair round detail.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [tourId, groupId, roundId]);

  const [p1, p2] = pairPlayers;
  const p1Id = p1?.id ?? "";
  const p2Id = p2?.id ?? "";

  const hcpByPlayer = useMemo(() => {
    const m = new Map<string, number>();
    for (const rp of rpRows) {
      const pid = String(rp.player_id);
      const h = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0;
      m.set(pid, h);
    }
    return m;
  }, [rpRows]);

  const parsByTeeHole = useMemo(() => {
    const m = new Map<Tee, Map<number, { par: number; si: number }>>();
    m.set("M", new Map());
    m.set("F", new Map());
    for (const pr of pars) {
      m.get(pr.tee)!.set(pr.hole_number, { par: pr.par, si: pr.stroke_index });
    }
    return m;
  }, [pars]);

  const scoreByPlayerHole = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    for (const s of scores) {
      m.set(`${String(s.player_id)}|${Number(s.hole_number)}`, s);
    }
    return m;
  }, [scores]);

  const computed = useMemo(() => {
    if (!p1Id || !p2Id) return null;

    const tee1 = normalizeTee(p1?.gender);
    const tee2 = normalizeTee(p2?.gender);

    const hcp1 = hcpByPlayer.get(p1Id) ?? 0;
    const hcp2 = hcpByPlayer.get(p2Id) ?? 0;

    const holes = Array.from({ length: 18 }, (_, i) => i + 1).map((hole) => {
      const pr1 = parsByTeeHole.get(tee1)?.get(hole) ?? { par: 0, si: 0 };
      const pr2 = parsByTeeHole.get(tee2)?.get(hole) ?? { par: 0, si: 0 };

      const s1 = scoreByPlayerHole.get(`${p1Id}|${hole}`);
      const s2 = scoreByPlayerHole.get(`${p2Id}|${hole}`);

      const raw1 = normalizeRawScore(s1?.strokes ?? null, s1?.pickup ?? null);
      const raw2 = normalizeRawScore(s2?.strokes ?? null, s2?.pickup ?? null);

      const gross1 = Number.isFinite(Number(s1?.strokes)) ? Number(s1?.strokes) : null;
      const gross2 = Number.isFinite(Number(s2?.strokes)) ? Number(s2?.strokes) : null;

      const pickup1 = s1?.pickup === true;
      const pickup2 = s2?.pickup === true;

      const pts1 =
        raw1 && pr1.par > 0 && pr1.si > 0
          ? netStablefordPointsForHole({
              rawScore: raw1,
              par: pr1.par,
              strokeIndex: pr1.si,
              playingHandicap: hcp1,
            })
          : 0;

      const pts2 =
        raw2 && pr2.par > 0 && pr2.si > 0
          ? netStablefordPointsForHole({
              rawScore: raw2,
              par: pr2.par,
              strokeIndex: pr2.si,
              playingHandicap: hcp2,
            })
          : 0;

      const bb = Math.max(pts1, pts2);

      const tie = bb > 0 && pts1 === bb && pts2 === bb;
      const p1Contrib = bb > 0 && pts1 === bb;
      const p2Contrib = bb > 0 && pts2 === bb;

      const shade1 = pr1.par > 0 ? shadeForGross(gross1, pickup1, pr1.par) : "none";
      const shade2 = pr2.par > 0 ? shadeForGross(gross2, pickup2, pr2.par) : "none";

      const grossLabel1 = pickup1 ? "P" : gross1 === null ? "" : String(gross1);
      const grossLabel2 = pickup2 ? "P" : gross2 === null ? "" : String(gross2);

      return { hole, grossLabel1, grossLabel2, gross1, gross2, pts1, pts2, bb, p1Contrib, p2Contrib, tie, shade1, shade2 };
    });

    const sum = (arr: any[]) => {
      const g1 = arr.reduce((s, x) => s + (Number.isFinite(Number(x.gross1)) ? Number(x.gross1) : 0), 0);
      const g2 = arr.reduce((s, x) => s + (Number.isFinite(Number(x.gross2)) ? Number(x.gross2) : 0), 0);
      const p1 = arr.reduce((s, x) => s + (Number.isFinite(Number(x.pts1)) ? Number(x.pts1) : 0), 0);
      const p2 = arr.reduce((s, x) => s + (Number.isFinite(Number(x.pts2)) ? Number(x.pts2) : 0), 0);
      const bb = arr.reduce((s, x) => s + (Number.isFinite(Number(x.bb)) ? Number(x.bb) : 0), 0);
      const c1 = arr.reduce((s, x) => s + (x.p1Contrib ? Number(x.pts1) : 0), 0);
      const c2 = arr.reduce((s, x) => s + (x.p2Contrib ? Number(x.pts2) : 0), 0);
      return { g1, g2, p1, p2, bb, c1, c2 };
    };

    const front = holes.slice(0, 9);
    const back = holes.slice(9, 18);

    return { holes, out: sum(front), inn: sum(back), total: sum(holes) };
  }, [p1Id, p2Id, p1?.gender, p2?.gender, hcpByPlayer, parsByTeeHole, scoreByPlayerHole]);

  const headerTitle = useMemo(() => {
    const courseName = round?.courses?.name ? ` – ${round.courses.name}` : "";
    const roundNo = typeof round?.round_no === "number" && round.round_no ? `Round ${round.round_no}` : "Round";
    const rname = (round?.name ?? "").trim();
    return `${rname || roundNo}${courseName}`;
  }, [round]);

  const dateText = useMemo(() => formatDate(round?.played_on ?? null), [round?.played_on]);

  return (
    <div className="bg-white text-slate-900 min-h-dvh">
      <main className="mx-auto w-full max-w-md px-4 py-4 pb-24">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-semibold">Pairs · Round detail</div>
            <div className="mt-1 truncate text-sm text-slate-700">{headerTitle}</div>
            {dateText ? <div className="mt-1 text-sm text-slate-500">{dateText}</div> : null}
            <div className="mt-1 text-sm text-slate-700">
              {p1?.name ?? "(P1)"} / {p2?.name ?? "(P2)"}
            </div>
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

        {loading || !computed ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">Loading…</div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="grid grid-cols-[56px_1fr_1fr_1fr_1fr_1fr] bg-slate-50 text-[11px] font-extrabold text-slate-700 border-b border-slate-200">
              <div className="px-2 py-2 text-left">HOLE</div>
              <div className="px-2 py-2 text-center">{p1?.name ?? "P1"} G</div>
              <div className="px-2 py-2 text-center">{p1?.name ?? "P1"} PTS</div>
              <div className="px-2 py-2 text-center">{p2?.name ?? "P2"} G</div>
              <div className="px-2 py-2 text-center">{p2?.name ?? "P2"} PTS</div>
              <div className="px-2 py-2 text-center">BB</div>
            </div>

            {computed.holes.map((h) => (
              <div
                key={h.hole}
                className="grid grid-cols-[56px_1fr_1fr_1fr_1fr_1fr] items-center border-b last:border-b-0 border-slate-200"
              >
                <div className="px-2 py-2 text-left font-extrabold">{h.hole}</div>

                <div className="px-2 py-2 flex justify-center">
                  <ScoreBoxGross shade={h.shade1} label={h.grossLabel1 || "—"} />
                </div>

                <div className="px-2 py-2 flex justify-center">
                  <ScoreBoxNet value={h.pts1} dotted={h.p1Contrib} tie={h.tie && h.p1Contrib} />
                </div>

                <div className="px-2 py-2 flex justify-center">
                  <ScoreBoxGross shade={h.shade2} label={h.grossLabel2 || "—"} />
                </div>

                <div className="px-2 py-2 flex justify-center">
                  <ScoreBoxNet value={h.pts2} dotted={h.p2Contrib} tie={h.tie && h.p2Contrib} />
                </div>

                <div className="px-2 py-2 text-center font-extrabold">{h.bb}</div>
              </div>
            ))}

            <TotalsRow label="Front 9" totals={computed.out} />
            <TotalsRow label="Back 9" totals={computed.inn} />
            <TotalsRow label="Total" totals={computed.total} />

            <div className="grid grid-cols-[56px_1fr_1fr_1fr_1fr_1fr] items-center border-t border-slate-300 bg-slate-50">
              <div className="px-2 py-2 text-left font-extrabold">Contrib</div>
              <div className="px-2 py-2" />
              <div className="px-2 py-2 text-center font-extrabold">{computed.total.c1}</div>
              <div className="px-2 py-2" />
              <div className="px-2 py-2 text-center font-extrabold">{computed.total.c2}</div>
              <div className="px-2 py-2" />
            </div>

            <div className="px-3 py-3 text-[11px] text-slate-600">
              Dotted outline = score contributed to Better Ball. If both players tie for best points on a hole, both contribute.
            </div>
          </div>
        )}

        <div className="mt-4 text-xs text-slate-500">
          <Link className="underline" href={`/m/tours/${tourId}/leaderboards`}>
            Back to Leaderboards
          </Link>
        </div>
      </main>
    </div>
  );
}

function TotalsRow(props: {
  label: string;
  totals: { g1: number; g2: number; p1: number; p2: number; bb: number; c1: number; c2: number };
}) {
  const { label, totals } = props;

  return (
    <div className="grid grid-cols-[56px_1fr_1fr_1fr_1fr_1fr] items-center border-t border-slate-300 bg-white">
      <div className="px-2 py-2 text-left font-extrabold">{label}</div>
      <div className="px-2 py-2 text-center font-extrabold">{totals.g1}</div>
      <div className="px-2 py-2 text-center font-extrabold">{totals.p1}</div>
      <div className="px-2 py-2 text-center font-extrabold">{totals.g2}</div>
      <div className="px-2 py-2 text-center font-extrabold">{totals.p2}</div>
      <div className="px-2 py-2 text-center font-extrabold">{totals.bb}</div>
    </div>
  );
}

// Force TS to treat this file as a module even if something odd happens during editing/encoding.
export {};
