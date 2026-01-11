"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RoundRow = {
  id: string;
  tour_id: string;
  name: string | null;
  created_at: string | null;
  round_no: number | null;
  course_id: string | null;
  courses?: { name: string } | null;
};

type RoundGroup = {
  id: string;
  round_id: string;
  group_no: number;
  start_hole: number;
  tee_time: string | null;
  notes: string | null;
};

type RoundGroupPlayer = {
  id: string;
  round_id: string;
  group_id: string;
  player_id: string;
  seat: number | null;
};

type PlayerRow = { id: string; name: string };

function formatDate(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtTime(ts?: string | null) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });
}

export default function MobileRoundTeeTimesPage() {
  const params = useParams<Record<string, string | string[]>>();
  const router = useRouter();

  // Be tolerant of param naming differences
  const tourId = String(params?.id ?? "").trim();

  const roundId = String(
    (params?.roundId as any) ??
      (params?.rid as any) ??
      (params?.round as any) ??
      ""
  ).trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [round, setRound] = useState<RoundRow | null>(null);
  const [groups, setGroups] = useState<RoundGroup[]>([]);
  const [members, setMembers] = useState<RoundGroupPlayer[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);

  function goBack() {
    // Best UX when user came from the hub
    router.back();

    // Fallback for direct visits/bookmarks
    // (push after a microtask so router.back() gets first shot)
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
          .select("id,tour_id,name,created_at,round_no,course_id,courses(name)")
          .eq("id", roundId)
          .eq("tour_id", tourId)
          .single();

        if (rErr) throw rErr;

        const { data: gData, error: gErr } = await supabase
          .from("round_groups")
          .select("id,round_id,group_no,start_hole,tee_time,notes")
          .eq("round_id", roundId)
          .order("group_no", { ascending: true });

        if (gErr) throw gErr;

        const { data: mData, error: mErr } = await supabase
          .from("round_group_players")
          .select("id,round_id,group_id,player_id,seat")
          .eq("round_id", roundId);

        if (mErr) throw mErr;

        const { data: tpData, error: tpErr } = await supabase
          .from("tour_players")
          .select("player_id, players(id,name)")
          .eq("tour_id", tourId)
          .order("name", { ascending: true, foreignTable: "players" });

        if (tpErr) throw tpErr;

        const playerRows: PlayerRow[] = (tpData ?? [])
          .map((r: any) => ({
            id: String(r.players?.id ?? r.player_id),
            name: String(r.players?.name ?? "(missing name)"),
          }))
          .filter((p) => !!p.id);

        if (cancelled) return;

        setRound((rData ?? null) as any);
        setGroups((gData ?? []) as RoundGroup[]);
        setMembers((mData ?? []) as RoundGroupPlayer[]);
        setPlayers(playerRows);
      } catch (e: any) {
        if (cancelled) return;
        setErrorMsg(e?.message ?? "Failed to load tee times.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [tourId, roundId]);

  const playerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.id, p.name);
    return m;
  }, [players]);

  const membersByGroup = useMemo(() => {
    const m = new Map<string, RoundGroupPlayer[]>();
    for (const mem of members) {
      if (!m.has(mem.group_id)) m.set(mem.group_id, []);
      m.get(mem.group_id)!.push(mem);
    }
    for (const [gid, arr] of m.entries()) {
      arr.sort((a, b) => (a.seat ?? 999) - (b.seat ?? 999));
      m.set(gid, arr);
    }
    return m;
  }, [members]);

  const roundTitle = useMemo(() => {
    const courseName = round?.courses?.name ? ` – ${round.courses.name}` : "";
    const noPrefix =
      typeof round?.round_no === "number" && round.round_no > 0
        ? `Round ${round.round_no}`
        : "";
    const name = (round?.name ?? "").trim();
    const main = name ? name : noPrefix ? noPrefix : "Round";
    return `${main}${courseName}`;
  }, [round]);

  const roundDateText = useMemo(() => formatDate(round?.created_at), [round]);

  return (
    <div className="bg-white">
      <main className="mx-auto w-full max-w-md px-4 py-4 pb-24">
        {/* Title row */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xl font-semibold text-gray-900">Tee times</div>
            <div className="mt-1 truncate text-sm text-gray-600">{roundTitle}</div>
            {roundDateText ? (
              <div className="mt-1 text-sm text-gray-500">{roundDateText}</div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={goBack}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-50 active:bg-gray-100"
          >
            Back
          </button>
        </div>

        {errorMsg ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {errorMsg}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-2xl border p-4">
                <div className="h-5 w-32 rounded bg-gray-100" />
                <div className="mt-2 h-4 w-44 rounded bg-gray-100" />
                <div className="mt-3 space-y-2">
                  <div className="h-4 w-56 rounded bg-gray-100" />
                  <div className="h-4 w-52 rounded bg-gray-100" />
                  <div className="h-4 w-48 rounded bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="mt-4 rounded-2xl border p-4 text-sm text-gray-700">
            No tee times set for this round.
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {groups.map((g) => {
              const mem = membersByGroup.get(g.id) ?? [];
              const timeText = fmtTime(g.tee_time);

              return (
                <div
                  key={g.id}
                  className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-gray-900">
                        Group {g.group_no}
                      </div>
                      <div className="mt-1 text-sm text-gray-600">
                        Start: <span className="font-medium">{g.start_hole}</span>
                        {timeText ? (
                          <>
                            {" "}
                            · Time: <span className="font-medium">{timeText}</span>
                          </>
                        ) : null}
                      </div>
                      {g.notes ? (
                        <div className="mt-1 text-xs text-gray-500">{g.notes}</div>
                      ) : null}
                    </div>

                    <div className="text-xs text-gray-500 whitespace-nowrap">
                      Players: {mem.length}
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {mem.length === 0 ? (
                      <div className="text-sm text-gray-600">
                        No players assigned.
                      </div>
                    ) : (
                      mem.map((m, idx) => (
                        <div key={m.id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0 truncate text-sm text-gray-900">
                            <span className="mr-2 text-gray-500">
                              {m.seat ?? idx + 1}.
                            </span>
                            {playerNameById.get(m.player_id) ?? "(unknown player)"}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
