"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Tour = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;

  // ✅ rehandicapping fields confirmed in schema
  rehandicapping_enabled: boolean | null;
  rehandicapping_rules_summary: string | null;
  rehandicapping_rule_key: string | null;
};

type Round = {
  id: string;
  round_no: number | null;
  played_on: string | null; // preferred
  created_at: string | null;
  course_id?: string | null;
  courses?: { name: string } | { name: string }[] | null;
};

type PlayerRow = { id: string; name: string };

type TourGroupRow = {
  id: string;
  tour_id: string;
  scope: "tour" | "round";
  type: "pair" | "team";
  name: string | null;
  round_id: string | null;
  created_at: string | null;
};

type TourGroupMemberRow = { group_id: string; player_id: string };

type TourGroupingSettings = {
  tour_id: string;

  default_team_best_m: number | null;

  individual_mode: "ALL" | "BEST_N" | string | null;
  individual_best_n: number | null;
  individual_final_required: boolean | null;

  pair_mode: "ALL" | "BEST_Q" | string | null;
  pair_best_q: number | null;
  pair_final_required: boolean | null;
};

function fmtDate(value: string | null) {
  if (!value) return "TBC";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Desktop-aligned fallback: use tour.start/end if set, else derive from rounds.played_on
function deriveTourStartEnd(tour: Tour | null, rounds: Round[]) {
  const tStart = (tour?.start_date ?? "").trim() || null;
  const tEnd = (tour?.end_date ?? "").trim() || null;

  if (tStart || tEnd) return { start: tStart, end: tEnd, source: "tour" as const };

  const played = rounds
    .map((r) => (r.played_on ?? "").trim())
    .filter(Boolean)
    .sort(); // ISO YYYY-MM-DD sorts lexicographically

  if (!played.length) return { start: null, end: null, source: "none" as const };

  return { start: played[0] ?? null, end: played[played.length - 1] ?? null, source: "rounds" as const };
}

function formatDateRange(start: string | null, end: string | null) {
  if (!start && !end) return "TBD";
  if (start && end) return start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
  return fmtDate(start ?? end);
}

function fmtRuleIndividual(s: TourGroupingSettings | null) {
  if (!s) return "All rounds";
  const mode = String(s.individual_mode ?? "ALL").toUpperCase();
  if (mode !== "BEST_N") return "All rounds";
  const n = Number.isFinite(Number(s.individual_best_n)) ? Number(s.individual_best_n) : 0;
  const fr = s.individual_final_required === true;
  if (n > 0) return fr ? `Best ${n} rounds (Final required)` : `Best ${n} rounds`;
  return fr ? "Best N rounds (Final required)" : "Best N rounds";
}

function fmtRulePairs(s: TourGroupingSettings | null) {
  if (!s) return "All rounds";
  const mode = String(s.pair_mode ?? "ALL").toUpperCase();
  if (mode !== "BEST_Q") return "All rounds";
  const q = Number.isFinite(Number(s.pair_best_q)) ? Number(s.pair_best_q) : 0;
  const fr = s.pair_final_required === true;
  if (q > 0) return fr ? `Best ${q} rounds (Final required)` : `Best ${q} rounds`;
  return fr ? "Best Q rounds (Final required)" : "Best Q rounds";
}

function fmtRuleTeams(s: TourGroupingSettings | null) {
  const m = Number.isFinite(Number(s?.default_team_best_m)) ? Number(s?.default_team_best_m) : 1;
  return `Best ${m} per hole, −1 per zero (all rounds)`;
}

function normalizePlayerJoin(val: any): PlayerRow | null {
  if (!val) return null;
  const p = Array.isArray(val) ? val[0] : val;
  if (!p?.id) return null;
  return { id: String(p.id), name: String(p.name ?? "").trim() || "(unnamed)" };
}

function courseNameForRound(r: Round) {
  const c: any = r.courses;
  if (!c) return "";
  if (Array.isArray(c)) return String(c?.[0]?.name ?? "").trim();
  return String(c?.name ?? "").trim();
}

export default function MobileTourDetailsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const tourId = params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);

  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [tourGroups, setTourGroups] = useState<TourGroupRow[]>([]);
  const [tourGroupMembers, setTourGroupMembers] = useState<TourGroupMemberRow[]>([]);

  const [eventSettings, setEventSettings] = useState<TourGroupingSettings | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError("");

      try {
        // Tour (include rehandicapping fields)
        const { data: tData, error: tErr } = await supabase
          .from("tours")
          .select("id,name,start_date,end_date,rehandicapping_enabled,rehandicapping_rules_summary,rehandicapping_rule_key")
          .eq("id", tourId)
          .single();
        if (tErr) throw tErr;

        // Rounds (include course name for display)
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,round_no,played_on,created_at,course_id,courses(name)")
          .eq("tour_id", tourId);
        if (rErr) throw rErr;

        // Event settings (leaderboard rules)
        const { data: sData, error: sErr } = await supabase
          .from("tour_grouping_settings")
          .select(
            "tour_id, default_team_best_m, individual_mode, individual_best_n, individual_final_required, pair_mode, pair_best_q, pair_final_required"
          )
          .eq("tour_id", tourId)
          .maybeSingle();
        if (sErr) throw sErr;

        // Players in tour
        const { data: tpData, error: tpErr } = await supabase
          .from("tour_players")
          .select("tour_id,player_id,players(id,name)")
          .eq("tour_id", tourId)
          .order("name", { ascending: true, foreignTable: "players" });
        if (tpErr) throw tpErr;

        const playersInTour: PlayerRow[] = (tpData ?? [])
          .map((row: any) => normalizePlayerJoin(row.players))
          .filter(Boolean) as PlayerRow[];

        // Pairs/Teams (tour scope)
        const { data: gData, error: gErr } = await supabase
          .from("tour_groups")
          .select("id,tour_id,scope,type,name,round_id,created_at")
          .eq("tour_id", tourId)
          .eq("scope", "tour")
          .in("type", ["pair", "team"])
          .order("type", { ascending: true })
          .order("created_at", { ascending: true });
        if (gErr) throw gErr;

        const glist = (gData ?? []) as TourGroupRow[];
        const groupIds = glist.map((g) => g.id);

        let members: TourGroupMemberRow[] = [];
        if (groupIds.length) {
          const { data: mData, error: mErr } = await supabase
            .from("tour_group_members")
            .select("group_id,player_id")
            .in("group_id", groupIds);
          if (mErr) throw mErr;
          members = (mData ?? []) as TourGroupMemberRow[];
        }

        if (!alive) return;
        setTour(tData as Tour);
        setRounds((rData ?? []) as Round[]);
        setEventSettings((sData ?? null) as TourGroupingSettings | null);

        setPlayers(playersInTour);
        setTourGroups(glist);
        setTourGroupMembers(members);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load tour details.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [tourId]);

  const sortedRounds = useMemo(() => {
    return [...rounds].sort((a, b) => {
      const an = a.round_no ?? 9999;
      const bn = b.round_no ?? 9999;
      if (an !== bn) return an - bn;
      return (a.created_at ?? "").localeCompare(b.created_at ?? "");
    });
  }, [rounds]);

  const { start: effStart, end: effEnd } = useMemo(() => {
    return deriveTourStartEnd(tour, rounds);
  }, [tour, rounds]);

  const playerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of players) m.set(p.id, p.name);
    return m;
  }, [players]);

  const membersByGroupId = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const row of tourGroupMembers) {
      if (!m.has(row.group_id)) m.set(row.group_id, []);
      m.get(row.group_id)!.push(row.player_id);
    }
    return m;
  }, [tourGroupMembers]);

  const tourPairs = useMemo(() => tourGroups.filter((g) => g.type === "pair"), [tourGroups]);
  const tourTeams = useMemo(() => tourGroups.filter((g) => g.type === "team"), [tourGroups]);

  function labelForGroup(g: TourGroupRow) {
    const stored = (g.name ?? "").trim();
    if (stored) return stored;

    const ids = membersByGroupId.get(g.id) ?? [];
    if (g.type === "pair" && ids.length >= 2) {
      const a = playerNameById.get(ids[0]) ?? ids[0];
      const b = playerNameById.get(ids[1]) ?? ids[1];
      return `${a} / ${b}`;
    }
    return `${g.type === "pair" ? "Pair" : "Team"} ${g.id.slice(0, 6)}`;
  }

  function membersLabel(g: TourGroupRow) {
    const ids = membersByGroupId.get(g.id) ?? [];
    if (!ids.length) return "—";
    return ids.map((pid) => playerNameById.get(pid) ?? pid).join(g.type === "pair" ? " / " : ", ");
  }

  const pairsMemberOnlyLabel = (g: TourGroupRow) => {
    const ids = membersByGroupId.get(g.id) ?? [];
    if (!ids.length) return "—";
    return ids.map((pid) => playerNameById.get(pid) ?? pid).join(" / ");
  };

  // ✅ Rehandicapping: actual truth from tours table
  const rehandicapEnabled = tour?.rehandicapping_enabled === true;
  const rehandicapSummary = (tour?.rehandicapping_rules_summary ?? "").trim();
  const rehandicapHeading = `Rehandicapping – ${rehandicapEnabled ? "Yes" : "No"}`;

  return (
    <div className="min-h-dvh bg-white text-gray-900">
      {/* Header (standard 3-band) */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur">
        {/* Band 1: Tour name + Back */}
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{tour?.name ?? "Tour"}</div>
          </div>

          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm active:bg-slate-50"
          >
            Back
          </button>
        </div>

        {/* Divider 1 */}
        <div className="border-b border-slate-200" />

        {/* Band 2: Page title */}
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-900">Tour details</div>
          </div>
          <div />
        </div>

        {/* Divider 2 */}
        <div className="border-b border-slate-200" />
      </div>

      <main className="max-w-md mx-auto px-4 py-4 space-y-6">
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
        ) : (
          <>
            {/* Tour summary */}
            <section className="rounded-xl border p-4">
              <div className="text-lg font-semibold">{tour?.name}</div>
              <div className="mt-1 text-sm text-gray-600">
                Dates: <span className="font-semibold text-gray-800">{formatDateRange(effStart, effEnd)}</span>
              </div>
            </section>

            {/* Players */}
            <section className="rounded-xl border p-4">
              <div className="font-semibold mb-2">{`Players – ${players.length}`}</div>

              {players.length > 0 ? (
                <ul className="space-y-1 text-sm text-gray-600">
                  {players.map((p) => (
                    <li key={p.id} className="truncate">
                      {p.name}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-gray-500">No players found for this tour.</div>
              )}
            </section>

            {/* Pairs */}
            <section className="rounded-xl border p-4">
              <div className="font-semibold mb-2">{`Pairs – ${tourPairs.length}`}</div>

              {tourPairs.length > 0 ? (
                <ul className="space-y-1 text-sm text-gray-600">
                  {tourPairs.map((g) => (
                    <li key={g.id}>{pairsMemberOnlyLabel(g)}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-gray-500">No pairs set for this tour.</div>
              )}
            </section>

            {/* Teams */}
            <section className="rounded-xl border p-4">
              <div className="font-semibold mb-2">{`Teams – ${tourTeams.length}`}</div>

              {tourTeams.length > 0 ? (
                <ul className="space-y-2 text-sm text-gray-600">
                  {tourTeams.map((g) => (
                    <li key={g.id}>
                      <div className="font-semibold text-gray-800">{labelForGroup(g)}</div>
                      <div className="text-gray-600">{membersLabel(g)}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-sm text-gray-500">No teams set for this tour.</div>
              )}
            </section>

            {/* Leaderboard event rules */}
            <section className="rounded-xl border p-4">
              <div className="font-semibold mb-2">Leaderboard rules</div>

              <div className="text-sm text-gray-700 space-y-2">
                <div>
                  <div className="font-semibold">Individual</div>
                  <div className="text-gray-600">Stableford total · {fmtRuleIndividual(eventSettings)}</div>
                </div>

                <div>
                  <div className="font-semibold">Pairs</div>
                  <div className="text-gray-600">Better Ball Stableford · {fmtRulePairs(eventSettings)}</div>
                </div>

                <div>
                  <div className="font-semibold">Teams</div>
                  <div className="text-gray-600">{fmtRuleTeams(eventSettings)}</div>
                </div>
              </div>
            </section>

            {/* Rounds summary */}
            <section className="rounded-xl border p-4">
              <div className="font-semibold mb-2">{`Rounds – ${sortedRounds.length}`}</div>

              {sortedRounds.length > 0 ? (
                <ul className="space-y-1 text-sm text-gray-600">
                  {sortedRounds.map((r, i) => {
                    const roundLabel = `Round ${r.round_no ?? i + 1}`;
                    const dateLabel = fmtDate(r.played_on ?? null);
                    const course = courseNameForRound(r);
                    const suffix = course ? ` · ${course}` : "";
                    return (
                      <li key={r.id}>
                        {roundLabel} — {dateLabel}
                        {suffix}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="text-sm text-gray-500">No rounds found for this tour.</div>
              )}
            </section>

            {/* Rehandicapping */}
            <section className="rounded-xl border p-4">
              <div className="font-semibold mb-2">{rehandicapHeading}</div>

              {rehandicapEnabled ? (
                <div className="text-sm text-gray-700">{rehandicapSummary ? rehandicapSummary : "(No summary provided)"}</div>
              ) : null}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
