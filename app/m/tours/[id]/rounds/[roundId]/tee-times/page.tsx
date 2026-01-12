"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type TourGroupRow = {
  id: string;
  tour_id: string;
  scope: "tour" | "round";
  round_id: string | null;
  type: "pair" | "team";
  name: string;
  team_index: number | null;
  created_at: string | null;
};

type MemberRow = {
  group_id: string;
  player_id: string;
  position: number | null;
  players?: { name: string | null } | { name: string | null }[] | null;
};

type RoundPlayerRow = {
  player_id: string;
  playing_handicap: number | string | null;
};

type GroupSettingRow = {
  group_id: string;
  tee_time?: string | null; // expected format e.g. "07:30" or "7:30 AM"
  starting_hole?: number | string | null; // 1..18
};

function firstName(p: any): string {
  if (!p) return "Player";
  if (Array.isArray(p)) return (p?.[0]?.name ?? "Player") as string;
  return (p?.name ?? "Player") as string;
}

function toNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function ordinal(n: number) {
  // 1 -> 1st, 2 -> 2nd, 3 -> 3rd, 4 -> 4th ... 11 -> 11th, 12 -> 12th, 13 -> 13th
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

export default function MobileRoundTeeTimesPage() {
  const params = useParams<{ id: string; roundId: string }>();
  const tourId = params?.id ?? "";
  const roundId = params?.roundId ?? "";

  const [groups, setGroups] = useState<TourGroupRow[]>([]);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [hcpByPlayer, setHcpByPlayer] = useState<Record<string, number>>({});
  const [settingsByGroup, setSettingsByGroup] = useState<Record<string, GroupSettingRow>>({});

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");

      // 1) Load round-scope groups for this round
      const { data: gData, error: gErr } = await supabase
        .from("tour_groups")
        .select("id,tour_id,scope,round_id,type,name,team_index,created_at")
        .eq("tour_id", tourId)
        .eq("scope", "round")
        .eq("round_id", roundId)
        .order("team_index", { ascending: true })
        .order("created_at", { ascending: true });

      if (!alive) return;

      if (gErr) {
        setErrorMsg(gErr.message);
        setGroups([]);
        setMembers([]);
        setHcpByPlayer({});
        setSettingsByGroup({});
        setLoading(false);
        return;
      }

      const gs = (gData ?? []) as TourGroupRow[];
      setGroups(gs);

      const groupIds = gs.map((g) => g.id);

      // 2) Load members (with player names)
      if (groupIds.length) {
        const { data: mData, error: mErr } = await supabase
          .from("tour_group_members")
          .select("group_id,player_id,position,players(name)")
          .in("group_id", groupIds)
          .order("position", { ascending: true });

        if (!alive) return;

        if (mErr) {
          setErrorMsg(mErr.message);
          setMembers([]);
        } else {
          setMembers((mData ?? []) as MemberRow[]);
        }
      } else {
        setMembers([]);
      }

      // 3) Load playing handicaps for the round
      const { data: rpData, error: rpErr } = await supabase
        .from("round_players")
        .select("player_id,playing_handicap")
        .eq("round_id", roundId);

      if (!alive) return;

      if (rpErr) {
        // Not fatal; just omit handicaps
        setHcpByPlayer({});
      } else {
        const map: Record<string, number> = {};
        for (const r of (rpData ?? []) as RoundPlayerRow[]) {
          const n = toNum(r.playing_handicap);
          if (n !== null) map[r.player_id] = n;
        }
        setHcpByPlayer(map);
      }

      // 4) Optional: group settings (tee time + starting hole per group)
      // If this table/columns don't exist, ignore silently.
      if (groupIds.length) {
        const { data: sData, error: sErr } = await supabase
          .from("tour_grouping_settings")
          .select("group_id,tee_time,starting_hole")
          .eq("tour_id", tourId)
          .eq("round_id", roundId);

        if (!alive) return;

        if (!sErr) {
          const sMap: Record<string, GroupSettingRow> = {};
          for (const row of (sData ?? []) as GroupSettingRow[]) {
            if (row?.group_id) sMap[row.group_id] = row;
          }
          setSettingsByGroup(sMap);
        } else {
          setSettingsByGroup({});
        }
      } else {
        setSettingsByGroup({});
      }

      setLoading(false);
    }

    if (tourId && roundId) load();
    else {
      setErrorMsg("Missing tourId or roundId in route.");
      setLoading(false);
    }

    return () => {
      alive = false;
    };
  }, [tourId, roundId]);

  const membersByGroup = useMemo(() => {
    const map: Record<string, MemberRow[]> = {};
    for (const m of members) {
      if (!map[m.group_id]) map[m.group_id] = [];
      map[m.group_id].push(m);
    }
    // ensure sorted by position
    for (const gid of Object.keys(map)) {
      map[gid].sort((a, b) => (toNum(a.position) ?? 999) - (toNum(b.position) ?? 999));
    }
    return map;
  }, [members]);

  function groupTitle(g: TourGroupRow, idx: number) {
    const label = `Group ${idx + 1}`;
    const teeTime = settingsByGroup[g.id]?.tee_time?.toString().trim();
    return teeTime ? `${label} — ${teeTime}` : label;
  }

  function startingHoleLabel(g: TourGroupRow) {
    const raw = settingsByGroup[g.id]?.starting_hole;
    const n = toNum(raw);
    if (!n) return null;
    return `Starting Hole: ${ordinal(n)}`;
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      {/* Simple header row */}
      <div className="border-b bg-white">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-base font-semibold">Tee times</div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-4 pt-4 pb-28">
        {loading ? (
          <div className="space-y-3">
            <div className="h-20 rounded-2xl bg-gray-100" />
            <div className="h-20 rounded-2xl bg-gray-100" />
            <div className="h-20 rounded-2xl bg-gray-100" />
          </div>
        ) : errorMsg ? (
          <div className="text-sm text-red-700">{errorMsg}</div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-gray-600">No groups set for this round.</div>
        ) : (
          <div className="space-y-3">
            {groups.map((g, idx) => {
              const m = membersByGroup[g.id] ?? [];
              const startHole = startingHoleLabel(g);

              return (
                <div key={g.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <div className="text-sm font-extrabold text-gray-900">
                      {groupTitle(g, idx)}
                    </div>
                    {startHole ? (
                      <div className="mt-1 text-xs font-semibold text-gray-600">
                        {startHole}
                      </div>
                    ) : null}
                  </div>

                  <div className="px-4 py-3">
                    {m.length === 0 ? (
                      <div className="text-sm text-gray-600">No players in this group.</div>
                    ) : (
                      <div className="space-y-2">
                        {m.map((mm) => {
                          const name = firstName(mm.players);
                          const hcp = hcpByPlayer[mm.player_id];
                          const hcpText =
                            typeof hcp === "number" && Number.isFinite(hcp) ? ` (${hcp})` : "";
                          return (
                            <div
                              key={mm.player_id}
                              className="text-sm font-semibold text-gray-900"
                            >
                              {name}
                              {hcpText}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
