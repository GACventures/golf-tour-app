// app/m/tours/[id]/matches/format/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RoundRow = {
  id: string;
  tour_id: string;
  course_id: string | null;
  round_no?: number | null;

  round_date?: string | null;
  played_on?: string | null;
  created_at: string | null;

  courses?: { name: string } | { name: string }[] | null;
};

function getCourseName(r: RoundRow) {
  const c: any = r.courses;
  if (!c) return "Course";
  if (Array.isArray(c)) return c?.[0]?.name ?? "Course";
  return c?.name ?? "Course";
}

function pickBestRoundDateISO(r: RoundRow): string | null {
  return r.round_date ?? r.played_on ?? r.created_at ?? null;
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

function isMissingColumnError(msg: string, column: string) {
  const m = msg.toLowerCase();
  const c = column.toLowerCase();
  return m.includes("does not exist") && (m.includes(`.${c}`) || m.includes(`"${c}"`) || m.includes(` ${c} `) || m.includes(`_${c}`));
}

export default function MatchesFormatRoundsPage() {
  const params = useParams<{ id?: string }>();
  const tourId = String(params?.id ?? "").trim();
  const router = useRouter();

  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let alive = true;

    async function fetchRounds(selectCols: string) {
      return supabase
        .from("rounds")
        .select(selectCols)
        .eq("tour_id", tourId)
        .order("round_no", { ascending: true })
        .order("created_at", { ascending: true });
    }

    async function loadRounds() {
      setLoading(true);
      setErrorMsg("");

      const baseCols = "id,tour_id,course_id,created_at,round_no,courses(name)";
      const cols1 = `${baseCols},round_date,played_on`;
      const cols2 = `${baseCols},played_on`;

      const r1 = await fetchRounds(cols1);
      if (!alive) return;

      if (!r1.error) {
        setRounds((r1.data ?? []) as any);
        setLoading(false);
        return;
      }

      if (isMissingColumnError(r1.error.message, "round_date")) {
        const r2 = await fetchRounds(cols2);
        if (!alive) return;

        if (!r2.error) {
          setRounds((r2.data ?? []) as any);
          setLoading(false);
          return;
        }

        if (isMissingColumnError(r2.error.message, "played_on")) {
          const r3 = await fetchRounds(baseCols);
          if (!alive) return;

          if (!r3.error) {
            setRounds((r3.data ?? []) as any);
            setLoading(false);
            return;
          }

          setErrorMsg(r3.error.message);
        } else {
          setErrorMsg(r2.error.message);
        }
      } else {
        setErrorMsg(r1.error.message);
      }

      setRounds([]);
      setLoading(false);
    }

    if (tourId) void loadRounds();
    else {
      setErrorMsg("Missing tour id in route.");
      setLoading(false);
    }

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
      return a.id.localeCompare(b.id);
    });
    return arr;
  }, [rounds]);

  function openRound(roundId: string) {
    router.push(`/m/tours/${tourId}/matches/format/${roundId}`);
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-10">
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold">Matches – Format</div>
            <div className="truncate text-sm text-gray-500">Choose a round</div>
          </div>

          <Link
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm active:bg-gray-50"
            href={`/m/tours/${tourId}/rounds`}
          >
            Back
          </Link>
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
          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700">No rounds found.</div>
        ) : (
          <div className="space-y-2">
            {sorted.map((r, idx) => {
              const rn = r.round_no ?? idx + 1;
              const label = `Round ${rn}`;
              const best = pickBestRoundDateISO(r);
              const d = fmtAuMelbourneDate(parseDateForDisplay(best));
              const course = getCourseName(r);

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
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-3 text-[11px] text-gray-400">Dates shown in Australia/Melbourne.</div>
      </main>
    </div>
  );
}
