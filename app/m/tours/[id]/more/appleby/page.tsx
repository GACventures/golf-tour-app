// app/m/tours/[id]/more/appleby/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";


import { supabase } from "@/lib/supabaseClient";
import { applyApplebyHandicaps, loadApplebyTourData, type ApplebyRoundKey } from "@/lib/handicaps/appleby";

const APPLEBY_TOUR_ID = "5a80b049-396f-46ec-965e-810e738471b6";
const ROUND_KEYS: ApplebyRoundKey[] = [3, 6, 9, 12];

function fmt1dp(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return Number(n).toFixed(1);
}

function fmtAdj(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  const v = Number(n);
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}`;
}

export default function MobileApplebyPage() {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [tourName, setTourName] = useState("");
  const [rounds, setRounds] = useState<any[]>([]);
  const [players, setPlayers] = useState<any[]>([]);
  const [canUpdate, setCanUpdate] = useState(false);
  const [cannotReason, setCannotReason] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [saveErr, setSaveErr] = useState("");

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErr("");
      setMsg("");
      setSaveErr("");

      if (!tourId || tourId !== APPLEBY_TOUR_ID) {
        setErr("This page is only available for the New Zealand Golf Tour 2026.");
        setLoading(false);
        return;
      }

      const res = await loadApplebyTourData({ supabase, tourId });
      if (!alive) return;

      if (!res.ok) {
        setErr(res.error);
        setLoading(false);
        return;
      }

      setTourName(res.tourName);
      setRounds(res.rounds);
      setPlayers(res.players);
      setCanUpdate(res.canUpdate);
      setCannotReason(res.cannotUpdateReason);
      setLoading(false);
    }

    void load();
    return () => {
      alive = false;
    };
  }, [tourId]);

  const cutoffByRound = useMemo(() => {
    const m: Record<number, number | null> = {};
    for (const k of ROUND_KEYS) {
      const any = players.find((p: any) => p.cutoffByRound?.[k] != null);
      m[k] = any ? Number(any.cutoffByRound[k]) : null;
    }
    return m as Record<ApplebyRoundKey, number | null>;
  }, [players]);

  async function onUpdate() {
    setSaving(true);
    setMsg("");
    setSaveErr("");

    try {
      const res = await applyApplebyHandicaps({ supabase, tourId, rounds, players });
      if (!res.ok) throw new Error(res.error);

      setMsg(`Updated round handicaps for this tour (${res.updated} round_player rows).`);
    } catch (e: any) {
      setSaveErr(e?.message ?? "Update failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-gray-900 truncate">Appleby system</div>
            <div className="text-[11px] text-gray-500 truncate">{tourName || "New Zealand Golf Tour 2026"}</div>
          </div>

          <Link
            href={`/m/tours/${tourId}/more/rehandicapping`}
            className="h-9 rounded-xl border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-900 flex items-center justify-center active:bg-gray-50"
          >
            Back
          </Link>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4 space-y-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-5 w-40 rounded bg-gray-100" />
            <div className="h-40 rounded-2xl border bg-white" />
            <div className="h-64 rounded-2xl border bg-white" />
          </div>
        ) : err ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{err}</div>
        ) : (
          <>
            {/* 1) Summary */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4">
              <div className="text-sm font-semibold text-gray-900">How the Appleby system works</div>
              <div className="mt-2 text-sm text-gray-700 space-y-2">
                <p>
                  For rounds 1–3, everyone plays off their tour starting handicap rounded to the nearest whole number (0.5 rounds up).
                </p>
                <p>
                  After rounds 3, 6, 9 and 12, a new adjustment is worked out from that day’s Stableford scores. Each point better or worse
                  than the day’s sixth-best score changes the adjustment by <span className="font-medium">0.1</span>.
                </p>
                <p>
                  That adjustment is added to the player’s exact tour starting handicap (kept to one decimal place), then the result is rounded
                  to the nearest whole number to get the playing handicap used for the next block of rounds.
                </p>
                <p>
                  Adjustments build up over time, but the cumulative adjustment is capped at <span className="font-medium">+3.0</span> or{" "}
                  <span className="font-medium">−3.0</span>. If the cap reduces an adjustment, it is marked with an asterisk (*).
                </p>
              </div>
            </section>

            {/* 2) Table */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Appleby calculation table</div>
                <div className="mt-1 text-[11px] text-gray-500">
                  Dotted outline marks the 6th-best score (all tied at the cutoff). Asterisk (*) means the ±3.0 cap reduced that step.
                </div>
              </div>

              {players.length === 0 ? (
                <div className="p-4 text-sm text-gray-700">No players found for this tour.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[1320px] w-full border-collapse">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="sticky left-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700">
                          Player
                        </th>

                        {/* Scores */}
                        {ROUND_KEYS.map((k) => (
                          <th key={`sc_${k}`} className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700 whitespace-nowrap">
                            R{k} score
                          </th>
                        ))}

                        {/* Adjustments */}
                        {ROUND_KEYS.map((k) => (
                          <th key={`adj_${k}`} className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700 whitespace-nowrap">
                            Adj after R{k}
                          </th>
                        ))}

                        <th className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700 whitespace-nowrap">
                          Start (exact)
                        </th>

                        {/* Start + adj */}
                        {ROUND_KEYS.map((k) => (
                          <th key={`spa_${k}`} className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700 whitespace-nowrap">
                            Start + adj (after R{k})
                          </th>
                        ))}

                        {/* Rounded */}
                        {ROUND_KEYS.map((k) => (
                          <th key={`rnd_${k}`} className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700 whitespace-nowrap">
                            Rounded (after R{k})
                          </th>
                        ))}
                      </tr>
                    </thead>

                    <tbody>
                      {players.map((p: any) => (
                        <tr key={p.player_id} className="border-b last:border-b-0">
                          <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap">
                            {p.name}
                          </td>

                          {/* Scores */}
                          {ROUND_KEYS.map((k) => {
                            const v = p.scoreByRound?.[k] ?? null;
                            const isCut = p.isCutoffScoreByRound?.[k] === true;
                            return (
                              <td key={`v_${p.player_id}_${k}`} className="px-3 py-2 text-right text-sm tabular-nums text-gray-900">
                                <span className={isCut ? "inline-block px-1 rounded border border-dotted border-gray-900" : ""}>
                                  {v == null ? "—" : String(v)}
                                </span>
                              </td>
                            );
                          })}

                          {/* Adjustments */}
                          {ROUND_KEYS.map((k) => {
                            const v = p.adjStep?.[k] ?? null;
                            const star = p.adjStepStar?.[k] === true;
                            return (
                              <td key={`a_${p.player_id}_${k}`} className="px-3 py-2 text-right text-sm tabular-nums text-gray-900 whitespace-nowrap">
                                {fmtAdj(v)}
                                {star ? <span className="ml-1 font-semibold">*</span> : null}
                              </td>
                            );
                          })}

                          <td className="px-3 py-2 text-right text-sm tabular-nums text-gray-900">{fmt1dp(p.start_exact_1dp)}</td>

                          {/* Start + adj */}
                          {ROUND_KEYS.map((k) => (
                            <td key={`sp_${p.player_id}_${k}`} className="px-3 py-2 text-right text-sm tabular-nums text-gray-900">
                              {fmt1dp(p.startPlusAfter?.[k] ?? null)}
                            </td>
                          ))}

                          {/* Rounded */}
                          {ROUND_KEYS.map((k) => (
                            <td key={`r_${p.player_id}_${k}`} className="px-3 py-2 text-right text-sm tabular-nums text-gray-900">
                              {p.startPlusAfterRounded?.[k] == null ? "—" : String(p.startPlusAfterRounded[k])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div className="px-4 py-3 text-[11px] text-gray-600">
                    Cutoffs:{" "}
                    {ROUND_KEYS.map((k, idx) => (
                      <span key={`c_${k}`} className="mr-2">
                        R{k}: <span className="font-semibold">{cutoffByRound[k] == null ? "—" : cutoffByRound[k]}</span>
                        {idx < ROUND_KEYS.length - 1 ? "," : ""}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* 3) Update button */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm p-4 space-y-3">
              <div className="text-sm font-semibold text-gray-900">Apply Appleby handicaps to rounds</div>
              <div className="text-xs text-gray-600">
                This will update round playing handicaps (whole numbers) for all existing rounds in this tour. It does not change who is marked
                as playing.
              </div>

              {!canUpdate ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{cannotReason ?? "Cannot update."}</div>
              ) : null}

              {saveErr ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{saveErr}</div>
              ) : null}

              {msg ? <div className="text-sm text-green-700">{msg}</div> : null}

              <button
                type="button"
                disabled={saving || !canUpdate}
                onClick={onUpdate}
                className={`h-11 w-full rounded-xl px-4 text-sm font-semibold border shadow-sm ${
                  saving || !canUpdate
                    ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "border-gray-900 bg-gray-900 text-white active:bg-gray-800"
                }`}
              >
                {saving ? "Updating…" : "Update handicaps?"}
              </button>

              <button
                type="button"
                onClick={() => router.push(`/m/tours/${tourId}/more/rehandicapping`)}
                className="h-11 w-full rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 active:bg-gray-50"
              >
                Back to rehandicapping
              </button>
            </section>
          </>
        )}
      </main>

     
    </div>
  );
}
