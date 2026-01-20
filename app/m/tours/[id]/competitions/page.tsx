"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import MobileNav from "../_components/MobileNav";

import { competitionCatalog } from "@/lib/competitions/catalog";
import { runCompetition } from "@/lib/competitions/engine";

import type { CompetitionDefinition, CompetitionKind, CompetitionContext } from "@/lib/competitions/types";

import { resolveEntities, type LeaderboardEntity } from "@/lib/competitions/entities/resolveEntities";
import { buildTourCompetitionContext, type Tee, type TourRoundInput, type PlayerInput, type RoundPlayerInput, type ScoreInput, type ParInput } from "@/lib/competitions/buildTourCompetitionContext";

type Tour = { id: string; name: string };

type RoundRow = {
  id: string;
  tour_id: string;
  name: string | null;
  round_no: number | null;
  created_at: string | null;
  course_id: string | null;
};

type PlayerRow = {
  id: string;
  name: string;
  gender?: Tee | null;
  start_handicap?: number | null;
};

type RoundPlayerRow = {
  round_id: string;
  player_id: string;
  playing: boolean;
  playing_handicap: number | null;
};

type ScoreRow = {
  round_id: string;
  player_id: string;
  hole_number: number;
  strokes: number | null;
  pickup?: boolean | null;
};

type ParRow = {
  course_id: string;
  hole_number: number;
  tee: Tee;
  par: number;
  stroke_index: number;
};

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function safeName(v: any, fallback: string) {
  const s = String(v ?? "").trim();
  return s ? s : fallback;
}

function normalizeTee(v: any): Tee {
  const s = String(v ?? "").trim().toUpperCase();
  return s === "F" ? "F" : "M";
}

function titleCaseKey(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .replace(/\bPct\b/i, "%");
}

function isPercentish(def: CompetitionDefinition) {
  const id = String(def.id ?? "").toLowerCase();
  const name = String(def.name ?? "").toLowerCase();
  return id.includes("_pct") || id.includes("percent") || name.includes("%");
}

