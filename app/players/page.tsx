"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Tee = "M" | "F";

type Player = {
  id: string;
  name: string;

  // New column (preferred)
  starting_handicap: number | null;

  // Legacy column still enforced NOT NULL in your DB
  start_handicap: number | null;

  // New: sex flag
  gender: Tee | null;

  created_at?: string | null;
};

function toInt(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function normalizeGender(v: any): Tee {
  const s = String(v ?? "")
    .trim()
    .toUpperCase();
  return s === "F" ? "F" : "M";
}

export default function PlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // add form
  const [name, setName] = useState("");
  const [hcp, setHcp] = useState("");
  const [gender, setGender] = useState<Tee>("M");

  // inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editHcp, setEditHcp] = useState<string>("");
  const [editGender, setEditGender] = useState<Tee>("M");

  async function loadPlayers() {
    setLoading(true);
    setErrorMsg("");

    try {
      // Select both columns for compatibility
      const { data, error } = await supabase
        .from("players")
        .select("id,name,gender,starting_handicap,start_handicap,created_at")
        .order("name", { ascending: true });

      if (error) throw new Error(error.message);

      const rows = (data ?? []) as any[];
      const normalized: Player[] = rows.map((p) => ({
        id: String(p.id),
        name: String(p.name),
        starting_handicap: Number.isFinite(Number(p.starting_handicap)) ? Number(p.starting_handicap) : null,
        start_handicap: Number.isFinite(Number(p.start_handicap)) ? Number(p.start_handicap) : null,
        gender: p.gender ? normalizeGender(p.gender) : null,
        created_at: p.created_at ?? null,
      }));

      setPlayers(normalized);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPlayers();
  }, []);

  const canAdd = useMemo(() => {
    if (saving) return false;
    if (!name.trim()) return false;
    const n = toInt(hcp);
    return n != null;
  }, [name, hcp, saving]);

  async function addPlayer() {
    setErrorMsg("");
    const n = toInt(hcp);
    if (!name.trim() || n == null) {
      setErrorMsg("Please enter a player name and a valid whole-number starting handicap.");
      return;
    }

    setSaving(true);
    try {
      // Write both columns (legacy + new)
      const { error } = await supabase.from("players").insert({
        name: name.trim(),
        gender: normalizeGender(gender),
        starting_handicap: n,
        start_handicap: n,
      });

      if (error) throw new Error(error.message);

      setName("");
      setHcp("");
      setGender("M");
      await loadPlayers();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  function effectiveHcp(p: Player): number {
    // Prefer new column, fallback to legacy
    const v = p.starting_handicap ?? p.start_handicap;
    return typeof v === "number" ? v : 0;
  }

  function beginEdit(p: Player) {
    setEditingId(p.id);
    setEditHcp(String(effectiveHcp(p)));
    setEditGender(p.gender ? normalizeGender(p.gender) : "M");
  }

  async function saveEdit(playerId: string) {
    setErrorMsg("");
    const n = toInt(editHcp);
    if (n == null) {
      setErrorMsg("Please enter a valid whole-number starting handicap.");
      return;
    }

    setSaving(true);
    try {
      // Update both columns to keep them in sync + gender
      const { error } = await supabase
        .from("players")
        .update({ starting_handicap: n, start_handicap: n, gender: normalizeGender(editGender) })
        .eq("id", playerId);

      if (error) throw new Error(error.message);

      setEditingId(null);
      setEditHcp("");
      setEditGender("M");
      await loadPlayers();
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Unknown error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-4 space-y-4">
      <div className="text-sm opacity-70">
        <Link className="underline" href="/tours">
          Tours
        </Link>{" "}
        <span className="opacity-50">/</span> Players (Library)
      </div>

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Players (Library)</h1>
          <div className="text-sm opacity-70">Global list of players + starting handicaps + gender.</div>
        </div>

        <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href="/courses">
          Courses
        </Link>
      </header>

      {errorMsg ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-semibold">Error</div>
          <div className="mt-1">{errorMsg}</div>
        </div>
      ) : null}

      {/* Add player */}
      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="text-lg font-semibold">Add a new player</div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <div className="text-sm opacity-70 mb-1">Name</div>
            <input
              className="w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="Player name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <div className="text-sm opacity-70 mb-1">Gender</div>
            <select
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={gender}
              onChange={(e) => setGender(normalizeGender(e.target.value))}
            >
              <option value="M">M</option>
              <option value="F">F</option>
            </select>
          </div>

          <div>
            <div className="text-sm opacity-70 mb-1">Starting handicap</div>
            <input
              className="w-full rounded-xl border px-3 py-2 text-sm text-right"
              placeholder="e.g. 11"
              value={hcp}
              onChange={(e) => setHcp(e.target.value)}
              inputMode="numeric"
            />
          </div>
        </div>

        <button
          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          disabled={!canAdd}
          onClick={() => void addPlayer()}
        >
          {saving ? "Saving…" : "Add Player"}
        </button>
      </section>

      {/* List players */}
      <section className="rounded-2xl border bg-white">
        {loading ? <div className="p-4 text-sm opacity-70">Loading…</div> : null}

        {!loading && players.length === 0 ? <div className="p-4 text-sm opacity-70">No players yet.</div> : null}

        {!loading && players.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-[860px] w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-3 text-left font-medium opacity-70">Name</th>
                  <th className="p-3 text-center font-medium opacity-70">Gender</th>
                  <th className="p-3 text-right font-medium opacity-70">Starting HCP</th>
                  <th className="p-3 text-right font-medium opacity-70">Actions</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => {
                  const isEditing = editingId === p.id;

                  return (
                    <tr key={p.id} className="border-b last:border-b-0">
                      <td className="p-3">{p.name}</td>

                      <td className="p-3 text-center">
                        {isEditing ? (
                          <select
                            className="rounded border px-2 py-1 text-sm"
                            value={editGender}
                            onChange={(e) => setEditGender(normalizeGender(e.target.value))}
                            disabled={saving}
                          >
                            <option value="M">M</option>
                            <option value="F">F</option>
                          </select>
                        ) : (
                          <span className="tabular-nums">{p.gender ?? "—"}</span>
                        )}
                      </td>

                      <td className="p-3 text-right tabular-nums">
                        {isEditing ? (
                          <input
                            className="w-24 rounded border px-2 py-1 text-right"
                            value={editHcp}
                            onChange={(e) => setEditHcp(e.target.value)}
                            inputMode="numeric"
                          />
                        ) : (
                          effectiveHcp(p)
                        )}
                      </td>

                      <td className="p-3 text-right">
                        {isEditing ? (
                          <div className="inline-flex gap-3">
                            <button
                              className="text-sm underline disabled:opacity-50"
                              disabled={saving}
                              onClick={() => void saveEdit(p.id)}
                            >
                              Save
                            </button>
                            <button
                              className="text-sm underline opacity-80 hover:opacity-100 disabled:opacity-50"
                              disabled={saving}
                              onClick={() => {
                                setEditingId(null);
                                setEditHcp("");
                                setEditGender("M");
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            className="text-sm underline opacity-80 hover:opacity-100 disabled:opacity-50"
                            disabled={saving}
                            onClick={() => beginEdit(p)}
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <div className="text-xs opacity-60 space-y-1">
        <div>
          Note: This page writes both <code>players.starting_handicap</code> and legacy <code>players.start_handicap</code>{" "}
          to satisfy your current DB constraint. We can remove the legacy column later.
        </div>
        <div>
          Gender values are stored as <code>M</code>/<code>F</code> in <code>players.gender</code>.
        </div>
      </div>
    </main>
  );
}
