"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import MobileNav from "../../_components/MobileNav";

// ✅ Updated import path per your note: lib/handicaps/recalc...
import { recalcAndSaveTourHandicaps } from "@/lib/handicaps/recalcAndSaveTourHandicaps";

type Tour = { id: string; name: string };

type PlayerRow = {
  id: string;
  name: string;
};

type TourPlayerRow = {
  tour_id: string;
  player_id: string;
  starting_handicap: number | null;
  players: PlayerRow | PlayerRow[] | null;
};

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function normalizePlayerJoin(val: any): PlayerRow | null {
  if (!val) return null;
  const p = Array.isArray(val) ? val[0] : val;
  if (!p?.id) return null;
  return { id: String(p.id), name: String(p.name ?? "").trim() || "(unnamed)" };
}

function toNullableNumber(v: string): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

export default function MobileTourAdminStartingHandicapsPage() {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rows, setRows] = useState<
    Array<{
      player_id: string;
      name: string;
      starting_handicap: number | null; // last saved value we loaded/committed
      input: string; // editable text
      dirty: boolean;
    }>
  >([]);

  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    let alive = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");
      setSaveMsg("");

      try {
        const { data: tData, error: tErr } = await supabase.from("tours").select("id,name").eq("id", tourId).single();
        if (tErr) throw tErr;

        const { data: tpData, error: tpErr } = await supabase
          .from("tour_players")
          .select("tour_id,player_id,starting_handicap,players(id,name)")
          .eq("tour_id", tourId)
          .order("name", { ascending: true, foreignTable: "players" });

        if (tpErr) throw tpErr;

        const list = (tpData ?? [])
          .map((r: any) => {
            const p = normalizePlayerJoin(r.players);
            const pid = String(r.player_id ?? p?.id ?? "");
            if (!pid) return null;

            const sh = Number.isFinite(Number(r.starting_handicap)) ? Math.max(0, Math.floor(Number(r.starting_handicap))) : null;

            return {
              player_id: pid,
              name: p?.name ?? "(player)",
              starting_handicap: sh,
              input: sh == null ? "" : String(sh),
              dirty: false,
            };
          })
          .filter(Boolean) as any[];

        if (!alive) return;
        setTour(tData as Tour);
        setRows(list);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load Tour Admin page.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [tourId]);

  const dirtyCount = useMemo(() => rows.filter((r) => r.dirty).length, [rows]);

  function setRowInput(playerId: string, next: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.player_id !== playerId) return r;
        const base = r.starting_handicap == null ? "" : String(r.starting_handicap);
        return { ...r, input: next, dirty: next.trim() !== base };
      })
    );
  }

  async function saveAll() {
    setSaving(true);
    setErrorMsg("");
    setSaveMsg("");

    try {
      const updates = rows
        .filter((r) => r.dirty)
        .map((r) => ({
          tour_id: tourId,
          player_id: r.player_id,
          starting_handicap: toNullableNumber(r.input),
        }));

      if (updates.length === 0) {
        setSaveMsg("No changes to save.");
        setSaving(false);
        return;
      }

      // 1) Save tour-level starting handicap
      const { error: upErr } = await supabase.from("tour_players").upsert(updates, {
        onConflict: "tour_id,player_id",
      });
      if (upErr) throw upErr;

      // 2) Recalc + save per-round playing handicaps using your rehandicapping engine.
      //    This ensures Round 1 picks up the new starting handicap,
      //    and later rounds get recalculated according to the rule.
      const recalcRes = await recalcAndSaveTourHandicaps({ supabase, tourId });
      if (!recalcRes.ok) throw new Error(recalcRes.error);

      // Mark clean locally
      setRows((prev) =>
        prev.map((r) => {
          const u = updates.find((x) => x.player_id === r.player_id);
          if (!u) return r;
          return {
            ...r,
            starting_handicap: u.starting_handicap,
            input: u.starting_handicap == null ? "" : String(u.starting_handicap),
            dirty: false,
          };
        })
      );

      setSaveMsg(
        `Saved ${updates.length} change${updates.length === 1 ? "" : "s"}. Rehandicapping recalculated and updated ${recalcRes.updated} round_player row${
          recalcRes.updated === 1 ? "" : "s"
        }.`
      );
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function goBack() {
    router.push(`/m/tours/${tourId}/more`);
  }

  if (!tourId || !isLikelyUuid(tourId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900 pb-24">
        <div className="mx-auto max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">
            Missing or invalid tour id in route.
            <div className="mt-2">
              <Link className="underline" href="/m">
                Go to mobile home
              </Link>
            </div>
          </div>
        </div>
        <MobileNav />
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-gray-900">Tour Admin</div>
            <div className="truncate text-sm text-gray-500">{tour?.name ?? ""}</div>
          </div>

          <button
            type="button"
            onClick={goBack}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm active:bg-gray-50"
          >
            Back
          </button>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4 space-y-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-5 w-40 rounded bg-gray-100" />
            <div className="h-64 rounded-2xl border bg-white" />
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorMsg}</div>
        ) : (
          <>
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Tour starting handicaps</div>
                <div className="mt-1 text-xs text-gray-600">
                  Saves <span className="font-medium">tour_players.starting_handicap</span>, then recalculates{" "}
                  <span className="font-medium">round_players.playing_handicap</span> using the tour’s rehandicapping rule.
                </div>
              </div>

              {rows.length === 0 ? (
                <div className="p-4 text-sm text-gray-700">No players found for this tour.</div>
              ) : (
                <div className="divide-y">
                  {rows.map((r) => (
                    <div key={r.player_id} className="p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-gray-900">{r.name}</div>
                        {r.dirty ? <div className="text-[11px] text-amber-700">Unsaved</div> : null}
                      </div>

                      <input
                        inputMode="numeric"
                        pattern="[0-9]*"
                        className="w-24 rounded-xl border border-gray-200 bg-white px-3 py-2 text-right text-sm font-semibold text-gray-900 shadow-sm"
                        value={r.input}
                        onChange={(e) => setRowInput(r.player_id, e.target.value)}
                        placeholder="—"
                        aria-label={`Starting handicap for ${r.name}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-gray-600">
                {dirtyCount > 0 ? `${dirtyCount} change${dirtyCount === 1 ? "" : "s"} pending` : "No pending changes"}
              </div>

              <button
                type="button"
                onClick={saveAll}
                disabled={saving || dirtyCount === 0}
                className={`h-10 rounded-xl px-4 text-sm font-semibold border shadow-sm ${
                  saving || dirtyCount === 0
                    ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "border-gray-900 bg-gray-900 text-white active:bg-gray-800"
                }`}
              >
                {saving ? "Saving…" : "Save all"}
              </button>
            </div>

            {saveMsg ? <div className="text-sm text-green-700">{saveMsg}</div> : null}
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
