"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { supabase } from "@/lib/supabaseClient";

/**
 * Supabase joined relations can come back as:
 * - object
 * - array of objects
 * - null
 *
 * Normalize to a single object (first item if array).
 */
function asSingle<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

type CourseRel = { name: string };

type Round = {
  id: string;
  tour_id: string | null;
  name: string;
  course_id: string | null;
  is_locked: boolean | null;

  // ✅ Fix: include played_on in the query below, but also keep it tolerant.
  played_on: string | null;

  // ✅ Robust: relation can be object OR array OR null
  courses?: CourseRel | CourseRel[] | null;
};

export default function RoundPage() {
  const params = useParams();
  const roundId = (params?.id as string) || "";

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [round, setRound] = useState<Round | null>(null);

  useEffect(() => {
    if (!roundId) return;

    let alive = true;

    async function loadRound() {
      setLoading(true);
      setErrorMsg("");

      try {
        // ✅ Fix #1: select played_on so Round matches returned data
        // ✅ Fix #2: select courses(name) and handle array/object with asSingle()
        const { data, error } = await supabase
          .from("rounds")
          .select("id, tour_id, name, course_id, is_locked, played_on, courses ( name )")
          .eq("id", roundId)
          .single();

        if (error) throw error;

        // data is untyped, but we now ensure our Round type matches the selection.
        const r = data as unknown as Round;

        if (!alive) return;
        setRound(r);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load round.");
        setRound(null);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    loadRound();
    return () => {
      alive = false;
    };
  }, [roundId]);

  const courseName = useMemo(() => {
    const c = asSingle(round?.courses);
    return c?.name ?? "(no course)";
  }, [round]);

  const playedOnLabel = useMemo(() => {
    if (!round?.played_on) return "Date: (not set)";
    // Keep formatting simple and safe for build; adjust to your preferred display
    return `Date: ${round.played_on}`;
  }, [round]);

  if (loading) {
    return (
      <div className="p-4">
        <div className="text-sm opacity-70">Loading…</div>
      </div>
    );
  }

  if (!round) {
    return (
      <div className="p-4 space-y-3">
        <div className="text-lg font-semibold">Round</div>
        <div className="text-sm text-red-600">{errorMsg || "Round not found."}</div>
        <Link className="underline text-sm" href="/tours">
          Back to tours
        </Link>
      </div>
    );
  }

  const isLocked = round.is_locked === true;

  return (
    <div className="p-4 space-y-4">
      <header className="space-y-1">
        <div className="text-xl font-semibold">{round.name}</div>
        <div className="text-sm opacity-75">Course: {courseName}</div>
        <div className="text-sm opacity-75">{playedOnLabel}</div>
        <div className="text-sm">
          Status:{" "}
          <span className={isLocked ? "text-red-600" : "text-green-700"}>
            {isLocked ? "Locked" : "Open"}
          </span>
        </div>
        {errorMsg ? <div className="text-sm text-red-600">{errorMsg}</div> : null}
      </header>

      <div className="space-y-2">
        {/* ✅ Mobile flow entry point */}
        <Link
          className="inline-block rounded-md bg-black text-white px-4 py-2 text-sm"
          href={`/rounds/${round.id}/mobile`}
        >
          Mobile scoring
        </Link>

        {/* Handy links (safe even if you don’t have these pages yet) */}
        {round.tour_id ? (
          <Link className="block underline text-sm" href={`/tours/${round.tour_id}/leaderboard`}>
            Tour leaderboard
          </Link>
        ) : null}

        <Link className="block underline text-sm" href={`/tours`}>
          Back to tours
        </Link>
      </div>
    </div>
  );
}
