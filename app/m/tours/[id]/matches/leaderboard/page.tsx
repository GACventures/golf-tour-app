// app/m/tours/[id]/matches/leaderboard/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Tee = "M" | "F";

type Tour = {
  id: string;
  name: string | null;
};

type RoundRow = {
  id: string;
  round_no: number | null;
  round_date?: string | null;
  played_on?: string | null;
  created_at?: string | null;
  courses?: { name: string } | { name: string }[] | null;
};

type GroupRow = {
  id: string;
  name: string | null;
};

type MatchFormat = "INDIVIDUAL_MATCHPLAY" | "BETTERBALL_MATCHPLAY" | "INDIVIDUAL_STABLEFORD";

type SettingsRow = {
  id: string;
  tour_id: string;
  round_id: string;
  group_a_id: string;
  group_b_id: string;
  format: MatchFormat;
  double_points: boolean;
  rounds?: RoundRow | RoundRow[] | null;
  group_a?: GroupRow | GroupRow[] | null;
  group_b?: GroupRow | GroupRow[] | null;
};

function safeName(v: any, fallback: string) {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function normalizeJoin<T>(val: any): T | null {
  if (!val) return null;
  return (Array.isArray(val) ? val[0] : val) as T;
}

function pickBestRoundDateISO(r: RoundRow): string | null {
  return (r.round_date ?? r.played_on ?? r.created_at ?? null) as any;
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

function formatLabel(f: MatchFormat) {
  switch (f) {
    case "INDIVIDUAL_MATCHPLAY":
      return "Individual matchplay";
    case "BETTERBALL_MATCHPLAY":
      return "Better ball matchplay";
    case "INDIVIDUAL_STABLEFORD":
      return "Individual stableford";
    default:
      return f;
  }
}

export default function MobileMatchesLeaderboardPage() {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [settings, setSettings] = useState<SettingsRow[]>([]);
  const [matchCounts, setMatchCounts] = useState<Map<string, number>>(new Map()); // settings_id -> count

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");

      try {
        const { data: tRow, error: tErr } = await supabase
          .from("tours")
          .select("id,name")
          .eq("id", tourId)
          .single();
        if (tErr) throw tErr;

        // Load per-round settings with round + group names (read-only scaffold)
        const { data: sRows, error: sErr } = await supabase
          .from("match_round_settings")
          .select(
            `
            id,tour_id,round_id,group_a_id,group_b_id,format,double_points,
            rounds(id,round_no,round_date,played_on,created_at,courses(name)),
            group_a:tour_groups!match_round_settings_group_a_id_fkey(id,name),
            group_b:tour_groups!match_round_settings_group_b_id_fkey(id,name)
          `
          )
          .eq("tour_id", tourId);

        if (sErr) throw sErr;

        const sList = (sRows ?? []) as unknown as SettingsRow[];

        // Count matches per setting (so user can see if match assignments are done)
        const counts = new Map<string, number>();
        if (sList.length > 0) {
          const settingIds = sList.map((s) => s.id);

          const { data: mRows, error: mErr } = await supabase
            .from("match_round_matches")
            .select("settings_id", { count: "exact" })
            .in("settings_id", settingIds);

          if (mErr) throw mErr;

          // Supabase doesn't group-count in one call; we compute counts client-side.
          (mRows ?? []).forEach((r: any) => {
            const sid = String(r.settings_id);
            counts.set(sid, (counts.get(sid) ?? 0) + 1);
          });
        }

        if (!alive) return;

        setTour(tRow as Tour);
        setSettings(sList);
        setMatchCounts(counts);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load Matches leaderboard.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    if (tourId) void load();
    else {
      setErrorMsg("Missing tour id in route.");
      setLoading(false);
    }

    return () => {
      alive = false;
    };
  }, [tourId]);

  const sorted = useMemo(() => {
    const arr = [...settings];
    arr.sort((a, b) => {
      const ra = normalizeJoin<RoundRow>(a.rounds);
      const rb = normalizeJoin<RoundRow>(b.rounds);
      const aNo = ra?.round_no ?? 9999;
      const bNo = rb?.round_no ?? 9999;
      if (aNo !== bNo) return aNo - bNo;
      return a.id.localeCompare(b.id);
    });
    return arr;
  }, [settings]);

  function goBack() {
    router.push(`/m/tours/${tourId}/rounds`);
  }

  const pillBase = "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold";
  const pillDark = "border-gray-900 bg-gray-900 text-white";
  const pillLight = "border-gray-200 bg-white text-gray-900";

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-10">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold">Matches – Leaderboard</div>
            <div className="truncate text-sm text-gray-500">{safeName(tour?.name, "")}</div>
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

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {loading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm">Loading…</div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorMsg}</div>
        ) : sorted.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
            No match formats have been configured yet.
            <div className="mt-2 text-xs text-gray-500">
              Go back to Rounds and choose <span className="font-semibold">Matches – Format</span> to set up a round.
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
              This page is the Matches hub. Next step will be to calculate and display the actual leaderboard points.
              For now it shows which rounds are configured, which teams are playing, and whether match assignments exist.
            </div>

            {sorted.map((s) => {
              const r = normalizeJoin<RoundRow>(s.rounds);
              const ga = normalizeJoin<GroupRow>(s.group_a);
              const gb = normalizeJoin<GroupRow>(s.group_b);

              const roundNo = r?.round_no ?? null;
              const courseName = (() => {
                const c: any = r?.courses;
                if (!c) return "Course";
                if (Array.isArray(c)) return safeName(c?.[0]?.name, "Course");
                return safeName(c?.name, "Course");
              })();

              const best = r ? pickBestRoundDateISO(r) : null;
              const dateStr = fmtAuMelbourneDate(parseDateForDisplay(best));

              const matchCount = matchCounts.get(s.id) ?? 0;

              return (
                <div key={s.id} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-extrabold text-gray-900">
                        {roundNo != null ? `Round ${roundNo}` : "Round"}
                      </div>
                      <div className="mt-1 text-xs font-semibold text-gray-600">{dateStr || "—"}</div>
                      <div className="mt-1 text-sm font-semibold text-gray-900 truncate">{courseName}</div>
                    </div>

                    <div className="shrink-0 flex flex-col items-end gap-2">
                      <span className={`${pillBase} ${pillDark}`}>{formatLabel(s.format)}</span>
                      {s.double_points ? <span className={`${pillBase} ${pillLight}`}>Double points</span> : null}
                    </div>
                  </div>

                  <div className="mt-3 text-sm text-gray-900">
                    <span className="font-semibold">{safeName(ga?.name, "Team A")}</span>{" "}
                    <span className="text-gray-500">vs</span>{" "}
                    <span className="font-semibold">{safeName(gb?.name, "Team B")}</span>
                  </div>

                  <div className="mt-2 text-xs text-gray-600">
                    {s.format === "INDIVIDUAL_STABLEFORD"
                      ? "No match assignments required for this format."
                      : matchCount > 0
                      ? `${matchCount} match${matchCount === 1 ? "" : "es"} created (player assignments next step).`
                      : "No matches created yet (set up player assignments in Matches – Format)."}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 text-[11px] text-gray-400">Dates shown in Australia/Melbourne.</div>
      </main>
    </div>
  );
}
