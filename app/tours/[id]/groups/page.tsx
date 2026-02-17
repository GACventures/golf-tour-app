// app/tours/[id]/groups/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";

// ✅ Tour roster player (derived from tour_players join)
type PlayerRow = { id: string; name: string; created_at?: string | null };

type TourGroupRow = {
  id: string;
  tour_id: string;
  scope: "tour" | "round";
  type: "pair" | "team";
  name: string | null;
  round_id: string | null;
  created_at?: string | null;
};

// ✅ Join table row: your DB does NOT have tour_group_members.id
type TourGroupMemberRow = {
  group_id: string;
  player_id: string;
};

function stablePlayerSort(a: PlayerRow, b: PlayerRow) {
  const ca = a.created_at ?? "";
  const cb = b.created_at ?? "";
  if (ca && cb && ca !== cb) return ca.localeCompare(cb);

  const na = (a.name ?? "").toLowerCase();
  const nb = (b.name ?? "").toLowerCase();
  if (na !== nb) return na.localeCompare(nb);

  return a.id.localeCompare(b.id);
}

export default function TourPairsTeamsPage() {
  const params = useParams<{ id: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [infoMsg, setInfoMsg] = useState("");

  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [groups, setGroups] = useState<TourGroupRow[]>([]);
  const [members, setMembers] = useState<TourGroupMemberRow[]>([]);

  // Create pair
  const [pairA, setPairA] = useState<string>("");
  const [pairB, setPairB] = useState<string>("");

  // Create team
  const [teamName, setTeamName] = useState<string>("");
  const [teamMembers, setTeamMembers] = useState<Record<string, boolean>>({}); // playerId -> selected

  // NEW: manual add/remove
  const [selectedPairId, setSelectedPairId] = useState<string>("");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [selectedPairPlayerId, setSelectedPairPlayerId] = useState<string>("");
  const [selectedTeamPlayerId, setSelectedTeamPlayerId] = useState<string>("");

  const playerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.id, p.name);
    return m;
  }, [players]);

  const tourPairs = useMemo(() => groups.filter((g) => g.scope === "tour" && g.type === "pair"), [groups]);
  const tourTeams = useMemo(() => groups.filter((g) => g.scope === "tour" && g.type === "team"), [groups]);

  const membersByGroup = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const row of members) {
      const gid = row.group_id;
      const pid = row.player_id;
      if (!m.has(gid)) m.set(gid, []);
      m.get(gid)!.push(pid);
    }
    return m;
  }, [members]);

  // NEW: who is already in ANY pair / ANY team (so we can offer "unassigned" lists)
  const assignedToPairs = useMemo(() => {
    const s = new Set<string>();
    for (const g of tourPairs) {
      const ids = membersByGroup.get(g.id) ?? [];
      for (const pid of ids) s.add(pid);
    }
    return s;
  }, [tourPairs, membersByGroup]);

  const assignedToTeams = useMemo(() => {
    const s = new Set<string>();
    for (const g of tourTeams) {
      const ids = membersByGroup.get(g.id) ?? [];
      for (const pid of ids) s.add(pid);
    }
    return s;
  }, [tourTeams, membersByGroup]);

  const unassignedForPairs = useMemo(() => {
    return [...players].filter((p) => !assignedToPairs.has(p.id)).sort(stablePlayerSort);
  }, [players, assignedToPairs]);

  const unassignedForTeams = useMemo(() => {
    return [...players].filter((p) => !assignedToTeams.has(p.id)).sort(stablePlayerSort);
  }, [players, assignedToTeams]);

  async function loadAll() {
    if (!tourId) return;
    setLoading(true);
    setErrorMsg("");
    setInfoMsg("");

    try {
      // ✅ Tour roster now comes from tour_players join to players
      const { data: tpData, error: tpErr } = await supabase
        .from("tour_players")
        .select("player_id, created_at, players:players(id,name,created_at)")
        .eq("tour_id", tourId)
        .order("name", { ascending: true, foreignTable: "players" });

      if (tpErr) throw tpErr;

      const plist: PlayerRow[] = (tpData ?? [])
        .map((r: any) => {
          const p = r.players;
          return {
            id: String(p?.id ?? r.player_id),
            name: String(p?.name ?? "(missing name)"),
            // prefer player created_at for stable sort; fallback to membership created_at
            created_at: (p?.created_at ?? r.created_at ?? null) as any,
          };
        })
        .filter((p) => !!p.id)
        .slice()
        .sort(stablePlayerSort);

      setPlayers(plist);

      // ensure teamMembers has keys (do not clobber existing selections)
      setTeamMembers((prev) => {
        const next = { ...prev };
        for (const p of plist) if (next[p.id] === undefined) next[p.id] = false;

        // prune removed players
        for (const k of Object.keys(next)) {
          if (!plist.some((p) => p.id === k)) delete next[k];
        }
        return next;
      });

      // groups
      const { data: gData, error: gErr } = await supabase
        .from("tour_groups")
        .select("id,tour_id,scope,type,name,round_id,created_at")
        .eq("tour_id", tourId)
        .eq("scope", "tour")
        .in("type", ["pair", "team"])
        .order("type", { ascending: true })
        .order("created_at", { ascending: true });

      if (gErr) throw gErr;

      const glist = (gData ?? []) as TourGroupRow[];
      setGroups(glist);

      const groupIds = glist.map((g) => g.id);
      if (!groupIds.length) {
        setMembers([]);
        return;
      }

      // ✅ FIX: do NOT select `id` (column does not exist)
      const { data: mData, error: mErr } = await supabase
        .from("tour_group_members")
        .select("group_id,player_id")
        .in("group_id", groupIds);

      if (mErr) throw mErr;
      setMembers((mData ?? []) as TourGroupMemberRow[]);

      // keep selected ids valid
      const firstPair = glist.find((g) => g.type === "pair")?.id ?? "";
      const firstTeam = glist.find((g) => g.type === "team")?.id ?? "";

      setSelectedPairId((prev) => (prev && glist.some((g) => g.id === prev) ? prev : firstPair));
      setSelectedTeamId((prev) => (prev && glist.some((g) => g.id === prev) ? prev : firstTeam));
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to load pairs/teams.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  function pairLabelFromIds(a: string, b: string) {
    const an = playerNameById.get(a) ?? a;
    const bn = playerNameById.get(b) ?? b;
    return `${an} / ${bn}`;
  }

  async function createPair() {
    setBusy(true);
    setErrorMsg("");
    setInfoMsg("");

    try {
      const a = pairA.trim();
      const b = pairB.trim();
      if (!a || !b) throw new Error("Pick two players for the pair.");
      if (a === b) throw new Error("Pair players must be different.");

      // prevent duplicates (A,B) == (B,A)
      const existing = tourPairs.some((g) => {
        const ids = membersByGroup.get(g.id) ?? [];
        if (ids.length < 2) return false;
        const x = ids[0];
        const y = ids[1];
        return (x === a && y === b) || (x === b && y === a);
      });
      if (existing) throw new Error("That pair already exists.");

      // optional: prevent player being in multiple pairs
      if (assignedToPairs.has(a) || assignedToPairs.has(b)) {
        throw new Error("One of those players is already in a pair. Remove them from their existing pair first.");
      }

      const name = pairLabelFromIds(a, b);

      const { data: insG, error: insGErr } = await supabase
        .from("tour_groups")
        .insert({
          tour_id: tourId,
          scope: "tour",
          type: "pair",
          name,
          round_id: null,
        })
        .select("id")
        .single();

      if (insGErr) throw insGErr;

      const groupId = String((insG as any).id);

      const { error: insMErr } = await supabase.from("tour_group_members").insert([
        { group_id: groupId, player_id: a },
        { group_id: groupId, player_id: b },
      ]);

      if (insMErr) throw insMErr;

      setInfoMsg("Pair created.");
      setPairA("");
      setPairB("");
      await loadAll();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to create pair.");
    } finally {
      setBusy(false);
    }
  }

  async function createTeam() {
    setBusy(true);
    setErrorMsg("");
    setInfoMsg("");

    try {
      const name = teamName.trim();
      if (!name) throw new Error("Enter a team name.");

      const memberIds = Object.entries(teamMembers)
        .filter(([, v]) => v)
        .map(([pid]) => pid);

      if (memberIds.length < 2) throw new Error("Pick at least 2 team members.");

      // optional: prevent player being in multiple teams
      if (memberIds.some((pid) => assignedToTeams.has(pid))) {
        throw new Error("One or more selected players are already in a team. Remove them from their existing team first.");
      }

      const { data: insG, error: insGErr } = await supabase
        .from("tour_groups")
        .insert({
          tour_id: tourId,
          scope: "tour",
          type: "team",
          name,
          round_id: null,
        })
        .select("id")
        .single();

      if (insGErr) throw insGErr;

      const groupId = String((insG as any).id);

      const { error: insMErr } = await supabase
        .from("tour_group_members")
        .insert(memberIds.map((pid) => ({ group_id: groupId, player_id: pid })));

      if (insMErr) throw insMErr;

      setInfoMsg("Team created.");
      setTeamName("");
      setTeamMembers((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) next[k] = false;
        return next;
      });
      await loadAll();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to create team.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteGroup(groupId: string) {
    setBusy(true);
    setErrorMsg("");
    setInfoMsg("");

    try {
      // delete members first
      const delM = await supabase.from("tour_group_members").delete().eq("group_id", groupId);
      if (delM.error) throw delM.error;

      const delG = await supabase.from("tour_groups").delete().eq("id", groupId);
      if (delG.error) throw delG.error;

      setInfoMsg("Deleted.");
      await loadAll();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to delete group.");
    } finally {
      setBusy(false);
    }
  }

  // ===== NEW: add/remove members =====

  async function removeGroupMember(groupId: string, playerId: string) {
    setBusy(true);
    setErrorMsg("");
    setInfoMsg("");
    try {
      const { error } = await supabase.from("tour_group_members").delete().eq("group_id", groupId).eq("player_id", playerId);
      if (error) throw error;
      setInfoMsg("Removed member.");
      await loadAll();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to remove member.");
    } finally {
      setBusy(false);
    }
  }

  async function addMemberToPair() {
    setErrorMsg("");
    setInfoMsg("");

    const gid = selectedPairId.trim();
    const pid = selectedPairPlayerId.trim();

    if (!gid) return setErrorMsg("Select a pair.");
    if (!pid) return setErrorMsg("Select a player to add.");

    const existing = membersByGroup.get(gid) ?? [];
    if (existing.length >= 2) return setErrorMsg("That pair already has 2 members. Remove one first.");

    if (assignedToPairs.has(pid)) return setErrorMsg("That player is already in a pair. Remove them from their existing pair first.");

    setBusy(true);
    try {
      const { error } = await supabase.from("tour_group_members").insert({ group_id: gid, player_id: pid });
      if (error) throw error;

      setInfoMsg("Added to pair.");
      setSelectedPairPlayerId("");
      await loadAll();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to add member to pair.");
    } finally {
      setBusy(false);
    }
  }

  async function addMemberToTeam() {
    setErrorMsg("");
    setInfoMsg("");

    const gid = selectedTeamId.trim();
    const pid = selectedTeamPlayerId.trim();

    if (!gid) return setErrorMsg("Select a team.");
    if (!pid) return setErrorMsg("Select a player to add.");

    if (assignedToTeams.has(pid)) return setErrorMsg("That player is already in a team. Remove them from their existing team first.");

    setBusy(true);
    try {
      const { error } = await supabase.from("tour_group_members").insert({ group_id: gid, player_id: pid });
      if (error) throw error;

      setInfoMsg("Added to team.");
      setSelectedTeamPlayerId("");
      await loadAll();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to add member to team.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-5xl p-4">
        <div className="text-sm opacity-70">Loading…</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-4 space-y-4">
      <div className="text-sm opacity-70">
        <Link className="underline" href="/tours">
          Tours
        </Link>{" "}
        <span className="opacity-50">/</span>{" "}
        <Link className="underline" href={`/tours/${tourId}`}>
          Tour
        </Link>{" "}
        <span className="opacity-50">/</span> Pairs &amp; teams
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Tour pairs &amp; teams</h1>
          <div className="text-sm opacity-70">Used by pair/team competitions, and Round 1 “prefer pairs”.</div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <button onClick={loadAll} disabled={busy} className="rounded-xl border px-3 py-2 text-sm disabled:opacity-50">
            Refresh
          </button>
        </div>
      </div>

      {errorMsg ? <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{errorMsg}</div> : null}

      {infoMsg ? (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{infoMsg}</div>
      ) : null}

      <section className="rounded-2xl border bg-white p-4 space-y-2">
        <h2 className="text-lg font-semibold">Players (this tour)</h2>
        {players.length === 0 ? (
          <div className="text-sm opacity-70">
            No players in this tour yet. Add players on{" "}
            <Link className="underline" href={`/tours/${tourId}/players`}>
              Players (This Tour)
            </Link>
            .
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
            {players.map((p) => (
              <div key={p.id} className="rounded-lg border px-2 py-1">
                {p.name}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* NEW: Manual member changes */}
      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Manual member changes</h2>
            <div className="text-sm opacity-70">Add/remove players from existing pairs and teams.</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Pair add */}
          <div className="rounded-xl border p-3 space-y-2">
            <div className="font-semibold">Add to pair</div>
            <div className="text-xs opacity-70">
              Available (not already in a pair): {unassignedForPairs.length}
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <select
                className="rounded-md border px-2 py-1 text-sm"
                value={selectedPairId}
                onChange={(e) => setSelectedPairId(e.target.value)}
                disabled={busy || tourPairs.length === 0}
              >
                <option value="">{tourPairs.length ? "Select pair…" : "No pairs yet"}</option>
                {tourPairs.map((g) => {
                  const ids = membersByGroup.get(g.id) ?? [];
                  const label =
                    g.name?.trim() || (ids.length >= 2 ? pairLabelFromIds(ids[0], ids[1]) : `Pair ${g.id.slice(0, 6)}`);
                  return (
                    <option key={g.id} value={g.id}>
                      {label}
                    </option>
                  );
                })}
              </select>

              <select
                className="rounded-md border px-2 py-1 text-sm"
                value={selectedPairPlayerId}
                onChange={(e) => setSelectedPairPlayerId(e.target.value)}
                disabled={busy || unassignedForPairs.length === 0}
              >
                <option value="">{unassignedForPairs.length ? "Select player…" : "No available players"}</option>
                {unassignedForPairs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => void addMemberToPair()}
                disabled={busy || !selectedPairId || !selectedPairPlayerId}
                className="rounded-md bg-black px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                Add
              </button>
            </div>

            <div className="text-[11px] opacity-60">Pairs are capped at 2 members.</div>
          </div>

          {/* Team add */}
          <div className="rounded-xl border p-3 space-y-2">
            <div className="font-semibold">Add to team</div>
            <div className="text-xs opacity-70">
              Available (not already in a team): {unassignedForTeams.length}
            </div>

            <div className="flex flex-wrap gap-2 items-center">
              <select
                className="rounded-md border px-2 py-1 text-sm"
                value={selectedTeamId}
                onChange={(e) => setSelectedTeamId(e.target.value)}
                disabled={busy || tourTeams.length === 0}
              >
                <option value="">{tourTeams.length ? "Select team…" : "No teams yet"}</option>
                {tourTeams.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name?.trim() || `Team ${g.id.slice(0, 6)}`}
                  </option>
                ))}
              </select>

              <select
                className="rounded-md border px-2 py-1 text-sm"
                value={selectedTeamPlayerId}
                onChange={(e) => setSelectedTeamPlayerId(e.target.value)}
                disabled={busy || unassignedForTeams.length === 0}
              >
                <option value="">{unassignedForTeams.length ? "Select player…" : "No available players"}</option>
                {unassignedForTeams.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => void addMemberToTeam()}
                disabled={busy || !selectedTeamId || !selectedTeamPlayerId}
                className="rounded-md bg-black px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                Add
              </button>
            </div>

            <div className="text-[11px] opacity-60">Teams have no size limit (you can remove members below).</div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Pairs</h2>
          <div className="text-sm opacity-70">Total: {tourPairs.length}</div>
        </div>

        <div className="rounded-xl border p-3 space-y-2">
          <div className="text-sm font-medium">Create pair</div>
          <div className="flex flex-wrap items-center gap-2">
            <select className="rounded-md border px-2 py-1 text-sm" value={pairA} onChange={(e) => setPairA(e.target.value)}>
              <option value="">Player A…</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <select className="rounded-md border px-2 py-1 text-sm" value={pairB} onChange={(e) => setPairB(e.target.value)}>
              <option value="">Player B…</option>
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={createPair}
              disabled={busy}
              className="rounded-md bg-black px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Add pair
            </button>
          </div>
          <div className="text-xs opacity-60">Tip: these pairs are used by Round 1 “prefer pairs” and pair competitions.</div>
        </div>

        {tourPairs.length === 0 ? (
          <div className="text-sm opacity-70">No pairs yet.</div>
        ) : (
          <div className="space-y-2">
            {tourPairs.map((g) => {
              const ids = membersByGroup.get(g.id) ?? [];
              const label =
                g.name?.trim() || (ids.length >= 2 ? pairLabelFromIds(ids[0], ids[1]) : `Pair ${g.id.slice(0, 6)}`);

              return (
                <div key={g.id} className="rounded-xl border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{label}</div>
                      <div className="text-xs opacity-70">Members:</div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void deleteGroup(g.id)}
                      disabled={busy}
                      className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
                      title="Delete pair"
                    >
                      Delete
                    </button>
                  </div>

                  {ids.length === 0 ? (
                    <div className="text-sm opacity-70">No members yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {ids.map((pid) => (
                        <div key={pid} className="flex items-center justify-between rounded-lg border px-3 py-2">
                          <div className="text-sm">{playerNameById.get(pid) ?? pid}</div>
                          <button
                            type="button"
                            onClick={() => void removeGroupMember(g.id, pid)}
                            disabled={busy}
                            className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
                            title="Remove member"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Teams</h2>
          <div className="text-sm opacity-70">Total: {tourTeams.length}</div>
        </div>

        <div className="rounded-xl border p-3 space-y-2">
          <div className="text-sm font-medium">Create team</div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              className="w-64 rounded-md border px-2 py-1 text-sm"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="Team name…"
            />
            <button
              type="button"
              onClick={createTeam}
              disabled={busy}
              className="rounded-md bg-black px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              Add team
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
            {players.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={teamMembers[p.id] === true}
                  onChange={(e) => setTeamMembers((prev) => ({ ...prev, [p.id]: e.target.checked }))}
                />
                <span className="truncate">{p.name}</span>
              </label>
            ))}
          </div>

          <div className="text-xs opacity-60">Pick 2+ members. These teams are used by team competitions.</div>
        </div>

        {tourTeams.length === 0 ? (
          <div className="text-sm opacity-70">No teams yet.</div>
        ) : (
          <div className="space-y-2">
            {tourTeams.map((g) => {
              const ids = membersByGroup.get(g.id) ?? [];
              const label = g.name?.trim() || `Team ${g.id.slice(0, 6)}`;

              return (
                <div key={g.id} className="rounded-xl border p-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{label}</div>
                      <div className="text-xs opacity-70">Members:</div>
                    </div>

                    <button
                      type="button"
                      onClick={() => void deleteGroup(g.id)}
                      disabled={busy}
                      className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
                      title="Delete team"
                    >
                      Delete
                    </button>
                  </div>

                  {ids.length === 0 ? (
                    <div className="text-sm opacity-70">No members yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {ids.map((pid) => (
                        <div key={pid} className="flex items-center justify-between rounded-lg border px-3 py-2">
                          <div className="text-sm">{playerNameById.get(pid) ?? pid}</div>
                          <button
                            type="button"
                            onClick={() => void removeGroupMember(g.id, pid)}
                            disabled={busy}
                            className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
                            title="Remove member"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
