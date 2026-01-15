// app/m/tours/[id]/rounds/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RoundRow = {
  id: string;
  tour_id: string;
  course_id: string | null;

  round_date?: string | null;
  played_on?: string | null;
  created_at: string | null;

  name?: string | null;
  courses?: { name: string } | { name: string }[] | null;
};

type Mode = "tee-times" | "score" | "results";

function getCourseName(r: RoundRow) {
  const c: any = r.courses;
  if (!c) return "Course";
  if (Array.isArray(c)) return c?.[0]?.name ?? "Course";
  return c?.name ?? "Course";
}

function normalizeMode(raw: string | null): Mode {
  if (raw === "tee-times" || raw === "score" || raw === "results") return raw;
  // DEFAULT = tee-times (black)
  return "tee-times";
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
  return m.includes("does not exist") && (m.includes(`.${c}`) || m.includes(`"${c}"`) || m.includes(` ${c} `));
}

export default function MobileRoundsHubPage() {
  const params = useParams<{ id: string }>();
  const tourId = params?.id ?? "";
  const router = useRouter();
  const sp = useSearchParams();

  const mode = normalizeMode(sp.get("mode"));

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
        .order("created_at", { ascending: true });
    }

    async function loadRounds() {
      setLoading(true);
      setErrorMsg("");

      const baseCols = "id,tour_id,course_id,created_at,name,courses(name)";
      const cols1 = `${baseCols},round_date,played_on`;
      const cols2 = `${baseCols},played_on`;

      let rows: RoundRow[] = [];

      const r1 = await fetchRounds(cols1);
      if (!alive) return;

      if (!r1.error) {
        rows = (r1.data ?? []) as unknown as RoundRow[];
        setRounds(rows);
        setLoading(false);
        return;
      }

      if (isMissingColumnError(r1.error.message, "round_date")) {
        const r2 = await fetchRounds(cols2);
        if (!alive) return;

        if (!r2.error) {
          rows = (r2.data ?? []) as unknown as RoundRow[];
          setRounds(rows);
          setLoading(false);
          return;
        }

        if (isMissingColumnError(r2.error.message, "played_on")) {
          const r3 = await fetchRounds(baseCols);
          if (!alive) return;

          if (!r3.error) {
            rows = (r3.data ?? []) as unknown as RoundRow[];
            setRounds(rows);
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

    if (tourId) loadRounds();
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
      const da = parseDateForDisplay(a.created_at)?.getTime() ?? 0;
      const db = parseDateForDisplay(b.created_at)?.getTime() ?? 0;
      if (da !== db) return da - db;
      return a.id.localeCompare(b.id);
    });
    return arr;
  }, [rounds]);

  function setMode(next: Mode) {
    const usp = new URLSearchParams(sp.toString());
    usp.set("mode", next);
    router.replace(`/m/tours/${tourId}/rounds?${usp.toString()}`);
  }

  function openRound(roundId: string) {
    const base = `/m/tours/${tourId}/rounds/${roundId}`;
    const href =
      mode === "tee-times"
        ? `${base}/tee-times`
        : mode === "results"
        ? `${base}/results`
        : `${base}/scoring`;

    router.push(href);
  }

  const pillBase = "flex-1 h-10 rounded-xl border text-sm font-semibold flex items-center justify-center";
  const pillActive = "border-gray-900 bg-gray-900 text-white";
  const pillIdle = "border-gray-200 bg-white text-gray-900";

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      <div className="border-b bg-white">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-base font-semibold">Rounds</div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-4 pt-4">
        <div className="flex gap-2">
          <button
            className={`${pillBase} ${mode === "tee-times" ? pillActive : pillIdle}`}
            onClick={() => setMode("tee-times")}
          >
            Tee times
          </button>
          <button
            className={`${pillBase} ${mode === "score" ? pillActive : pillIdle}`}
            onClick={() => setMode("score")}
          >
            Score Entry
          </button>
          <button
            className={`${pillBase} ${mode === "results" ? pillActive : pillIdle}`}
            onClick={() => setMode("results")}
          >
            Results
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md px-4 pt-4 pb-28">
        {loading ? (
          <div className="space-y-3">
            <div className="h-12 rounded-2xl bg-gray-100" />
            <div className="h-12 rounded-2xl bg-gray-100" />
            <div className="h-12 rounded-2xl bg-gray-100" />
          </div>
        ) : errorMsg ? (
          <div className="text-sm text-red-700">{errorMsg}</div>
        ) : sorted.length === 0 ? (
          <div className="text-sm text-gray-600">No rounds yet.</div>
        ) : (
          <div className="space-y-2">
            {sorted.map((r, idx) => {
              const label = `Round ${idx + 1}`;
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
      </div>
    </div>
  );
}
