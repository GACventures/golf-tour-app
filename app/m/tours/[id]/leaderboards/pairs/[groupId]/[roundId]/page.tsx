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
  created_at: string | null;
  round_no: number | null;
  course_id: string | null;
  played_on: string | null;
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

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number | null;
};

type PlayerLite = { id: string; name: string; gender?: string | null };

type GroupMemberRow = {
  group_id: string;
  player_id: string;
  position: number | null;
  players: PlayerLite | PlayerLite[] | null;
};

type Shade = "ace" | "eagle" | "birdie" | "par" | "bogey" | "dbogey" | "none";

const SWING_IN_SPRING_TOUR_ID = "a2d8ba33-e0e8-48a6-aff4-37a71bf29988";
const SWING_IN_SPRING_SPECIAL_PAIRS_ROUND_NO = 3;

const SCOTLAND_TOUR_2026_ID = "207a93c7-70fb-4969-9ef1-6ad844e556c5";
const SCOTLAND_S_MCCURDY_PLAYER_ID = "10ec8991-8795-437e-87e9-ad06b115b0a3";

const SCOTLAND_SCORE_SUBSTITUTE_BY_ROUND_NO: Record<number, string> = {
  1: "0d3b3fce-41ce-44e5-8603-cb27bc734eb4", // L Warwick
  6: "0d3b3fce-41ce-44e5-8603-cb27bc734eb4", // L Warwick
  11: "0d3b3fce-41ce-44e5-8603-cb27bc734eb4", // L Warwick
  2: "1f2b1df0-8c63-4cfe-a786-68291f7f42db", // T Baum
  7: "1f2b1df0-8c63-4cfe-a786-68291f7f42db", // T Baum
  12: "1f2b1df0-8c63-4cfe-a786-68291f7f42db", // T Baum
  3: "593d6f38-cce6-45cc-a8ae-e9a9d7e426b8", // J Gray
  8: "593d6f38-cce6-45cc-a8ae-e9a9d7e426b8", // J Gray
  13: "593d6f38-cce6-45cc-a8ae-e9a9d7e426b8", // J Gray
  4: "64d4f7ff-9ce4-4c81-b5f4-9eab02248b97", // A Lennon
  9: "64d4f7ff-9ce4-4c81-b5f4-9eab02248b97", // A Lennon
  5: "9600eebc-7cdd-42f5-bd38-77f920dc41de", // P Creswell
  10: "9600eebc-7cdd-42f5-bd38-77f920dc41de", // P Creswell
};

function effectiveScorePlayerId(params: { tourId: string; roundNo: number | null | undefined; playerId: string }) {
  const { tourId, roundNo, playerId } = params;
  if (tourId !== SCOTLAND_TOUR_2026_ID) return playerId;
  if (playerId !== SCOTLAND_S_MCCURDY_PLAYER_ID) return playerId;
  const rn = Number(roundNo);
  if (!Number.isFinite(rn)) return playerId;
  return SCOTLAND_SCORE_SUBSTITUTE_BY_ROUND_NO[rn] ?? playerId;
}

/* ----------------------------------
   Colour helpers (same as individual)
----------------------------------- */
const BLUE_ACE = "#082B5C";
const BLUE_EAGLE = "#1757D6";
const BLUE_BIRDIE = "#4DA3FF";

function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  const raw = String(iso).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const d = new Date(isDateOnly ? `${raw}T00:00:00.000Z` : raw);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

function asSingle<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

/** ✅ Align with your scorecard logic: treat W/FEMALE as F */
function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  const isF = s === "F" || s === "FEMALE" || s === "W" || s === "WOMEN" || s === "WOMAN";
  return isF ? "F" : "M";
}

function rawScoreFor(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  const n = Number(strokes);
  return Number.isFinite(n) ? String(n) : "";
}

