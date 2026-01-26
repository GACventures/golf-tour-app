"use client";

import { useEffect, useMemo, useState } from "react";
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
  courses?: { name: string } | null;
  played_on: string | null; // ✅ correct date column
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

type MobilePlayer = {
  id: string;
  name: string;
  gender?: string | null;
  startHandicap: number;
};

type ParRow = {
  course_id: string;
  hole_number: number;
  tee?: Tee | null; // modern schema
  par?: number | null;
  stroke_index?: number | null;

  // legacy optional schema (keep as fallback)
  par_m?: number | null;
  stroke_index_m?: number | null;
  par_f?: number | null;
  stroke_index_f?: number | null;
};

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

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" || s === "FEMALE" || s === "W" ? "F" : "M";
}

function rawScoreFor(strokes: number | null, pickup?: boolean | null) {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  const n = Number(strokes);
  return Number.isFinite(n) ? String(n) : "";
}

function holesSavedCount(scores: ScoreRow[]) {
  let n = 0;
  for (const s of scores) {
    if (s.pickup) n++;
    else if (Number.isFinite(Number(s.strokes))) n++;
  }
  return n;
}

function thruLabel(n: number) {
  return n >= 18 ? "F" : String(n);
}

/**
 * Support either schema:
 * - tee-aware rows: tee, par, stroke_index (preferred)
 * - legacy combined rows: par_m/par_f + stroke_index_m/stroke_index_f
 * - legacy simple: par + stroke_index
 */
function pickParSi(row: ParRow | null | undefined, tee: Tee) {
  if (!row) return { par: 0, si: 0 };

  const hasMF =
    row &&
    (row.par_m !== undefined ||
      row.par_f !== undefined ||
      row.stroke_index_m !== undefined ||
      row.stroke_index_f !== undefined);

  if (hasMF) {
    const par = Number(tee === "F" ? row.par_f ?? row.par_m : row.par_m ?? row.par_f);
    const si = Number(tee === "F" ? row.stroke_index_f ?? row.stroke_index_m : row.stroke_index_m ?? row.stroke_index_f);
    return { par: Number.isFinite(par) ? par : 0, si: Number.isFinite(si) ? si : 0 };
  }

  const par = Number(row.par);
  const si = Number(row.stroke_index);
  return { par: Number.isFinite(par) ? par : 0, si: Number.isFinite(si) ? si : 0 };
}

async function loadPlayersForTour(tourId: string): Promise<MobilePlayer[]> {
  // 1) Preferred: tour_players join players
  const { data: tpData, error: tpErr } = await supabase
    .from("tour_players")
    .select("player_id,starting_handicap,players(id,name,gender)")
    .eq("tour_id", tourId);

  if (!tpErr && (tpData ?? []).length > 0) {
    return (tpData ?? [])
      .map((r: any) => ({
        id: String(r.players?.id ?? r.player_id),
        name: String(r.players?.name ?? "(missing name)"),
        gender: (r.players as any)?.gender ?? null,
        startHandicap: Number.isFinite(Number(r.starting_handicap)) ? Number(r.starting_handicap) : 0,
      }))
      .filter((p: any) => !!p.id);
  }

  // 2) Fallback: legacy model players.tour_id
  const { data: pData, error: pErr } = await supabase
    .from("players")
    .select("*")
    .eq("tour_id", tourId)
    .order("name", { ascending: true });

  if (pErr) throw pErr;

  return (pData ?? [])
    .map((p: any) => ({
      id: String(p.id),
      name: String(p.name ?? "(missing name)"),
      gender: (p.gender as any) ?? null,
      startHandicap: Number.isFinite(Number(p.start_handicap))
        ? Number(p.start_handicap)
        : Number.isFinite(Number(p.starting_handicap))
        ? Number(p.starting_handicap)
        : Number.isFinite(Number(p.playing_handicap))
        ? Number(p.playing_handicap)
        : 0,
    }))
    .filter((x: any) => !!x.id);
}

function isMissingColumnError(msg: string, col: string) {
  const m = String(msg ?? "").toLowerCase();
  const c = col.toLowerCase();
  return m.includes("does not exist") && (m.includes(`"${c}"`) || m.includes(`.${c}`) || m.includes(` ${c} `));
}

