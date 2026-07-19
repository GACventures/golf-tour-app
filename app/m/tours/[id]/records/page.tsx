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

type RoundStats = {
  roundId: string;
  roundNo: number | null;
  courseName: string;
  highestScore: number;
  highestPlayers: string[];
  lowestScore: number;
  lowestPlayers: string[];
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

type DailyRecordEntry = {
  value: number;
  course: string;
  roundLabel: string;
  playerNames?: string[];
};

type MarginRecordEntry = {
  course: string;
  roundLabel: string;
  playerNames: string[];
};

type MarginRecord = {
  gap: number;
  entries: MarginRecordEntry[];
};

type PlayerValueRecord = {
  value: number;
  playerNames: string[];
};

type PlayerCountRecord = {
  count: number;
  playerNames: string[];
};

const EPSILON = 0.000000001;

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function safeName(v: unknown, fallback: string) {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function normalizeTee(v: unknown): Tee {
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

function nearlyEqual(a: number, b: number) {
  return Math.abs(a - b) <= EPSILON;
}

function roundLabel(roundNo: number | null) {
  return `Round ${roundNo ?? "?"}`;
}

function joinNames(names: string[]) {
  return names.length ? names.join(", ") : "—";
}

function uniqueSortedNames(names: string[]) {
  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
}

function maxEntries(entries: DailyRecordEntry[]): DailyRecordEntry[] {
  if (!entries.length) return [];
  const maxValue = Math.max(...entries.map((entry) => entry.value));
  return entries.filter((entry) => nearlyEqual(entry.value, maxValue));
}

function minEntries(entries: DailyRecordEntry[]): DailyRecordEntry[] {
  if (!entries.length) return [];
  const minValue = Math.min(...entries.map((entry) => entry.value));
  return entries.filter((entry) => nearlyEqual(entry.value, minValue));
}

function buildPlayerValueRecord(
  values: Array<{ playerName: string; value: number }>,
  mode: "max" | "min",
): PlayerValueRecord | null {
  if (!values.length) return null;

  const recordValue =
    mode === "max"
      ? Math.max(...values.map((item) => item.value))
      : Math.min(...values.map((item) => item.value));

  return {
    value: recordValue,
    playerNames: uniqueSortedNames(
      values.filter((item) => nearlyEqual(item.value, recordValue)).map((item) => item.playerName),
    ),
  };
}

function buildPlayerCountRecord(
  values: Array<{ playerName: string; count: number }>,
): PlayerCountRecord | null {
  if (!values.length) return null;

  const recordCount = Math.max(...values.map((item) => item.count));

  return {
    count: recordCount,
    playerNames: uniqueSortedNames(
      values.filter((item) => item.count === recordCount).map((item) => item.playerName),
    ),
  };
}

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

        const courseIds = Array.from(new Set(rr.map((r) => r.course_id).filter(Boolean))) as string[];
        if (courseIds.length) {
          const { data: cData, error: cErr } = await supabase.from("courses").select("id,name").in("id", courseIds);
          if (cErr) throw cErr;
          if (!alive) return;

          const map: Record<string, string> = {};
          for (const c of (cData ?? []) as CourseRow[]) {
            map[String(c.id)] = safeName(c.name, "(course)");
          }
          setCoursesById(map);
        } else {
          setCoursesById({});
        }

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

  const playerRoundScores = useMemo((): PlayerRoundScore[] => {
    const results: PlayerRoundScore[] = [];

    const parByCourseHoleTee = new Map<string, { par: number; si: number }>();
    for (const p of pars) {
      parByCourseHoleTee.set(`${p.course_id}:${p.hole_number}:${p.tee}`, {
        par: p.par,
        si: p.stroke_index,
      });
    }

    const scoresByRoundPlayer = new Map<string, Map<number, ScoreRow>>();
    for (const s of scores) {
      const key = `${s.round_id}:${s.player_id}`;
      if (!scoresByRoundPlayer.has(key)) {
        scoresByRoundPlayer.set(key, new Map());
      }
      scoresByRoundPlayer.get(key)!.set(s.hole_number, s);
    }

    const rpByRoundPlayer = new Map<string, RoundPlayerRow>();
    for (const rp of roundPlayers) {
      rpByRoundPlayer.set(`${rp.round_id}:${rp.player_id}`, rp);
    }

    for (const round of rounds) {
      if (!round.course_id) continue;

      for (const player of players) {
        const rpKey = `${round.id}:${player.id}`;
        const rp = rpByRoundPlayer.get(rpKey);
        if (!rp || !rp.playing) continue;

        const tee = normalizeTee(player.gender);
        const hcp = Number.isFinite(Number(rp.playing_handicap)) ? Number(rp.playing_handicap) : 0;

        const scoreMap = scoresByRoundPlayer.get(rpKey) ?? new Map<number, ScoreRow>();
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

  const roundStats = useMemo((): RoundStats[] => {
    const stats: RoundStats[] = [];

    for (const round of rounds) {
      const roundScores = playerRoundScores.filter((prs) => prs.roundId === round.id);
      if (roundScores.length === 0) continue;

      const scoreValues = roundScores.map((rs) => rs.score);
      const highest = Math.max(...scoreValues);
      const lowest = Math.min(...scoreValues);
      const avg = mean(scoreValues) ?? 0;

      stats.push({
        roundId: round.id,
        roundNo: round.round_no,
        courseName: round.course_id ? (coursesById[round.course_id] ?? "(course)") : "(course)",
        highestScore: highest,
        highestPlayers: uniqueSortedNames(
          roundScores.filter((rs) => rs.score === highest).map((rs) => rs.playerName),
        ),
        lowestScore: lowest,
        lowestPlayers: uniqueSortedNames(
          roundScores.filter((rs) => rs.score === lowest).map((rs) => rs.playerName),
        ),
        averageScore: avg,
        playerCount: roundScores.length,
      });
    }

    return stats;
  }, [rounds, playerRoundScores, coursesById]);

  const dailyScoreRecords = useMemo(() => {
    if (roundStats.length === 0) {
      return {
        highestMax: [] as DailyRecordEntry[],
        highestMin: [] as DailyRecordEntry[],
        highestAvg: null as number | null,
        lowestMax: [] as DailyRecordEntry[],
        lowestMin: [] as DailyRecordEntry[],
        lowestAvg: null as number | null,
        averageMax: [] as DailyRecordEntry[],
        averageMin: [] as DailyRecordEntry[],
        averageAvg: null as number | null,
      };
    }

    const highs: DailyRecordEntry[] = roundStats.map((rs) => ({
      value: rs.highestScore,
      course: rs.courseName,
      roundLabel: roundLabel(rs.roundNo),
      playerNames: rs.highestPlayers,
    }));

    const lows: DailyRecordEntry[] = roundStats.map((rs) => ({
      value: rs.lowestScore,
      course: rs.courseName,
      roundLabel: roundLabel(rs.roundNo),
      playerNames: rs.lowestPlayers,
    }));

    const avgs: DailyRecordEntry[] = roundStats.map((rs) => ({
      value: rs.averageScore,
      course: rs.courseName,
      roundLabel: roundLabel(rs.roundNo),
    }));

    return {
      highestMax: maxEntries(highs),
      highestMin: minEntries(highs),
      highestAvg: mean(highs.map((h) => h.value)),
      lowestMax: maxEntries(lows),
      lowestMin: minEntries(lows),
      lowestAvg: mean(lows.map((l) => l.value)),
      averageMax: maxEntries(avgs),
      averageMin: minEntries(avgs),
      averageAvg: mean(avgs.map((a) => a.value)),
    };
  }, [roundStats]);

  const marginRecords = useMemo(() => {
    const firstSecondCandidates: Array<{ gap: number; entry: MarginRecordEntry }> = [];
    const lastSecondLastCandidates: Array<{ gap: number; entry: MarginRecordEntry }> = [];

    for (const round of rounds) {
      const roundScores = playerRoundScores.filter((prs) => prs.roundId === round.id);
      if (roundScores.length < 2) continue;

      const sorted = [...roundScores].sort((a, b) => b.score - a.score);
      const course = round.course_id ? (coursesById[round.course_id] ?? "(course)") : "(course)";
      const label = roundLabel(round.round_no);

      const firstScore = sorted[0].score;
      const firstPlayers = uniqueSortedNames(
        sorted.filter((item) => item.score === firstScore).map((item) => item.playerName),
      );
      const nextLowerScore = sorted.find((item) => item.score < firstScore)?.score ?? firstScore;

      firstSecondCandidates.push({
        gap: firstScore - nextLowerScore,
        entry: {
          course,
          roundLabel: label,
          playerNames: firstPlayers,
        },
      });

      const lastScore = sorted[sorted.length - 1].score;
      const lastPlayers = uniqueSortedNames(
        sorted.filter((item) => item.score === lastScore).map((item) => item.playerName),
      );
      const nextHigherScore =
        [...sorted].reverse().find((item) => item.score > lastScore)?.score ?? lastScore;

      lastSecondLastCandidates.push({
        gap: nextHigherScore - lastScore,
        entry: {
          course,
          roundLabel: label,
          playerNames: lastPlayers,
        },
      });
    }

    function buildMarginRecord(
      candidates: Array<{ gap: number; entry: MarginRecordEntry }>,
    ): MarginRecord {
      if (!candidates.length) {
        return { gap: 0, entries: [] };
      }

      const maxGap = Math.max(...candidates.map((candidate) => candidate.gap));

      return {
        gap: maxGap,
        entries: candidates
          .filter((candidate) => nearlyEqual(candidate.gap, maxGap))
          .map((candidate) => candidate.entry),
      };
    }

    return {
      maxFirstSecondGap: buildMarginRecord(firstSecondCandidates),
      maxLastSecondLastGap: buildMarginRecord(lastSecondLastCandidates),
    };
  }, [rounds, playerRoundScores, coursesById]);

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

    for (const round of rounds) {
      const roundScores = playerRoundScores.filter((prs) => prs.roundId === round.id);
      if (roundScores.length === 0) continue;

      const sorted = [...roundScores].sort((a, b) => b.score - a.score);

      for (const rs of roundScores) {
        playerScoresByPlayer.get(rs.playerId)?.push(rs.score);
      }

      const firstScore = sorted[0].score;
      for (const rs of sorted) {
        if (rs.score === firstScore) {
          firstPlaceCount.set(rs.playerId, (firstPlaceCount.get(rs.playerId) ?? 0) + 1);
        } else {
          break;
        }
      }

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
        for (const rs of sorted) {
          top3Count.set(rs.playerId, (top3Count.get(rs.playerId) ?? 0) + 1);
        }
      }

      const lastScore = sorted[sorted.length - 1].score;
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].score === lastScore) {
          lastPlaceCount.set(sorted[i].playerId, (lastPlaceCount.get(sorted[i].playerId) ?? 0) + 1);
        } else {
          break;
        }
      }
    }

    const eligiblePlayers = players.filter(
      (player) => (playerScoresByPlayer.get(player.id)?.length ?? 0) > 0,
    );

    const playerAverages = eligiblePlayers
      .map((player) => {
        const avg = mean(playerScoresByPlayer.get(player.id) ?? []);
        return avg === null ? null : { playerName: player.name, value: avg };
      })
      .filter((item): item is { playerName: string; value: number } => item !== null);

    const playerStdDevs = eligiblePlayers
      .map((player) => {
        const sd = stdDev(playerScoresByPlayer.get(player.id) ?? []);
        return sd === null ? null : { playerName: player.name, value: sd };
      })
      .filter((item): item is { playerName: string; value: number } => item !== null);

    return {
      highestAvg: buildPlayerValueRecord(playerAverages, "max"),
      mostFirst: buildPlayerCountRecord(
        eligiblePlayers.map((player) => ({
          playerName: player.name,
          count: firstPlaceCount.get(player.id) ?? 0,
        })),
      ),
      mostTop3: buildPlayerCountRecord(
        eligiblePlayers.map((player) => ({
          playerName: player.name,
          count: top3Count.get(player.id) ?? 0,
        })),
      ),
      mostLast: buildPlayerCountRecord(
        eligiblePlayers.map((player) => ({
          playerName: player.name,
          count: lastPlaceCount.get(player.id) ?? 0,
        })),
      ),
      mostConsistent: buildPlayerValueRecord(playerStdDevs, "min"),
      mostVolatile: buildPlayerValueRecord(playerStdDevs, "max"),
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

  const renderDailyEntries = (entries: DailyRecordEntry[], decimals = 0) => {
    if (!entries.length) {
      return <span className="font-semibold">—</span>;
    }

    return (
      <div className="space-y-1 text-right">
        {entries.map((entry, index) => (
          <div key={`${entry.roundLabel}-${entry.course}-${index}`}>
            <div className="font-semibold">
              {entry.value.toFixed(decimals)} points
            </div>
            <div className="text-xs text-gray-500">
              {entry.roundLabel} · {entry.course}
              {entry.playerNames?.length ? ` · ${joinNames(entry.playerNames)}` : ""}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderMarginEntries = (
    record: MarginRecord,
    placeLabel: string,
  ) => {
    if (!record.entries.length) {
      return <div className="text-xs text-gray-500">—</div>;
    }

    return (
      <div className="space-y-1">
        {record.entries.map((entry, index) => (
          <div className="text-xs text-gray-500" key={`${entry.roundLabel}-${entry.course}-${index}`}>
            {entry.roundLabel} · {entry.course} · {joinNames(entry.playerNames)} ({placeLabel})
          </div>
        ))}
      </div>
    );
  };

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
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {errorMsg}
          </div>
        ) : !hasEnoughData ? (
          <div className="rounded-2xl border p-4 text-sm text-gray-700">
            Insufficient data. Tour records require at least 2 completed rounds.
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900">
                Daily Score Records
              </div>

              <div className="space-y-4 p-4">
                <div>
                  <div className="mb-2 text-xs font-semibold text-gray-600">
                    Daily Highest Score
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start justify-between gap-4">
                      <span className="shrink-0 text-gray-600">Maximum:</span>
                      {renderDailyEntries(dailyScoreRecords.highestMax)}
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <span className="shrink-0 text-gray-600">Minimum:</span>
                      {renderDailyEntries(dailyScoreRecords.highestMin)}
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-600">Average:</span>
                      <span className="font-semibold">
                        {dailyScoreRecords.highestAvg?.toFixed(1) ?? "—"} points
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold text-gray-600">
                    Daily Lowest Score
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start justify-between gap-4">
                      <span className="shrink-0 text-gray-600">Maximum:</span>
                      {renderDailyEntries(dailyScoreRecords.lowestMax)}
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <span className="shrink-0 text-gray-600">Minimum:</span>
                      {renderDailyEntries(dailyScoreRecords.lowestMin)}
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-600">Average:</span>
                      <span className="font-semibold">
                        {dailyScoreRecords.lowestAvg?.toFixed(1) ?? "—"} points
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold text-gray-600">
                    Daily Average Score
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex items-start justify-between gap-4">
                      <span className="shrink-0 text-gray-600">Maximum:</span>
                      {renderDailyEntries(dailyScoreRecords.averageMax, 1)}
                    </div>
                    <div className="flex items-start justify-between gap-4">
                      <span className="shrink-0 text-gray-600">Minimum:</span>
                      {renderDailyEntries(dailyScoreRecords.averageMin, 1)}
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-600">Average:</span>
                      <span className="font-semibold">
                        {dailyScoreRecords.averageAvg?.toFixed(1) ?? "—"} points
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900">
                Margin Records
              </div>

              <div className="space-y-4 p-4">
                <div>
                  <div className="mb-2 text-xs font-semibold text-gray-600">
                    Margin between First and Second Place
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Highest:</span>
                      <span className="font-semibold">
                        {marginRecords.maxFirstSecondGap.gap} points
                      </span>
                    </div>
                    {renderMarginEntries(marginRecords.maxFirstSecondGap, "1st place")}
                  </div>
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold text-gray-600">
                    Margin between Last and Second Last
                  </div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Highest:</span>
                      <span className="font-semibold">
                        {marginRecords.maxLastSecondLastGap.gap} points
                      </span>
                    </div>
                    {renderMarginEntries(marginRecords.maxLastSecondLastGap, "last place")}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="border-b bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-900">
                Player Records
              </div>

              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-4 text-sm">
                  <span className="text-gray-600">Highest average across all rounds:</span>
                  <span className="text-right font-semibold">
                    {playerRecords.highestAvg
                      ? `${playerRecords.highestAvg.value.toFixed(1)} pts · ${joinNames(
                          playerRecords.highestAvg.playerNames,
                        )}`
                      : "—"}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-4 text-sm">
                  <span className="text-gray-600">Most times first (equal first):</span>
                  <span className="text-right font-semibold">
                    {playerRecords.mostFirst
                      ? `${playerRecords.mostFirst.count} times · ${joinNames(
                          playerRecords.mostFirst.playerNames,
                        )}`
                      : "—"}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-4 text-sm">
                  <span className="text-gray-600">Most times in top 3 (incl. equal 3rd):</span>
                  <span className="text-right font-semibold">
                    {playerRecords.mostTop3
                      ? `${playerRecords.mostTop3.count} times · ${joinNames(
                          playerRecords.mostTop3.playerNames,
                        )}`
                      : "—"}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-4 text-sm">
                  <span className="text-gray-600">Most times in last place:</span>
                  <span className="text-right font-semibold">
                    {playerRecords.mostLast
                      ? `${playerRecords.mostLast.count} times · ${joinNames(
                          playerRecords.mostLast.playerNames,
                        )}`
                      : "—"}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-4 text-sm">
                  <span className="text-gray-600">Most consistent (lowest std dev):</span>
                  <span className="text-right font-semibold">
                    {playerRecords.mostConsistent
                      ? `${playerRecords.mostConsistent.value.toFixed(2)} · ${joinNames(
                          playerRecords.mostConsistent.playerNames,
                        )}`
                      : "—"}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-4 text-sm">
                  <span className="text-gray-600">Most volatile (highest std dev):</span>
                  <span className="text-right font-semibold">
                    {playerRecords.mostVolatile
                      ? `${playerRecords.mostVolatile.value.toFixed(2)} · ${joinNames(
                          playerRecords.mostVolatile.playerNames,
                        )}`
                      : "—"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}