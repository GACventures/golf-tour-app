"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";

type CourseRel = { name: string };

type Round = {
  id: string;
  name: string;
  course_id: string | null;
  is_locked: boolean | null;
  played_on: string | null;
  round_no: number | null;
  courses?: CourseRel | CourseRel[] | null;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number | null;
};

type PlayerRow = { id: string; name: string };

type RoundGroupPlayerRow = {
  round_id: string;
  group_id: string;
  player_id: string;
  seat: number | null;
};

function asSingle<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export default function MobileRoundScoringSelectPage() {
  const params = useParams<{ id?: string; roundId?: string }>();
  const router = useRouter();

  const tourId = String(params?.id ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [round, setRound] = useState<Round | null>(null);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [playersById, setPlayersById] = useState<Record<string, PlayerRow>>({});

  // group memberships for this round (optional)
  const [groupPlayers, setGroupPlayers] = useState<RoundGroupPlayerRow[]>([]);

  const [meId, setMeId] = useState("");
  const [buddyId, setBuddyId] = useState("");

  // Tracks if the user explicitly chose a buddy (so we don't overwrite their choice)
  const buddyManuallySetRef = useRef(false);

  useEffect(() => {
    if (!tourId || !roundId) return;

    let alive = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");

      try {
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,name,course_id,is_locked,played_on,round_no,courses(name)")
          .eq("id", roundId)
          .eq("tour_id", tourId)
          .single();
        if (rErr) throw rErr;

        const { data: rpData, error: rpErr } = await supabase
          .from("round_players")
          .select("round_id,player_id,playing,playing_handicap")
          .eq("round_id", roundId)
          .eq("playing", true);
        if (rpErr) throw rpErr;

        const rpRows: RoundPlayerRow[] = (rpData ?? []).map((x: any) => ({
          round_id: String(x.round_id),
          player_id: String(x.player_id),
          playing: x.playing === true,
          playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
        }));

        const ids = Array.from(new Set(rpRows.map((r) => r.player_id))).filter(Boolean);

        const map: Record<string, PlayerRow> = {};
        if (ids.length > 0) {
          const { data: pData, error: pErr } = await supabase.from("players").select("id,name").in("id", ids);
          if (pErr) throw pErr;

          for (const p of pData ?? []) {
            const id = String((p as any).id);
            map[id] = { id, name: String((p as any).name) };
          }
        }

        // group memberships for this round (if groups exist)
        let gpRows: RoundGroupPlayerRow[] = [];
        if (ids.length > 0) {
          const { data: gpData, error: gpErr } = await supabase
            .from("round_group_players")
            .select("round_id,group_id,player_id,seat")
            .eq("round_id", roundId)
            .in("player_id", ids);

          // soft-fail
          if (gpErr) {
            const msg = gpErr.message ?? "";
            if (!msg.toLowerCase().includes("does not exist")) {
              console.warn("round_group_players load error:", gpErr);
            }
            gpRows = [];
          } else {
            gpRows = (gpData ?? []) as RoundGroupPlayerRow[];
          }
        }

        if (!alive) return;

        setRound(rData as unknown as Round);
        setRoundPlayers(rpRows);
        setPlayersById(map);
        setGroupPlayers(gpRows);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load scoring selection.");
        setRound(null);
        setRoundPlayers([]);
        setPlayersById({});
        setGroupPlayers([]);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [tourId, roundId]);

  const courseName = useMemo(() => {
    const c = asSingle(round?.courses);
    return c?.name ?? "(no course)";
  }, [round]);

  const isLocked = round?.is_locked === true;

  const roundLabel = useMemo(() => {
    const n = round?.round_no;
    if (Number.isFinite(Number(n)) && Number(n) > 0) return `Round ${Number(n)}`;
    // fallback if round_no is null
    return round?.name?.trim() ? round.name.trim() : "Round";
  }, [round]);

  const playingPlayers = useMemo(() => {
    const list = roundPlayers
      .filter((rp) => rp.playing === true)
      .map((rp) => playersById[rp.player_id])
      .filter((p): p is PlayerRow => !!p && !!p.id);

    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [roundPlayers, playersById]);

  const groupIdByPlayer = useMemo(() => {
    const m = new Map<string, { group_id: string; seat: number }>();
    for (const gp of groupPlayers) {
      m.set(String(gp.player_id), { group_id: String(gp.group_id), seat: Number(gp.seat ?? 999) });
    }
    return m;
  }, [groupPlayers]);

  const playersInSameGroup = useMemo(() => {
    if (!meId) return [];
    const rec = groupIdByPlayer.get(meId);
    if (!rec) return [];
    const gid = rec.group_id;

    const peers = groupPlayers
      .filter((x) => String(x.group_id) === gid)
      .map((x) => ({ player_id: String(x.player_id), seat: Number(x.seat ?? 999) }))
      .filter((x) => x.player_id !== meId);

    peers.sort((a, b) => a.seat - b.seat);

    return peers
      .map((p) => playersById[p.player_id])
      .filter((p): p is PlayerRow => !!p && !!p.id);
  }, [meId, groupIdByPlayer, groupPlayers, playersById]);

  // Auto-suggest buddy when Me changes (unless user already picked buddy manually)
  useEffect(() => {
    if (!meId) {
      buddyManuallySetRef.current = false;
      setBuddyId("");
      return;
    }

    if (buddyManuallySetRef.current) return;
    if (buddyId && buddyId !== meId) return;

    const suggested = playersInSameGroup[0]?.id ?? "";
    setBuddyId(suggested || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId, playersInSameGroup]);

  const targetUrl = useMemo(() => {
    if (!meId) return "";
    const qs = new URLSearchParams();
    qs.set("meId", meId);
    if (buddyId && buddyId !== meId) qs.set("buddyId", buddyId);
    return `/m/tours/${tourId}/rounds/${roundId}/scoring/score?${qs.toString()}`;
  }, [tourId, roundId, meId, buddyId]);

  const buddyLabel = useMemo(() => {
    if (!meId) return "Buddy (optional)";
    const inSameGroup = playersInSameGroup.some((p) => p.id === buddyId);
    if (buddyId && inSameGroup) return "Buddy (suggested from your group)";
    if (playersInSameGroup.length > 0) return "Buddy (suggested from your group)";
    return "Buddy (optional)";
  }, [meId, buddyId, playersInSameGroup]);

  function goBack() {
    // ✅ back to ROUNDS LIST (avoid 404)
    router.push(`/m/tours/${tourId}/rounds`);
  }

  if (loading) {
    return <div className="mx-auto w-full max-w-md px-4 py-4 pb-24 text-sm opacity-70">Loading…</div>;
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-4 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xl font-semibold">Scoring</div>

          {/* ✅ show round number/label clearly */}
          <div className="mt-1 truncate text-base font-semibold text-gray-800">{roundLabel}</div>

          <div className="mt-1 text-base text-gray-700">Course: {courseName}</div>

          <div className="mt-1 text-base">
            Status:{" "}
            <span className={isLocked ? "text-red-600 font-semibold" : "text-green-700 font-semibold"}>
              {isLocked ? "Locked" : "Open"}
            </span>
          </div>

          {errorMsg ? <div className="mt-2 text-sm text-red-600">{errorMsg}</div> : null}
        </div>

        <button
          type="button"
          onClick={goBack}
          className="rounded-xl border px-4 py-3 text-base font-semibold hover:bg-gray-50 active:bg-gray-100"
        >
          Back
        </button>
      </div>

      {playingPlayers.length === 0 ? (
        <div className="mt-4 rounded-2xl border p-4 text-sm space-y-2 bg-white">
          <div className="font-semibold">No playing players</div>
          <div className="text-gray-700">
            This mode only allows selecting players marked <code>playing=true</code> in{" "}
            <code>round_players</code>.
          </div>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <label className="block">
            <div className="mb-2 text-base font-semibold">Me</div>
            <select
              className="w-full rounded-2xl border px-4 py-4 bg-white text-base"
              value={meId}
              onChange={(e) => {
                const nextMe = e.target.value;
                setMeId(nextMe);

                buddyManuallySetRef.current = false;
                if (buddyId === nextMe) setBuddyId("");
              }}
            >
              <option value="">Select…</option>
              {playingPlayers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <div className="mb-2 text-base font-semibold">{buddyLabel}</div>
            <select
              className="w-full rounded-2xl border px-4 py-4 bg-white text-base"
              value={buddyId}
              onChange={(e) => {
                buddyManuallySetRef.current = true;
                setBuddyId(e.target.value);
              }}
              disabled={!meId}
            >
              <option value="">None</option>

              {meId && playersInSameGroup.length > 0 ? (
                <>
                  <optgroup label="Same group">
                    {playersInSameGroup
                      .filter((p) => p.id !== meId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </optgroup>
                  <optgroup label="All playing">
                    {playingPlayers
                      .filter((p) => p.id !== meId && !playersInSameGroup.some((x) => x.id === p.id))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </optgroup>
                </>
              ) : (
                playingPlayers
                  .filter((p) => p.id !== meId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))
              )}
            </select>
          </label>

          {meId ? (
            <div className="text-sm text-gray-600">
              {playersInSameGroup.length > 0
                ? "Buddy is suggested from your group, but you can override."
                : "No group found for you yet (or groups not generated). Buddy is optional."}
            </div>
          ) : null}

          {meId && !isLocked ? (
            <Link
              href={targetUrl}
              className="block w-full rounded-2xl bg-gray-900 px-4 py-4 text-center text-base font-semibold text-white hover:bg-gray-800 active:bg-gray-700"
            >
              Continue to scoring
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="w-full rounded-2xl bg-gray-400 px-4 py-4 text-center text-base font-semibold text-white"
            >
              {isLocked ? "Round is locked" : "Select Me to continue"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
