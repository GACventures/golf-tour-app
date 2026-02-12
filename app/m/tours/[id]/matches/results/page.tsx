"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import MobileNav from "@/app/m/tours/[id]/_components/MobileNav";

type RoundRow = {
  id: string;
  tour_id: string;
  course_id: string | null;
  round_no?: number | null;
  round_date?: string | null; // may not exist
  played_on?: string | null; // may not exist
  created_at: string | null;
  name?: string | null;
  courses?: { name: string } | { name: string }[] | null;
};

type SettingsRow = {
  round_id: string;
  format: "INDIVIDUAL_MATCHPLAY" | "BETTERBALL_MATCHPLAY" | "INDIVIDUAL_STABLEFORD";
  double_points: boolean;
};

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isMissingColumnError(msg: string, column: string) {
  const m = String(msg ?? "").toLowerCase();
  const c = column.toLowerCase();
  return m.includes("does not exist") && (m.includes(`.${c}`) || m.includes(`"${c}"`) || m.includes(` ${c} `));
}

function getCourseName(r: RoundRow) {
  const c: any = r.courses;
  if (!c) return "Course";
  if (Array.isArray(c)) return c?.[0]?.name ?? "Course";
  return c?.name ?? "Course";
}

function pickBestRoundDateISO(r: RoundRow): string | null {
  return (r as any).round_date ?? (r as any).played_on ?? r.created_at ?? null;
}

function parseDateForDisplay(s: string | null): Date | null {
  if (!s) return null;
  const raw = String(s).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const iso = isDateOnly ? `${raw}T00:00:00.000Z` : raw;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtAuMelbourneDate(d: Date | null): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}`.replace(/\s+/g, " ");
}

function formatLabel(f: SettingsRow["format"]) {
  if (f === "INDIVIDUAL_MATCHPLAY") return "Ind Matchplay";
  if (f === "BETTERBALL_MATCHPLAY") return "Better Ball";
  return "Ind Stableford";
}

export default function MatchesResultsRoundsPage() {
  const params = useParams<{ id?: string }>();
  const tourId = String(params?.id ?? "").trim();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [settingsByRound, setSettingsByRound] = useState<Map<string, SettingsRow>>(new Map());

  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    let alive = true;

    async function fetchRounds(selectCols: string) {
      return supabase
        .from("rounds")
        .select(selectCols)
        .eq("tour_id", tourId)
        .order("round_no", { ascending: true })
        .order("created_at", { ascending: true });
    }

    async function load() {
      setLoading(true);
      setErrorMsg("");

      try {
        const baseCols = "id,tour_id,course_id,created_at,name,round_no,courses(name)";
        const cols1 = `${baseCols},round_date,played_on`;
        const cols2 = `${baseCols},played_on`;

        let rRows: RoundRow[] = [];

        const r1 = await fetchRounds(cols1);
        if (!r1.error) {
          rRows = (r1.data ?? []) as any;
        } else if (isMissingColumnError(r1.error.message, "round_date")) {
          const r2 = await fetchRounds(cols2);
          if (!r2.error) {
            rRows = (r2.data ?? []) as any;
          } else if (isMissingColumnError(r2.error.message, "played_on")) {
            const r3 = await fetchRounds(baseCols);
            if (r3.error) throw r3.error;
            rRows = (r3.data ?? []) as any;
          } else {
            throw r2.error;
          }
        } else {
          throw r1.error;
        }

        // settings for rounds (optional)
        const { data: sRows, error: sErr } = await supabase
          .from("match_round_settings")
          .select("round_id,format,double_points")
          .eq("tour_id", tourId);

        if (sErr) throw sErr;

        const map = new Map<string, SettingsRow>();
        (sRows ?? []).forEach((s: any) => {
          map.set(String(s.round_id), {
            round_id: String(s.round_id),
            format: s.format,
            double_points: s.double_points === true,
          });
        });

        if (!alive) return;
        setRounds(rRows);
        setSettingsByRound(map);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load rounds.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [tourId]);

  const sorted = useMemo(() => {
    const arr = [...rounds];
    arr.sort((a, b) => {
      const aNo = typeof a.round_no === "number" ? a.round_no : null;
      const bNo = typeof b.round_no === "number" ? b.round_no : null;

      if (aNo != null && bNo != null && aNo !== bNo) return aNo - bNo;
      if (aNo != null && bNo == null) return -1;
      if (aNo == null && bNo != null) return 1;

      const da = parseDateForDisplay(a.created_at)?.getTime() ?? 0;
      const db = parseDateForDisplay(b.created_at)?.getTime() ?? 0;
      if (da !== db) return da - db;

      return a.id.localeCompare(b.id);
    });
    return arr;
  }, [rounds]);

  function openRound(roundId: string) {
    router.push(`/m/tours/${tourId}/matches/results/${roundId}`);
  }

  if (!tourId || !isLikelyUuid(tourId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900 pb-24">
        <div className="mx-auto max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">
            Missing or invalid tour id.
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
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between">
          <div className="text-base font-semibold">Matchplay results</div>
          <div />
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-12 rounded-2xl bg-gray-100" />
            <div className="h-12 rounded-2xl bg-gray-100" />
            <div className="h-12 rounded-2xl bg-gray-100" />
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorMsg}</div>
        ) : sorted.length === 0 ? (
          <div className="text-sm text-gray-600">No rounds yet.</div>
        ) : (
          <div className="space-y-2">
            {sorted.map((r, idx) => {
              const rn = r.round_no ?? idx + 1;
              const label = `Round ${rn}`;
              const best = pickBestRoundDateISO(r);
              const d = fmtAuMelbourneDate(parseDateForDisplay(best));
              const course = getCourseName(r);

              const set = settingsByRound.get(r.id) ?? null;

              return (
                <button
                  key={r.id}
                  className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm active:bg-gray-50"
                  onClick={() => openRound(r.id)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-extrabold text-gray-900">{label}</div>
                    <div className="text-xs font-semibold text-gray-600 whitespace-nowrap">{d || "—"}</div>
                  </div>

                  <div className="mt-1 text-sm font-semibold text-gray-900 truncate">{course}</div>

                  <div className="mt-1 text-[11px] text-gray-600">
                    {set ? (
                      <>
                        Format: <span className="font-semibold">{formatLabel(set.format)}</span>
                        {set.double_points ? <span className="ml-2 font-semibold">· Double points</span> : null}
                      </>
                    ) : (
                      <span className="text-gray-500">No match format set for this round</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
