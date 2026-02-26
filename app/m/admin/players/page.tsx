"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Tee = "M" | "F";

type Player = {
  id: string;
  name: string;
  starting_handicap: number | null;
  start_handicap: number | null;
  gender: Tee | null;
  created_at?: string | null;
};

function toHcp1dpOrNull(input: string): number | null {
  const s = String(input ?? "").trim();
  if (!s) return null;
  if (!/^\d+(\.\d{0,1})?$/.test(s)) return null;

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return Number(n.toFixed(1));
}

function fmt1dp(v: number | null | undefined): string {
  if (!Number.isFinite(Number(v))) return "0.0";
  return Number(v).toFixed(1);
}

function normalizeGender(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

export default function MobileAdminPlayersPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const [name, setName] = useState("");
  const [hcp, setHcp] = useState("");
  const [gender, setGender] = useState<Tee>("M");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editHcp, setEditHcp] = useState<string>("");
  const [editGender, setEditGender] = useState<Tee>("M");

  async function loadPlayers() {
    setLoading(true);
    setErrorMsg("");

    try {
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
    return toHcp1dpOrNull(hcp) != null;
  }, [name, hcp, saving]);

  async function addPlayer() {
    setErrorMsg("");
    const n = toHcp1dpOrNull(hcp);

    if (!name.trim() || n == null) {
      setErrorMsg("Enter a name and a valid starting handicap (0+ with up to 1 decimal place).");
      return;
    }

    setSaving(true);
    try {
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
    const v = p.starting_handicap ?? p.start_handicap;
    return Number.isFinite(Number(v)) ? Number(v) : 0;
  }

  function beginEdit(p: Player) {
    setEditingId(p.id);
    setEditHcp(fmt1dp(effectiveHcp(p)));
    setEditGender(p.gender ? normalizeGender(p.gender) : "M");
  }

  async function saveEdit(playerId: string) {
    setErrorMsg("");
    const n = toHcp1dpOrNull(editHcp);

    if (n == null) {
      setErrorMsg("Enter a valid starting handicap (0+ with up to 1 decimal place).");
      return;
    }

    setSaving(true);
    try {
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
    <div className="space-y-3">
      <div className="text-sm opacity-70">
        <Link className="underline" href="/m/admin">
          ← Admin hub
        </Link>{" "}
        <span className="opacity-50">/</span> Players
      </div>

      {errorMsg ? (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-semibold">Error</div>
          <div className="mt-1">{errorMsg}</div>
        </div>
      ) : null}

      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="text-lg font-semibold">Add player</div>

        <div className="space-y-2">
          <label className="block">
            <div className="text-xs font-semibold text-gray-700">Name</div>
            <input
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              placeholder="Player name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
            />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <div className="text-xs font-semibold text-gray-700">Gender</div>
              <select
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                value={gender}
                onChange={(e) => setGender(normalizeGender(e.target.value))}
                disabled={saving}
              >
                <option value="M">M</option>
                <option value="F">F</option>
              </select>
            </label>

            <label className="block">
              <div className="text-xs font-semibold text-gray-700">Starting HCP</div>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm text-right"
                placeholder="e.g. 11.5"
                value={hcp}
                onChange={(e) => setHcp(e.target.value)}
                inputMode="decimal"
                pattern="^\d+(\.\d{0,1})?$"
                disabled={saving}
              />
            </label>
          </div>

          <button
            className="w-full rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={!canAdd}
            onClick={() => void addPlayer()}
          >
            {saving ? "Saving…" : "Add player"}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border bg-white">
        <div className="p-4 flex items-center justify-between">
          <div className="text-lg font-semibold">Players</div>
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            onClick={() => void loadPlayers()}
            disabled={saving || loading}
          >
            Refresh
          </button>
        </div>

        {loading ? <div className="px-4 pb-4 text-sm opacity-70">Loading…</div> : null}
        {!loading && players.length === 0 ? <div className="px-4 pb-4 text-sm opacity-70">No players yet.</div> : null}

        <ul className="divide-y">
          {players.map((p) => {
            const isEditing = editingId === p.id;

            return (
              <li key={p.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{p.name}</div>
                    <div className="text-xs text-gray-600 mt-1">
                      Gender: <span className="font-medium">{p.gender ?? "—"}</span> · HCP:{" "}
                      <span className="font-medium tabular-nums">{fmt1dp(effectiveHcp(p))}</span>
                    </div>
                  </div>

                  {!isEditing ? (
                    <button
                      className="text-sm underline underline-offset-4 disabled:opacity-50"
                      disabled={saving}
                      onClick={() => beginEdit(p)}
                    >
                      Edit
                    </button>
                  ) : null}
                </div>

                {isEditing ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="block">
                      <div className="text-xs font-semibold text-gray-700">Gender</div>
                      <select
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        value={editGender}
                        onChange={(e) => setEditGender(normalizeGender(e.target.value))}
                        disabled={saving}
                      >
                        <option value="M">M</option>
                        <option value="F">F</option>
                      </select>
                    </label>

                    <label className="block">
                      <div className="text-xs font-semibold text-gray-700">Starting HCP</div>
                      <input
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm text-right"
                        value={editHcp}
                        onChange={(e) => setEditHcp(e.target.value)}
                        inputMode="decimal"
                        pattern="^\d+(\.\d{0,1})?$"
                        disabled={saving}
                      />
                    </label>

                    <div className="col-span-2 flex gap-2">
                      <button
                        className="flex-1 rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
                        disabled={saving}
                        onClick={() => void saveEdit(p.id)}
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button
                        className="flex-1 rounded-xl border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
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
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="text-xs text-gray-500">
        This page keeps <code className="px-1 rounded bg-gray-100">starting_handicap</code> and legacy{" "}
        <code className="px-1 rounded bg-gray-100">start_handicap</code> in sync.
      </div>
    </div>
  );
}