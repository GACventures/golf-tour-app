// app/m/tours/[id]/rounds/[roundId]/scoring/score-alt/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";
import { recalcAndSaveTourHandicaps } from "@/lib/handicaps/recalcAndSaveTourHandicaps";

type Tee = "M" | "F";
type TabKey = "entry" | "summary";

// === Gross score colouring (shared with other mobile views) ===
type Shade = "ace" | "eagle" | "birdie" | "par" | "bogey" | "dbogey" | "none";

const BLUE_ACE = "#082B5C";
const BLUE_EAGLE = "#1757D6";
const BLUE_BIRDIE = "#4DA3FF";

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

function GrossBox({ shade, label }: { shade: Shade; label: string }) {
  const isBlue = shade === "ace" || shade === "eagle" || shade === "birdie";
  const base = "inline-flex min-w-[44px] justify-center rounded-md px-2 py-[2px] text-[14px] font-extrabold";

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

type CourseRel = { name: string };

type Round = {
  id: string;
  name: string;
  course_id: string | null;
  is_locked: boolean | null;
  courses?: CourseRel | CourseRel[] | null;
};

type ParRow = {
  course_id: string;
  hole_number: number;
  tee: Tee;
  par: number;
  stroke_index: number;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number | null;
  tee?: Tee | null; // per-round tee
};

type PlayerRow = {
  id: string;
  name: string;
  gender?: Tee | null; // global gender (fallback only)
};

type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean | null;
};

// Buddy-check score storage (separate from official scores)
type BuddyScoreRow = {
  round_id: string;
  owner_player_id: string;
  buddy_player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean | null;
};

const borderLight = "border-slate-300";

function asSingle<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function normalizeRawInput(v: string): string {
  const s = (v ?? "").toString().trim().toUpperCase();
  if (!s) return "";
  if (s === "P") return "P";
  if (/^\d+$/.test(s)) return s;
  return "";
}

