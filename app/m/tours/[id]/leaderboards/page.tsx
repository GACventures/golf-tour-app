// app/m/tours/[id]/leaderboards/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

type Tee = "M" | "F";
type TabKey = "individual" | "pairs" | "teams";

type Tour = { id: string; name: string };

type RoundRow = {
  id: string;
  tour_id: string;
  round_no: number | null;
  course_id: string | null;
};

type PlayerRow = {
  id: string;
  tour_id: string;
  name: string;
  gender: "M" | "F" | null;
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
  pickup: boolean | null;
};

type ParRow = {
  course_id: string;
  hole_number: number;
  tee: Tee;
  par: number;
  stroke_index: number;
};

// Matches your schema (text columns; name NOT NULL)
type TourGroupRow = {
  id: string;
  tour_id: string;
  scope: string; // "tour" | "round"
  round_id: string | null;
  type: string; // "pair" | "team"
  name: string; // NOT NULL
  team_index: number | null;
};

type TourGroupMemberRow = {
  group_id: string;
  player_id: string;
  position: number | null;
  created_at: string;
};

type TourGroupingSettingsRow = {
  tour_id: string;
  default_pairing_mode: string;
  default_team_mode: string;
  default_team_count: number | null;
  lock_generated: boolean;
  updated_at: string;
  default_team_best_m: number | null; // <-- your "Y" candidate
};

type GroupResolved = {
  id: string;
  name: string;
  playerIds: string[];
  team_index: number | null;
};