function shadeForGross(gross: number | null, pickup: boolean | null | undefined, par: number): Shade {
  if (pickup) return "dbogey";
  if (!Number.isFinite(Number(gross))) return "none";

  const g = Number(gross);
  const diff = g - Number(par);
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

async function loadParsForCourse(courseId: string) {
  const { data, error } = await supabase
    .from("pars")
    .select("course_id,hole_number,tee,par,stroke_index")
    .eq("course_id", courseId)
    .in("tee", ["M", "F"])
    .order("hole_number", { ascending: true });

  if (error) throw error;
  return (data ?? []) as ParRow[];
}

function GrossBox({ shade, label }: { shade: Shade; label: string }) {
  const isBlue = shade === "ace" || shade === "eagle" || shade === "birdie";
  const base = "inline-flex min-w-[22px] justify-center rounded px-1 py-[1px] text-[12px] font-extrabold leading-5";
  const className =
    shade === "par"
      ? `${base} bg-white text-gray-900 border border-gray-300`
      : shade === "bogey"
      ? `${base} bg-[#f8cfcf] text-gray-900`
      : shade === "dbogey"
      ? `${base} bg-[#c0392b] text-white`
      : `${base} bg-transparent text-gray-900`;

  return (
    <span className={className} style={isBlue ? blueStyleForShade(shade) : undefined}>
      {label}
    </span>
  );
}

function StablefordBox({ value, contributes, tied }: { value: number; contributes: boolean; tied: boolean }) {
  const base = "inline-flex min-w-[22px] justify-center rounded px-1 py-[1px] text-[12px] font-extrabold leading-5";
  const border = contributes ? "border-2 border-dotted border-slate-700" : "border border-transparent";
  const ring = tied ? "ring-2 ring-slate-400 ring-inset" : "";
  return <span className={`${base} ${border} ${ring}`}>{value}</span>;
}

export default function MobilePairsRoundDetailPage() {
  const params = useParams<{ id?: string; groupId?: string; roundId?: string }>();
  const router = useRouter();

  const tourId = String(params?.id ?? "").trim();
  const groupId = String(params?.groupId ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [round, setRound] = useState<RoundRow | null>(null);
  const [members, setMembers] = useState<PlayerLite[]>([]);
  const [playersById, setPlayersById] = useState<Record<string, PlayerLite>>({});
  const [pars, setPars] = useState<ParRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);

  function goBack() {
    router.back();
    queueMicrotask(() => {
      if (tourId) router.push(`/m/tours/${tourId}/leaderboards`);
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!tourId || !groupId || !roundId) return;

      setLoading(true);
      setErrorMsg("");

      try {
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,tour_id,name,created_at,played_on,round_no,course_id,courses(name)")
          .eq("id", roundId)
          .eq("tour_id", tourId)
          .single();
        if (rErr) throw rErr;

        const courseId = String((rData as any)?.course_id ?? "");
        if (!courseId) throw new Error("Round has no course_id.");

        const { data: gmData, error: gmErr } = await supabase
          .from("tour_group_members")
          .select("group_id,player_id,position,players(id,name,gender)")
          .eq("group_id", groupId);
        if (gmErr) throw gmErr;

        const gm = (gmData ?? []) as unknown as GroupMemberRow[];
        gm.sort(
          (a, b) =>
            (a.position ?? 999) - (b.position ?? 999) ||
            String(a.player_id ?? "").localeCompare(String(b.player_id ?? ""))
        );

        const players: PlayerLite[] = gm
          .map((m) => asSingle(m.players))
          .filter(Boolean)
          .map((p) => ({
            id: String((p as any).id),
            name: String((p as any).name ?? "(player)"),
            gender: (p as any).gender ?? null,
          }));

        if (players.length < 2) throw new Error("Pair does not have 2 members.");

        const p1 = players[0];
        const p2 = players[1];
        const roundNo = Number((rData as any)?.round_no);
        const scoringPlayerIds = Array.from(
          new Set(
            [p1.id, p2.id].map((playerId) =>
              effectiveScorePlayerId({
                tourId,
                roundNo,
                playerId,
              })
            ).concat([p1.id, p2.id])
          )
        );

        const { data: rpData, error: rpErr } = await supabase
          .from("round_players")
          .select("round_id,player_id,playing,playing_handicap")
          .eq("round_id", roundId)
          .in("player_id", scoringPlayerIds);
        if (rpErr) throw rpErr;

        const { data: sData, error: sErr } = await supabase
          .from("scores")
          .select("round_id,player_id,hole_number,strokes,pickup")
          .eq("round_id", roundId)
          .in("player_id", scoringPlayerIds);
        if (sErr) throw sErr;

        const { data: pData, error: pErr } = await supabase.from("players").select("id,name,gender").in("id", scoringPlayerIds);
        if (pErr) throw pErr;
        const playerMap: Record<string, PlayerLite> = {};
        for (const p of pData ?? []) {
          playerMap[String((p as any).id)] = {
            id: String((p as any).id),
            name: String((p as any).name ?? "(player)"),
            gender: (p as any).gender ?? null,
          };
        }
        for (const p of players) playerMap[p.id] = playerMap[p.id] ?? p;

        const ps = await loadParsForCourse(courseId);

        if (cancelled) return;

        setRound(rData as any);
        setMembers(players.slice(0, 2));
        setPlayersById(playerMap);
        setRoundPlayers((rpData ?? []) as any);
        setScores((sData ?? []) as any);
        setPars(ps);
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.message ?? "Failed to load pairs round detail.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [tourId, groupId, roundId]);

  const p1 = members[0] ?? null;
  const p2 = members[1] ?? null;

  const isSwingInSpringRound3 =
    tourId === SWING_IN_SPRING_TOUR_ID && Number(round?.round_no) === SWING_IN_SPRING_SPECIAL_PAIRS_ROUND_NO;

  const hcpByPlayer = useMemo(() => {
    const m = new Map<string, number>();
    for (const rp of roundPlayers) {
      const h = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0;
      m.set(String(rp.player_id), h);
    }
    return m;
  }, [roundPlayers]);

  const parByTeeHole = useMemo(() => {
    const m = new Map<string, Map<number, { par: number; si: number }>>();
    for (const pr of pars) {
      const tee = normalizeTee(pr.tee);
      if (!m.has(tee)) m.set(tee, new Map());
      m.get(tee)!.set(Number(pr.hole_number), { par: Number(pr.par), si: Number(pr.stroke_index) });
    }
    return m;
  }, [pars]);

  const scoreByPlayerHole = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    for (const s of scores) m.set(`${String(s.player_id)}|${Number(s.hole_number)}`, s);
    return m;
  }, [scores]);

  function getPlayerHoleCell(player: PlayerLite, hole: number) {
    const effectivePlayerId = effectiveScorePlayerId({ tourId, roundNo: round?.round_no, playerId: player.id });
    const effectivePlayer = playersById[effectivePlayerId] ?? player;
    const tee = normalizeTee(effectivePlayer.gender);
    const parsForTee = parByTeeHole.get(tee);
    const pr = parsForTee?.get(hole) ?? { par: 0, si: 0 };

    const sc = scoreByPlayerHole.get(`${effectivePlayerId}|${hole}`);
    const pickup = sc?.pickup === true;
    const gross = Number.isFinite(Number(sc?.strokes)) ? Number(sc?.strokes) : null;
    const raw = rawScoreFor(gross, pickup);
    const hcp = hcpByPlayer.get(effectivePlayerId) ?? 0;

    const net =
      raw && pr.par > 0 && pr.si > 0
        ? netStablefordPointsForHole({
            rawScore: raw,
            par: pr.par,
            strokeIndex: pr.si,
            playingHandicap: hcp,
          })
        : 0;

    const shade = pr.par > 0 && (pickup || gross !== null) ? shadeForGross(gross, pickup, pr.par) : "none";

    return {
      hole,
      gross: pickup ? "P" : gross !== null ? String(gross) : "",
      net,
      shade,
      contributes: false,
      tied: false,
    };
  }

  const rows = useMemo(() => {
    if (!p1 || !p2) return [];

    const p1EffectiveId = effectiveScorePlayerId({ tourId, roundNo: round?.round_no, playerId: p1.id });
    const p2EffectiveId = effectiveScorePlayerId({ tourId, roundNo: round?.round_no, playerId: p2.id });
    const p1Effective = playersById[p1EffectiveId] ?? p1;
    const p2Effective = playersById[p2EffectiveId] ?? p2;

    const p1tee = normalizeTee(p1Effective.gender);
    const p2tee = normalizeTee(p2Effective.gender);

    const p1pars = parByTeeHole.get(p1tee);
    const p2pars = parByTeeHole.get(p2tee);

    const p1hcp = hcpByPlayer.get(p1EffectiveId) ?? 0;
    const p2hcp = hcpByPlayer.get(p2EffectiveId) ?? 0;

    const out: any[] = [];
    for (let hole = 1; hole <= 18; hole++) {
      const p1pr = p1pars?.get(hole) ?? { par: 0, si: 0 };
      const p2pr = p2pars?.get(hole) ?? { par: 0, si: 0 };

      const s1 = scoreByPlayerHole.get(`${p1EffectiveId}|${hole}`);
      const s2 = scoreByPlayerHole.get(`${p2EffectiveId}|${hole}`);

      const p1pickup = s1?.pickup === true;
      const p2pickup = s2?.pickup === true;

      const p1gross = Number.isFinite(Number(s1?.strokes)) ? Number(s1?.strokes) : null;
      const p2gross = Number.isFinite(Number(s2?.strokes)) ? Number(s2?.strokes) : null;

      const p1raw = rawScoreFor(p1gross, p1pickup);
      const p2raw = rawScoreFor(p2gross, p2pickup);

      const p1net =
        p1raw && p1pr.par > 0 && p1pr.si > 0
          ? netStablefordPointsForHole({
              rawScore: p1raw,
              par: p1pr.par,
              strokeIndex: p1pr.si,
              playingHandicap: p1hcp,
            })
          : 0;

      const p2net =
        p2raw && p2pr.par > 0 && p2pr.si > 0
          ? netStablefordPointsForHole({
              rawScore: p2raw,
              par: p2pr.par,
              strokeIndex: p2pr.si,
              playingHandicap: p2hcp,
            })
          : 0;

      const best = Math.max(p1net, p2net);
      const tied = p1net === p2net;

      const p1contrib = tied ? true : p1net === best;
      const p2contrib = tied ? true : p2net === best;

      const p1shade =
        p1pr.par > 0 && (p1pickup || p1gross !== null) ? shadeForGross(p1gross, p1pickup, p1pr.par) : "none";
      const p2shade =
        p2pr.par > 0 && (p2pickup || p2gross !== null) ? shadeForGross(p2gross, p2pickup, p2pr.par) : "none";

      out.push({
        hole,
        p1: {
          gross: p1pickup ? "P" : p1gross !== null ? String(p1gross) : "",
          net: p1net,
          shade: p1shade,
          contributes: p1contrib,
          tied,
        },
        p2: {
          gross: p2pickup ? "P" : p2gross !== null ? String(p2gross) : "",
          net: p2net,
          shade: p2shade,
          contributes: p2contrib,
          tied,
        },
        best,
      });
    }
    return out;
  }, [p1, p2, parByTeeHole, hcpByPlayer, scoreByPlayerHole, playersById, tourId, round?.round_no]);

  const specialRows = useMemo(() => {
    if (!p1 || !p2) return [];

    const out: any[] = [];

    for (let displayHole = 1; displayHole <= 9; displayHole++) {
      const p1Front = getPlayerHoleCell(p1, displayHole);
      const p1Back = getPlayerHoleCell(p1, displayHole + 9);
      const p2Front = getPlayerHoleCell(p2, displayHole);
      const p2Back = getPlayerHoleCell(p2, displayHole + 9);

      const cells = [p1Front, p1Back, p2Front, p2Back];
      const best = Math.max(...cells.map((c) => Number(c.net) || 0));
      const tied = cells.filter((c) => Number(c.net) === best).length > 1;

      for (const c of cells) {
        c.contributes = tied ? Number(c.net) === best : Number(c.net) === best;
        c.tied = tied && Number(c.net) === best;
      }

      out.push({
        displayHole,
        p1Front,
        p1Back,
        p2Front,
        p2Back,
        best,
      });
    }

    return out;
  }, [p1, p2, parByTeeHole, hcpByPlayer, scoreByPlayerHole, playersById, tourId, round?.round_no]);

  const totals = useMemo(() => {
    const sum = (arr: typeof rows) => {
      const grossNum = (v: string) => {
        if (!v) return 0;
        if (v === "P") return 0;
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };

      const p1gross = arr.reduce((s, r) => s + grossNum(r.p1.gross), 0);
      const p2gross = arr.reduce((s, r) => s + grossNum(r.p2.gross), 0);

      const p1net = arr.reduce((s, r) => s + (Number(r.p1.net) || 0), 0);
      const p2net = arr.reduce((s, r) => s + (Number(r.p2.net) || 0), 0);

      const best = arr.reduce((s, r) => s + (Number(r.best) || 0), 0);

      return { p1gross, p2gross, p1net, p2net, best };
    };

    const front = rows.slice(0, 9);
    const back = rows.slice(9, 18);

    const out = sum(front);
    const inn = sum(back);
    const total = sum(rows);

    const contrib = (arr: typeof rows) => {
      const p1 = arr.reduce((s, r) => s + (r.p1.contributes ? Number(r.p1.net) || 0 : 0), 0);
      const p2 = arr.reduce((s, r) => s + (r.p2.contributes ? Number(r.p2.net) || 0 : 0), 0);
      return { p1, p2 };
    };

    return { out, inn, total, contrib: contrib(rows) };
  }, [rows]);

  const specialTotals = useMemo(() => {
    const grossNum = (v: string) => {
      if (!v) return 0;
      if (v === "P") return 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const sumCell = (key: "p1Front" | "p1Back" | "p2Front" | "p2Back") => {
      const gross = specialRows.reduce((s, r) => s + grossNum(r[key].gross), 0);
      const net = specialRows.reduce((s, r) => s + (Number(r[key].net) || 0), 0);
      const contrib = specialRows.reduce((s, r) => s + (r[key].contributes ? Number(r[key].net) || 0 : 0), 0);
      return { gross, net, contrib };
    };

    return {
      p1Front: sumCell("p1Front"),
      p1Back: sumCell("p1Back"),
      p2Front: sumCell("p2Front"),
      p2Back: sumCell("p2Back"),
      best: specialRows.reduce((s, r) => s + (Number(r.best) || 0), 0),
    };
  }, [specialRows]);

  // Header lines
  const headerLine1 = useMemo(() => {
    if (!p1 || !p2) return "Pair";
    return `Pair – ${p1.name}/${p2.name}`;
  }, [p1, p2]);

  const headerLine2 = useMemo(() => {
    const roundNo = typeof round?.round_no === "number" && round.round_no ? `Round ${round.round_no}` : "Round";
    const course = round?.courses?.name ? ` · ${round.courses.name}` : "";
    return `${roundNo}${course}`;
  }, [round]);

  const headerLine3 = useMemo(() => formatDate(round?.played_on ?? null), [round?.played_on]);

  // Existing block shading vars (unchanged)
  const P1_BG = "bg-slate-50";
  const P2_BG = "bg-slate-100/70";

  function SpecialScoreCell({
    cell,
    bg,
  }: {
    cell: {
      hole: number;
      gross: string;
      net: number;
      shade: Shade;
      contributes: boolean;
      tied: boolean;
    };
    bg: string;
  }) {
    return (
      <td className={`px-2 py-2 text-center ${bg}`}>
        <div className="flex flex-col items-center gap-1">
          <div className="text-[10px] font-bold text-slate-500">H{cell.hole}</div>
          <div className="flex items-center justify-center gap-1">
            <GrossBox shade={cell.shade} label={cell.gross || ""} />
            <StablefordBox value={cell.net} contributes={cell.contributes} tied={cell.tied} />
          </div>
        </div>
      </td>
    );
  }

  return (
    <div className="min-h-dvh bg-white text-slate-900">
      <main className="mx-auto w-full max-w-md px-4 py-4 pb-24">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-extrabold">{headerLine1}</div>
            <div className="mt-1 truncate text-sm font-semibold text-slate-700">{headerLine2}</div>
            {headerLine3 ? <div className="mt-1 text-sm text-slate-500">{headerLine3}</div> : null}
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
        ) : !p1 || !p2 ? (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            Pair members not found.
          </div>
        ) : isSwingInSpringRound3 ? (
          <>
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
              Round 3 pairs scoring: each row takes the highest Stableford score from both players’ matching front-nine
              and back-nine holes.
            </div>

            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full border-collapse">
                <thead>
                  <tr className="text-[12px] font-extrabold text-slate-800">
                    <th className="border-b border-slate-200 bg-white px-2 py-2 text-center w-[54px]">Score Hole</th>
                    <th colSpan={2} className={`border-b border-slate-200 px-2 py-2 text-center ${P1_BG}`}>
                      {p1.name}
                    </th>
                    <th colSpan={2} className={`border-b border-slate-200 px-2 py-2 text-center ${P2_BG}`}>
                      {p2.name}
                    </th>
                    <th className="border-b border-slate-200 bg-white px-2 py-2 text-center w-[70px]">Better</th>
                  </tr>

                  <tr className="bg-slate-50 text-[11px] font-semibold text-slate-700">
                    <th className="border-b border-slate-200 px-2 py-2 text-center"> </th>
                    <th className={`border-b border-slate-200 px-2 py-2 text-center ${P1_BG}`}>Front</th>
                    <th className={`border-b border-slate-200 px-2 py-2 text-center ${P1_BG}`}>Back</th>
                    <th className={`border-b border-slate-200 px-2 py-2 text-center ${P2_BG}`}>Front</th>
                    <th className={`border-b border-slate-200 px-2 py-2 text-center ${P2_BG}`}>Back</th>
                    <th className="border-b border-slate-200 px-2 py-2 text-center">BB</th>
                  </tr>
                </thead>

                <tbody className="text-sm text-slate-900">
                  {specialRows.map((r) => (
                    <tr key={r.displayHole} className="border-b border-slate-100">
                      <td className="px-2 py-2 text-center font-semibold">{r.displayHole}</td>

                      <SpecialScoreCell cell={r.p1Front} bg={P1_BG} />
                      <SpecialScoreCell cell={r.p1Back} bg={P1_BG} />
                      <SpecialScoreCell cell={r.p2Front} bg={P2_BG} />
                      <SpecialScoreCell cell={r.p2Back} bg={P2_BG} />

                      <td className="px-2 py-2 text-center font-extrabold">{r.best}</td>
                    </tr>
                  ))}

                  <tr className="border-b border-slate-200 bg-slate-50">
                    <td className="px-2 py-2 text-center text-[12px] font-extrabold text-slate-900">Total</td>

                    <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P1_BG}`}>
                      <div>G {specialTotals.p1Front.gross}</div>
                      <div>N {specialTotals.p1Front.net}</div>
                    </td>
                    <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P1_BG}`}>
                      <div>G {specialTotals.p1Back.gross}</div>
                      <div>N {specialTotals.p1Back.net}</div>
                    </td>
                    <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P2_BG}`}>
                      <div>G {specialTotals.p2Front.gross}</div>
                      <div>N {specialTotals.p2Front.net}</div>
                    </td>
                    <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P2_BG}`}>
                      <div>G {specialTotals.p2Back.gross}</div>
                      <div>N {specialTotals.p2Back.net}</div>
                    </td>

                    <td className="px-2 py-2 text-center text-[12px] font-extrabold">{specialTotals.best}</td>
                  </tr>

                  <tr className="bg-white">
                    <td className="px-2 py-2 text-center text-[12px] font-extrabold text-slate-700">Contrib</td>

                    <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P1_BG}`}>
                      {specialTotals.p1Front.contrib}
                    </td>
                    <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P1_BG}`}>
                      {specialTotals.p1Back.contrib}
                    </td>
                    <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P2_BG}`}>
                      {specialTotals.p2Front.contrib}
                    </td>
                    <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P2_BG}`}>
                      {specialTotals.p2Back.contrib}
                    </td>

                    <td className="px-2 py-2 text-center" />
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-xs text-slate-600">
              Each scoring hole uses the best Stableford score from the front/back matching holes for both players.
              Dotted borders show the value contributing to the Better score.
            </div>

            <div className="mt-4 text-center">
              <Link className="text-sm font-semibold underline" href={`/m/tours/${tourId}/leaderboards`}>
                Back to Leaderboards
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="text-[12px] font-extrabold text-slate-800">
                    <th className="border-b border-slate-200 bg-white px-2 py-2 text-center w-[44px]">Hole</th>
                    <th colSpan={2} className={`border-b border-slate-200 px-2 py-2 text-center ${P1_BG}`}>
                      {p1.name}
                    </th>
                    <th colSpan={2} className={`border-b border-slate-200 px-2 py-2 text-center ${P2_BG}`}>
                      {p2.name}
                    </th>
                    <th className="border-b border-slate-200 bg-white px-2 py-2 text-center w-[70px]">Better</th>
                  </tr>

                  <tr className="bg-slate-50 text-[11px] font-semibold text-slate-700">
                    <th className="border-b border-slate-200 px-2 py-2 text-center"> </th>
                    <th className={`border-b border-slate-200 px-2 py-2 text-center ${P1_BG}`}>Gross</th>
                    <th className={`border-b border-slate-200 px-2 py-2 text-center ${P1_BG}`}>Net</th>
                    <th className={`border-b border-slate-200 px-2 py-2 text-center ${P2_BG}`}>Gross</th>
                    <th className={`border-b border-slate-200 px-2 py-2 text-center ${P2_BG}`}>Net</th>
                    <th className="border-b border-slate-200 px-2 py-2 text-center">BB</th>
                  </tr>
                </thead>

                <tbody className="text-sm text-slate-900">
                  {rows.map((r) => {
                    const isFrontEnd = r.hole === 9;
                    const isBackEnd = r.hole === 18;

                    return (
                      <React.Fragment key={r.hole}>
                        <tr className="border-b border-slate-100">
                          <td className="px-2 py-2 text-center font-semibold">{r.hole}</td>

                          <td className={`px-2 py-2 text-center ${P1_BG}`}>
                            <GrossBox shade={r.p1.shade} label={r.p1.gross || ""} />
                          </td>
                          <td className={`px-2 py-2 text-center ${P1_BG}`}>
                            <StablefordBox value={r.p1.net} contributes={r.p1.contributes} tied={r.p1.tied} />
                          </td>

                          <td className={`px-2 py-2 text-center ${P2_BG}`}>
                            <GrossBox shade={r.p2.shade} label={r.p2.gross || ""} />
                          </td>
                          <td className={`px-2 py-2 text-center ${P2_BG}`}>
                            <StablefordBox value={r.p2.net} contributes={r.p2.contributes} tied={r.p2.tied} />
                          </td>

                          <td className="px-2 py-2 text-center font-extrabold">{r.best}</td>
                        </tr>

                        {isFrontEnd ? (
                          <tr className="border-b border-slate-200 bg-white">
                            <td className="px-2 py-2 text-center text-[12px] font-extrabold text-slate-700">Out</td>

                            <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P1_BG}`}>
                              {totals.out.p1gross}
                            </td>
                            <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P1_BG}`}>
                              {totals.out.p1net}
                            </td>

                            <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P2_BG}`}>
                              {totals.out.p2gross}
                            </td>
                            <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P2_BG}`}>
                              {totals.out.p2net}
                            </td>

                            <td className="px-2 py-2 text-center text-[12px] font-extrabold">{totals.out.best}</td>
                          </tr>
                        ) : null}

                        {isBackEnd ? (
                          <>
                            <tr className="border-b border-slate-100 bg-white">
                              <td className="px-2 py-2 text-center text-[12px] font-extrabold text-slate-700">In</td>

                              <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P1_BG}`}>
                                {totals.inn.p1gross}
                              </td>
                              <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P1_BG}`}>
                                {totals.inn.p1net}
                              </td>

                              <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P2_BG}`}>
                                {totals.inn.p2gross}
                              </td>
                              <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P2_BG}`}>
                                {totals.inn.p2net}
                              </td>

                              <td className="px-2 py-2 text-center text-[12px] font-extrabold">{totals.inn.best}</td>
                            </tr>

                            <tr className="border-b border-slate-200 bg-slate-50">
                              <td className="px-2 py-2 text-center text-[12px] font-extrabold text-slate-900">Total</td>

                              <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P1_BG}`}>
                                {totals.total.p1gross}
                              </td>
                              <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P1_BG}`}>
                                {totals.total.p1net}
                              </td>

                              <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P2_BG}`}>
                                {totals.total.p2gross}
                              </td>
                              <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P2_BG}`}>
                                {totals.total.p2net}
                              </td>

                              <td className="px-2 py-2 text-center text-[12px] font-extrabold">{totals.total.best}</td>
                            </tr>

                            <tr className="bg-white">
                              <td className="px-2 py-2 text-center text-[12px] font-extrabold text-slate-700">Contrib</td>

                              <td className={`px-2 py-2 text-center ${P1_BG}`} />
                              <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P1_BG}`}>
                                {totals.contrib.p1}
                              </td>

                              <td className={`px-2 py-2 text-center ${P2_BG}`} />
                              <td className={`px-2 py-2 text-center text-[12px] font-extrabold ${P2_BG}`}>
                                {totals.contrib.p2}
                              </td>

                              <td className="px-2 py-2 text-center" />
                            </tr>
                          </>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 text-center">
              <Link className="text-sm font-semibold underline" href={`/m/tours/${tourId}/leaderboards`}>
                Back to Leaderboards
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}