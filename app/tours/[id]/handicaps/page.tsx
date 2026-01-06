"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

type Tour = { id: string; name: string };
type Round = { id: string; tour_id: string; course_id: string; created_at: string | null };
type Player = { id: string; tour_id: string; name: string } & Record<string, any>;

type ParRow = { course_id: string; hole_number: number; par: number; stroke_index: number };

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
  pickup?: boolean;
};

type RoundHeader = { id: string; label: string; courseId: string };

type ComputedRow = {
  playerId: string;
  playerName: string;
  startingHandicap: number;
  perRoundScore: Record<string, number | null>;
  perRoundPH: Record<string, number>;
};

function roundHalfUp(x: number): number {
  // .5 rounds up (works for negatives too)
  return x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
}

function ceilHalfStart(sh: number): number {
  // MIN = ceil(SH/2)
  return Math.ceil(sh / 2);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function getStartingHandicapFromPlayer(p: Player): number {
  // Adjust this list if your column name differs.
  const candidates = ["starting_handicap", "start_handicap", "handicap", "initial_handicap", "hcp", "ga_handicap"];

  for (const k of candidates) {
    const v = Number((p as any)[k]);
    if (Number.isFinite(v)) return Math.max(0, Math.floor(v));
  }
  return 0;
}

function sumBestN(values: Array<number | null | undefined>, n: number): number {
  const k = Math.max(0, Math.floor(n));
  if (k === 0) return 0;
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  nums.sort((a, b) => b - a);
  return nums.slice(0, k).reduce((s, v) => s + v, 0);
}

function bestNWithOptionalFinal(opts: {
  perRoundById: Record<string, number | null>;
  roundIdsInOrder: string[];
  n: number;
  mustIncludeFinal: boolean;
}): number {
  const n = Math.max(1, Math.floor(opts.n || 1));
  const ids = opts.roundIdsInOrder;
  const finalId = ids.length ? ids[ids.length - 1] : null;
  if (!finalId) return 0;

  const per = opts.perRoundById;

  if (!opts.mustIncludeFinal) {
    return sumBestN(ids.map((id) => per[id]), n);
  }

  const rest = Math.max(0, n - 1);
  const finalVal = per[finalId];
  const others = ids.filter((id) => id !== finalId).map((id) => per[id]);

  if (finalVal === null) {
    // If final not played, take best (N-1) of the others
    return sumBestN(others, rest);
  }

  return finalVal + sumBestN(others, rest);
}

export default function TourHandicapDebugPage() {
  const params = useParams<{ id: string }>();
  const tourId = params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);

  const [excludeIncomplete, setExcludeIncomplete] = useState(true);

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setSaveMsg("");

      const { data: tourData, error: tourErr } = await supabase
        .from("tours")
        .select("id,name")
        .eq("id", tourId)
        .single();

      if (cancelled) return;
      if (tourErr) {
        setError(tourErr.message);
        setLoading(false);
        return;
      }
      setTour(tourData as Tour);

      const { data: roundData, error: roundsErr } = await supabase
        .from("rounds")
        .select("id,tour_id,course_id,created_at")
        .eq("tour_id", tourId)
        .order("created_at", { ascending: true });

      if (cancelled) return;
      if (roundsErr) {
        setError(roundsErr.message);
        setLoading(false);
        return;
      }
      const roundList = (roundData ?? []) as Round[];
      setRounds(roundList);

      const { data: playerData, error: playersErr } = await supabase
        .from("players")
        .select("*")
        .eq("tour_id", tourId)
        .order("name", { ascending: true });

      if (cancelled) return;
      if (playersErr) {
        setError(playersErr.message);
        setLoading(false);
        return;
      }
      setPlayers((playerData ?? []) as Player[]);

      const roundIds = roundList.map((r) => r.id);
      if (roundIds.length === 0) {
        setPars([]);
        setRoundPlayers([]);
        setScores([]);
        setLoading(false);
        return;
      }

      const courseIds = Array.from(new Set(roundList.map((r) => r.course_id)));

      const { data: parsData, error: parsErr } = await supabase
        .from("pars")
        .select("course_id,hole_number,par,stroke_index")
        .in("course_id", courseIds);

      if (cancelled) return;
      if (parsErr) {
        setError(parsErr.message);
        setLoading(false);
        return;
      }
      setPars((parsData ?? []) as ParRow[]);

      // IMPORTANT: load all round_players rows (not only playing=true)
      const { data: rpData, error: rpErr } = await supabase
        .from("round_players")
        .select("round_id,player_id,playing,playing_handicap")
        .in("round_id", roundIds);

      if (cancelled) return;
      if (rpErr) {
        setError(rpErr.message);
        setLoading(false);
        return;
      }
      setRoundPlayers((rpData ?? []) as RoundPlayerRow[]);

      const { data: scoreData, error: scoreErr } = await supabase
        .from("scores")
        .select("round_id,player_id,hole_number,strokes,pickup")
        .in("round_id", roundIds);

      if (cancelled) return;
      if (scoreErr) {
        setError(scoreErr.message);
        setLoading(false);
        return;
      }
      setScores((scoreData ?? []) as ScoreRow[]);

      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [tourId]);

  const computed = useMemo(() => {
    const warnings: string[] = [];

    // course -> hole -> {par, si}
    const courseHole: Record<string, Record<number, { par: number; si: number }>> = {};
    for (const p of pars) {
      if (!courseHole[p.course_id]) courseHole[p.course_id] = {};
      courseHole[p.course_id][p.hole_number] = { par: p.par, si: p.stroke_index };
    }

    // round -> player -> playing?
    const playingMap: Record<string, Record<string, boolean>> = {};
    for (const rp of roundPlayers) {
      if (!playingMap[rp.round_id]) playingMap[rp.round_id] = {};
      playingMap[rp.round_id][rp.player_id] = !!rp.playing;
    }

    // round -> player -> hole -> rawScore
    const scoreMap: Record<string, Record<string, Record<number, string>>> = {};
    for (const s of scores) {
      const isPickup = (s as any).pickup === true;
      const raw = isPickup
        ? "P"
        : s.strokes === null || s.strokes === undefined
        ? ""
        : String(s.strokes).trim().toUpperCase();

      if (!scoreMap[s.round_id]) scoreMap[s.round_id] = {};
      if (!scoreMap[s.round_id][s.player_id]) scoreMap[s.round_id][s.player_id] = {};
      scoreMap[s.round_id][s.player_id][s.hole_number] = raw;
    }

    function isRoundComplete(roundId: string): boolean {
      const playingPlayers = players.filter((pl) => playingMap[roundId]?.[pl.id] === true);
      if (playingPlayers.length === 0) return false;

      for (const pl of playingPlayers) {
        for (let hole = 1; hole <= 18; hole++) {
          const raw = scoreMap[roundId]?.[pl.id]?.[hole] ?? "";
          if (!raw) return false;
        }
      }
      return true;
    }

    const eligibleRounds = excludeIncomplete ? rounds.filter((r) => isRoundComplete(r.id)) : rounds;

    const roundHeaders: RoundHeader[] = eligibleRounds.map((r, idx) => ({
      id: r.id,
      label: `R${idx + 1}`,
      courseId: r.course_id,
    }));

    const anyHasStarting = players.some((p) => Number.isFinite(getStartingHandicapFromPlayer(p)));
    if (!anyHasStarting) {
      warnings.push(
        "Could not find a starting handicap column on players (tried: starting_handicap, handicap, initial_handicap, hcp...). Defaulting to 0."
      );
    }

    const perPlayer: ComputedRow[] = players.map((pl) => {
      const sh = getStartingHandicapFromPlayer(pl);
      return {
        playerId: pl.id,
        playerName: pl.name,
        startingHandicap: sh,
        perRoundScore: {},
        perRoundPH: {},
      };
    });

    const roundAvgRoundedById: Record<string, number | null> = {};

    // Init Round 1 PH = SH
    if (roundHeaders[0]) {
      const r1 = roundHeaders[0].id;
      for (const row of perPlayer) row.perRoundPH[r1] = row.startingHandicap;
    }

    const stablefordTotal = (roundId: string, courseId: string, playerId: string, ph: number): number => {
      let total = 0;
      const holeInfo = courseHole[courseId];
      if (!holeInfo) return 0;

      for (let hole = 1; hole <= 18; hole++) {
        const info = holeInfo[hole];
        if (!info) continue;

        const raw = scoreMap[roundId]?.[playerId]?.[hole] ?? "";
        total += netStablefordPointsForHole({
          rawScore: raw,
          par: info.par,
          strokeIndex: info.si,
          playingHandicap: ph,
        });
      }
      return total;
    };

    // Iteratively compute PH + scores
    for (let rIndex = 0; rIndex < roundHeaders.length; rIndex++) {
      const rh = roundHeaders[rIndex];
      const next = roundHeaders[rIndex + 1] ?? null;

      // ensure PH exists for this round
      for (const row of perPlayer) {
        if (row.perRoundPH[rh.id] === undefined) {
          if (rIndex === 0) row.perRoundPH[rh.id] = row.startingHandicap;
          else {
            const prevId = roundHeaders[rIndex - 1].id;
            row.perRoundPH[rh.id] = row.perRoundPH[prevId] ?? row.startingHandicap;
          }
        }
      }

      // compute scores for played players only
      const playedScores: number[] = [];
      for (const row of perPlayer) {
        const played = playingMap[rh.id]?.[row.playerId] === true;
        if (!played) {
          row.perRoundScore[rh.id] = null;
          continue;
        }
        const ph = row.perRoundPH[rh.id];
        const sc = stablefordTotal(rh.id, rh.courseId, row.playerId, ph);
        row.perRoundScore[rh.id] = sc;
        playedScores.push(sc);
      }

      // avg rounded over players who played
      if (playedScores.length === 0) roundAvgRoundedById[rh.id] = null;
      else {
        const avg = playedScores.reduce((s, v) => s + v, 0) / playedScores.length;
        roundAvgRoundedById[rh.id] = roundHalfUp(avg);
      }

      // compute next PH
      if (next) {
        const avgRounded = roundAvgRoundedById[rh.id];
        for (const row of perPlayer) {
          const prevPH = row.perRoundPH[rh.id];
          const playedPrev = playingMap[rh.id]?.[row.playerId] === true;

          if (!playedPrev || avgRounded === null) {
            row.perRoundPH[next.id] = prevPH;
            continue;
          }

          const prevScore = row.perRoundScore[rh.id];
          if (prevScore === null) {
            row.perRoundPH[next.id] = prevPH;
            continue;
          }

          const diff = (avgRounded - prevScore) / 3;
          const raw = roundHalfUp(prevPH + diff);

          const sh = row.startingHandicap;
          const max = sh + 3;
          const min = ceilHalfStart(sh);

          row.perRoundPH[next.id] = clamp(raw, min, max);
        }
      }
    }

    return {
      roundHeaders,
      computedRows: perPlayer,
      roundAvgRoundedById,
      warnings,
    };
  }, [rounds, players, pars, roundPlayers, scores, excludeIncomplete]);

  async function savePlayingHandicapsToDb() {
    setSaveMsg("");
    setSaving(true);

    try {
      const roundIds = computed.roundHeaders.map((r) => r.id);
      if (roundIds.length === 0) {
        setSaveMsg("No rounds to save.");
        setSaving(false);
        return;
      }

      // Build a quick lookup: playerId -> (roundId -> PH)
      const phByPlayerRound: Record<string, Record<string, number>> = {};
      for (const row of computed.computedRows) {
        phByPlayerRound[row.playerId] = row.perRoundPH;
      }

      // We will UPSERT only rows that already exist in round_players,
      // preserving the current `playing` flag, and writing `playing_handicap`.
      const payload = roundPlayers
        .filter((rp) => roundIds.includes(rp.round_id))
        .map((rp) => {
          const ph = phByPlayerRound[rp.player_id]?.[rp.round_id];
          return {
            round_id: rp.round_id,
            player_id: rp.player_id,
            playing: rp.playing, // preserve
            playing_handicap: Number.isFinite(ph) ? ph : rp.playing_handicap ?? 0,
          };
        });

      if (payload.length === 0) {
        setSaveMsg("No round_players rows found to update. (Do you have round_players rows created for the rounds?)");
        setSaving(false);
        return;
      }

      // NOTE: requires a unique constraint or PK on (round_id, player_id)
      const { error: upErr } = await supabase.from("round_players").upsert(payload, {
        onConflict: "round_id,player_id",
      });

      if (upErr) {
        setSaveMsg(`Save failed: ${upErr.message}`);
        setSaving(false);
        return;
      }

      setSaveMsg(`Saved ✓ Updated ${payload.length} round_players rows.`);
      setSaving(false);

      // Reload round_players so displayed DB values match
      const { data: rpData, error: rpErr } = await supabase
        .from("round_players")
        .select("round_id,player_id,playing,playing_handicap")
        .in("round_id", roundIds);

      if (!rpErr) setRoundPlayers((rpData ?? []) as RoundPlayerRow[]);
    } catch (e: any) {
      setSaveMsg(`Save failed: ${String(e?.message ?? e)}`);
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 16 }}>Loading handicap validation…</div>;

  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: "crimson", fontWeight: 800 }}>Error</div>
        <div style={{ marginTop: 8 }}>{error}</div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <Link href={`/tours/${tourId}/leaderboard`}>← Back to leaderboard</Link>
        <span style={{ color: "#bbb" }}>•</span>
        <Link href={`/tours/${tourId}/groups`}>Manage pairs/teams</Link>
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 800 }}>Handicap Validation</h1>
      
      <div style={{ marginTop: 6, color: "#555" }}>{tour?.name ?? ""}</div>

      <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontSize: 14 }}>
          <input
            type="checkbox"
            checked={excludeIncomplete}
            onChange={(e) => setExcludeIncomplete(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Exclude incomplete rounds
        </label>

        <button
          type="button"
          onClick={savePlayingHandicapsToDb}
          disabled={saving}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: saving ? "#f7f7f7" : "white",
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save playing handicaps to DB"}
        </button>

        {saveMsg && (
          <div style={{ fontSize: 12, color: saveMsg.startsWith("Save failed") ? "crimson" : "#2e7d32" }}>
            {saveMsg}
          </div>
        )}
      </div>

      {computed.warnings.length > 0 && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: "1px solid #f0c36d", background: "#fff8e6" }}>
          <div style={{ fontWeight: 800, marginBottom: 6 }}>Notes</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {computed.warnings.map((w, i) => (
              <li key={i} style={{ fontSize: 13, color: "#5a4b00" }}>
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {computed.roundHeaders.length === 0 ? (
        <div style={{ marginTop: 14, color: "#666" }}>No eligible rounds to show.</div>
      ) : (
        <div style={{ marginTop: 14, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 980, width: "100%" }}>
            <thead>
              <tr>
                <th style={thLeftSticky}>Player</th>
                <th style={thRight}>Start Hcp</th>
                {computed.roundHeaders.map((rh) => (
                  <th key={rh.id} style={thCenterGroup} colSpan={2}>
                    {rh.label}
                  </th>
                ))}
              </tr>
              <tr>
                <th style={thLeftSticky}></th>
                <th style={thRight}></th>
                {computed.roundHeaders.map((rh) => (
                  <React.Fragment key={rh.id}>
                    <th style={thRightSmall}>Score</th>
                    <th style={thRightSmall}>PH</th>
                  </React.Fragment>
                ))}
              </tr>
              <tr>
                <th style={thLeftSticky}>Avg (rounded)</th>
                <th style={thRight}>—</th>
                {computed.roundHeaders.map((rh) => (
                  <React.Fragment key={rh.id}>
                    <th style={tdRightSmall}>{computed.roundAvgRoundedById[rh.id] ?? "—"}</th>
                    <th style={tdRightSmall}>—</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>

            <tbody>
              {computed.computedRows.map((row) => (
                <tr key={row.playerId}>
                  <td style={tdLeftSticky}>
                    <div style={{ fontWeight: 700 }}>{row.playerName}</div>
                    <div style={{ fontSize: 12, color: "#666" }}>
                      Min {ceilHalfStart(row.startingHandicap)} / Max {row.startingHandicap + 3}
                    </div>
                  </td>
                  <td style={tdRight}>{row.startingHandicap}</td>

                  {computed.roundHeaders.map((rh) => {
                    const sc = row.perRoundScore[rh.id];
                    const ph = row.perRoundPH[rh.id];
                    return (
                      <React.Fragment key={rh.id}>
                        <td style={tdRightSmall}>{sc === null ? "—" : sc}</td>
                        <td style={tdRightSmall}>{Number.isFinite(ph) ? ph : "—"}</td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
            “Score” = Stableford points computed using the “PH” shown. “—” means the player didn’t play that round (round_players.playing).
          </div>
        </div>
      )}
    </div>
  );
}

const thLeftSticky: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #ddd",
  position: "sticky",
  left: 0,
  background: "white",
  zIndex: 2,
  minWidth: 220,
};

const thRight: React.CSSProperties = {
  textAlign: "right",
  padding: "10px 8px",
  borderBottom: "1px solid #ddd",
  whiteSpace: "nowrap",
};

const thCenterGroup: React.CSSProperties = {
  textAlign: "center",
  padding: "10px 8px",
  borderBottom: "1px solid #ddd",
  whiteSpace: "nowrap",
};

const thRightSmall: React.CSSProperties = {
  textAlign: "right",
  padding: "8px 8px",
  borderBottom: "1px solid #ddd",
  whiteSpace: "nowrap",
  fontSize: 12,
};

const tdLeftSticky: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #eee",
  position: "sticky",
  left: 0,
  background: "white",
  zIndex: 1,
};

const tdRight: React.CSSProperties = {
  textAlign: "right",
  padding: "10px 8px",
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
};

const tdRightSmall: React.CSSProperties = {
  textAlign: "right",
  padding: "10px 8px",
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
  fontSize: 13,
};
