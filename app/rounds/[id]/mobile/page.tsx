"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { supabase } from "@/lib/supabaseClient";

type CourseRel = { name: string };

type Round = {
  id: string;
  name: string;
  course_id: string | null;
  is_locked: boolean | null;
  played_on: string | null;
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

export default function MobileSelectPage() {
  const params = useParams();
  const roundId = String((params as any)?.id ?? "").trim();


  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [round, setRound] = useState<Round | null>(null);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [playersById, setPlayersById] = useState<Record<string, PlayerRow>>({});

  // NEW: group memberships for this round
  const [groupPlayers, setGroupPlayers] = useState<RoundGroupPlayerRow[]>([]);

  const [meId, setMeId] = useState("");
  const [buddyId, setBuddyId] = useState("");

  // Tracks if the user explicitly chose a buddy (so we don't overwrite their choice)
  const buddyManuallySetRef = useRef(false);

  useEffect(() => {
    if (!roundId) return;

    let alive = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");

      try {
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,name,course_id,is_locked,played_on,courses(name)")
          .eq("id", roundId)
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

        // NEW: load group memberships for this round (if groups exist)
        let gpRows: RoundGroupPlayerRow[] = [];
        if (ids.length > 0) {
          const { data: gpData, error: gpErr } = await supabase
            .from("round_group_players")
            .select("round_id,group_id,player_id,seat")
            .eq("round_id", roundId)
            .in("player_id", ids);

          // If table doesn't exist yet or RLS blocks, show a friendly message but keep page working.
          if (gpErr) {
            // Only set error if it's not "relation does not exist"
            // (Some users deploy before migrations; we don't want to break mobile selection.)
            const msg = gpErr.message ?? "";
            if (!msg.toLowerCase().includes("does not exist")) {
              // soft warning only; don't fail the whole page
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
        setErrorMsg(e?.message ?? "Failed to load mobile selection.");
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
  }, [roundId]);

  const courseName = useMemo(() => {
    const c = asSingle(round?.courses);
    return c?.name ?? "(no course)";
  }, [round]);

  const isLocked = round?.is_locked === true;

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

    // Map to PlayerRow if we have it
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

    // If buddy was manually set, don't override.
    if (buddyManuallySetRef.current) return;

    // If we already have a valid buddy (not me), keep it.
    if (buddyId && buddyId !== meId) return;

    // Prefer first player in the same group (seat order)
    const suggested = playersInSameGroup[0]?.id ?? "";

    if (suggested) {
      setBuddyId(suggested);
    } else {
      // No group or no peer in group => leave buddy empty
      setBuddyId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId, playersInSameGroup]);

  const targetUrl = useMemo(() => {
    if (!meId) return "";
    const qs = new URLSearchParams();
    qs.set("meId", meId);
    if (buddyId && buddyId !== meId) qs.set("buddyId", buddyId);
    return `/rounds/${roundId}/mobile/score?${qs.toString()}`;
  }, [roundId, meId, buddyId]);

  const buddyLabel = useMemo(() => {
    if (!meId) return "Buddy (optional)";
    const inSameGroup = playersInSameGroup.some((p) => p.id === buddyId);
    if (buddyId && inSameGroup) return "Buddy (suggested from your group)";
    if (playersInSameGroup.length > 0) return "Buddy (suggested from your group)";
    return "Buddy (optional)";
  }, [meId, buddyId, playersInSameGroup]);

  if (loading) return <div className="p-4 text-sm opacity-70">Loading…</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-1">
        <div className="text-xl font-semibold">{round?.name ?? "Round"}</div>
        <div className="text-sm opacity-75">Course: {courseName}</div>
        <div className="text-sm">
          Status:{" "}
          <span className={isLocked ? "text-red-600" : "text-green-700"}>
            {isLocked ? "Locked" : "Open"}
          </span>
        </div>
        {errorMsg ? <div className="text-sm text-red-600">{errorMsg}</div> : null}
      </div>

      {playingPlayers.length === 0 ? (
        <div className="rounded-md border p-3 text-sm space-y-2">
          <div className="font-semibold">No playing players</div>
          <div className="opacity-80">
            This mode only allows selecting players marked <code>playing=true</code> in <code>round_players</code>.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm">
            <div className="mb-1 font-medium">Me</div>
            <select
              className="w-full border rounded-md p-2"
              value={meId}
              onChange={(e) => {
                const nextMe = e.target.value;
                setMeId(nextMe);

                // If changing me, reset the "manual buddy" flag so we can re-suggest.
                buddyManuallySetRef.current = false;

                // If buddy equals me, clear.
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

          <label className="block text-sm">
            <div className="mb-1 font-medium">{buddyLabel}</div>
            <select
              className="w-full border rounded-md p-2"
              value={buddyId}
              onChange={(e) => {
                buddyManuallySetRef.current = true;
                setBuddyId(e.target.value);
              }}
              disabled={!meId}
            >
              <option value="">None</option>

              {/* If we have group peers, show them first */}
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

          {/* Small helper line */}
          {meId ? (
            <div className="text-xs opacity-70">
              {playersInSameGroup.length > 0
                ? "Buddy is suggested from your group, but you can override."
                : "No group found for you yet (or groups not generated). Buddy is optional."}
            </div>
          ) : null}

          {targetUrl ? (
            <div className="text-xs opacity-70">
              Target: <code>{targetUrl}</code>
            </div>
          ) : null}

          {/* ✅ Use Link for bulletproof navigation */}
          {meId && !isLocked ? (
            <Link
              href={targetUrl}
              className="block w-full text-center rounded-md px-4 py-2 text-sm text-white bg-black"
            >
              Continue to scoring
            </Link>
          ) : (
            <button type="button" disabled className="w-full rounded-md px-4 py-2 text-sm text-white bg-gray-400">
              {isLocked ? "Round is locked" : "Select Me to continue"}
            </button>
          )}

          {/* Hard navigate fallback (copy/paste) */}
          {targetUrl ? (
            <div className="text-xs">
              If the button doesn’t work, copy/paste this into the address bar:
              <div className="mt-1">
                <code>{targetUrl}</code>
              </div>
            </div>
          ) : null}
        </div>
      )}

      <div className="flex gap-3 text-sm">
        <Link className="underline" href={`/rounds/${roundId}`}>
          ← Back to round
        </Link>
        <Link className="underline" href={`/rounds/${roundId}/groups`}>
          Groups
        </Link>
        <Link className="underline" href={`/tours`}>
          Tours
        </Link>
      </div>
    </div>
  );
}
