"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";
import { recalcAndSaveTourHandicaps } from "@/lib/handicaps/recalcAndSaveTourHandicaps";

type Tee = "M" | "F";

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

const headerBlue = "bg-sky-500";
const headerPink = "bg-pink-400";
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

export default function MobileScoreEntryPage() {
  const params = useParams();
  const sp = useSearchParams();
  const router = useRouter();

  const tourId = String((params as any)?.id ?? "").trim();

  const roundId = (params as any)?.roundId
    ? String((params as any)?.roundId ?? "")
    : String((params as any)?.id ?? "");

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

  // DEBUG banner to prove rehandicapping is called
  const [rehandicapMsg, setRehandicapMsg] = useState<string>("");

  const [hole, setHole] = useState(1);

  const isLocked = round?.is_locked === true;

  // FX state + timeouts
  const [holeFx, setHoleFx] = useState<HoleFxState>({ stage: "idle", dir: null });
  const fxTimerRef = useRef<number | null>(null);

  function clearFxTimer() {
    if (fxTimerRef.current) {
      window.clearTimeout(fxTimerRef.current);
      fxTimerRef.current = null;
    }
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

  // Whole-page slide style
  const fxStyle: React.CSSProperties = useMemo(() => {
    const base = "transform 330ms ease-in-out";
    const off = "105%";

    if (holeFx.stage === "idle") {
      return { transform: "translateX(0)", transition: base, willChange: "transform" };
    }

    if (holeFx.stage === "out") {
      const x = holeFx.dir === "next" ? `-${off}` : off;
      return { transform: `translateX(${x})`, transition: base, willChange: "transform" };
    }

    if (holeFx.stage === "inSnap") {
      const x = holeFx.dir === "next" ? off : `-${off}`;
      return { transform: `translateX(${x})`, transition: "none", willChange: "transform" };
    }

    if (holeFx.stage === "in") {
      return { transform: "translateX(0)", transition: base, willChange: "transform" };
    }

    return { transform: "translateX(0)", transition: base, willChange: "transform" };
  }, [holeFx]);

  // Preferred tee logic:
  // 1) round_players.tee
  // 2) players.gender
  // 3) default M
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
      setRehandicapMsg("");

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

        // Scores for all playing players (buddy can display), but save only me
        let scoreRows: ScoreRow[] = [];
        if (ids.length > 0) {
          const { data: sData, error: sErr } = await supabase
            .from("scores")
            .select("round_id,player_id,hole_number,strokes,pickup")
            .eq("round_id", roundId)
            .in("player_id", ids);
          if (sErr) throw sErr;
          scoreRows = (sData ?? []) as ScoreRow[];
        }

        const nextScores: Record<string, Record<number, string>> = {};
        for (const pid of ids) nextScores[pid] = {};
        for (const row of scoreRows) {
          const pid = String(row.player_id);
          const h = Number(row.hole_number);
          const isPickup = (row as any).pickup === true;
          const raw = isPickup ? "P" : row.strokes === null || row.strokes === undefined ? "" : String(row.strokes);
          nextScores[pid][h] = normalizeRawInput(raw);
        }

        if (!alive) return;

        setRound(r);
        setParsByTee(nextParsByTee);
        setRoundPlayers(rpRows);
        setPlayersById(pMap);
        setScores(nextScores);

        // baseline for unsaved: me only
        initialScoresRef.current = { [meId]: nextScores[meId] ?? {} };
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

  // Derived
  const courseName = useMemo(() => asSingle(round?.courses)?.name ?? "(no course)", [round]);
  const playingIds = useMemo(() => roundPlayers.map((rp) => rp.player_id), [roundPlayers]);

  const meOk = !!meId && playingIds.includes(meId);
  const buddyOk = !buddyId || playingIds.includes(buddyId);

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

  function adjustStrokes(pid: string, holeNumber: number, delta: number) {
    const raw = scores[pid]?.[holeNumber] ?? "";
    if (raw === "P") return;
    const cur = raw ? Number(raw) : 0;
    const next = clamp(cur + delta, 0, 30);
    setRaw(pid, holeNumber, next === 0 ? "" : String(next));
  }

  function togglePickup(pid: string, holeNumber: number) {
    const raw = scores[pid]?.[holeNumber] ?? "";
    setRaw(pid, holeNumber, raw === "P" ? "" : "P");
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

  function sumPoints(pid: string): number {
    let sum = 0;
    for (let h = 1; h <= 18; h++) sum += pointsFor(pid, h);
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

  async function saveAll() {
    setSaveErr("");
    setSavedMsg("");
    setRehandicapMsg("");

    if (!roundId) return;
    if (isLocked) {
      setSaveErr("Round is locked.");
      return;
    }
    if (!meId) {
      setSaveErr("Missing meId. Go back and reselect Me.");
      return;
    }

    const pid = meId; // SAVE ONLY ME

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

      // Trigger rehandicap recalculation for the tour (DEBUG banner on page)
      try {
        const tid = await fetchTourIdForRound(roundId);
        if (tid) {
          setRehandicapMsg("Rehandicapping running…");

          const res = await recalcAndSaveTourHandicaps({
            supabase,
            tourId: tid,
          });

          const ts = new Date().toLocaleTimeString();

          if (!res.ok) {
            setRehandicapMsg(`Rehandicapping FAILED @ ${ts}: ${res.error}`);
            setSaveErr(`Saved, but rehandicap failed: ${res.error}`);
          } else {
            setRehandicapMsg(`Rehandicapping ran ✓ (updated ${res.updated} rows) @ ${ts}`);
            await refreshRoundPlayers();
          }
        } else {
          setRehandicapMsg("Rehandicapping skipped (no tourId for this round).");
        }
      } catch (e: any) {
        const ts = new Date().toLocaleTimeString();
        setRehandicapMsg(`Rehandicapping ERROR @ ${ts}: ${e?.message ?? "unknown"}`);
        setSaveErr(`Saved, but rehandicap error: ${e?.message ?? "unknown"}`);
      }

      initialScoresRef.current = { [meId]: { ...(scores[meId] ?? {}) } };
      setSavedMsg("Saved ✓");
      window.setTimeout(() => setSavedMsg(""), 1200);
    } catch (e: any) {
      setSaveErr(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  // Swipe handling: left = next, right = prev
  const swipeRef = useRef<{ x: number; y: number; t: number } | null>(null);

  function animateHoleChange(dir: "next" | "prev") {
    if (holeFx.stage !== "idle") return;

    const nextHole = clamp(hole + (dir === "next" ? 1 : -1), 1, 18);
    if (nextHole === hole) return;

    clearFxTimer();

    setHoleFx({ stage: "out", dir });

    fxTimerRef.current = window.setTimeout(() => {
      setHole(nextHole);
      setHoleFx({ stage: "inSnap", dir });

      requestAnimationFrame(() => {
        setHoleFx({ stage: "in", dir });

        fxTimerRef.current = window.setTimeout(() => {
          setHoleFx({ stage: "idle", dir: null });
          clearFxTimer();
        }, 330);
      });
    }, 330);
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
    if (dx <= -threshold) animateHoleChange("next");
    if (dx >= threshold) animateHoleChange("prev");
  }

  useEffect(() => {
    return () => clearFxTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = isDirty();

  function goBackToSelect() {
    const href = `/m/tours/${tourId}/rounds/${roundId}/scoring?meId=${encodeURIComponent(meId)}${
      buddyId ? `&buddyId=${encodeURIComponent(buddyId)}` : ""
    }`;
    if (!dirty || confirm("You have unsaved changes for Me. Leave without saving?")) {
      router.push(href);
    }
  }

  function openPlayerSummary(pid: string) {
    if (!pid) return;
    router.push(`/m/tours/${tourId}/rounds/${roundId}/results/${pid}`);
  }

  function HoleBox() {
    return (
      <div className="px-4 pb-2">
        <div className="flex items-center justify-center">
          <div className={`w-[230px] rounded-md border ${borderLight} bg-white text-slate-900 text-center py-2`}>
            <div className="text-xs font-semibold tracking-wide text-slate-600">HOLE</div>
            <div className="text-4xl font-black leading-tight">{hole}</div>
            <div className="text-[11px] text-slate-600">
              <div>
                <span className="font-semibold">M:</span> Par {holeInfoM.par || "—"} · SI {holeInfoM.si || "—"}
              </div>
              <div>
                <span className="font-semibold">F:</span> Par {holeInfoF.par || "—"} · SI {holeInfoF.si || "—"}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function PlayerCard(props: { pid: string; name: string; hcp: number; tee: Tee }) {
    const { pid, name, hcp, tee } = props;

    const raw = scores[pid]?.[hole] ?? "";
    const pickup = raw === "P";

    const pts = pointsFor(pid, hole);

    // ✅ Change #4: show "P" in strokes display (not —)
    const grossDisplay = pickup ? "P" : raw && raw !== "P" ? raw : "0";

    const info = infoFor(pid, hole);
    const totalPts = useMemo(() => sumPoints(pid), [pid, scores, meHcp, buddyHcp, parsByTee]);

    const isFemale = teeForPlayer(pid) === "F";
    const headerClass = isFemale ? headerPink : headerBlue;

    return (
      <div className="rounded-lg overflow-hidden shadow-sm border-2 border-slate-400 bg-white">
        <div className={`${headerClass} px-4 py-2 text-white font-semibold text-base text-center`}>
          {name} <span className="opacity-90">(HC: {hcp} · Tee: {tee})</span>
        </div>

        <div className="bg-white p-3 text-slate-900">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className="w-16 h-16 rounded-lg border border-slate-300 bg-slate-100 text-slate-900 text-5xl font-black leading-none active:scale-[0.98] disabled:opacity-50"
              onClick={() => adjustStrokes(pid, hole, -1)}
              disabled={isLocked || pickup}
              aria-label="Decrease strokes"
            >
              −
            </button>

            <div className="text-center">
              <div className="text-5xl font-black text-slate-900 leading-none">{grossDisplay}</div>
              <div className="text-sm font-semibold text-slate-600 mt-1">strokes</div>
            </div>

            <button
              type="button"
              className="w-16 h-16 rounded-lg border border-slate-300 bg-slate-100 text-slate-900 text-5xl font-black leading-none active:scale-[0.98] disabled:opacity-50"
              onClick={() => adjustStrokes(pid, hole, +1)}
              disabled={isLocked || pickup}
              aria-label="Increase strokes"
            >
              +
            </button>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="text-[11px] font-bold tracking-wide text-slate-600">PAR</div>
              <button
                type="button"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white text-slate-900 text-2xl font-black py-2 active:scale-[0.99] disabled:opacity-50"
                onClick={() => {
                  if (!info?.par) return;
                  setRaw(pid, hole, String(info.par));
                }}
                disabled={isLocked || !info?.par}
                aria-label="Set strokes to par"
              >
                {info.par || "—"}
              </button>
            </div>

            <div>
              <div className="text-[11px] font-bold tracking-wide text-slate-600">SI</div>
              <div className="mt-1 rounded-md border border-slate-300 bg-white text-slate-900 text-2xl font-black py-2">
                {info.si || "—"}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold tracking-wide text-slate-600">POINTS</div>
              <div
                className={`mt-1 rounded-md border border-slate-300 text-2xl font-black py-2 ${
                  pickup ? "bg-slate-100 text-slate-400" : "bg-white text-slate-900"
                }`}
              >
                {pickup ? "0" : String(pts)}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-bold tracking-wide text-slate-600">PICK UP</div>
              <button
                type="button"
                className={`mt-1 w-full rounded-md border border-slate-300 text-2xl font-black py-2 ${
                  pickup ? "bg-slate-900 text-white" : "bg-white text-slate-900"
                }`}
                onClick={() => togglePickup(pid, hole)}
                disabled={isLocked}
              >
                P
              </button>
            </div>
          </div>

          {/* ✅ Change #3: tap Total pts -> go to that player's summary page */}
          <div className="mt-2 flex justify-between text-xs text-slate-600">
            <button type="button" className="underline" onClick={() => setRaw(pid, hole, "")} disabled={isLocked}>
              Clear hole
            </button>

            <button
              type="button"
              onClick={() => openPlayerSummary(pid)}
              className="font-extrabold text-slate-900 underline underline-offset-2"
              aria-label={`Open ${name} summary`}
            >
              Total pts: {totalPts}
            </button>
          </div>
        </div>
      </div>
    );
  }

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

  if (!meOk) {
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

  if (!buddyOk) {
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

  // ✅ Change #1 + #2:
  // Full-screen, no tour/home header, no Entry/Summary tabs. Keep only minimal back + save.
  return (
    <div className="fixed inset-0 bg-white text-slate-900 overflow-hidden">
      {/* Minimal top strip (not tour/home header) */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-slate-200">
        <button
          type="button"
          className="flex items-center gap-2 text-lg font-bold text-slate-900"
          onClick={goBackToSelect}
          aria-label="Back"
        >
          <span className="text-2xl leading-none">‹</span>
          <span>Back</span>
        </button>

        <button
          type="button"
          onClick={saveAll}
          disabled={saving || isLocked}
          className={`px-3 py-2 rounded-md text-sm font-bold text-white ${
            saving || isLocked ? "bg-slate-500" : "bg-sky-600"
          }`}
        >
          {saving ? "Saving…" : isLocked ? "Locked" : "Save (Me)"}
        </button>
      </div>

      {/* Hole box */}
      <HoleBox />

      {/* Main content locked to screen; swipe to change hole */}
      <div
        className="px-4 pb-3 space-y-3"
        style={fxStyle}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <PlayerCard pid={meId} name={meName} hcp={meHcp} tee={meTee} />
        {buddyId ? <PlayerCard pid={buddyId} name={buddyName} hcp={buddyHcp} tee={buddyTee} /> : null}

        <div className="text-xs text-slate-600 text-center">
          Swipe <span className="font-semibold">left/right</span> to change hole.{" "}
          {dirty ? <span className="text-amber-700 font-semibold">Unsaved (Me)</span> : null}
          {savedMsg ? <span className="text-green-700 font-semibold"> {savedMsg}</span> : null}
          {saveErr ? <span className="text-red-600 font-semibold"> {saveErr}</span> : null}
          {rehandicapMsg ? <span className="text-sky-700 font-semibold"> {rehandicapMsg}</span> : null}
        </div>

        <div className="text-[11px] text-slate-500 text-center">
          Note: Buddy scores are for viewing/entry only and are not saved.
        </div>

        {errorMsg ? <div className="text-sm text-red-600 text-center">{errorMsg}</div> : null}
      </div>
    </div>
  );
}