function formatTotal(def: CompetitionDefinition, n: number) {
  if (!Number.isFinite(n)) return "0";
  if (isPercentish(def)) return `${n.toFixed(2)}%`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function sortCompColumns(keys: string[]) {
  const preferred = [
    "members",
    "holes_played",
    "points_total",
    "avg_points",
    "zero_count",
    "zero_pct",
    "four_plus_count",
    "four_plus_pct",
    "eclectic_total",
  ];
  const out = [...keys];
  out.sort((a, b) => {
    const ia = preferred.indexOf(a);
    const ib = preferred.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.localeCompare(b);
  });
  return out;
}

export default function MobileCompetitionsPage() {
  const params = useParams<{ id?: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [roundPlayers, setRoundPlayers] = useState<RoundPlayerRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [pars, setPars] = useState<ParRow[]>([]);

  const tourCompetitions = useMemo(() => {
    return (competitionCatalog ?? []).filter((c: any) => c?.scope === "tour") as CompetitionDefinition[];
  }, []);

  const [selectedCompId, setSelectedCompId] = useState<string>(() => {
    const first = (competitionCatalog ?? []).find((c: any) => c?.scope === "tour");
    return String(first?.id ?? "tour_napoleon_par3_avg");
  });

  const selectedDef = useMemo(() => {
    return tourCompetitions.find((c) => c.id === selectedCompId) ?? (tourCompetitions[0] ?? null);
  }, [tourCompetitions, selectedCompId]);

  // Pair/team entities
  const [entities, setEntities] = useState<LeaderboardEntity[]>([]);
  const [entityMembersById, setEntityMembersById] = useState<Record<string, string[]>>({});
  const [entityLabelsById, setEntityLabelsById] = useState<Record<string, string>>({});
  const [entitiesError, setEntitiesError] = useState("");

  useEffect(() => {
    if (!tourId || !isLikelyUuid(tourId)) return;

    let alive = true;

    async function loadAll() {
      setLoading(true);
      setErrorMsg("");

      try {
        const { data: tData, error: tErr } = await supabase.from("tours").select("id,name").eq("id", tourId).single();
        if (tErr) throw tErr;
        if (!alive) return;
        setTour(tData as Tour);

        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,tour_id,name,round_no,created_at,course_id")
          .eq("tour_id", tourId)
          .order("round_no", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true });
        if (rErr) throw rErr;
        const rr = (rData ?? []) as RoundRow[];
        if (!alive) return;
        setRounds(rr);

        const { data: tpData, error: tpErr } = await supabase
          .from("tour_players")
          .select("tour_id,player_id,starting_handicap,players(id,name,gender,start_handicap)")
          .eq("tour_id", tourId)
          .order("name", { ascending: true, foreignTable: "players" });
        if (tpErr) throw tpErr;

        const ps: PlayerRow[] = (tpData ?? [])
          .map((row: any) => ({
            id: String(row.players?.id ?? row.player_id),
            name: safeName(row.players?.name, "(unnamed)"),
            gender: row.players?.gender ? normalizeTee(row.players.gender) : null,
            // Prefer tour starting handicap; fallback to global start_handicap if present
            start_handicap: Number.isFinite(Number(row.starting_handicap))
              ? Number(row.starting_handicap)
              : Number.isFinite(Number(row.players?.start_handicap))
              ? Number(row.players.start_handicap)
              : 0,
          }))
          .filter((p) => !!p.id);

        if (!alive) return;
        setPlayers(ps);

        const roundIds = rr.map((r) => r.id);
        const playerIds = ps.map((p) => p.id);

        if (roundIds.length > 0 && playerIds.length > 0) {
          const { data: rpData, error: rpErr } = await supabase
            .from("round_players")
            .select("round_id,player_id,playing,playing_handicap")
            .in("round_id", roundIds)
            .in("player_id", playerIds);
          if (rpErr) throw rpErr;

          const rpRows: RoundPlayerRow[] = (rpData ?? []).map((x: any) => ({
            round_id: String(x.round_id),
            player_id: String(x.player_id),
            playing: x.playing === true,
            playing_handicap: Number.isFinite(Number(x.playing_handicap)) ? Number(x.playing_handicap) : null,
          }));

          if (!alive) return;
          setRoundPlayers(rpRows);
        } else {
          setRoundPlayers([]);
        }

        if (roundIds.length > 0 && playerIds.length > 0) {
          const { data: sData, error: sErr } = await supabase
            .from("scores")
            .select("round_id,player_id,hole_number,strokes,pickup")
            .in("round_id", roundIds)
            .in("player_id", playerIds);
          if (sErr) throw sErr;
          if (!alive) return;
          setScores((sData ?? []) as ScoreRow[]);
        } else {
          setScores([]);
        }

        const courseIds = Array.from(new Set(rr.map((r) => r.course_id).filter(Boolean))) as string[];
        if (courseIds.length > 0) {
          const { data: pData, error: pErr } = await supabase
            .from("pars")
            .select("course_id,hole_number,tee,par,stroke_index")
            .in("course_id", courseIds)
            .in("tee", ["M", "F"])
            .order("course_id", { ascending: true })
            .order("hole_number", { ascending: true });
          if (pErr) throw pErr;

          const pr: ParRow[] = (pData ?? []).map((x: any) => ({
            course_id: String(x.course_id),
            hole_number: Number(x.hole_number),
            tee: normalizeTee(x.tee),
            par: Number(x.par),
            stroke_index: Number(x.stroke_index),
          }));

          if (!alive) return;
          setPars(pr);
        } else {
          setPars([]);
        }
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load competitions.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    void loadAll();

    return () => {
      alive = false;
    };
  }, [tourId]);

  // Resolve entities when selected comp is pair/team
  useEffect(() => {
    let cancelled = false;

    async function loadEntities() {
      setEntitiesError("");

      const kind = (selectedDef?.kind ?? "individual") as CompetitionKind;
      if (kind === "individual") {
        setEntities([]);
        setEntityMembersById({});
        setEntityLabelsById({});
        return;
      }

      try {
        const res = await resolveEntities({ tourId, scope: "tour", kind });
        if (cancelled) return;

        const list = res.entities ?? [];
        setEntities(list);

        const membersById: Record<string, string[]> = {};
        const labelsById: Record<string, string> = {};
        for (const e of list) {
          membersById[e.entityId] = e.memberPlayerIds;
          labelsById[e.entityId] = e.name;
        }
        setEntityMembersById(membersById);
        setEntityLabelsById(labelsById);

        // resolveEntities can return an informational error string (e.g. explicit groups missing)
        if (res.error) setEntitiesError(res.error);
      } catch (e: any) {
        if (!cancelled) {
          setEntities([]);
          setEntityMembersById({});
          setEntityLabelsById({});
          setEntitiesError(e?.message ?? "Failed to resolve pairs/teams.");
        }
      }
    }

    if (tourId && isLikelyUuid(tourId)) void loadEntities();

    return () => {
      cancelled = true;
    };
  }, [tourId, selectedDef]);

  // Build context + run competition
  const { resultRows, statColumns } = useMemo(() => {
    if (!selectedDef) return { resultRows: [] as any[], statColumns: [] as string[] };
    if (players.length === 0 || rounds.length === 0) return { resultRows: [] as any[], statColumns: [] as string[] };

    const ctx = buildTourCompetitionContext({
      rounds: rounds as unknown as TourRoundInput[],
      players: players as unknown as PlayerInput[],
      roundPlayers: roundPlayers as unknown as RoundPlayerInput[],
      scores: scores as unknown as ScoreInput[],
      pars: pars as unknown as ParInput[],
      entities:
        (entities ?? []).map((e) => ({
          entityId: e.entityId,
          label: e.name,
          memberPlayerIds: e.memberPlayerIds,
        })) ?? [],
      entityMembersById,
      entityLabelsById,
      team_best_m: 2, // mobile read-only for now; default 2
    });

    const res = runCompetition(selectedDef, ctx as unknown as CompetitionContext);
    const rows = ((res as any)?.rows ?? []) as Array<{ entryId: string; label: string; total: number; stats?: Record<string, any> }>;

    // Derive stat columns present in results
    const keySet = new Set<string>();
    for (const row of rows) {
      const stats = row?.stats ?? {};
      for (const k of Object.keys(stats)) keySet.add(k);
    }

    return {
      resultRows: rows,
      statColumns: sortCompColumns(Array.from(keySet)),
    };
  }, [selectedDef, players, rounds, roundPlayers, scores, pars, entities, entityMembersById, entityLabelsById]);

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
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3">
          <div className="text-sm font-semibold text-gray-900">Competitions</div>
          <div className="mt-1 text-xs text-gray-600">{tour?.name ?? ""}</div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-5 w-40 rounded bg-gray-100" />
            <div className="h-64 rounded-2xl border bg-white" />
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{errorMsg}</div>
        ) : tourCompetitions.length === 0 ? (
          <div className="rounded-2xl border p-4 text-sm text-gray-700">No tour competitions found in catalog.</div>
        ) : (
          <>
            <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
              <div className="text-xs font-semibold text-gray-700">Select competition</div>
              <select
                className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                value={selectedCompId}
                onChange={(e) => setSelectedCompId(e.target.value)}
              >
                {tourCompetitions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              {selectedDef ? (
                <div className="mt-2 text-xs text-gray-600">
                  Kind: <span className="font-semibold">{selectedDef.kind}</span>
                </div>
              ) : null}

              {entitiesError ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">{entitiesError}</div>
              ) : null}
            </div>

            <div className="mt-4 overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
              {resultRows.length === 0 ? (
                <div className="p-4 text-sm text-gray-700">No results yet for this competition.</div>
              ) : (
                <table className="min-w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="sticky left-0 z-10 bg-gray-50 border-b border-gray-200 px-3 py-2 text-left text-xs font-semibold text-gray-700">
                        Entry
                      </th>
                      {statColumns.map((k) => (
                        <th key={k} className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700">
                          {titleCaseKey(k)}
                        </th>
                      ))}
                      <th className="border-b border-gray-200 px-3 py-2 text-right text-xs font-semibold text-gray-700">Total</th>
                    </tr>
                  </thead>

                  <tbody>
                    {resultRows.map((r) => {
                      const stats = r.stats ?? {};
                      return (
                        <tr key={r.entryId} className="border-b last:border-b-0">
                          <td className="sticky left-0 z-10 bg-white px-3 py-2 text-sm font-semibold text-gray-900 whitespace-nowrap">
                            {r.label}
                          </td>

                          {statColumns.map((k) => (
                            <td key={k} className="px-3 py-2 text-right text-sm text-gray-900">
                              <span className="inline-flex min-w-[76px] justify-end rounded-md px-2 py-1">
                                {typeof stats[k] === "number"
                                  ? isPercentish(selectedDef!)
                                    ? `${Number(stats[k]).toFixed(2)}%`
                                    : Number.isInteger(stats[k])
                                    ? String(stats[k])
                                    : Number(stats[k]).toFixed(2)
                                  : String(stats[k] ?? "")}
                              </span>
                            </td>
                          ))}

                          <td className="px-3 py-2 text-right text-sm font-semibold text-gray-900">
                            {formatTotal(selectedDef!, Number(r.total))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4 text-xs text-gray-600">
              This page is read-only. It runs the same competition engine as desktop and will automatically include new competitions added to the catalog.
            </div>
          </>
        )}
      </main>

      <MobileNav />
    </div>
  );
}
