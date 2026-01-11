// app/m/tours/[id]/competitions/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import MobileNav from "../_components/MobileNav";
import { supabase } from "@/lib/supabaseClient";

type Tee = "M" | "F";

type Tour = { id: string; name: string };

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

function roundLabelShort(round: RoundRow, index: number, isFinal: boolean) {
  const n = round.round_no ?? index + 1;
  return isFinal ? `R${n} (F)` : `R${n}`;
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

function round2(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Number(n.toFixed(2));
}

function pct2(num: number, den: number) {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 0;
  return round2((num / den) * 100);
}

// Equal-rank ranking: 1,1,3 style
function computeRanks(values: Array<{ id: string; value: number }>, direction: "desc" | "asc") {
  const arr = [...values];
  arr.sort((a, b) => {
    const av = Number.isFinite(a.value) ? a.value : 0;
    const bv = Number.isFinite(b.value) ? b.value : 0;
    return direction === "desc" ? bv - av : av - bv;
  });

  const ranks = new Map<string, number>();
  let lastVal: number | null = null;
  let lastRank = 0;

  for (let i = 0; i < arr.length; i++) {
    const v = Number.isFinite(arr[i].value) ? arr[i].value : 0;
    if (lastVal === null || v !== lastVal) {
      lastRank = i + 1;
      lastVal = v;
    }
    ranks.set(arr[i].id, lastRank);
  }
  return ranks;
}

export default function MobileCompetitionsPage() {
  const params = useParams<{ id?: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);

  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    let alive = true;

    async function loadAll() {
      setLoading(true);
      setErrorMsg("");

      try {
        const { data: tData, error: tErr } = await supabase.from("tours").select("id,name").eq("id", tourId).single();
        if (tErr) throw tErr;
        if (!alive) return;
        setTour(tData as Tour);

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

        const { data: tpData, error: tpErr } = await supabase
          .from("tour_players")
          .select("tour_id,player_id,starting_handicap,players(id,name,gender)")
          .eq("tour_id", tourId)
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

        const roundIds = rr.map((r) => r.id);
        const playerIds = ps.map((p) => p.id);

        if (roundIds.length > 0 && playerIds.length > 0) {
          const { data: rpData, error: rpErr } = await supabase
            .from("round_players")
            .select("round_id,player_id,playing,playing_handicap")
            .in("round_id", roundIds)
            .in("player_id", playerIds);
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

        if (roundIds.length > 0 && playerIds.length > 0) {
          const { data: sData, error: sErr } = await supabase
            .from("scores")
            .select("round_id,player_id,hole_number,strokes,pickup")
            .in("round_id", roundIds)
            .in("player_id", playerIds);
          if (sErr) throw sErr;

          if (!alive) return;
          setScores((sData ?? []) as ScoreRow[]);
        } else {
          setScores([]);
        }

        const courseIds = Array.from(new Set(rr.map((r) => r.course_id).filter(Boolean))) as string[];
        if (courseIds.length > 0) {
          const { data: pData, error: pErr } = await supabase
            .from("pars")
            .select("course_id,hole_number,tee,par,stroke_index")
            .in("course_id", courseIds)
            .in("tee", ["M", "F"])
            .order("course_id", { ascending: true })
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
        } else {
          setPars([]);
        }
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load competitions.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    void loadAll();

    return () => {
      alive = false;
    };
  }, [tourId]);

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

  const finalRoundId = useMemo(() => {
    return sortedRounds.length ? sortedRounds[sortedRounds.length - 1].id : "";
  }, [sortedRounds]);

  const playerById = useMemo(() => {
    const m = new Map<string, PlayerRow>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const rpByRoundPlayer = useMemo(() => {
    const m = new Map<string, RoundPlayerRow>();
    for (const rp of roundPlayers) m.set(`${rp.round_id}|${rp.player_id}`, rp);
    return m;
  }, [roundPlayers]);

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

  const scoreByRoundPlayerHole = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    for (const s of scores) m.set(`${s.round_id}|${s.player_id}|${Number(s.hole_number)}`, s);
    return m;
  }, [scores]);

  // Determine if a player has a "complete" round: all 18 holes have a saved stroke OR pickup.
  const isRoundComplete = useMemo(() => {
    const cache = new Map<string, boolean>();

    return (roundId: string, playerId: string) => {
      const key = `${roundId}|${playerId}`;
      const hit = cache.get(key);
      if (hit !== undefined) return hit;

      for (let h = 1; h <= 18; h++) {
        const sc = scoreByRoundPlayerHole.get(`${roundId}|${playerId}|${h}`);
        const ok = !!sc && (sc.pickup === true || (sc.strokes !== null && sc.strokes !== undefined));
        if (!ok) {
          cache.set(key, false);
          return false;
        }
      }
      cache.set(key, true);
      return true;
    };
  }, [scoreByRoundPlayerHole]);

  // Precompute per-player per-round per-hole Stableford points (only when playing + has score + has par/si)
  const ptsByPlayerRoundHole = useMemo(() => {
    const m = new Map<string, number>(); // `${pid}|${rid}|${h}` -> pts
    for (const r of sortedRounds) {
      if (!r.course_id) continue;
      for (const p of players) {
        const rp = rpByRoundPlayer.get(`${r.id}|${p.id}`);
        if (!rp?.playing) continue;

        const tee: Tee = normalizeTee(p.gender);
        const parsMap = parsByCourseTeeHole.get(r.course_id)?.get(tee);
        if (!parsMap) continue;

        const hcp = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0;

        for (let h = 1; h <= 18; h++) {
          const pr = parsMap.get(h);
          if (!pr) continue;

          const sc = scoreByRoundPlayerHole.get(`${r.id}|${p.id}|${h}`);
          if (!sc) continue;

          const raw = normalizeRawScore(sc.strokes, sc.pickup);
          const pts = netStablefordPointsForHole({
            rawScore: raw,
            par: pr.par,
            strokeIndex: pr.si,
            playingHandicap: hcp,
          });

          m.set(`${p.id}|${r.id}|${h}`, pts);
        }
      }
    }
    return m;
  }, [sortedRounds, players, rpByRoundPlayer, parsByCourseTeeHole, scoreByRoundPlayerHole]);

  function holePar(courseId: string, tee: Tee, hole: number) {
    return parsByCourseTeeHole.get(courseId)?.get(tee)?.get(hole)?.par ?? null;
  }

  // Compute competition values per player
  const rows = useMemo(() => {
    type Row = {
      playerId: string;
      name: string;
      napoleon: number; // avg par3
      bigGeorge: number; // avg par4
      grandCanyon: number; // avg par5
      wizard: number; // pct 4+
      bagelMan: number; // pct 0 (LOWER better)
      eclectic: number; // sum best pts per hole
    };

    const out: Row[] = [];

    for (const p of players) {
      let par3Sum = 0, par3Cnt = 0;
      let par4Sum = 0, par4Cnt = 0;
      let par5Sum = 0, par5Cnt = 0;

      let holesTotal = 0;
      let wizardCnt = 0;
      let bagelCnt = 0;

      // Eclectic best per hole across tour (we don’t require complete rounds for eclectic value here;
      // but it will naturally be 0 if missing)
      const bestByHole: number[] = Array(19).fill(0);

      for (const r of sortedRounds) {
        const rp = rpByRoundPlayer.get(`${r.id}|${p.id}`);
        if (!rp?.playing) continue;

        if (!r.course_id) continue;

        const tee: Tee = normalizeTee(p.gender);

        // RequireComplete competitions: only include COMPLETE rounds
        const complete = isRoundComplete(r.id, p.id);
        if (complete) {
          for (let h = 1; h <= 18; h++) {
            const pts = ptsByPlayerRoundHole.get(`${p.id}|${r.id}|${h}`);
            if (pts === undefined) continue;

            const par = holePar(r.course_id, tee, h);
            if (par === 3) {
              par3Sum += pts; par3Cnt += 1;
            } else if (par === 4) {
              par4Sum += pts; par4Cnt += 1;
            } else if (par === 5) {
              par5Sum += pts; par5Cnt += 1;
            }

            holesTotal += 1;
            if (pts >= 4) wizardCnt += 1;
            if (pts === 0) bagelCnt += 1;
          }
        }

        // Eclectic: include any scored holes (playing + saved score already implied by pts map)
        for (let h = 1; h <= 18; h++) {
          const pts = ptsByPlayerRoundHole.get(`${p.id}|${r.id}|${h}`);
          if (pts === undefined) continue;
          if (pts > bestByHole[h]) bestByHole[h] = pts;
        }
      }

      const napoleon = par3Cnt > 0 ? round2(par3Sum / par3Cnt) : 0;
      const bigGeorge = par4Cnt > 0 ? round2(par4Sum / par4Cnt) : 0;
      const grandCanyon = par5Cnt > 0 ? round2(par5Sum / par5Cnt) : 0;

      const wizard = pct2(wizardCnt, holesTotal);
      const bagelMan = pct2(bagelCnt, holesTotal);

      let eclectic = 0;
      for (let h = 1; h <= 18; h++) eclectic += Number(bestByHole[h] ?? 0) || 0;

      out.push({
        playerId: p.id,
        name: p.name,
        napoleon,
        bigGeorge,
        grandCanyon,
        wizard,
        bagelMan,
        eclectic,
      });
    }

    // Default sort: Eclectic desc then name
    out.sort((a, b) => b.eclectic - a.eclectic || a.name.localeCompare(b.name));
    return out;
  }, [players, sortedRounds, rpByRoundPlayer, ptsByPlayerRoundHole, isRoundComplete, parsByCourseTeeHole]);

  // Ranks per competition (Bagel ascending)
  const ranks = useMemo(() => {
    const by = (key: keyof (typeof rows)[number]) =>
      rows.map((r) => ({ id: r.playerId, value: Number(r[key]) || 0 }));

    return {
      napoleon: computeRanks(by("napoleon"), "desc"),
      bigGeorge: computeRanks(by("bigGeorge"), "desc"),
      grandCanyon: computeRanks(by("grandCanyon"), "desc"),
      wizard: computeRanks(by("wizard"), "desc"),
      bagelMan: computeRanks(by("bagelMan"), "asc"), // LOWER is better
      eclectic: computeRanks(by("eclectic"), "desc"),
    };
  }, [rows]);

  function fmtScore(val: number, kind: "avg" | "pct" | "int") {
    if (!Number.isFinite(val)) return "0";
    if (kind === "pct") return `${round2(val)}%`;
    if (kind === "avg") return String(round2(val));
    return String(Math.round(val));
  }

  if (!tourId || !isLikelyUuid(tourId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900">
        <div className="mx-auto max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">
            Missing or invalid tour id in route.
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
      {/* sticky strip only (no extra heading/back arrow) */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">Competitions</div>
          <div className="truncate text-xs text-gray-500">{tour?.name ?? ""}</div>
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
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border p-4 text-sm text-gray-700">No players found for this tour.</div>
        ) : (
          <>
            {/* TABLE */}
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="sticky left-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700">
                      Player
                    </th>
                    {[
                      { key: "napoleon", label: "Napoleon" },
                      { key: "bigGeorge", label: "Big George" },
                      { key: "grandCanyon", label: "Grand Canyon" },
                      { key: "wizard", label: "Wizard" },
                      { key: "bagelMan", label: "Bagel Man" },
                      { key: "eclectic", label: "Eclectic" },
                    ].map((c) => (
                      <th
                        key={c.key}
                        className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700 whitespace-nowrap"
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {rows.map((r) => (
                    <tr key={r.playerId} className="border-b last:border-b-0">
                      <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap">
                        <Link
                          className="underline decoration-gray-300 underline-offset-4"
                          href={`/m/tours/${tourId}/competitions/eclectic/${r.playerId}`}
                        >
                          {r.name}
                        </Link>
                      </td>

                      <td className="px-3 py-2 text-right text-sm text-gray-900 whitespace-nowrap">
                        {fmtScore(r.napoleon, "avg")} ({ranks.napoleon.get(r.playerId) ?? "-"})
                      </td>
                      <td className="px-3 py-2 text-right text-sm text-gray-900 whitespace-nowrap">
                        {fmtScore(r.bigGeorge, "avg")} ({ranks.bigGeorge.get(r.playerId) ?? "-"})
                      </td>
                      <td className="px-3 py-2 text-right text-sm text-gray-900 whitespace-nowrap">
                        {fmtScore(r.grandCanyon, "avg")} ({ranks.grandCanyon.get(r.playerId) ?? "-"})
                      </td>
                      <td className="px-3 py-2 text-right text-sm text-gray-900 whitespace-nowrap">
                        {fmtScore(r.wizard, "pct")} ({ranks.wizard.get(r.playerId) ?? "-"})
                      </td>
                      <td className="px-3 py-2 text-right text-sm text-gray-900 whitespace-nowrap">
                        {fmtScore(r.bagelMan, "pct")} ({ranks.bagelMan.get(r.playerId) ?? "-"})
                      </td>
                      <td className="px-3 py-2 text-right text-sm text-gray-900 whitespace-nowrap">
                        {fmtScore(r.eclectic, "int")} ({ranks.eclectic.get(r.playerId) ?? "-"})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Descriptions */}
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 text-sm">
              <div className="font-semibold text-gray-900">Competition descriptions</div>
              <ul className="mt-2 space-y-2 text-gray-700">
                <li>
                  <span className="font-semibold">Napoleon:</span> Average Stableford points on Par 3 holes (complete rounds only).
                </li>
                <li>
                  <span className="font-semibold">Big George:</span> Average Stableford points on Par 4 holes (complete rounds only).
                </li>
                <li>
                  <span className="font-semibold">Grand Canyon:</span> Average Stableford points on Par 5 holes (complete rounds only).
                </li>
                <li>
                  <span className="font-semibold">Wizard:</span> Percentage of holes with 4+ Stableford points (complete rounds only).
                </li>
                <li>
                  <span className="font-semibold">Bagel Man:</span> Percentage of holes with 0 Stableford points (complete rounds only).{" "}
                  <span className="font-semibold">Lower is better.</span>
                </li>
                <li>
                  <span className="font-semibold">Eclectic:</span> Best Stableford score on each hole across the tour; summed total.
                </li>
              </ul>
            </div>
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
