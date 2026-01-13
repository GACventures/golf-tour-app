"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RoundRow = {
  id: string;
  created_at: string | null;
  courses?: { name: string } | { name: string }[] | null;
};

type RoundGroupRow = {
  id: string;
  group_no: number;
  tee_time: string | null;
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

function courseName(r: RoundRow | null) {
  const c: any = r?.courses;
  if (!c) return "";
  if (Array.isArray(c)) return c?.[0]?.name ?? "";
  return c?.name ?? "";
}

function parseDate(s: string | null) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDate(d: Date | null) {
  if (!d) return "";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function ordinal(n: number) {
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 13) return `${n}th`;
  const m10 = n % 10;
  if (m10 === 1) return `${n}st`;
  if (m10 === 2) return `${n}nd`;
  if (m10 === 3) return `${n}rd`;
  return `${n}th`;
}

function fmtTime(t: string | null) {
  if (!t) return "";
  // Supabase returns HH:MM:SS → trim seconds
  return t.length >= 5 ? t.slice(0, 5) : t;
}

function playerName(p: any) {
  if (!p) return "Player";
  if (Array.isArray(p)) return p?.[0]?.name ?? "Player";
  return p?.name ?? "Player";
}

export default function MobileRoundTeeTimesPage() {
  const params = useParams<{ id: string; roundId: string }>();
  const tourId = params.id;
  const roundId = params.roundId;

  const [round, setRound] = useState<RoundRow | null>(null);
  const [roundIndex, setRoundIndex] = useState<number | null>(null);

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

      /** 1) Load all rounds (to compute Round X) */
      const { data: allRounds } = await supabase
        .from("rounds")
        .select("id")
        .eq("tour_id", tourId)
        .order("created_at", { ascending: true });

      if (!alive) return;

      const idx =
        (allRounds ?? []).findIndex((r: any) => r.id === roundId) + 1;
      setRoundIndex(idx > 0 ? idx : null);

      /** 2) Load this round (course + date) */
      const { data: rData, error: rErr } = await supabase
        .from("rounds")
        .select("id,created_at,courses(name)")
        .eq("id", roundId)
        .single();

      if (!alive) return;
      if (rErr) {
        setErrorMsg(rErr.message);
        setLoading(false);
        return;
      }
      setRound(rData as RoundRow);

      /** 3) Load tee-time groups */
      const { data: gData, error: gErr } = await supabase
        .from("round_groups")
        .select("id,group_no,tee_time,start_hole")
        .eq("round_id", roundId)
        .order("group_no", { ascending: true });

      if (!alive) return;
      if (gErr) {
        setErrorMsg(gErr.message);
        setLoading(false);
        return;
      }
      setGroups((gData ?? []) as RoundGroupRow[]);

      const groupIds = (gData ?? []).map((g: any) => g.id);

      /** 4) Group players */
      if (groupIds.length) {
        const { data: mData } = await supabase
          .from("round_group_players")
          .select("group_id,player_id,players(name)")
          .in("group_id", groupIds);

        if (!alive) return;
        setMembers((mData ?? []) as GroupPlayerRow[]);
      }

      /** 5) Playing handicaps */
      const { data: rpData } = await supabase
        .from("round_players")
        .select("player_id,playing_handicap")
        .eq("round_id", roundId);

      if (!alive) return;

      const map: Record<string, number> = {};
      for (const r of (rpData ?? []) as RoundPlayerRow[]) {
        const n = Number(r.playing_handicap);
        if (Number.isFinite(n)) map[r.player_id] = n;
      }
      setHcpByPlayer(map);

      setLoading(false);
    }

    load();
    return () => {
      alive = false;
    };
  }, [tourId, roundId]);

  const membersByGroup = useMemo(() => {
    const map: Record<string, GroupPlayerRow[]> = {};
    for (const m of members) {
      if (!map[m.group_id]) map[m.group_id] = [];
      map[m.group_id].push(m);
    }
    return map;
  }, [members]);

  const roundDate = fmtDate(parseDate(round?.created_at ?? null));
  const course = courseName(round);

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      {/* Header */}
      <div className="border-b bg-white">
        <div className="mx-auto max-w-md px-4 py-3">
          <div className="text-base font-semibold">Tee times</div>
        </div>
      </div>

      {/* Round summary */}
      <div className="border-b bg-gray-50">
        <div className="mx-auto max-w-md px-4 py-3 text-sm font-semibold text-gray-800">
          {roundIndex ? `Round ${roundIndex}` : "Round"} · {roundDate} · {course}
        </div>
      </div>

      <div className="mx-auto max-w-md px-4 pt-4 pb-28">
        {loading ? (
          <div className="space-y-3">
            <div className="h-24 rounded-xl bg-gray-100" />
            <div className="h-24 rounded-xl bg-gray-100" />
          </div>
        ) : errorMsg ? (
          <div className="text-sm text-red-700">{errorMsg}</div>
        ) : groups.length === 0 ? (
          <div className="text-sm text-gray-600">No tee times set.</div>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => {
              const title = `Group ${g.group_no}${
                g.tee_time ? ` — ${fmtTime(g.tee_time)}` : ""
              }`;
              const startHole = g.start_hole
                ? `Starting Hole: ${ordinal(g.start_hole)}`
                : "";

              return (
                <div
                  key={g.id}
                  className="rounded-2xl border border-gray-200 bg-white shadow-sm"
                >
                  <div className="px-4 py-3 border-b border-gray-100">
                    <div className="text-sm font-extrabold">{title}</div>
                    {startHole && (
                      <div className="mt-1 text-xs font-semibold text-gray-600">
                        {startHole}
                      </div>
                    )}
                  </div>

                  <div className="px-4 py-3 space-y-2">
                    {(membersByGroup[g.id] ?? []).map((m) => {
                      const hcp = hcpByPlayer[m.player_id];
                      return (
                        <div
                          key={m.player_id}
                          className="text-sm font-semibold"
                        >
                          {playerName(m.players)}
                          {Number.isFinite(hcp) ? ` (${hcp})` : ""}
                        </div>
                      );
                    })}
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