function rawToShots(raw: string): number {
  const s = normalizeRawInput(raw);
  if (!s) return 0;
  if (s === "P") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

// Whole-page swipe FX states
type HoleFxState =
  | { stage: "idle"; dir: "next" | "prev" | null }
  | { stage: "out"; dir: "next" | "prev" }
  | { stage: "inSnap"; dir: "next" | "prev" }
  | { stage: "in"; dir: "next" | "prev" };

// --- shots given helper ---
function shotsGivenForHole(playingHandicap: number, strokeIndex: number): number {
  const hcp = Number.isFinite(Number(playingHandicap)) ? Number(playingHandicap) : 0;
  const si = Number.isFinite(Number(strokeIndex)) ? Number(strokeIndex) : 0;
  if (!si || si < 1 || si > 18) return 0;

  if (hcp >= 0) {
    return Math.floor((hcp + 18 - si) / 18);
  }

  const abs = Math.abs(hcp);
  return -Math.floor((abs + si - 1) / 18);
}

export default function MobileScoreEntryAltPage() {
  const params = useParams();
  const sp = useSearchParams();
  const router = useRouter();

  const tourId = String((params as any)?.id ?? "").trim();
  const roundId = (params as any)?.roundId ? String((params as any)?.roundId ?? "") : String((params as any)?.id ?? "");

  const meId = sp.get("meId") ?? "";
  const buddyId = sp.get("buddyId") ?? "";

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [round, setRound] = useState<Round | null>(null);
  const [parsByTee, setParsByTee] = useState<Record<Tee, ParRow[]>>({ M: [], F: [] });
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [playersById, setPlayersById] = useState<Record<string, PlayerRow>>({});
  const [scores, setScores] = useState<Record<string, Record<number, string>>>({});

  // Baseline for unsaved detection (ME ONLY)
  const initialScoresRef = useRef<Record<string, Record<number, string>>>({});

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  const [hole, setHole] = useState(1);
  const [tab, setTab] = useState<TabKey>("entry");
  const [summaryPid, setSummaryPid] = useState<string>("");

  const isLocked = round?.is_locked === true;

  // keypad prefix state (per player)
  const [prefix1ByPid, setPrefix1ByPid] = useState<Record<string, boolean>>({});

  // FX state + timeouts
  const [holeFx, setHoleFx] = useState<HoleFxState>({ stage: "idle", dir: null });
  const fxTimerRef = useRef<number | null>(null);

  // Hole number pulse state
  const [holePulse, setHolePulse] = useState<"idle" | "up" | "down">("idle");
  const pulseTimerRef = useRef<number | null>(null);

  const SWIPE_MS = 420;
  const PULSE_UP_MS = 140;
  const PULSE_HOLD_MS = 120;
  const PULSE_DOWN_MS = 160;

  // DEBUG marker (visible in UI to confirm this file/route is deployed)
  const DEBUG_MARK = "DEBUG score-alt: prev/next nav (v1)";

  function clearFxTimer() {
    if (fxTimerRef.current) {
      window.clearTimeout(fxTimerRef.current);
      fxTimerRef.current = null;
    }
  }
  function clearPulseTimer() {
    if (pulseTimerRef.current) {
      window.clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = null;
    }
  }

  function triggerHolePulse() {
    clearPulseTimer();
    setHolePulse("up");

    pulseTimerRef.current = window.setTimeout(() => {
      setHolePulse("down");

      pulseTimerRef.current = window.setTimeout(() => {
        setHolePulse("idle");
        clearPulseTimer();
      }, PULSE_DOWN_MS);
    }, PULSE_UP_MS + PULSE_HOLD_MS);
  }

  // Lock page scroll/bounce for this screen only
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;

    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyOverscroll = (body.style as any).overscrollBehavior;

    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    (body.style as any).overscrollBehavior = "none";

    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      (body.style as any).overscrollBehavior = prevBodyOverscroll;
    };
  }, []);

  // Whole-page slide style (entry tab only)
  const fxStyle: React.CSSProperties = useMemo(() => {
    const base = `transform ${SWIPE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`;
    const off = "105%";

    if (holeFx.stage === "idle") return { transform: "translateX(0)", transition: base, willChange: "transform" };
    if (holeFx.stage === "out") {
      const x = holeFx.dir === "next" ? `-${off}` : off;
      return { transform: `translateX(${x})`, transition: base, willChange: "transform" };
    }
    if (holeFx.stage === "inSnap") {
      const x = holeFx.dir === "next" ? off : `-${off}`;
      return { transform: `translateX(${x})`, transition: "none", willChange: "transform" };
    }
    if (holeFx.stage === "in") return { transform: "translateX(0)", transition: base, willChange: "transform" };
    return { transform: "translateX(0)", transition: base, willChange: "transform" };
  }, [holeFx, SWIPE_MS]);

  // Preferred tee logic:
  function teeForPlayer(pid: string): Tee {
    if (!pid) return "M";

    const rp = roundPlayers.find((x) => x.player_id === pid);
    if (rp?.tee) return normalizeTee(rp.tee);

    const g = playersById[pid]?.gender;
    if (g) return normalizeTee(g);

    return "M";
  }

  async function fetchTourIdForRound(rid: string): Promise<string | null> {
    if (!rid) return null;
    const { data, error } = await supabase.from("rounds").select("tour_id").eq("id", rid).maybeSingle();
    if (error) throw error;
    const tid = (data as any)?.tour_id ? String((data as any).tour_id) : "";
    return tid.trim() ? tid : null;
  }

  async function refreshRoundPlayers() {
    if (!roundId) return;
    const { data: rpData, error: rpErr } = await supabase
      .from("round_players")
      .select("round_id,player_id,playing,playing_handicap,tee")
      .eq("round_id", roundId)
      .eq("playing", true);
    if (rpErr) throw rpErr;

    const rpRows: RoundPlayerRow[] = (rpData ?? []).map((x: any) => ({
      round_id: String(x.round_id),
      player_id: String(x.player_id),
      playing: x.playing === true,
      playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
      tee: x.tee ? normalizeTee(x.tee) : null,
    }));
    setRoundPlayers(rpRows);
  }

  // Load
  useEffect(() => {
    if (!roundId) return;
    let alive = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");
      setSaveErr("");
      setSavedMsg("");

      try {
        // Round
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,name,course_id,is_locked,courses(name)")
          .eq("id", roundId)
          .single();
        if (rErr) throw rErr;
        const r = rData as unknown as Round;

        // Pars (both tees)
        const nextParsByTee: Record<Tee, ParRow[]> = { M: [], F: [] };
        if (r.course_id) {
          const { data, error } = await supabase
            .from("pars")
            .select("course_id,hole_number,tee,par,stroke_index")
            .eq("course_id", r.course_id)
            .in("tee", ["M", "F"])
            .order("hole_number", { ascending: true });

          if (error) throw error;

          for (const row of data ?? []) {
            const tee = normalizeTee((row as any).tee);
            nextParsByTee[tee].push({
              course_id: String((row as any).course_id),
              hole_number: Number((row as any).hole_number),
              tee,
              par: Number((row as any).par),
              stroke_index: Number((row as any).stroke_index),
            });
          }
        }

        // Round players (playing only)
        const { data: rpData, error: rpErr } = await supabase
          .from("round_players")
          .select("round_id,player_id,playing,playing_handicap,tee")
          .eq("round_id", roundId)
          .eq("playing", true);
        if (rpErr) throw rpErr;

        const rpRows: RoundPlayerRow[] = (rpData ?? []).map((x: any) => ({
          round_id: String(x.round_id),
          player_id: String(x.player_id),
          playing: x.playing === true,
          playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
          tee: x.tee ? normalizeTee(x.tee) : null,
        }));

        const ids = Array.from(new Set(rpRows.map((x) => x.player_id))).filter(Boolean);

        // Players (GLOBAL gender)
        const pMap: Record<string, PlayerRow> = {};
        if (ids.length > 0) {
          const { data: pData, error: pErr } = await supabase.from("players").select("id,name,gender").in("id", ids);
          if (pErr) throw pErr;
          for (const p of pData ?? []) {
            const id = String((p as any).id);
            pMap[id] = {
              id,
              name: String((p as any).name),
              gender: (p as any).gender ? normalizeTee((p as any).gender) : null,
            };
          }
        }

        // Official scores: ME ONLY
        let meScoreRows: ScoreRow[] = [];
        if (meId) {
          const { data: sData, error: sErr } = await supabase
            .from("scores")
            .select("round_id,player_id,hole_number,strokes,pickup")
            .eq("round_id", roundId)
            .eq("player_id", meId);
          if (sErr) throw sErr;
          meScoreRows = (sData ?? []) as ScoreRow[];
        }

        // Buddy-check scores
        let buddyCheckRows: BuddyScoreRow[] = [];
        if (meId && buddyId) {
          const { data: bData, error: bErr } = await supabase
            .from("buddy_scores")
            .select("round_id,owner_player_id,buddy_player_id,hole_number,strokes,pickup")
            .eq("round_id", roundId)
            .eq("owner_player_id", meId)
            .eq("buddy_player_id", buddyId);
          if (bErr) throw bErr;
          buddyCheckRows = (bData ?? []) as BuddyScoreRow[];
        }

        const nextScores: Record<string, Record<number, string>> = {};
        if (meId) nextScores[meId] = {};
        if (buddyId) nextScores[buddyId] = {};

        for (const row of meScoreRows) {
          const h = Number(row.hole_number);
          const isPickup = (row as any).pickup === true;
          const raw = isPickup ? "P" : row.strokes === null || row.strokes === undefined ? "" : String(row.strokes);
          if (meId) nextScores[meId][h] = normalizeRawInput(raw);
        }

        for (const row of buddyCheckRows) {
          const h = Number(row.hole_number);
          const isPickup = (row as any).pickup === true;
          const raw = isPickup ? "P" : row.strokes === null || row.strokes === undefined ? "" : String(row.strokes);
          if (buddyId) nextScores[buddyId][h] = normalizeRawInput(raw);
        }

        if (!alive) return;

        setRound(r);
        setParsByTee(nextParsByTee);
        setRoundPlayers(rpRows);
        setPlayersById(pMap);
        setScores(nextScores);

        setPrefix1ByPid({});
        initialScoresRef.current = { [meId]: nextScores[meId] ?? {} };

        setSummaryPid((prev) => prev || meId || buddyId || "");
        setTab("entry");
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load score entry.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  const courseName = useMemo(() => asSingle(round?.courses)?.name ?? "(no course)", [round]);
  const playingIds = useMemo(() => roundPlayers.map((rp) => rp.player_id), [roundPlayers]);

  const meName = playersById[meId]?.name ?? "Me";
  const buddyName = buddyId ? playersById[buddyId]?.name ?? "Buddy" : "";

  const holeInfoByNumberByTee = useMemo(() => {
    const makeMap = (rows: ParRow[]) => {
      const by: Record<number, { par: number; si: number }> = {};
      for (const p of rows) by[p.hole_number] = { par: p.par, si: p.stroke_index };
      return by;
    };
    return { M: makeMap(parsByTee.M), F: makeMap(parsByTee.F) };
  }, [parsByTee]);

  const meTee = useMemo(() => teeForPlayer(meId), [meId, roundPlayers, playersById]);
  const buddyTee = useMemo(() => teeForPlayer(buddyId), [buddyId, roundPlayers, playersById]);

  const meHcp = useMemo(() => {
    const rp = roundPlayers.find((x) => x.player_id === meId);
    return Number.isFinite(Number(rp?.playing_handicap)) ? Number(rp?.playing_handicap) : 0;
  }, [roundPlayers, meId]);

  const buddyHcp = useMemo(() => {
    const rp = roundPlayers.find((x) => x.player_id === buddyId);
    return Number.isFinite(Number(rp?.playing_handicap)) ? Number(rp?.playing_handicap) : 0;
  }, [roundPlayers, buddyId]);

  function infoFor(pid: string, h: number) {
    const tee = teeForPlayer(pid);
    return holeInfoByNumberByTee[tee]?.[h] ?? { par: 0, si: 0 };
  }

  const holeInfoM = holeInfoByNumberByTee.M?.[hole] ?? { par: 0, si: 0 };
  const holeInfoF = holeInfoByNumberByTee.F?.[hole] ?? { par: 0, si: 0 };

  function setRaw(pid: string, holeNumber: number, raw: string) {
    const norm = normalizeRawInput(raw);
    setScores((prev) => ({ ...prev, [pid]: { ...(prev[pid] ?? {}), [holeNumber]: norm } }));
  }

  function togglePickup(pid: string, holeNumber: number) {
    const raw = scores[pid]?.[holeNumber] ?? "";
    setRaw(pid, holeNumber, raw === "P" ? "" : "P");
    setPrefix1ByPid((prev) => ({ ...prev, [pid]: false }));
  }

  function pointsFor(pid: string, h: number): number {
    const hi = infoFor(pid, h);
    if (!hi?.par || !hi?.si) return 0;

    const raw = scores[pid]?.[h] ?? "";
    const hcp = pid === meId ? meHcp : pid === buddyId ? buddyHcp : 0;

    return netStablefordPointsForHole({
      rawScore: raw,
      par: hi.par,
      strokeIndex: hi.si,
      playingHandicap: hcp,
    });
  }

  function sumPoints(pid: string, from: number, to: number): number {
    let sum = 0;
    for (let h = from; h <= to; h++) sum += pointsFor(pid, h);
    return sum;
  }

  function sumShots(pid: string, from: number, to: number): number {
    let sum = 0;
    for (let h = from; h <= to; h++) sum += rawToShots(scores[pid]?.[h] ?? "");
    return sum;
  }

  function isDirty(): boolean {
    const initial = initialScoresRef.current;
    const pid = meId;
    if (!pid) return false;

    for (let h = 1; h <= 18; h++) {
      const a = normalizeRawInput(initial?.[pid]?.[h] ?? "");
      const b = normalizeRawInput(scores?.[pid]?.[h] ?? "");
      if (a !== b) return true;
    }
    return false;
  }

  async function saveAll(): Promise<boolean> {
    setSaveErr("");
    setSavedMsg("");

    if (!roundId) return false;
    if (isLocked) {
      setSaveErr("Round is locked.");
      return false;
    }
    if (!meId) {
      setSaveErr("Missing meId. Go back and reselect Me.");
      return false;
    }

    const pid = meId;

    const upserts: ScoreRow[] = [];
    const deletes: { round_id: string; player_id: string; hole_number: number }[] = [];

    const initialMe = initialScoresRef.current?.[pid] ?? {};

    for (let h = 1; h <= 18; h++) {
      const raw = normalizeRawInput(scores[pid]?.[h] ?? "");
      const had = normalizeRawInput(initialMe?.[h] ?? "");

      if (!raw) {
        if (had) deletes.push({ round_id: roundId, player_id: pid, hole_number: h });
        continue;
      }

      const isPickup = raw === "P";
      const strokes = isPickup ? null : Number(raw);

      upserts.push({
        round_id: roundId,
        player_id: pid,
        hole_number: h,
        strokes: Number.isFinite(strokes as any) ? (strokes as any) : null,
        pickup: isPickup ? true : false,
      });
    }

    setSaving(true);
    try {
      for (const d of deletes) {
        const { error } = await supabase
          .from("scores")
          .delete()
          .eq("round_id", d.round_id)
          .eq("player_id", d.player_id)
          .eq("hole_number", d.hole_number);
        if (error) throw error;
      }

      if (upserts.length > 0) {
        const { error } = await supabase.from("scores").upsert(upserts as any, {
          onConflict: "round_id,player_id,hole_number",
        });
        if (error) throw error;
      }

      try {
        const tid = await fetchTourIdForRound(roundId);
        if (tid) {
          const res = await recalcAndSaveTourHandicaps({
            supabase,
            tourId: tid,
            fromRoundId: roundId,
          });
          if (res?.ok) await refreshRoundPlayers();
        }
      } catch {
        // intentionally silent
      }

      initialScoresRef.current = { [meId]: { ...(scores[meId] ?? {}) } };
      setSavedMsg("Saved ✓");
      window.setTimeout(() => setSavedMsg(""), 1200);

      return true;
    } catch (e: any) {
      setSaveErr(e?.message ?? "Save failed.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function saveBuddyCheckHole(holeNumber: number): Promise<void> {
    if (!roundId) return;
    if (!meId) return;
    if (!buddyId) return;

    const raw = normalizeRawInput(scores[buddyId]?.[holeNumber] ?? "");

    if (!raw) {
      const { error } = await supabase
        .from("buddy_scores")
        .delete()
        .eq("round_id", roundId)
        .eq("owner_player_id", meId)
        .eq("buddy_player_id", buddyId)
        .eq("hole_number", holeNumber);

      if (error) setSaveErr(error.message ?? "Buddy-check save failed.");
      return;
    }

    const isPickup = raw === "P";
    const strokes = isPickup ? null : Number(raw);

    const row: BuddyScoreRow = {
      round_id: roundId,
      owner_player_id: meId,
      buddy_player_id: buddyId,
      hole_number: holeNumber,
      strokes: Number.isFinite(strokes as any) ? (strokes as any) : null,
      pickup: isPickup ? true : false,
    };

    const { error } = await supabase.from("buddy_scores").upsert(row as any, {
      onConflict: "round_id,owner_player_id,buddy_player_id,hole_number",
    });

    if (error) setSaveErr(error.message ?? "Buddy-check save failed.");
  }

  // Swipe handling
  const swipeRef = useRef<{ x: number; y: number; t: number } | null>(null);

  function animateHoleChange(dir: "next" | "prev") {
    if (tab !== "entry") return;
    if (holeFx.stage !== "idle") return;

    const nextHole = clamp(hole + (dir === "next" ? 1 : -1), 1, 18);
    if (nextHole === hole) return;

    clearFxTimer();
    setHoleFx({ stage: "out", dir });

    fxTimerRef.current = window.setTimeout(() => {
      setHole(nextHole);
      triggerHolePulse();

      setHoleFx({ stage: "inSnap", dir });

      requestAnimationFrame(() => {
        setHoleFx({ stage: "in", dir });

        fxTimerRef.current = window.setTimeout(() => {
          setHoleFx({ stage: "idle", dir: null });
          clearFxTimer();
        }, SWIPE_MS);
      });
    }, SWIPE_MS);
  }

  async function handleSwipe(dir: "next" | "prev") {
    if (tab !== "entry") return;
    if (holeFx.stage !== "idle") return;

    const nextHole = clamp(hole + (dir === "next" ? 1 : -1), 1, 18);
    if (nextHole === hole) return;

    if (!isLocked && buddyId) {
      await saveBuddyCheckHole(hole);
    }

    if (!isLocked && !saving && isDirty()) {
      await saveAll();
    }

    setPrefix1ByPid({});

    animateHoleChange(dir);
  }

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }

  function onTouchEnd(e: React.TouchEvent) {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;

    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dt = Date.now() - start.t;

    if (Math.abs(dy) > Math.abs(dx)) return;
    if (dt > 1200) return;

    const threshold = 70;
    if (dx <= -threshold) void handleSwipe("next");
    if (dx >= threshold) void handleSwipe("prev");
  }

  useEffect(() => {
    return () => {
      clearFxTimer();
      clearPulseTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function goBackToSelect() {
    const href = `/m/tours/${tourId}/rounds/${roundId}/scoring?meId=${encodeURIComponent(meId)}${
      buddyId ? `&buddyId=${encodeURIComponent(buddyId)}` : ""
    }`;
    if (!isDirty() || confirm("You have unsaved changes for Me. Leave without saving?")) {
      router.push(href);
    }
  }

  function handleBack() {
    if (tab === "summary") {
      setTab("entry");
      return;
    }
    goBackToSelect();
  }

  function openInPageSummaryFor(pid: string) {
    if (!pid) return;
    setSummaryPid(pid);
    setTab("summary");
  }

  // --- keypad input (ALT) ---
  function pressDigit(pid: string, digit: number) {
    if (isLocked) return;

    const usePrefix = prefix1ByPid[pid] === true;
    const next = usePrefix ? 10 + digit : digit;

    setRaw(pid, hole, String(next));
    setPrefix1ByPid((prev) => ({ ...prev, [pid]: false }));
  }

  function pressPrefix1(pid: string) {
    if (isLocked) return;
    setPrefix1ByPid((prev) => ({ ...prev, [pid]: !(prev[pid] === true) }));
  }

  function pressZero(pid: string) {
    if (isLocked) return;

    const usePrefix = prefix1ByPid[pid] === true;
    if (usePrefix) {
      setRaw(pid, hole, "10");
      setPrefix1ByPid((prev) => ({ ...prev, [pid]: false }));
      return;
    }

    setRaw(pid, hole, "");
  }

  function clearHole(pid: string) {
    if (isLocked) return;
    setRaw(pid, hole, "");
    setPrefix1ByPid((prev) => ({ ...prev, [pid]: false }));
  }

  // --- UI helpers ---

  // One-row hole info (SI-only)
  function HoleRowEntryOnly() {
    const holeScale = holePulse === "up" ? 1.12 : holePulse === "down" ? 1.0 : 1.0;
    const holeStyle: React.CSSProperties = {
      transform: `scale(${holeScale})`,
      transition:
        holePulse === "up"
          ? `transform ${PULSE_UP_MS}ms ease-out`
          : holePulse === "down"
            ? `transform ${PULSE_DOWN_MS}ms ease-in`
            : "none",
      transformOrigin: "center",
      willChange: "transform",
    };

    return (
      <div className="px-4 pb-2">
        <div className="rounded-xl border border-slate-300 bg-white px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-slate-900">
            <div className="flex items-center gap-2">
              <div className="text-sm font-extrabold tracking-wide text-slate-700">HOLE</div>
              <div className="text-3xl font-black leading-none" style={holeStyle}>
                {hole}
              </div>
            </div>

            <div className="flex items-center gap-3 text-sm font-bold text-slate-800">
              <div className="whitespace-nowrap">SI: M {holeInfoM.si || "—"}</div>
              <div className="whitespace-nowrap">F {holeInfoF.si || "—"}</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function SummaryPlayerToggleTop() {
    const hasBuddy = Boolean(buddyId);

    return (
      <div className="px-4 pb-2">
        <div className="flex items-center justify-center">
          <div className={`w-[260px] rounded-md border ${borderLight} bg-white text-slate-900 text-center py-2`}>
            <div className="text-xs font-semibold tracking-wide text-slate-600">SUMMARY PLAYER</div>

            <div className="mt-2 inline-flex rounded-md overflow-hidden border border-slate-300">
              <button
                type="button"
                onClick={() => setSummaryPid(meId)}
                className={`px-4 py-2 text-base font-bold ${
                  summaryPid === meId ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-900"
                }`}
              >
                {meName}
              </button>

              {hasBuddy ? (
                <button
                  type="button"
                  onClick={() => setSummaryPid(buddyId)}
                  className={`px-4 py-2 text-base font-bold ${
                    summaryPid === buddyId ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-900"
                  }`}
                >
                  {buddyName}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function SummaryTotalsRow(props: { label: string; shots: number; pts: number; onJumpTo?: number }) {
    const { label, shots, pts, onJumpTo } = props;

    return (
      <div className="px-3 py-2 border-t border-slate-300 bg-slate-50 grid grid-cols-5 gap-2 items-center text-slate-900">
        <button
          type="button"
          className="rounded-md px-3 py-2 text-left font-bold bg-slate-900 text-white"
          onClick={() => {
            if (onJumpTo) {
              setHole(onJumpTo);
              setTab("entry");
              triggerHolePulse();
            }
          }}
        >
          {label}
        </button>
        <div />
        <div />
        <div className="text-center font-bold">{shots}</div>
        <div className="text-center font-bold">{pts}</div>
      </div>
    );
  }

  function SummaryTable() {
    const pid = summaryPid || meId;
    const tee = teeForPlayer(pid);

    const frontShots = sumShots(pid, 1, 9);
    const frontPts = sumPoints(pid, 1, 9);
    const backShots = sumShots(pid, 10, 18);
    const backPts = sumPoints(pid, 10, 18);
    const totalShots = frontShots + backShots;
    const totalPts = frontPts + backPts;

    return (
      <div className="rounded-lg overflow-hidden bg-white shadow-sm text-slate-900 border border-slate-200">
        <div className="bg-slate-100 px-3 py-2 text-xs font-bold tracking-wide text-slate-700 grid grid-cols-5 gap-2">
          <div>HOLE</div>
          <div className="text-center">PAR</div>
          <div className="text-center">SI</div>
          <div className="text-center">STROKES</div>
          <div className="text-center">PTS</div>
        </div>

        {Array.from({ length: 18 }).map((_, idx) => {
          const h = idx + 1;
          const info = holeInfoByNumberByTee[tee]?.[h] ?? { par: 0, si: 0 };

          const raw = scores[pid]?.[h] ?? "";
          const disp = raw === "P" ? "P" : raw || "—";
          const pts = pointsFor(pid, h);

          return (
            <React.Fragment key={h}>
              <div className="px-3 py-2 border-t border-slate-200 grid grid-cols-5 gap-2 items-center">
                <button
                  type="button"
                  className="rounded-md px-3 py-2 text-left font-bold bg-slate-100 text-slate-900"
                  onClick={() => {
                    setHole(h);
                    setTab("entry");
                    triggerHolePulse();
                  }}
                >
                  {h}
                </button>

                <div className="text-center font-semibold">{info.par || "—"}</div>
                <div className="text-center">{info.si || "—"}</div>

                <div className="text-center">
                  <GrossBox
                    shade={shadeForGross(disp === "P" ? null : Number(disp), disp === "P", info.par)}
                    label={disp}
                  />
                </div>

                <div className="text-center font-bold">{pts}</div>
              </div>

              {h === 9 ? <SummaryTotalsRow label="Front 9" shots={frontShots} pts={frontPts} onJumpTo={1} /> : null}

              {h === 18 ? (
                <>
                  <SummaryTotalsRow label="Back 9" shots={backShots} pts={backPts} onJumpTo={10} />
                  <SummaryTotalsRow label="Total" shots={totalShots} pts={totalPts} onJumpTo={1} />
                </>
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  function PlayerPanel(props: { pid: string; label: string; hcp: number; tee: Tee; isBuddy: boolean }) {
    const { pid, label, hcp, tee, isBuddy } = props;

    const raw = scores[pid]?.[hole] ?? "";
    const pickup = raw === "P";

    const info = infoFor(pid, hole);
    const si = info?.si ?? 0;
    const par = info?.par ?? 0;

    const shotsGiven = shotsGivenForHole(hcp, si);
    const holePts = pickup ? 0 : pointsFor(pid, hole);

    const totalPts = useMemo(() => sumPoints(pid, 1, 18), [pid, scores, parsByTee, meHcp, buddyHcp]);
    const totalShots = useMemo(() => sumShots(pid, 1, 18), [pid, scores]);

    const grossDisplay = pickup ? "P" : raw && raw !== "P" ? raw : "—";
    const prefixOn = prefix1ByPid[pid] === true;

    const sectionBg = isBuddy ? "bg-emerald-200 border-emerald-300" : "bg-indigo-200 border-indigo-300";
    const nameHeader =
      tee === "F" ? "bg-pink-200 text-slate-900 border-pink-300" : "bg-sky-200 text-slate-900 border-sky-300";
    const keypadPanel = tee === "F" ? "bg-pink-100 border-pink-300" : "bg-sky-100 border-sky-300";
    const btnBaseBorder = tee === "F" ? "border-pink-300" : "border-sky-300";
    const btnBaseBg = tee === "F" ? "bg-pink-50" : "bg-sky-50";

    const parShade = "bg-amber-200 border-amber-400 text-slate-900";

    function KeyButton(props2: { text: string; onClick: () => void; shaded?: boolean; disabled?: boolean }) {
      const { text, onClick, shaded, disabled } = props2;
      return (
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={[
            "h-14 rounded-xl border text-xl font-black active:scale-[0.99] disabled:opacity-50",
            shaded ? parShade : `${btnBaseBg} ${btnBaseBorder} text-slate-900`,
          ].join(" ")}
        >
          {text}
        </button>
      );
    }

    function StatBox(props2: { label: string; value: React.ReactNode; variant?: "white" | "black" | "outline" }) {
      const variant = props2.variant ?? "white";

      const box =
        variant === "black"
          ? "bg-black text-white border-black"
          : variant === "outline"
            ? "bg-white text-slate-900 border-2 border-slate-900"
            : "bg-white text-slate-900 border border-slate-300";

      return (
        <div className={`rounded-xl ${box} px-3 py-2 text-center`}>
          <div className="text-xs font-extrabold tracking-wide opacity-80">{props2.label}</div>
          <div className="mt-1 text-2xl font-black leading-tight">{props2.value}</div>
        </div>
      );
    }

    return (
      <div className={`rounded-2xl border shadow-sm overflow-hidden ${sectionBg}`}>
        <div className="rounded-2xl overflow-hidden bg-white/75">
          <div className={`px-3 py-2 text-sm font-extrabold text-center border-b ${nameHeader}`}>
            <div className="truncate">
              {label} <span className="opacity-80">(HC: {hcp} · Tee: {tee})</span>
            </div>
          </div>

          <div className="p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <StatBox label="Par" value={par || "—"} variant="white" />
              <StatBox label="Shots" value={Number.isFinite(shotsGiven) ? shotsGiven : 0} variant="white" />
              <StatBox label="Strokes" value={grossDisplay} variant="outline" />
              <StatBox label="Points" value={holePts} variant="white" />
            </div>

            <div className={`rounded-xl border px-3 py-3 ${keypadPanel}`}>
              <div className="text-xs font-extrabold text-slate-700 mb-2 text-center">STROKES</div>

              <div className="grid grid-cols-3 gap-2">
                <KeyButton text="1" onClick={() => pressDigit(pid, 1)} shaded={par === 1} disabled={isLocked} />
                <KeyButton text="2" onClick={() => pressDigit(pid, 2)} shaded={par === 2} disabled={isLocked} />
                <KeyButton text="3" onClick={() => pressDigit(pid, 3)} shaded={par === 3} disabled={isLocked} />

                <KeyButton text="4" onClick={() => pressDigit(pid, 4)} shaded={par === 4} disabled={isLocked} />
                <KeyButton text="5" onClick={() => pressDigit(pid, 5)} shaded={par === 5} disabled={isLocked} />
                <KeyButton text="6" onClick={() => pressDigit(pid, 6)} shaded={par === 6} disabled={isLocked} />

                <KeyButton text="7" onClick={() => pressDigit(pid, 7)} shaded={par === 7} disabled={isLocked} />
                <KeyButton text="8" onClick={() => pressDigit(pid, 8)} shaded={par === 8} disabled={isLocked} />
                <KeyButton text="9" onClick={() => pressDigit(pid, 9)} shaded={par === 9} disabled={isLocked} />

                <button
                  type="button"
                  onClick={() => pressPrefix1(pid)}
                  disabled={isLocked}
                  className={[
                    "h-14 rounded-xl border text-xl font-black active:scale-[0.99] disabled:opacity-50",
                    btnBaseBorder,
                    prefixOn ? "bg-slate-900 text-white border-slate-900" : `${btnBaseBg} text-slate-900`,
                  ].join(" ")}
                >
                  1-
                </button>

                <KeyButton text="0" onClick={() => pressZero(pid)} shaded={par === 0} disabled={isLocked} />

                <button
                  type="button"
                  onClick={() => togglePickup(pid, hole)}
                  disabled={isLocked}
                  className={[
                    "h-14 rounded-xl border text-xl font-black active:scale-[0.99] disabled:opacity-50",
                    btnBaseBorder,
                    pickup ? "bg-slate-900 text-white border-slate-900" : `${btnBaseBg} text-slate-900`,
                  ].join(" ")}
                >
                  P
                </button>
              </div>

              <div className="mt-2 flex justify-start text-xs text-slate-700">
                <button type="button" className="underline" onClick={() => clearHole(pid)} disabled={isLocked}>
                  Clear hole
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-300 bg-white px-3 py-2">
              <div className="text-xs font-extrabold tracking-wide text-slate-700 text-center">TOTAL</div>

              <div className="mt-2 grid grid-cols-2 gap-2 text-center">
                <div className="text-[11px] font-bold text-slate-600">Shots</div>
                <div className="text-[11px] font-bold text-slate-600">Points</div>

                <div className="rounded-lg border border-slate-300 bg-white py-2 text-2xl font-black text-slate-900">
                  {totalShots}
                </div>

                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-slate-200 py-2 text-2xl font-black text-slate-900 active:scale-[0.99]"
                  onClick={() => openInPageSummaryFor(pid)}
                  aria-label="Open summary"
                >
                  {totalPts}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const meOkNow = !!meId && playingIds.includes(meId);
  const buddyOkNow = !buddyId || playingIds.includes(buddyId);

  if (loading) {
    return <div className="mx-auto w-full max-w-md px-4 py-4 pb-24 text-sm opacity-70">Loading…</div>;
  }

  if (!round) {
    return (
      <div className="p-4 space-y-3 text-slate-900">
        <div className="text-lg font-semibold">Score entry</div>
        <div className="text-sm text-red-600">{errorMsg || "Round not found."}</div>
      </div>
    );
  }

  if (!meOkNow) {
    return (
      <div className="p-4 space-y-3 text-slate-900">
        <div className="text-xl font-semibold">{round.name}</div>
        <div className="text-sm text-slate-600">Course: {courseName}</div>
        <div className="rounded-md border border-slate-300 p-3 text-sm space-y-2 bg-slate-50">
          <div className="font-semibold">Can’t start scoring</div>
          <div className="text-slate-600">
            The score page needs a valid <code>meId</code> for a player marked <code>playing=true</code>.
          </div>
        </div>
      </div>
    );
  }

  if (!buddyOkNow) {
    return (
      <div className="p-4 space-y-3 text-slate-900">
        <div className="text-xl font-semibold">{round.name}</div>
        <div className="text-sm text-slate-600">Course: {courseName}</div>
        <div className="rounded-md border border-slate-300 p-3 text-sm space-y-2 bg-slate-50">
          <div className="font-semibold">Buddy is not eligible</div>
          <div className="text-slate-600">The selected buddy is not marked as playing for this round.</div>
        </div>
      </div>
    );
  }

  const dirtyNow = isDirty();

  const navDisabled = tab !== "entry" || holeFx.stage !== "idle";
  const canPrev = !navDisabled && hole > 1;
  const canNext = !navDisabled && hole < 18;

  return (
    <div className="fixed inset-0 bg-white text-slate-900 overflow-hidden flex flex-col">
      {/* Top bar */}
      <div className="px-4 pt-3 pb-1 flex items-center justify-between">
        <button type="button" className="text-sm font-bold text-slate-900 underline" onClick={handleBack} aria-label="Back">
          Back
        </button>

        <button
          type="button"
          onClick={() => void saveAll()}
          disabled={saving || isLocked}
          className={`px-3 py-2 rounded-md text-sm font-bold text-white ${saving || isLocked ? "bg-slate-500" : "bg-sky-600"}`}
        >
          {saving ? "Saving…" : isLocked ? "Locked" : "Save (Me)"}
        </button>
      </div>

      {/* DEBUG banner (top, always visible) */}
      <div className="px-4 pb-2">
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-center text-[12px] font-black text-red-700">
          {DEBUG_MARK}
        </div>
      </div>

      {tab === "entry" ? <HoleRowEntryOnly /> : <SummaryPlayerToggleTop />}

      {/* Scroll area (flex-1 so it never hides the bottom bar) */}
      <div
        className="px-4 py-3 space-y-3 overflow-y-auto flex-1"
        onTouchStart={tab === "entry" ? onTouchStart : undefined}
        onTouchEnd={tab === "entry" ? onTouchEnd : undefined}
      >
        {tab === "entry" ? (
          <div style={fxStyle} className="space-y-3">
            <div className="grid grid-cols-2 gap-3 items-start">
              <PlayerPanel pid={meId} label={meName} hcp={meHcp} tee={meTee} isBuddy={false} />
              {buddyId ? (
                <PlayerPanel pid={buddyId} label={buddyName} hcp={buddyHcp} tee={buddyTee} isBuddy={true} />
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
                  No buddy selected.
                </div>
              )}
            </div>

            <div className="text-xs text-slate-600 text-center">
              Swipe <span className="font-semibold">left/right</span> to change hole.{" "}
              {dirtyNow ? <span className="text-amber-700 font-semibold">Unsaved (Me)</span> : null}
              {savedMsg ? <span className="text-green-700 font-semibold"> {savedMsg}</span> : null}
              {saveErr ? <span className="text-red-600 font-semibold"> {saveErr}</span> : null}
            </div>

            {errorMsg ? <div className="text-sm text-red-600 text-center">{errorMsg}</div> : null}

            {/* Spacer so content doesn't feel cramped above bottom bar */}
            <div className="h-20" />
          </div>
        ) : (
          <>
            <SummaryTable />
            {errorMsg ? <div className="text-sm text-red-600 text-center">{errorMsg}</div> : null}
            <div className="h-20" />
          </>
        )}
      </div>

      {/* Bottom hole nav (matches swipe behavior by calling handleSwipe) */}
      <div
        className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto w-full max-w-md px-4 py-3">
          {/* DEBUG marker (bottom) */}
          <div className="mb-2 text-center text-[11px] font-black text-red-600">{DEBUG_MARK}</div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void handleSwipe("prev")}
              disabled={!canPrev}
              className={[
                "flex-1 rounded-xl border px-3 py-2 text-sm font-extrabold active:scale-[0.99] disabled:opacity-50",
                "bg-slate-100 text-slate-900 border-slate-300",
              ].join(" ")}
            >
              Prev hole
            </button>

            <button
              type="button"
              onClick={() => void handleSwipe("next")}
              disabled={!canNext}
              className={[
                "flex-1 rounded-xl border px-3 py-2 text-sm font-extrabold active:scale-[0.99] disabled:opacity-50",
                "bg-slate-900 text-white border-slate-900",
              ].join(" ")}
            >
              Next hole
            </button>
          </div>

          {tab !== "entry" ? (
            <div className="mt-1 text-center text-[11px] text-slate-500">Return to entry to change hole.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}