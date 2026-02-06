// app/m/tours/[id]/matches/results/[roundId]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type MatchFormat = "INDIVIDUAL_MATCHPLAY" | "BETTERBALL_MATCHPLAY" | "INDIVIDUAL_STABLEFORD";

type SettingsRow = {
  id: string;
  tour_id: string;
  round_id: string;
  group_a_id: string;
  group_b_id: string;
  format: MatchFormat;
  double_points: boolean;
  created_at: string;
  updated_at: string;
};

type GroupRow = { id: string; name: string | null };

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function safeText(v: any, fallback = "") {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function formatLabel(f: MatchFormat) {
  if (f === "INDIVIDUAL_MATCHPLAY") return "Individual matchplay";
  if (f === "BETTERBALL_MATCHPLAY") return "Better ball matchplay";
  return "Individual stableford";
}

export default function MatchesResultsRoundDetailPage() {
  const params = useParams<{ id?: string; roundId?: string }>();
  const tourId = String(params?.id ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [settings, setSettings] = useState<SettingsRow | null>(null);
  const [groupsById, setGroupsById] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId)) return;

    let alive = true;

    async function load() {
      setLoading(true);
      setErrorMsg("");

      try {
        const { data: sRow, error: sErr } = await supabase
          .from("match_round_settings")
          .select("id,tour_id,round_id,group_a_id,group_b_id,format,double_points,created_at,updated_at")
          .eq("round_id", roundId)
          .maybeSingle();
        if (sErr) throw sErr;

        const { data: gRows, error: gErr } = await supabase
          .from("tour_groups")
          .select("id,name")
          .eq("tour_id", tourId)
          .is("round_id", null);
        if (gErr) throw gErr;

        const map = new Map<string, string>();
        (gRows ?? []).forEach((g: GroupRow) => map.set(String(g.id), safeText(g.name, "(unnamed)")));

        if (!alive) return;
        setSettings((sRow ?? null) as any);
        setGroupsById(map);
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load match results.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [tourId, roundId]);

  const heading = useMemo(() => {
    if (!settings) return "Matches – Results";
    const a = groupsById.get(settings.group_a_id) ?? "Team A";
    const b = groupsById.get(settings.group_b_id) ?? "Team B";
    return `${a} vs ${b}`;
  }, [settings, groupsById]);

  if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900 pb-10">
        <div className="mx-auto w-full max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">Missing or invalid tour/round id in route.</div>
          <div className="mt-4">
            <Link className="underline text-sm" href={`/m/tours/${safeText(tourId)}/matches/results`}>
              Back
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-10">
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold">Matches – Results</div>
            <div className="truncate text-sm text-gray-500">{heading}</div>
          </div>

          <Link
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm active:bg-gray-50"
            href={`/m/tours/${tourId}/matches/results`}
          >
            Back
          </Link>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4 space-y-4">
        {loading ? (
          <div className="rounded-2xl border p-4 text-sm">Loading…</div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorMsg}</div>
        ) : !settings ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
            No match format has been configured for this round yet.
            <div className="mt-2">
              <Link className="underline" href={`/m/tours/${tourId}/matches/format/${roundId}`}>
                Configure format for this round
              </Link>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700 space-y-2">
            <div>
              Format: <span className="font-semibold text-gray-900">{formatLabel(settings.format)}</span>
            </div>
            <div>
              Double points: <span className="font-semibold text-gray-900">{settings.double_points ? "Yes" : "No"}</span>
            </div>
            <div className="pt-2 text-xs text-gray-500">
              Next step: we will compute and display the per-match results for this round based on saved match assignments.
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
