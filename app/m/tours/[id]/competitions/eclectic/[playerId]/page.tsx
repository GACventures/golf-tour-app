// app/m/tours/[id]/competitions/eclectic/[playerId]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import MobileNav from "../../../_components/MobileNav";

type Tee = "M" | "F";

type RoundRow = {
  id: string;
  tour_id: string;
  name: string | null;
  round_no: number | null;
  created_at: string | null;
  course_id: string | null;
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

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function safeName(v: any, fallback: string) {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function normalizeRawScore(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  const n = Number(strokes);
  return Number.isFinite(n) ? String(n) : "";
}

function netStablefordPointsForHole(params: {
  rawScore: string;
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

function roundLabelShort(roundNo: number | null | undefined, index: number, isFinal: boolean) {
  const n = roundNo ?? index + 1;
  return isFinal ? `R${n} (F)` : `R${n}`;
}

export default function MobileEclecticBreakdownPage() {
  const params = useParams<{ id?: string; playerId?: string }>();
  const tourId = String(params?.id ?? "").trim();
  const playerId = String(params?.playerId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);

  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId) || !playerId || !isLikelyUuid(playerId)) return;

    let alive = true;

    async function loadAll() {
      setLoading(true);
      setErrorMsg("");

      try {
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,tour_id,name,round_no,created_at,course_id")
          .eq("tour_id", tourId)
          .order("round_no", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true });
        if (rErr) throw rErr;
        const rr = (rData ?? []) as RoundRow[];
        if (!alive) return;
        setRounds(rr);

        const { data: pData, error: pErr } = await supabase
          .from("players")
          .select("id,name,gender")
          .eq("id", playerId)
          .single();
        if (pErr) throw pErr;
        if (!alive) return;
        setPlayer({
          id: String((pData as any).id),
          name: safeName((pData as any).name, "(unnamed)"),
          gender: (pData as any).gender ? normalizeTee((pData as any).gender) : null,
        });

        const roundIds = rr.map((r) => r.id);

        if (roundIds.length > 0) {
          const { data: rpData, error: rpErr } = await supabase
            .from("round_players")
            .select("round_id,player_id,playing,playing_handicap")
            .in("round_id", roundIds)
            .eq("player_id", playerId);
          if (rpErr) throw rpErr;

          if (!alive) return;
          setRoundPlayers(
            (rpData ?? []).map((x: any) => ({
              round_id: String(x.round_id),
              player_id: String(x.player_id),
              playing: x.playing === true,
              playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
            }))
          );

          const { data: sData, error: sErr } = await supabase
            .from("scores")
            .select("round_id,player_id,hole_number,strokes,pickup")
            .in("round_id", roundIds)
            .eq("player_id", playerId);
          if (sErr) throw sErr;

          if (!alive) return;
          setScores((sData ?? []) as ScoreRow[]);
        } else {
          setRoundPlayers([]);
          setScores([]);
        }

        const courseIds = Array.from(new Set(rr.map((r) => r.course_id).filter(Boolean))) as string[];
        if (courseIds.length > 0) {
          const { data: parData, error: parErr } = await supabase
            .from("pars")
            .select("course_id,hole_number,tee,par,stroke_index")
            .in("course_id", courseIds)
            .in("tee", ["M", "F"])
            .order("course_id", { ascending: true })
            .order("hole_number", { ascending: true });
          if (parErr) throw parErr;

          if (!alive) return;
          setPars(
            (parData ?? []).map((x: any) => ({
              course_id: String(x.course_id),
              hole_number: Number(x.hole_number),
              tee: normalizeTee(x.tee),
              par: Number(x.par),
              stroke_index: Number(x.stroke_index),
            }))
          );
        } else {
          setPars([]);
        }
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load eclectic breakdown.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    void loadAll();

    return () => {
      alive = false;
    };
  }, [tourId, playerId]);

  const sortedRounds = useMemo(() => {
    const arr = [...rounds];
    arr.sort((a, b) => {
      const an = a.round_no ?? 999999;
      const bn = b.round_no ?? 999999;
      if (an !== bn) return an - bn;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });
    return arr;
  }, [rounds]);

  const finalRoundId = useMemo(() => (sortedRounds.length ? sortedRounds[sortedRounds.length - 1].id : ""), [sortedRounds]);

  const rpByRound = useMemo(() => {
    const m = new Map<string, RoundPlayerRow>();
    for (const rp of roundPlayers) m.set(rp.round_id, rp);
    return m;
  }, [roundPlayers]);

  const scoreByRoundHole = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    for (const s of scores) m.set(`${s.round_id}|${Number(s.hole_number)}`, s);
    return m;
  }, [scores]);

  const parsByCourseTeeHole = useMemo(() => {
    const m = new Map<string, Map<Tee, Map<number, { par: number; si: number }>>>();
    for (const p of pars) {
      if (!m.has(p.course_id)) m.set(p.course_id, new Map());
      const byTee = m.get(p.course_id)!;
      if (!byTee.has(p.tee)) byTee.set(p.tee, new Map());
      byTee.get(p.tee)!.set(p.hole_number, { par: p.par, si: p.stroke_index });
    }
    return m;
  }, [pars]);

  // ✅ EARLIEST-round tie-break on equal best pts
  const eclectic = useMemo(() => {
    const tee: Tee = normalizeTee(player?.gender);
    const best: Array<{ hole: number; pts: number; roundLabel: string }> = [];

    for (let h = 1; h <= 18; h++) {
      let bestPts = 0;
      let bestRoundIdx = Number.POSITIVE_INFINITY; // smaller = earlier
      let bestRoundLab = "";

      for (let idx = 0; idx < sortedRounds.length; idx++) {
        const r = sortedRounds[idx];
        const courseId = r.course_id;
        if (!courseId) continue;

        const rp = rpByRound.get(r.id);
        if (!rp?.playing) continue;

        const pr = parsByCourseTeeHole.get(courseId)?.get(tee)?.get(h);
        if (!pr) continue;

        const sc = scoreByRoundHole.get(`${r.id}|${h}`);
        if (!sc) continue;

        const raw = normalizeRawScore(sc.strokes, sc.pickup);
        const hcp = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0;

        const pts = netStablefordPointsForHole({
          rawScore: raw,
          par: pr.par,
          strokeIndex: pr.si,
          playingHandicap: hcp,
        });

        // best points; if tie, choose EARLIEST (lowest idx)
        if (pts > bestPts || (pts === bestPts && idx < bestRoundIdx)) {
          bestPts = pts;
          bestRoundIdx = idx;
          bestRoundLab = roundLabelShort(r.round_no, idx, r.id === finalRoundId);
        }
      }

      best.push({ hole: h, pts: bestPts, roundLabel: bestRoundLab || "—" });
    }

    const front = best.slice(0, 9).reduce((acc, x) => acc + x.pts, 0);
    const back = best.slice(9, 18).reduce((acc, x) => acc + x.pts, 0);
    const total = front + back;

    return { best, front, back, total };
  }, [player?.gender, sortedRounds, rpByRound, scoreByRoundHole, parsByCourseTeeHole, finalRoundId]);

  if (!tourId || !isLikelyUuid(tourId) || !playerId || !isLikelyUuid(playerId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900 pb-24">
        <div className="mx-auto max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">
            Missing or invalid route params.
            <div className="mt-2">
              <Link className="underline" href="/m">
                Go to mobile home
              </Link>
            </div>
          </div>
        </div>
        <MobileNav />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">{player?.name ?? "Player"}</div>
          <div className="mt-1 text-xs">
            <Link className="underline text-gray-600" href={`/m/tours/${tourId}/competitions`}>
              Back to competitions
            </Link>
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-5 w-40 rounded bg-gray-100" />
            <div className="h-64 rounded-2xl border bg-white" />
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorMsg}</div>
        ) : (
          <>
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-700">Holes 1–9</div>
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-white">
                    <th className="border-b border-gray-200 px-4 py-2 text-left text-xs font-semibold text-gray-700">
                      Hole
                    </th>
                    <th className="border-b border-gray-200 px-4 py-2 text-right text-xs font-semibold text-gray-700">
                      Pts
                    </th>
                    <th className="border-b border-gray-200 px-4 py-2 text-right text-xs font-semibold text-gray-700">
                      Round
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {eclectic.best.slice(0, 9).map((x) => (
                    <tr key={x.hole} className="border-b last:border-b-0">
                      <td className="px-4 py-2 text-sm text-gray-900">{x.hole}</td>
                      <td className="px-4 py-2 text-sm text-gray-900 text-right font-semibold">{x.pts}</td>
                      <td className="px-4 py-2 text-sm text-gray-700 text-right">{x.roundLabel}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50">
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900">Front 9</td>
                    <td className="px-4 py-2 text-sm font-extrabold text-gray-900 text-right">{eclectic.front}</td>
                    <td className="px-4 py-2" />
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-700">Holes 10–18</div>
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-white">
                    <th className="border-b border-gray-200 px-4 py-2 text-left text-xs font-semibold text-gray-700">
                      Hole
                    </th>
                    <th className="border-b border-gray-200 px-4 py-2 text-right text-xs font-semibold text-gray-700">
                      Pts
                    </th>
                    <th className="border-b border-gray-200 px-4 py-2 text-right text-xs font-semibold text-gray-700">
                      Round
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {eclectic.best.slice(9, 18).map((x) => (
                    <tr key={x.hole} className="border-b last:border-b-0">
                      <td className="px-4 py-2 text-sm text-gray-900">{x.hole}</td>
                      <td className="px-4 py-2 text-sm text-gray-900 text-right font-semibold">{x.pts}</td>
                      <td className="px-4 py-2 text-sm text-gray-700 text-right">{x.roundLabel}</td>
                    </tr>
                  ))}
                  <tr className="bg-gray-50">
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900">Back 9</td>
                    <td className="px-4 py-2 text-sm font-extrabold text-gray-900 text-right">{eclectic.back}</td>
                    <td className="px-4 py-2" />
                  </tr>
                  <tr className="bg-yellow-50">
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900">Total</td>
                    <td className="px-4 py-2 text-sm font-extrabold text-gray-900 text-right">{eclectic.total}</td>
                    <td className="px-4 py-2" />
                  </tr>
                </tbody>
              </table>
            </div>

            {/* ✅ Updated note */}
            <div className="mt-3 text-xs text-gray-500">
              For each hole, the round shown is the <span className="font-semibold">earliest</span> round where the
              player achieved their best points for that hole.
            </div>
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
