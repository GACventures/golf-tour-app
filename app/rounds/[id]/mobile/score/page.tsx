"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";

import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

/**
 * Supabase relations can come back as:
 * - an object { ... }
 * - an array of objects [{ ... }]
 * - null
 *
 * This helper normalizes to a single object (first item if array).
 */
function asSingle<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

type CourseRel = { name: string };
type PlayerRel = { id: string; name: string };

type RoundRow = {
  id: string;
  name: string;
  course_id: string | null;
  is_locked: boolean | null;
  // relation can be object OR array depending on query shape
  courses?: CourseRel | CourseRel[] | null;
};

type ParRow = { hole_number: number; par: number; stroke_index: number };

// Your scores table shape (adjust if yours differs)
type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup: boolean | null;
  // joined relation (optional)
  players?: PlayerRel | PlayerRel[] | null;
};

type MiniPlayer = {
  id: string;
  name: string;
  playing_handicap?: number; // optional; only used if you have it
};

export default function MobileScoreEntryPage() {
  const params = useParams();
  const sp = useSearchParams();
  const router = useRouter();

  const roundId = (params?.id as string) || "";

  // Expect these from /rounds/[id]/mobile selection step
  const meId = sp.get("me") ?? "";
  const buddyId = sp.get("buddy") ?? "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [savedMsg, setSavedMsg] = useState<string>("");

  const [round, setRound] = useState<RoundRow | null>(null);
  const [pars, setPars] = useState<ParRow[]>([]);
  const [players, setPlayers] = useState<MiniPlayer[]>([]);

  // scores[playerId][holeIndex] -> { strokes, pickup }
  const [scores, setScores] = useState<
    Record<string, Record<number, { strokes: string; pickup: boolean }>>
  >({});

  const holes = useMemo(() => Array.from({ length: 18 }, (_, i) => i + 1), []);
  const selectedIds = useMemo(
    () => [meId, buddyId].filter(Boolean),
    [meId, buddyId]
  );

  const courseName = useMemo(() => {
    const c = asSingle(round?.courses);
    return c?.name ?? "";
  }, [round]);

  const isLocked = !!round?.is_locked;

  useEffect(() => {
    if (!roundId) return;

    // If user hits /mobile/score directly without choosing Me, send them back.
    // (No build impact; just a better UX.)
    if (!meId) {
      router.replace(`/rounds/${roundId}/mobile`);
      return;
    }

    let alive = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");
      setSavedMsg("");

      try {
        // 1) Round + course name
        const { data: roundData, error: roundErr } = await supabase
          .from("rounds")
          .select("id, name, course_id, is_locked, courses ( name )")
          .eq("id", roundId)
          .single();

        if (roundErr) throw roundErr;
        const r = roundData as unknown as RoundRow;

        // 2) Pars (course_holes or course_pars table — adjust if yours differs)
        // Common pattern: course_holes has (course_id, hole_number, par, stroke_index)
        let parRows: ParRow[] = [];
        if (r.course_id) {
          const { data: parData, error: parErr } = await supabase
            .from("course_holes")
            .select("hole_number, par, stroke_index")
            .eq("course_id", r.course_id)
            .order("hole_number", { ascending: true });

          if (parErr) throw parErr;
          parRows = (parData ?? []) as ParRow[];
        }

        // 3) Players in round (adjust if you use a different linking table)
        // Common pattern: round_players (round_id, player_id, playing, players(...))
        const { data: rpData, error: rpErr } = await supabase
          .from("round_players")
          .select("player_id, playing, players ( id, name, playing_handicap )")
          .eq("round_id", roundId);

        if (rpErr) throw rpErr;

        // Keep only the selected players for mobile flow: Me + optional Buddy
        const picked: MiniPlayer[] = [];
        for (const row of rpData ?? []) {
          const p = asSingle((row as any)?.players) as any;
          if (!p?.id) continue;
          if (!selectedIds.includes(p.id)) continue;
          picked.push({
            id: String(p.id),
            name: String(p.name ?? ""),
            playing_handicap:
              typeof p.playing_handicap === "number" ? p.playing_handicap : undefined,
          });
        }

        // 4) Existing scores for round (optionally join players)
        const { data: scoreData, error: scoreErr } = await supabase
          .from("scores")
          .select("round_id, player_id, hole_number, strokes, pickup, players ( id, name )")
          .eq("round_id", roundId);

        if (scoreErr) throw scoreErr;

        // Build score map (and demonstrate robust relation handling)
        const nextScores: Record<
          string,
          Record<number, { strokes: string; pickup: boolean }>
        > = {};

        const rows = (scoreData ?? []) as unknown as ScoreRow[];
        for (const row of rows) {
          // ✅ Robust: players relation can be object OR array; but we actually
          // only need row.player_id for saving. Still normalize to avoid TS traps.
          const playerRel = asSingle(row.players);
          const _pidFromRel = playerRel?.id; // safe now, never errors in TS

          const pid = String(row.player_id);
          const h = Number(row.hole_number);
          if (!pid || !Number.isFinite(h) || h < 1 || h > 18) continue;

          if (!nextScores[pid]) nextScores[pid] = {};
          nextScores[pid][h] = {
            strokes: row.strokes == null ? "" : String(row.strokes),
            pickup: !!row.pickup,
          };
        }

        // Ensure every selected player has entries
        for (const p of picked) {
          if (!nextScores[p.id]) nextScores[p.id] = {};
          for (const h of holes) {
            if (!nextScores[p.id][h]) {
              nextScores[p.id][h] = { strokes: "", pickup: false };
            }
          }
        }

        if (!alive) return;
        setRound(r);
        setPars(parRows);
        setPlayers(picked);
        setScores(nextScores);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load round data.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [roundId, meId, selectedIds, holes, router]);

  const parByHole = useMemo(() => {
    const map: Record<number, ParRow> = {};
    for (const row of pars) map[row.hole_number] = row;
    return map;
  }, [pars]);

  function updateStrokes(playerId: string, hole: number, value: string) {
    setScores((prev) => ({
      ...prev,
      [playerId]: {
        ...(prev[playerId] ?? {}),
        [hole]: {
          ...(prev[playerId]?.[hole] ?? { strokes: "", pickup: false }),
          strokes: value,
        },
      },
    }));
  }

  function togglePickup(playerId: string, hole: number) {
    setScores((prev) => {
      const cur = prev[playerId]?.[hole] ?? { strokes: "", pickup: false };
      return {
        ...prev,
        [playerId]: {
          ...(prev[playerId] ?? {}),
          [hole]: { ...cur, pickup: !cur.pickup },
        },
      };
    });
  }

  async function saveAll() {
    if (!roundId) return;
    if (isLocked) {
      setErrorMsg("This round is locked. Scores cannot be edited.");
      return;
    }

    setSaving(true);
    setErrorMsg("");
    setSavedMsg("");

    try {
      const rowsToUpsert: Array<{
        round_id: string;
        player_id: string;
        hole_number: number;
        strokes: number | null;
        pickup: boolean;
      }> = [];

      for (const p of players) {
        for (const h of holes) {
          const cell = scores[p.id]?.[h] ?? { strokes: "", pickup: false };
          const s = cell.strokes.trim();
          const strokesNum = s === "" ? null : Number(s);
          rowsToUpsert.push({
            round_id: roundId,
            player_id: p.id,
            hole_number: h,
            strokes: Number.isFinite(strokesNum as number) ? (strokesNum as number) : null,
            pickup: !!cell.pickup,
          });
        }
      }

      const { error } = await supabase.from("scores").upsert(rowsToUpsert, {
        onConflict: "round_id,player_id,hole_number",
      });

      if (error) throw error;

      setSavedMsg("Saved ✅");
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to save scores.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-sm opacity-70">Loading…</div>
      </div>
    );
  }

  if (!round) {
    return (
      <div className="p-4 space-y-3">
        <div className="text-lg font-semibold">Mobile scoring</div>
        <div className="text-red-600 text-sm">{errorMsg || "Round not found."}</div>
        <Link className="underline text-sm" href={`/rounds/${roundId}/mobile`}>
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">{round.name}</div>
            <div className="text-xs opacity-70">
              {courseName ? `Course: ${courseName}` : "Course: (not set)"}
              {isLocked ? " • Locked" : ""}
            </div>
          </div>

          <Link
            className="text-sm underline"
            href={`/rounds/${roundId}/mobile?me=${encodeURIComponent(meId)}${
              buddyId ? `&buddy=${encodeURIComponent(buddyId)}` : ""
            }`}
          >
            Change players
          </Link>
        </div>

        {errorMsg ? <div className="text-sm text-red-600">{errorMsg}</div> : null}
        {savedMsg ? <div className="text-sm text-green-700">{savedMsg}</div> : null}
      </header>

      <div className="space-y-6">
        {players.map((p) => (
          <section key={p.id} className="rounded-lg border p-3 space-y-3">
            <div className="font-medium">{p.name}</div>

            <div className="grid grid-cols-2 gap-2">
              {holes.map((h) => {
                const cell = scores[p.id]?.[h] ?? { strokes: "", pickup: false };
                const parRow = parByHole[h];
                const par = parRow?.par ?? 0;
                const si = parRow?.stroke_index ?? 0;

                // Stableford display: if pickup, treat as 0 (or your app’s convention)
                const strokesNum = cell.strokes.trim() === "" ? NaN : Number(cell.strokes);
                const pts =
                  cell.pickup || !Number.isFinite(strokesNum)
                    ? null
                    : netStablefordPointsForHole({
                        strokes: strokesNum,
                        par,
                        strokeIndex: si,
                        // if you have playing handicap allocation per hole, plug it in here;
                        // otherwise your helper may already handle it elsewhere
                        handicapStrokesOnHole: 0,
                      } as any);

                return (
                  <div key={h} className="rounded-md border p-2">
                    <div className="flex items-baseline justify-between">
                      <div className="text-sm font-semibold">Hole {h}</div>
                      <div className="text-xs opacity-70 text-right leading-tight">
                        <div>Par {par || "-"}</div>
                        <div>SI {si || "-"}</div>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center gap-2">
                      <input
                        className="w-20 rounded border px-2 py-1 text-sm"
                        inputMode="numeric"
                        placeholder="Stk"
                        value={cell.strokes}
                        disabled={isLocked}
                        onChange={(e) => updateStrokes(p.id, h, e.target.value)}
                      />

                      <label className="flex items-center gap-2 text-xs select-none">
                        <input
                          type="checkbox"
                          checked={cell.pickup}
                          disabled={isLocked}
                          onChange={() => togglePickup(p.id, h)}
                        />
                        Pickup
                      </label>

                      <div className="ml-auto text-xs opacity-80">
                        {pts == null ? (
                          <span>Pts: –</span>
                        ) : (
                          <span>Pts: {pts}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <div className="sticky bottom-0 bg-white/80 backdrop-blur border-t p-3 -mx-4 flex gap-3">
        <button
          className="flex-1 rounded-md border px-3 py-2 text-sm"
          onClick={() => router.push(`/rounds/${roundId}`)}
        >
          Exit
        </button>

        <button
          className="flex-1 rounded-md bg-black text-white px-3 py-2 text-sm disabled:opacity-50"
          disabled={saving || isLocked}
          onClick={saveAll}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