async function loadParsForCourse(courseId: string) {
  // ✅ Preferred: tee-aware rows (M/F)
  const attempt1 = await supabase
    .from("pars")
    .select("course_id,hole_number,tee,par,stroke_index")
    .eq("course_id", courseId)
    .in("tee", ["M", "F"])
    .order("hole_number", { ascending: true });

  if (!attempt1.error) return (attempt1.data ?? []) as ParRow[];

  // ✅ Fallback: legacy combined schema
  if (isMissingColumnError(attempt1.error.message, "tee")) {
    const attempt2 = await supabase
      .from("pars")
      .select("course_id,hole_number,par,stroke_index,par_m,stroke_index_m,par_f,stroke_index_f")
      .eq("course_id", courseId)
      .order("hole_number", { ascending: true });

    if (attempt2.error) throw attempt2.error;
    return (attempt2.data ?? []) as ParRow[];
  }

  throw attempt1.error;
}

export default function MobileRoundResultsPage() {
  const params = useParams<{ id?: string; roundId?: string }>();
  const router = useRouter();

  const tourId = String(params?.id ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [round, setRound] = useState<RoundRow | null>(null);
  const [players, setPlayers] = useState<MobilePlayer[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);

  function goBack() {
    router.back();
    queueMicrotask(() => {
      if (tourId && roundId) router.push(`/m/tours/${tourId}/rounds/${roundId}`);
      else if (tourId) router.push(`/m/tours/${tourId}/rounds`);
      else router.push(`/m`);
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!tourId || !roundId) return;

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

        const [pls, rpRes, scRes, ps] = await Promise.all([
          loadPlayersForTour(tourId),
          supabase.from("round_players").select("round_id,player_id,playing,playing_handicap").eq("round_id", roundId),
          supabase.from("scores").select("round_id,player_id,hole_number,strokes,pickup").eq("round_id", roundId),
          courseId ? loadParsForCourse(courseId) : Promise.resolve([] as ParRow[]),
        ]);

        if (rpRes.error) throw rpRes.error;
        if (scRes.error) throw scRes.error;

        if (cancelled) return;

        setRound(rData as any);
        setPlayers(pls);
        setRoundPlayers((rpRes.data ?? []) as any);
        setScores((scRes.data ?? []) as any);
        setPars(ps);
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.message ?? "Failed to load results.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [tourId, roundId]);

  const rpByPlayer = useMemo(() => {
    const m = new Map<string, RoundPlayerRow>();
    for (const rp of roundPlayers) m.set(String(rp.player_id), rp);
    return m;
  }, [roundPlayers]);

  // ✅ Tee-aware pars:
  // - If tee rows exist: Map<Tee, Map<hole, row>>
  // - Else: Map<hole, legacyRow>
  const parsModel = useMemo(() => {
    const hasTee = pars.some((p) => {
      const t = String((p as any)?.tee ?? "").toUpperCase();
      return t === "M" || t === "F";
    });

    const byTeeHole = new Map<Tee, Map<number, ParRow>>();
    const byHoleLegacy = new Map<number, ParRow>();

    if (hasTee) {
      byTeeHole.set("M", new Map());
      byTeeHole.set("F", new Map());

      for (const p of pars) {
        const hole = Number((p as any).hole_number);
        if (!Number.isFinite(hole)) continue;
        const tee: Tee = String((p as any).tee ?? "").toUpperCase() === "F" ? "F" : "M";
        byTeeHole.get(tee)!.set(hole, p);
      }
    } else {
      for (const p of pars) {
        const hole = Number((p as any).hole_number);
        if (!Number.isFinite(hole)) continue;
        byHoleLegacy.set(hole, p);
      }
    }

    return { hasTee, byTeeHole, byHoleLegacy };
  }, [pars]);

  // Scores indexed for O(1) hole lookup per player
  const scoresByPlayerHole = useMemo(() => {
    const m = new Map<string, Map<number, ScoreRow>>();
    for (const s of scores) {
      const pid = String(s.player_id);
      const hole = Number(s.hole_number);
      if (!Number.isFinite(hole)) continue;
      if (!m.has(pid)) m.set(pid, new Map());
      m.get(pid)!.set(hole, s);
    }
    return m;
  }, [scores]);

  const rows = useMemo(() => {
    const playingIds = new Set<string>();
    for (const rp of roundPlayers) if (rp.playing === true) playingIds.add(String(rp.player_id));

    const list = players
      .filter((p) => playingIds.size === 0 || playingIds.has(p.id))
      .map((p) => {
        const rp = rpByPlayer.get(p.id);
        const hcp = Number.isFinite(Number(rp?.playing_handicap)) ? Number(rp?.playing_handicap) : p.startHandicap;

        const tee: Tee = normalizeTee(p.gender);
        const byHole = scoresByPlayerHole.get(p.id) ?? new Map<number, ScoreRow>();

        // thru = saved holes count
        let saved = 0;
        for (let hole = 1; hole <= 18; hole++) {
          const sc = byHole.get(hole);
          if (!sc) continue;
          if (sc.pickup) saved++;
          else if (Number.isFinite(Number(sc.strokes))) saved++;
        }

        let total = 0;

        for (let hole = 1; hole <= 18; hole++) {
          const sc = byHole.get(hole);
          if (!sc) continue;

          // pick correct par/si for this player's tee
          let pr: ParRow | null = null;

          if (parsModel.hasTee) {
            pr = parsModel.byTeeHole.get(tee)?.get(hole) ?? null;
            // if missing, fallback to other tee rather than silently 0
            if (!pr) pr = parsModel.byTeeHole.get(tee === "M" ? "F" : "M")?.get(hole) ?? null;
          } else {
            pr = parsModel.byHoleLegacy.get(hole) ?? null;
          }

          const { par, si } = pickParSi(pr, tee);
          if (!par || !si) continue;

          const raw = rawScoreFor(sc.strokes, sc.pickup);
          if (!raw) continue;

          total += netStablefordPointsForHole({
            rawScore: raw,
            par,
            strokeIndex: si,
            playingHandicap: hcp,
          });
        }

        return { playerId: p.id, name: p.name, hcp, saved, total };
      });

    list.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    return list.map((x, idx) => ({ ...x, rank: idx + 1 }));
  }, [players, roundPlayers, rpByPlayer, scoresByPlayerHole, parsModel]);

  const headerTitle = useMemo(() => {
    const courseName = round?.courses?.name ? ` – ${round.courses.name}` : "";
    const roundNo = typeof round?.round_no === "number" && round.round_no ? `Round ${round.round_no}` : "Round";
    const name = (round?.name ?? "").trim();
    return `${name || roundNo}${courseName}`;
  }, [round]);

  const dateText = useMemo(() => formatDate(round?.played_on ?? null), [round?.played_on]);

  return (
    <div className="bg-white text-slate-900 min-h-dvh">
      <main className="mx-auto w-full max-w-md px-4 py-4 pb-24">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-semibold">Results</div>
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
          <div className="mt-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="h-5 w-52 rounded bg-slate-100" />
                <div className="mt-3 h-10 rounded bg-slate-100" />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4">
            <div className="px-2 text-xs font-semibold text-slate-600">
              <div className="grid grid-cols-[64px_1fr_64px_64px] items-center gap-2">
                <div>Rank</div>
                <div>Name</div>
                <div className="text-center">Thru</div>
                <div className="text-center">Total</div>
              </div>
            </div>

            <div className="mt-2 space-y-2">
              {rows.map((r) => (
                <div key={r.playerId} className="rounded-xl border border-slate-300 bg-white text-slate-900 shadow-sm">
                  <div className="grid grid-cols-[64px_1fr_64px_64px] items-center gap-2 px-3 py-3">
                    <div className="text-center text-lg font-extrabold">{r.rank}</div>

                    <Link href={`/m/tours/${tourId}/rounds/${roundId}/results/${r.playerId}`} className="min-w-0">
                      <div className="truncate text-base font-semibold">
                        {r.name} <span className="font-extrabold">[{r.hcp}]</span>
                      </div>
                    </Link>

                    <div className="text-center text-base font-bold">{thruLabel(r.saved)}</div>
                    <div className="text-center text-base font-extrabold">{r.total}</div>
                  </div>
                </div>
              ))}
            </div>

            {rows.length === 0 ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                No players found for this round.
              </div>
            ) : null}
          </div>
        )}
      </main>
    </div>
  );
}