type LeaderRow = {
  id: string; // playerId OR groupId
  name: string;
  tourTotal: number;
  byRound: Record<string, number>; // roundId -> points
};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export default function MobileLeaderboardsPage() {
  const params = useParams();
  const tourId = (params?.id as string) || "";

  const [tab, setTab] = useState<TabKey>("individual");

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);

  // Step 1: groups + settings
  const [pairGroups, setPairGroups] = useState<GroupResolved[]>([]);
  const [teamGroups, setTeamGroups] = useState<GroupResolved[]>([]);
  const [groupingSettings, setGroupingSettings] = useState<TourGroupingSettingsRow | null>(null);

  useEffect(() => {
    if (!tourId) return;
    void loadEverything();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  async function loadEverything() {
    setLoading(true);
    setErrorMsg("");

    try {
      // Tour
      const { data: tourData, error: tourErr } = await supabase
        .from("tours")
        .select("id,name")
        .eq("id", tourId)
        .single();

      if (tourErr) throw new Error(tourErr.message);
      setTour(tourData as Tour);

      // Rounds
      const { data: roundsData, error: roundsErr } = await supabase
        .from("rounds")
        .select("id,tour_id,round_no,course_id")
        .eq("tour_id", tourId)
        .order("round_no", { ascending: true });

      if (roundsErr) throw new Error(roundsErr.message);
      const roundsRows = (roundsData ?? []) as RoundRow[];
      setRounds(roundsRows);

      // Players
      const { data: playersData, error: playersErr } = await supabase
        .from("players")
        .select("id,tour_id,name,gender")
        .eq("tour_id", tourId)
        .order("name", { ascending: true });

      if (playersErr) throw new Error(playersErr.message);
      const playerRows = (playersData ?? []) as PlayerRow[];
      setPlayers(playerRows);

      const roundIds = roundsRows.map((r) => r.id);

      // Round players
      const { data: rpData, error: rpErr } = await supabase
        .from("round_players")
        .select("round_id,player_id,playing,playing_handicap")
        .in("round_id", roundIds);

      if (rpErr) throw new Error(rpErr.message);
      setRoundPlayers((rpData ?? []) as RoundPlayerRow[]);

      // Scores
      const { data: scoreData, error: scoreErr } = await supabase
        .from("scores")
        .select("round_id,player_id,hole_number,strokes,pickup")
        .in("round_id", roundIds);

      if (scoreErr) throw new Error(scoreErr.message);
      setScores((scoreData ?? []) as ScoreRow[]);

      // Pars
      const courseIds = Array.from(
        new Set(roundsRows.map((r) => r.course_id).filter(Boolean))
      ) as string[];

      if (courseIds.length > 0) {
        const { data: parData, error: parErr } = await supabase
          .from("pars")
          .select("course_id,hole_number,tee,par,stroke_index")
          .in("course_id", courseIds);

        if (parErr) throw new Error(parErr.message);
        setPars((parData ?? []) as ParRow[]);
      } else {
        setPars([]);
      }

      // Step 1: groups + settings
      await loadGroupsAndSettings();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function loadGroupsAndSettings() {
    // tour_groups (tour scope only)
    const { data: groupsData, error: groupsErr } = await supabase
      .from("tour_groups")
      .select("id,tour_id,scope,round_id,type,name,team_index")
      .eq("tour_id", tourId)
      .eq("scope", "tour");

    if (groupsErr) throw new Error(groupsErr.message);
    const groups = (groupsData ?? []) as TourGroupRow[];
    const groupIds = groups.map((g) => g.id);

    // tour_group_members
    let members: TourGroupMemberRow[] = [];
    if (groupIds.length > 0) {
      const { data: membersData, error: membersErr } = await supabase
        .from("tour_group_members")
        .select("group_id,player_id,position,created_at")
        .in("group_id", groupIds);

      if (membersErr) throw new Error(membersErr.message);
      members = (membersData ?? []) as TourGroupMemberRow[];
    }

    // tour_grouping_settings
    const { data: settingsData, error: settingsErr } = await supabase
      .from("tour_grouping_settings")
      .select(
        "tour_id,default_pairing_mode,default_team_mode,default_team_count,lock_generated,updated_at,default_team_best_m"
      )
      .eq("tour_id", tourId)
      .maybeSingle();

    if (settingsErr) throw new Error(settingsErr.message);
    setGroupingSettings((settingsData ?? null) as TourGroupingSettingsRow | null);

    // Resolve members per group (ordered by position if present)
    const membersByGroupId = new Map<string, TourGroupMemberRow[]>();
    for (const m of members) {
      const arr = membersByGroupId.get(m.group_id) ?? [];
      arr.push(m);
      membersByGroupId.set(m.group_id, arr);
    }
    for (const [gid, arr] of membersByGroupId.entries()) {
      arr.sort((a, b) => (a.position ?? 999) - (b.position ?? 999));
      membersByGroupId.set(gid, arr);
    }

    const resolvedPairs: GroupResolved[] = [];
    const resolvedTeams: GroupResolved[] = [];

    for (const g of groups) {
      const mem = membersByGroupId.get(g.id) ?? [];
      const ids = mem.map((x) => x.player_id);

      const resolved: GroupResolved = {
        id: g.id,
        name: g.name, // NOT NULL per schema
        playerIds: ids,
        team_index: g.team_index ?? null,
      };

      if (g.type === "pair") resolvedPairs.push(resolved);
      if (g.type === "team") resolvedTeams.push(resolved);
    }

    resolvedPairs.sort((a, b) => a.name.localeCompare(b.name));
    resolvedTeams.sort(
      (a, b) =>
        (a.team_index ?? 999) - (b.team_index ?? 999) ||
        a.name.localeCompare(b.name)
    );

    setPairGroups(resolvedPairs);
    setTeamGroups(resolvedTeams);
  }

  const roundsSorted = useMemo(() => {
    const copy = [...rounds];
    copy.sort((a, b) => (a.round_no ?? 0) - (b.round_no ?? 0));
    return copy;
  }, [rounds]);

  const finalRoundNo = useMemo(() => {
    let maxNo = 0;
    for (const r of roundsSorted) maxNo = Math.max(maxNo, r.round_no ?? 0);
    return maxNo;
  }, [roundsSorted]);

  function roundLabel(r: RoundRow) {
    const n = r.round_no ?? 0;
    if (n === finalRoundNo && n > 0) return `R${n} (F)`;
    return `R${n}`;
  }

  // Index pars: courseId + tee + hole -> { par, si }
  const parIndex = useMemo(() => {
    const m = new Map<string, { par: number; si: number }>();
    for (const p of pars) {
      const key = `${p.course_id}|${p.tee}|${p.hole_number}`;
      m.set(key, { par: p.par, si: p.stroke_index });
    }
    return m;
  }, [pars]);

  // Round player index
  const rpIndex = useMemo(() => {
    const m = new Map<string, RoundPlayerRow>();
    for (const rp of roundPlayers) {
      m.set(`${rp.round_id}|${rp.player_id}`, rp);
    }
    return m;
  }, [roundPlayers]);

  // Score index
  const scoreIndex = useMemo(() => {
    const m = new Map<string, ScoreRow>();
    for (const s of scores) {
      m.set(`${s.round_id}|${s.player_id}|${s.hole_number}`, s);
    }
    return m;
  }, [scores]);

  const leaderRows: LeaderRow[] = useMemo(() => {
    const byRoundIds = roundsSorted.map((r) => r.id);

    if (tab === "individual") {
      const rows: LeaderRow[] = [];

      for (const p of players) {
        const byRound: Record<string, number> = {};
        let tourTotal = 0;

        for (const r of roundsSorted) {
          const rp = rpIndex.get(`${r.id}|${p.id}`);
          const isPlaying = !!rp?.playing;
          const hcap = rp?.playing_handicap ?? 0;

          let roundPts = 0;

          if (isPlaying) {
            for (let hole = 1; hole <= 18; hole++) {
              const s = scoreIndex.get(`${r.id}|${p.id}|${hole}`);
              const strokes = s?.strokes ?? null;
              const pickup = !!s?.pickup;

              const tee: Tee = p.gender === "F" ? "F" : "M";
              const parSi = parIndex.get(`${r.course_id ?? ""}|${tee}|${hole}`);
              if (!parSi) continue; // missing pars => 0

              const pts = netStablefordPointsForHole({
                strokes,
                pickup,
                par: parSi.par,
                strokeIndex: parSi.si,
                playingHandicap: hcap,
              });

              roundPts += Number.isFinite(pts) ? pts : 0;
            }
          }

          byRound[r.id] = roundPts;
          tourTotal += roundPts;
        }

        rows.push({ id: p.id, name: p.name, tourTotal, byRound });
      }

      rows.sort((a, b) => b.tourTotal - a.tourTotal || a.name.localeCompare(b.name));
      return rows;
    }

    // Step 1 only: pairs/teams list with 0 scores
    const groups = tab === "pairs" ? pairGroups : teamGroups;

    const rows: LeaderRow[] = groups.map((g) => {
      const byRound: Record<string, number> = {};
      for (const rid of byRoundIds) byRound[rid] = 0;
      return { id: g.id, name: g.name, tourTotal: 0, byRound };
    });

    return rows;
  }, [tab, players, roundsSorted, rpIndex, scoreIndex, parIndex, pairGroups, teamGroups]);

  return (
    <div className="p-4 space-y-3">
      <div className="space-y-1">
        <div className="text-sm opacity-70">Leaderboards</div>
        <div className="text-xl font-semibold">{tour?.name ?? "Tour"}</div>
      </div>

      {/* Segmented control */}
      <div className="flex gap-2">
        <button
          className={cx(
            "px-3 py-2 rounded-xl border text-sm",
            tab === "individual" ? "border-black font-semibold" : "opacity-70"
          )}
          onClick={() => setTab("individual")}
        >
          Individual
        </button>
        <button
          className={cx(
            "px-3 py-2 rounded-xl border text-sm",
            tab === "pairs" ? "border-black font-semibold" : "opacity-70"
          )}
          onClick={() => setTab("pairs")}
        >
          Pairs
        </button>
        <button
          className={cx(
            "px-3 py-2 rounded-xl border text-sm",
            tab === "teams" ? "border-black font-semibold" : "opacity-70"
          )}
          onClick={() => setTab("teams")}
        >
          Teams
        </button>
      </div>

      {errorMsg ? (
        <div className="p-3 rounded-xl border border-red-300 bg-red-50 text-red-800 text-sm">
          {errorMsg}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm opacity-70">Loading…</div>
      ) : (
        <>
          {tab === "teams" ? (
            <div className="text-xs opacity-70">
              Team best Y per hole (tour-level):{" "}
              <span className="font-semibold">
                {groupingSettings?.default_team_best_m ?? "not set"}
              </span>
              {" "}
              (from tour_grouping_settings.default_team_best_m)
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="min-w-[680px] w-full border-collapse">
              <thead>
                <tr className="text-left text-xs opacity-70">
                  <th className="py-2 pr-3 w-[240px]">Name</th>
                  <th className="py-2 pr-3 w-[80px]">TOUR</th>
                  {roundsSorted.map((r) => (
                    <th key={r.id} className="py-2 pr-3 w-[70px]">
                      {roundLabel(r)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leaderRows.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="py-2 pr-3 text-sm font-medium">{row.name}</td>
                    <td className="py-2 pr-3 text-sm font-semibold">{row.tourTotal}</td>
                    {roundsSorted.map((r) => (
                      <td key={r.id} className="py-2 pr-3 text-sm">
                        {row.byRound[r.id] ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
                {leaderRows.length === 0 ? (
                  <tr>
                    <td className="py-4 text-sm opacity-70" colSpan={2 + roundsSorted.length}>
                      No rows to show.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          {tab === "pairs" ? (
            <div className="text-xs opacity-70">
              Step 1: tour-level pairs loaded and displayed (scores are 0 until Step 2).
            </div>
          ) : null}

          {tab === "teams" ? (
            <div className="text-xs opacity-70">
              Step 1: tour-level teams loaded and displayed (scores are 0 until Step 3).
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
