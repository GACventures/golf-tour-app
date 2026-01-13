"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RoundGroupRow = {
  id: string;
  round_id: string;
  group_no: number | null;
  tee_time: string | null; // returned as string by Supabase for time
  start_hole: number | null;
};

type GroupPlayerRow = {
  group_id: string;
  player_id: string;
  players?: { name: string | null } | { name: string | null }[] | null;
};

type RoundPlayerRow = {
  player_id: string;
  playing_handicap: number | string | null;
};

function playerName(p: any): string {
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
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function fmtTeeTime(t: string | null) {
  if (!t) return "";
  // Supabase time often comes back as "HH:MM:SS" — trim seconds.
  const s = t.trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s.slice(0, 5);
  return s;
}

export default function MobileRoundTeeTimesPage() {
  const params = useParams<{ id: string; roundId: string }>();
  const roundId = params?.roundId ?? "";

  const [groups, setGroups] = useState<RoundGroupRow[]>([]);
  const [members, setMembers] = useState<GroupPlayerRow[]>([]);
  const [hcpByPlayer, setHcpByPlayer] = useState<Record<string, number>>({});

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");

      // 1) Load tee-time groups for this round
      const { data: gData, error: gErr } = await supabase
        .from("round_groups")
        .select("id,round_id,group_no,tee_time,start_hole")
        .eq("round_id", roundId)
        .order("group_no", { ascending: true });

      if (!alive) return;

      if (gErr) {
        setErrorMsg(gErr.message);
        setGroups([]);
        setMembers([]);
        setHcpByPlayer({});
        setLoading(false);
        return;
      }

      const gs = (gData ?? []) as RoundGroupRow[];
      setGroups(gs);

      const groupIds = gs.map((g) => g.id);

      // 2) Load group membership + player names
      if (groupIds.length) {
        const { data: mData, error: mErr } = await supabase
          .from("round_group_players")
          .select("group_id,player_id,players(name)")
          .in("group_id", groupIds);

        if (!alive) return;

        if (mErr) {
          setErrorMsg(mErr.message);
          setMembers([]);
        } else {
          setMembers((mData ?? []) as GroupPlayerRow[]);
        }
      } else {
        setMembers([]);
      }

      // 3) Load playing handicaps for this round
      const { data: rpData, error: rpErr } = await supabase
        .from("round_players")
        .select("player_id,playing_handicap")
        .eq("round_id", roundId);

      if (!alive) return;

      if (rpErr) {
        setHcpByPlayer({});
      } else {
        const map: Record<string, number> = {};
        for (const r of (rpData ?? []) as RoundPlayerRow[]) {
          const n = toNum(r.playing_handicap);
          if (n !== null) map[r.player_id] = n;
        }
        setHcpByPlayer(map);
      }

      setLoading(false);
    }

    if (roundId) load();
    else {
      setErrorMsg("Missing roundId in route.");
      setLoading(false);
    }

    return () => {
      alive = false;
    };
  }, [roundId]);

  const membersByGroup = useMemo(() => {
    const map: Record<string, GroupPlayerRow[]> = {};
    for (const m of members) {
      if (!map[m.group_id]) map[m.group_id] = [];
      map[m.group_id].push(m);
    }
    // keep stable order (DB order not guaranteed). If you have a position column, we can sort properly.
    for (const gid of Object.keys(map)) {
      map[gid].sort((a, b) => playerName(a.players).localeCompare(playerName(b.players)));
    }
    return map;
  }, [members]);

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      {/* Header row */}
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
          <div className="text-sm text-gray-600">No tee times set for this round.</div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const groupNo = g.group_no ?? 0;
              const tee = fmtTeeTime(g.tee_time);
              const startHole = g.start_hole ? `Starting Hole: ${ordinal(g.start_hole)}` : "";
              const title = tee ? `Group ${groupNo} — ${tee}` : `Group ${groupNo}`;

              const m = membersByGroup[g.id] ?? [];

              return (
                <div key={g.id} className="rounded-2xl border border-gray-200 bg-white shadow-sm">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <div className="text-sm font-extrabold text-gray-900">{title}</div>
                    {startHole ? (
                      <div className="mt-1 text-xs font-semibold text-gray-600">{startHole}</div>
                    ) : null}
                  </div>

                  <div className="px-4 py-3">
                    {m.length === 0 ? (
                      <div className="text-sm text-gray-600">No players in this group.</div>
                    ) : (
                      <div className="space-y-2">
                        {m.map((mm) => {
                          const name = playerName(mm.players);
                          const hcp = hcpByPlayer[mm.player_id];
                          const hcpText =
                            typeof hcp === "number" && Number.isFinite(hcp) ? ` (${hcp})` : "";
                          return (
                            <div key={mm.player_id} className="text-sm font-semibold text-gray-900">
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
