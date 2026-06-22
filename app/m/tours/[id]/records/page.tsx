"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

type Tee = "M" | "F";

type RoundRow = {
  id: string;
  tour_id: string;
  name: string | null;
  round_no: number | null;
  course_id: string | null;
  played_on: string | null;
};

type CourseRow = {
  id: string;
  name: string | null;
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

function rawScoreFor(strokes: number | null, pickup?: boolean | null): string {
  if (pickup) return "P";
  if (strokes === null || strokes === undefined) return "";
  return String(strokes);
}

function mean(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function stdDev(nums: number[]): number | null {
  if (nums.length < 2) return null;
  const m = mean(nums);
  if (m === null) return null;
  const variance = nums.reduce((acc, x) => acc + (x - m) * (x - m), 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

type RoundStats = {
  roundId: string;
  roundNo: number | null;
  courseName: string;
  highestScore: number;
  highestPlayer: string;
  lowestScore: number;
  lowestPlayer: string;
  averageScore: number;
  playerCount: number;
};

type PlayerRoundScore = {
  playerId: string;
  playerName: string;
  roundId: string;
  score: number;
  holesCompleted: number;
};

export default function TourRecordsPage() {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [coursesById, setCoursesById] = useState<Record<string, string>>({});
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
        // Fetch rounds
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,tour_id,name,round_no,course_id,played_on")
          .eq("tour_id", tourId)
          .order("round_no", { ascending: true, nullsFirst: false })
          .order("played_on", { ascending: true });

        if (rErr) throw rErr;
        const rr = (rData ?? []) as RoundRow[];
        if (!alive) return;
        setRounds(rr);

        // Fetch courses
        const courseIds = Array.from(new Set(rr.map((r) => r.course_id).filter(Boolean))) as string[];
        if (courseIds.length) {
          const { data: cData, error: cErr } = await supabase.from("courses").select("id,name").in("id", courseIds);
          if (cErr) throw cErr;
          if (!alive) return;
          const map: Record<string, string> = {};
          for (const c of (cData ?? []) as CourseRow[]) map[String(c.id)] = safeName(c.name, "(course)");
          setCoursesById(map);
        } else {
          setCoursesById({});
        }

        // Fetch players
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

        // Fetch round_players
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

        // Fetch scores
        if (roundIds.length > 0 && playerIds.length > 0) {
          const allScores: ScoreRow[] = [];

          for (const r of rr) {
            const { data: sData, error: sErr } = await supabase
              .from("scores")
              .select("round_id,player_id,hole_number,strokes,pickup")
              .eq("round_id", r.id)
              .in("player_id", playerIds)
              .order("player_id", { ascending: true })
              .order("hole_number", { ascending: true });

            if (sErr) throw sErr;
            allScores.push(...((sData ?? []) as ScoreRow[]));
          }

          if (!alive) return;
          setScores(allScores);
        } else {
          setScores([]);
        }

        // Fetch pars
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
        setErrorMsg(e?.message ?? "Failed to load tour records.");
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

  // Calculate player scores for each round
  const playerRoundScores = useMemo((): PlayerRoundScore[] => {
    const results: PlayerRoundScore[] = [];

    const parByCourseHoleTee = new Map<string, { par: number; si: number }>();
    for (const p of pars) {
      parByCourseHoleTee.set(`${p.course_id}:${p.hole_number}:${p.tee}`, { par: p.par, si: p.stroke_index });
    }

    const scoresByRoundPlayer = new Map<string, Map<number, ScoreRow>>();
    for (const s of scores) {
      const key = `${s.round_id}:${s.player_id}`;
      if (!scoresByRoundPlayer.has(key)) scoresByRoundPlayer.set(key, new Map());
      scoresByRoundPlayer.get(key)!.set(s.hole_number, s);
    }

    const rpByRoundPlayer = new Map<string, RoundPlayerRow>();
    for (const rp of roundPlayers) {
      rpByRoundPlayer.set(`${rp.round_id}:${rp.player_id}`, rp);
    }

    const playersById = new Map<string, PlayerRow>();
    for (const p of players) playersById.set(p.id, p);

    for (const round of rounds) {
      if (!round.course_id) continue;

      for (const player of players) {
        const rpKey = `${round.id}:${player.id}`;
        const rp = rpByRoundPlayer.get(rpKey);
        if (!rp || !rp.playing) continue;

        const tee = normalizeTee(player.gender);
        const hcp = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0;

        const scoreMap = scoresByRoundPlayer.get(rpKey) ?? new Map();
        let total = 0;
        let holesCompleted = 0;

        for (let hole = 1; hole <= 18; hole++) {
          const sc = scoreMap.get(hole);
          if (!sc) continue;

          const parKey = `${round.course_id}:${hole}:${tee}`;
          const parSI = parByCourseHoleTee.get(parKey);
          if (!parSI) continue;

          const raw = rawScoreFor(sc.strokes, sc.pickup);
          if (!raw) continue;

          holesCompleted++;
          total += netStablefordPointsForHole({
            rawScore: raw,
            par: parSI.par,
            strokeIndex: parSI.si,
            playingHandicap: hcp,
          });
        }

        if (holesCompleted >= 18) {
          results.push({
            playerId: player.id,
            playerName: player.name,
            roundId: round.id,
            score: total,
            holesCompleted,
          });
        }
      }
    }

    return results;
  }, [rounds, players, roundPlayers, scores, pars]);

  // Calculate round statistics
  const roundStats = useMemo((): RoundStats[] => {
    const stats: RoundStats[] = [];

    for (const round of rounds) {
      const roundScores = playerRoundScores.filter((prs) => prs.roundId === round.id);
      if (roundScores.length === 0) continue;

      const scores = roundScores.map((rs) => rs.score);
      const highest = Math.max(...scores);
      const lowest = Math.min(...scores);
      const avg = mean(scores) ?? 0;

      const highestPlayer = roundScores.find((rs) => rs.score === highest)?.playerName ?? "";
      const lowestPlayer = roundScores.find((rs) => rs.score === lowest)?.playerName ?? "";

      stats.push({
        roundId: round.id,
        roundNo: round.round_no,
        courseName: round.course_id ? (coursesById[round.course_id] ?? "(course)") : "(course)",
        highestScore: highest,
        highestPlayer,
        lowestScore: lowest,
        lowestPlayer,
        averageScore: avg,
        playerCount: roundScores.length,
      });
    }

    return stats;
  }, [rounds, playerRoundScores, coursesById]);

  // Daily score records
  const dailyScoreRecords = useMemo(() => {
    if (roundStats.length === 0) {
      return {
        highestMax: null,
        highestMin: null,
        highestAvg: null,
        lowestMax: null,
        lowestMin: null,
        lowestAvg: null,
        averageMax: null,
        averageMin: null,
        averageAvg: null,
      };
    }

    const highs = roundStats.map((rs) => ({ value: rs.highestScore, course: rs.courseName }));
    const lows = roundStats.map((rs) => ({ value: rs.lowestScore, course: rs.courseName }));
    const avgs = roundStats.map((rs) => ({ value: rs.averageScore, course: rs.courseName }));

    const highestMax = highs.reduce((max, h) => (h.value > max.value ? h : max));
    const highestMin = highs.reduce((min, h) => (h.value < min.value ? h : min));
    const highestAvg = mean(highs.map((h) => h.value));

    const lowestMax = lows.reduce((max, l) => (l.value > max.value ? l : max));
    const lowestMin = lows.reduce((min, l) => (l.value < min.value ? l : min));
    const lowestAvg = mean(lows.map((l) => l.value));

    const averageMax = avgs.reduce((max, a) => (a.value > max.value ? a : max));
    const averageMin = avgs.reduce((min, a) => (a.value < min.value ? a : min));
    const averageAvg = mean(avgs.map((a) => a.value));

    return {
      highestMax,
      highestMin,
      highestAvg,
      lowestMax,
      lowestMin,
      lowestAvg,
      averageMax,
      averageMin,
      averageAvg,
    };
  }, [roundStats]);

  // Margin records
  const marginRecords = useMemo(() => {
    let maxFirstSecondGap = { gap: 0, course: "", winner: "", round: "" };
    let maxLastSecondLastGap = { gap: 0, course: "", lastPlace: "", round: "" };

    for (const round of rounds) {
      const roundScores = playerRoundScores.filter((prs) => prs.roundId === round.id);
      if (roundScores.length < 2) continue;

      const sorted = [...roundScores].sort((a, b) => b.score - a.score);

      // First vs second
      const firstSecondGap = sorted[0].score - sorted[1].score;
      if (firstSecondGap > maxFirstSecondGap.gap) {
        maxFirstSecondGap = {
          gap: firstSecondGap,
          course: round.course_id ? (coursesById[round.course_id] ?? "(course)") : "(course)",
          winner: sorted[0].playerName,
          round: `Round ${round.round_no ?? "?"}`,
        };
      }

      // Last vs second last
      if (sorted.length >= 2) {
        const lastSecondLastGap = sorted[sorted.length - 2].score - sorted[sorted.length - 1].score;
        if (lastSecondLastGap > maxLastSecondLastGap.gap) {
          maxLastSecondLastGap = {
            gap: lastSecondLastGap,
            course: round.course_id ? (coursesById[round.course_id] ?? "(course)") : "(course)",
            lastPlace: sorted[sorted.length - 1].playerName,
            round: `Round ${round.round_no ?? "?"}`,
          };
        }
      }
    }

    return { maxFirstSecondGap, maxLastSecondLastGap };
  }, [rounds, playerRoundScores, coursesById]);

  // Player records
  const playerRecords = useMemo(() => {
    const playerScoresByPlayer = new Map<string, number[]>();
    const firstPlaceCount = new Map<string, number>();
    const top3Count = new Map<string, number>();
    const lastPlaceCount = new Map<string, number>();

    for (const player of players) {
      playerScoresByPlayer.set(player.id, []);
      firstPlaceCount.set(player.id, 0);
      top3Count.set(player.id, 0);
      lastPlaceCount.set(player.id, 0);
    }

    // Collect scores and placements
    for (const round of rounds) {
      const roundScores = playerRoundScores.filter((prs) => prs.roundId === round.id);
      if (roundScores.length === 0) continue;

      const sorted = [...roundScores].sort((a, b) => b.score - a.score);

      // Add scores to player arrays
      for (const rs of roundScores) {
        playerScoresByPlayer.get(rs.playerId)?.push(rs.score);
      }

      // Count first place (including ties)
      const firstScore = sorted[0].score;
      for (const rs of sorted) {
        if (rs.score === firstScore) {
          firstPlaceCount.set(rs.playerId, (firstPlaceCount.get(rs.playerId) ?? 0) + 1);
        } else {
          break;
        }
      }

      // Count top 3 (including ties for 3rd)
      if (sorted.length >= 3) {
        const thirdScore = sorted[2].score;
        for (const rs of sorted) {
          if (rs.score >= thirdScore) {
            top3Count.set(rs.playerId, (top3Count.get(rs.playerId) ?? 0) + 1);
          } else {
            break;
          }
        }
      } else {
        // If fewer than 3 players, all are in top 3
        for (const rs of sorted) {
          top3Count.set(rs.playerId, (top3Count.get(rs.playerId) ?? 0) + 1);
        }
      }

      // Count last place
      const lastScore = sorted[sorted.length - 1].score;
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].score === lastScore) {
          lastPlaceCount.set(sorted[i].playerId, (lastPlaceCount.get(sorted[i].playerId) ?? 0) + 1);
        } else {
          break;
        }
      }
    }

    // Calculate averages and std devs
    const playerAvgs = new Map<string, number>();
    const playerStdDevs = new Map<string, number>();

    for (const player of players) {
      const scores = playerScoresByPlayer.get(player.id) ?? [];
      if (scores.length > 0) {
        const avg = mean(scores);
        if (avg !== null) playerAvgs.set(player.id, avg);

        const sd = stdDev(scores);
        if (sd !== null) playerStdDevs.set(player.id, sd);
      }
    }

    // Find records
    let highestAvg = { playerId: "", playerName: "", value: 0 };
    let mostFirst = { playerId: "", playerName: "", count: 0 };
    let mostTop3 = { playerId: "", playerName: "", count: 0 };
    let mostLast = { playerId: "", playerName: "", count: 0 };
    let mostConsistent = { playerId: "", playerName: "", value: Infinity };
    let mostVolatile = { playerId: "", playerName: "", value: 0 };

    for (const player of players) {
      const avg = playerAvgs.get(player.id) ?? 0;
      if (avg > highestAvg.value) {
        highestAvg = { playerId: player.id, playerName: player.name, value: avg };
      }

      const first = firstPlaceCount.get(player.id) ?? 0;
      if (first > mostFirst.count) {
        mostFirst = { playerId: player.id, playerName: player.name, count: first };
      }

      const top3 = top3Count.get(player.id) ?? 0;
      if (top3 > mostTop3.count) {
        mostTop3 = { playerId: player.id, playerName: player.name, count: top3 };
      }

      const last = lastPlaceCount.get(player.id) ?? 0;
      if (last > mostLast.count) {
        mostLast = { playerId: player.id, playerName: player.name, count: last };
      }

      const sd = playerStdDevs.get(player.id);
      if (sd !== undefined && sd < mostConsistent.value) {
        mostConsistent = { playerId: player.id, playerName: player.name, value: sd };
      }

      if (sd !== undefined && sd > mostVolatile.value) {
        mostVolatile = { playerId: player.id, playerName: player.name, value: sd };
      }
    }

    return {
      highestAvg,
      mostFirst,
      mostTop3,
      mostLast,
      mostConsistent: mostConsistent.value !== Infinity ? mostConsistent : null,
      mostVolatile: mostVolatile.value > 0 ? mostVolatile : null,
    };
  }, [players, rounds, playerRoundScores]);

  const hasEnoughData = roundStats.length >= 2;

  if (!tourId || !isLikelyUuid(tourId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900 pb-24">
        <div className="mx-auto max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">Invalid tour ID.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      <div className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold text-gray-900">Tour Records</div>
            <button
              type="button"
              onClick={() => router.push(`/m/tours/${tourId}`)}
              className="rounded-lg px-2 py-1 text-sm font-semibold text-gray-800 hover:bg-gray-100 active:bg-gray-200"
            >
              Back
            </button>
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
        ) : !hasEnoughData ? (
          <div className="rounded-2xl border p-4 text-sm text-gray-700">
            Insufficient data. Tour records require at least 2 completed rounds.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Daily Score Records */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900">Daily Score Records</div>
              <div className="p-4 space-y-4">
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-2">Daily Highest Score</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Maximum:</span>
                      <span className="font-semibold">
                        {dailyScoreRecords.highestMax?.value ?? "—"} points ({dailyScoreRecords.highestMax?.course ?? "—"})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Minimum:</span>
                      <span className="font-semibold">
                        {dailyScoreRecords.highestMin?.value ?? "—"} points ({dailyScoreRecords.highestMin?.course ?? "—"})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Average:</span>
                      <span className="font-semibold">{dailyScoreRecords.highestAvg?.toFixed(1) ?? "—"} points</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-2">Daily Lowest Score</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Maximum:</span>
                      <span className="font-semibold">
                        {dailyScoreRecords.lowestMax?.value ?? "—"} points ({dailyScoreRecords.lowestMax?.course ?? "—"})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Minimum:</span>
                      <span className="font-semibold">
                        {dailyScoreRecords.lowestMin?.value ?? "—"} points ({dailyScoreRecords.lowestMin?.course ?? "—"})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Average:</span>
                      <span className="font-semibold">{dailyScoreRecords.lowestAvg?.toFixed(1) ?? "—"} points</span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-2">Daily Average Score</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Maximum:</span>
                      <span className="font-semibold">
                        {dailyScoreRecords.averageMax?.value.toFixed(1) ?? "—"} points ({dailyScoreRecords.averageMax?.course ?? "—"})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Minimum:</span>
                      <span className="font-semibold">
                        {dailyScoreRecords.averageMin?.value.toFixed(1) ?? "—"} points ({dailyScoreRecords.averageMin?.course ?? "—"})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Average:</span>
                      <span className="font-semibold">{dailyScoreRecords.averageAvg?.toFixed(1) ?? "—"} points</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Margin Records */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900">Margin Records</div>
              <div className="p-4 space-y-4">
                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-2">Margin between First and Second Place</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Highest:</span>
                      <span className="font-semibold">{marginRecords.maxFirstSecondGap.gap} points</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {marginRecords.maxFirstSecondGap.course} · {marginRecords.maxFirstSecondGap.winner} (1st place)
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-gray-600 mb-2">Margin between Last and Second Last</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Highest:</span>
                      <span className="font-semibold">{marginRecords.maxLastSecondLastGap.gap} points</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {marginRecords.maxLastSecondLastGap.course} · {marginRecords.maxLastSecondLastGap.lastPlace} (last place)
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Player Records */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900">Player Records</div>
              <div className="p-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Highest average across all rounds:</span>
                  <span className="font-semibold">
                    {playerRecords.highestAvg.value.toFixed(1)} pts · {playerRecords.highestAvg.playerName}
                  </span>
                </div>

                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Most times first (equal first):</span>
                  <span className="font-semibold">
                    {playerRecords.mostFirst.count} times · {playerRecords.mostFirst.playerName}
                  </span>
                </div>

                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Most times in top 3 (incl. equal 3rd):</span>
                  <span className="font-semibold">
                    {playerRecords.mostTop3.count} times · {playerRecords.mostTop3.playerName}
                  </span>
                </div>

                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Most times in last place:</span>
                  <span className="font-semibold">
                    {playerRecords.mostLast.count} times · {playerRecords.mostLast.playerName}
                  </span>
                </div>

                {playerRecords.mostConsistent ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Most consistent (lowest std dev):</span>
                    <span className="font-semibold">
                      {playerRecords.mostConsistent.value.toFixed(2)} · {playerRecords.mostConsistent.playerName}
                    </span>
                  </div>
                ) : null}

                {playerRecords.mostVolatile ? (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Most volatile (highest std dev):</span>
                    <span className="font-semibold">
                      {playerRecords.mostVolatile.value.toFixed(2)} · {playerRecords.mostVolatile.playerName}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
