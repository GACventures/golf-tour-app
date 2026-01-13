// app/tours/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { supabase } from "@/lib/supabaseClient";

type Tour = {
  id: string;
  name: string;
  rehandicapping_enabled: boolean | null;
  handicap_rules_summary: string | null;
  rehandicapping_rules_summary: string | null;
};

// Courses are now often GLOBAL (tour_id can be null)
type Course = { id: string; name: string; tour_id: string | null };

// Global player library row (displayed via tour_players join)
type Player = { id: string; name: string; start_handicap: number };

// Tour membership row (join)
type TourPlayerRow = {
  tour_id: string;
  player_id: string;
  starting_handicap: number | null;
  players: { id: string; name: string; start_handicap: number } | null;
};

type Round = {
  id: string;
  tour_id: string;
  course_id: string | null;
  name: string;
  round_no: number | null;
  created_at: string | null;
};

type TourGroupRow = {
  id: string;
  tour_id: string;
  scope: "tour" | "round";
  type: "pair" | "team";
  name: string | null;
  round_id: string | null;
  created_at?: string | null;
};

type TourGroupMemberRow = {
  group_id: string;
  player_id: string;
};

type TourGroupingSettings = {
  tour_id: string;

  default_team_best_m: number | null;

  individual_mode: "ALL" | "BEST_N" | string;
  individual_best_n: number | null;
  individual_final_required: boolean;

  pair_mode: "ALL" | "BEST_Q" | string;
  pair_best_q: number | null;
  pair_final_required: boolean;
};

function roundLabel(r: { id: string; name: string | null; round_no: number | null }) {
  const nm = (r.name ?? "").trim();
  if (r.round_no) return `Round ${r.round_no}${nm ? `: ${nm}` : ""}`;
  if (nm) return nm;
  return r.id;
}

function normalizePlayerJoin(val: any): { id: string; name: string; start_handicap: number } | null {
  if (!val) return null;

  const p = Array.isArray(val) ? val[0] : val;
  if (!p) return null;

  const id = p.id != null ? String(p.id) : "";
  const name = p.name != null ? String(p.name) : "";
  const sh = p.start_handicap ?? p.start_handicap ?? p.start_handicap;

  const start_handicap = Number.isFinite(Number(sh)) ? Number(sh) : 0;

  if (!id) return null;
  return { id, name: name || "(missing player)", start_handicap };
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
  const y = Number.isFinite(Number(s?.default_team_best_m)) ? Number(s?.default_team_best_m) : 1;
  return `Best ${y} per hole, −1 per zero (all rounds)`;
}

function cleanText(s: string | null | undefined) {
  const t = (s ?? "").trim();
  return t.length ? t : null;
}

export default function TourPage() {
  const params = useParams<{ id: string }>();
  const tourId = params.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [tour, setTour] = useState<Tour | null>(null);
  const [coursesById, setCoursesById] = useState<Record<string, Course>>({});
  const [tourPlayers, setTourPlayers] = useState<TourPlayerRow[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);

  const [tourGroups, setTourGroups] = useState<TourGroupRow[]>([]);
  const [tourGroupMembers, setTourGroupMembers] = useState<TourGroupMemberRow[]>([]);
  const [eventSettings, setEventSettings] = useState<TourGroupingSettings | null>(null);

  // Step C: edit controls state
  const [editingHcp, setEditingHcp] = useState(false);
  const [draftRehEnabled, setDraftRehEnabled] = useState(false);
  const [draftHandicapSummary, setDraftHandicapSummary] = useState("");
  const [draftRehSummary, setDraftRehSummary] = useState("");
  const [savingHcp, setSavingHcp] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  function syncDraftFromTour(t: Tour | null) {
    setDraftRehEnabled(t?.rehandicapping_enabled === true);
    setDraftHandicapSummary(t?.handicap_rules_summary ?? "");
    setDraftRehSummary(t?.rehandicapping_rules_summary ?? "");
  }

  async function loadAll() {
    setLoading(true);
    setError("");
    setSaveMsg("");

    try {
      // Tour (includes handicapping fields)
      const { data: tourData, error: tourErr } = await supabase
        .from("tours")
        .select("id,name,rehandicapping_enabled,handicap_rules_summary,rehandicapping_rules_summary")
        .eq("id", tourId)
        .maybeSingle();

      if (tourErr) throw new Error(tourErr.message);
      if (!tourData) throw new Error("Tour not found (or you do not have access).");

      const t = tourData as Tour;
      setTour(t);
      syncDraftFromTour(t);

      // Event settings
      const { data: sData, error: sErr } = await supabase
        .from("tour_grouping_settings")
        .select(
          "tour_id, default_team_best_m, individual_mode, individual_best_n, individual_final_required, pair_mode, pair_best_q, pair_final_required"
        )
        .eq("tour_id", tourId)
        .maybeSingle();

      if (sErr) throw new Error(sErr.message);
      setEventSettings((sData ?? null) as TourGroupingSettings | null);

      // Rounds
      const { data: roundData, error: roundErr } = await supabase
        .from("rounds")
        .select("id,tour_id,course_id,name,round_no,created_at")
        .eq("tour_id", tourId)
        .order("created_at", { ascending: true });

      if (roundErr) throw new Error(roundErr.message);

      const roundList = (roundData ?? []) as Round[];
      setRounds(roundList);

      // Courses by course_id (supports GLOBAL courses too)
      const courseIds = Array.from(new Set(roundList.map((r) => r.course_id).filter(Boolean))) as string[];
      if (courseIds.length) {
        const { data: cData, error: cErr } = await supabase.from("courses").select("id,name,tour_id").in("id", courseIds);
        if (cErr) throw new Error(cErr.message);

        const map: Record<string, Course> = {};
        for (const c of cData ?? []) {
          const id = String((c as any).id);
          map[id] = { id, name: String((c as any).name), tour_id: (c as any).tour_id ?? null };
        }
        setCoursesById(map);
      } else {
        setCoursesById({});
      }

      // Tour players via join table
      const { data: tpData, error: tpErr } = await supabase
        .from("tour_players")
        .select("tour_id,player_id,starting_handicap, players(id,name,start_handicap)")
        .eq("tour_id", tourId)
        .order("name", { ascending: true, foreignTable: "players" });

      if (tpErr) throw new Error(tpErr.message);

      const normalizedTP: TourPlayerRow[] = (tpData ?? []).map((row: any) => {
        const playerObj = normalizePlayerJoin(row.players);

        const starting_handicap =
          row.starting_handicap == null ? null : Number.isFinite(Number(row.starting_handicap)) ? Number(row.starting_handicap) : null;

        return {
          tour_id: String(row.tour_id),
          player_id: String(row.player_id),
          starting_handicap,
          players: playerObj,
        };
      });

      setTourPlayers(normalizedTP);

      // Pairs/Teams groups (tour scope)
      const { data: gData, error: gErr } = await supabase
        .from("tour_groups")
        .select("id,tour_id,scope,type,name,round_id,created_at")
        .eq("tour_id", tourId)
        .eq("scope", "tour")
        .in("type", ["pair", "team"])
        .order("type", { ascending: true })
        .order("created_at", { ascending: true });

      if (gErr) throw new Error(gErr.message);

      const glist = (gData ?? []) as TourGroupRow[];
      setTourGroups(glist);

      const groupIds = glist.map((g) => g.id);
      if (!groupIds.length) {
        setTourGroupMembers([]);
        setLoading(false);
        return;
      }

      const { data: mData, error: mErr } = await supabase
        .from("tour_group_members")
        .select("group_id,player_id")
        .in("group_id", groupIds);

      if (mErr) throw new Error(mErr.message);

      setTourGroupMembers((mData ?? []) as TourGroupMemberRow[]);
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  const playersInThisTour: Player[] = useMemo(() => {
    return (tourPlayers ?? [])
      .map((r) => ({
        id: r.players?.id ?? "",
        name: r.players?.name ?? "(missing player)",
        start_handicap: r.starting_handicap ?? 0,
      }))
      .filter((p) => !!p.id);
  }, [tourPlayers]);

  const playerNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of playersInThisTour) m.set(p.id, p.name);
    return m;
  }, [playersInThisTour]);

  const membersByGroup = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const row of tourGroupMembers) {
      if (!m.has(row.group_id)) m.set(row.group_id, []);
      m.get(row.group_id)!.push(row.player_id);
    }
    return m;
  }, [tourGroupMembers]);

  const tourPairs = useMemo(() => tourGroups.filter((g) => g.scope === "tour" && g.type === "pair"), [tourGroups]);
  const tourTeams = useMemo(() => tourGroups.filter((g) => g.scope === "tour" && g.type === "team"), [tourGroups]);

  function labelForGroup(g: TourGroupRow) {
    const fallback = `${g.type === "pair" ? "Pair" : "Team"} ${g.id.slice(0, 6)}`;
    const ids = membersByGroup.get(g.id) ?? [];

    const storedName = (g.name ?? "").trim();
    if (storedName) return storedName;

    if (g.type === "pair" && ids.length >= 2) {
      const a = playerNameById.get(ids[0]) ?? ids[0];
      const b = playerNameById.get(ids[1]) ?? ids[1];
      return `${a} / ${b}`;
    }

    return fallback;
  }

  function membersLabel(g: TourGroupRow) {
    const ids = membersByGroup.get(g.id) ?? [];
    if (!ids.length) return "—";
    return ids.map((pid) => playerNameById.get(pid) ?? pid).join(g.type === "pair" ? " / " : ", ");
  }

  async function saveHandicappingEdits() {
    if (!tour) return;
    setSavingHcp(true);
    setSaveMsg("");

    const payload: any = {
      rehandicapping_enabled: draftRehEnabled,
      handicap_rules_summary: cleanText(draftHandicapSummary),
      rehandicapping_rules_summary: draftRehEnabled ? cleanText(draftRehSummary) : null,
    };

    const { error: upErr } = await supabase.from("tours").update(payload).eq("id", tour.id);

    if (upErr) {
      setSaveMsg(`Save failed: ${upErr.message}`);
      setSavingHcp(false);
      return;
    }

    setSaveMsg("Saved ✓");
    setEditingHcp(false);

    // Refresh tour fields (and keep the rest of page intact)
    const { data: t2, error: t2Err } = await supabase
      .from("tours")
      .select("id,name,rehandicapping_enabled,handicap_rules_summary,rehandicapping_rules_summary")
      .eq("id", tour.id)
      .maybeSingle();

    if (!t2Err && t2) {
      const tt = t2 as Tour;
      setTour(tt);
      syncDraftFromTour(tt);
    }

    setSavingHcp(false);
  }

  function cancelHandicappingEdits() {
    setEditingHcp(false);
    setSaveMsg("");
    syncDraftFromTour(tour);
  }

  if (loading) return <div style={{ padding: 16 }}>Loading tour…</div>;

  if (error)
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: "crimson", fontWeight: 700 }}>Error</div>
        <div style={{ marginTop: 8 }}>{error}</div>
      </div>
    );

  const readHandicapSummary =
    cleanText(tour?.handicap_rules_summary) ??
    "Not specified yet. (Set tours.handicap_rules_summary to describe baseline handicap source + any adjustments.)";

  const readRehEnabled = tour?.rehandicapping_enabled === true;

  const readRehSummary = readRehEnabled
    ? cleanText(tour?.rehandicapping_rules_summary) ?? "Rehandicapping enabled (no summary set)."
    : "No rehandicapping.";

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>{tour?.name ?? "Tour"}</h1>

      {/* Players (hub) */}
      <h2 style={{ marginTop: 24, fontSize: 18, fontWeight: 700 }}>Players</h2>
      <div style={{ marginTop: 8, color: "#333" }}>
        Total: <strong>{playersInThisTour.length}</strong>
      </div>
      <div style={{ marginTop: 8 }}>
        <Link href={`/tours/${tourId}/players`}>Manage players (this tour) →</Link>
      </div>

      {playersInThisTour.length === 0 ? (
        <div style={{ marginTop: 8, color: "#555" }}>No players yet.</div>
      ) : (
        <ul style={{ marginTop: 8 }}>
          {playersInThisTour.map((p) => (
            <li key={p.id}>
              {p.name} <span style={{ color: "#777" }}>(starting hcp: {p.start_handicap})</span>
            </li>
          ))}
        </ul>
      )}

      {/* Events */}
      <h2 style={{ marginTop: 24, fontSize: 18, fontWeight: 700 }}>Events</h2>
      <div style={{ marginTop: 8, color: "#333" }}>
        <div>
          <strong>Individual</strong> — Stableford total &nbsp;·&nbsp; <span style={{ color: "#555" }}>{fmtRuleIndividual(eventSettings)}</span>
        </div>
        <div style={{ marginTop: 6 }}>
          <strong>Pairs</strong> — Better Ball Stableford &nbsp;·&nbsp; <span style={{ color: "#555" }}>{fmtRulePairs(eventSettings)}</span>
        </div>
        <div style={{ marginTop: 6 }}>
          <strong>Teams</strong> — {fmtRuleTeams(eventSettings)}
        </div>

        <div style={{ marginTop: 10 }}>
          <Link href={`/tours/${tourId}/events/manage`}>Manage events →</Link>
        </div>
      </div>

      {/* Pairs & Teams */}
      <h2 style={{ marginTop: 24, fontSize: 18, fontWeight: 700 }}>Pairs &amp; Teams</h2>
      <div style={{ marginTop: 8 }}>
        <div style={{ color: "#333" }}>
          Pairs: <strong>{tourPairs.length}</strong> &nbsp;|&nbsp; Teams: <strong>{tourTeams.length}</strong>
        </div>

        {tourPairs.length === 0 && tourTeams.length === 0 ? (
          <div style={{ marginTop: 6, color: "#555" }}>No pairs or teams yet.</div>
        ) : (
          <div style={{ marginTop: 10 }}>
            {tourPairs.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Pairs</div>
                <ul style={{ marginTop: 0 }}>
                  {tourPairs.map((g) => (
                    <li key={g.id}>
                      <strong>{labelForGroup(g)}</strong> <span style={{ color: "#666" }}>({membersLabel(g)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {tourTeams.length > 0 && (
              <div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>Teams</div>
                <ul style={{ marginTop: 0 }}>
                  {tourTeams.map((g) => (
                    <li key={g.id}>
                      <strong>{labelForGroup(g)}</strong> <span style={{ color: "#666" }}>({membersLabel(g)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          <Link href={`/tours/${tourId}/groups`}>Manage pairs &amp; teams →</Link>
        </div>
      </div>

      {/* Rounds */}
      <h2 style={{ marginTop: 24, fontSize: 18, fontWeight: 700 }}>Rounds</h2>
      <div style={{ marginTop: 8, color: "#333" }}>
        Total: <strong>{rounds.length}</strong>
      </div>
      <div style={{ marginTop: 8 }}>
        <Link href={`/tours/${tourId}/rounds`}>Manage rounds →</Link>
      </div>

      {rounds.length === 0 ? (
        <div style={{ marginTop: 8, color: "#555" }}>No rounds yet.</div>
      ) : (
        <ul style={{ marginTop: 8 }}>
          {rounds.map((r) => {
            const courseName = r.course_id ? coursesById[r.course_id]?.name : null;

            return (
              <li key={r.id} style={{ marginBottom: 6 }}>
                <strong>{roundLabel(r)}</strong> — {courseName ?? (r.course_id ?? "(no course)")} |{" "}
                <Link href={`/rounds/${r.id}`}>Open</Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Handicapping (BOTTOM, as requested) */}
      <h2 style={{ marginTop: 36, fontSize: 18, fontWeight: 700 }}>Handicapping</h2>

      {!editingHcp ? (
        <div style={{ marginTop: 8, color: "#333", lineHeight: 1.5 }}>
          <div>
            <strong>Baseline / rules:</strong> <span style={{ color: "#555" }}>{readHandicapSummary}</span>
          </div>

          <div style={{ marginTop: 10 }}>
            <strong>Rehandicapping:</strong>{" "}
            <span style={{ color: readRehEnabled ? "#1b5e20" : "#555", fontWeight: 700 }}>
              {readRehEnabled ? "Yes" : "No"}
            </span>
          </div>

          <div style={{ marginTop: 6, color: "#555" }}>{readRehSummary}</div>

          <button
            type="button"
            onClick={() => {
              syncDraftFromTour(tour);
              setEditingHcp(true);
              setSaveMsg("");
            }}
            style={{
              marginTop: 12,
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid #ccc",
              background: "white",
              cursor: "pointer",
            }}
          >
            Edit handicapping →
          </button>

          {saveMsg && (
            <div style={{ marginTop: 8, fontSize: 12, color: saveMsg.startsWith("Save failed") ? "crimson" : "#2e7d32" }}>
              {saveMsg}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 12, maxWidth: 820 }}>
          <div style={{ fontSize: 13, color: "#555", marginBottom: 8 }}>
            This edits display-only tour metadata (does not recalculate any scores).
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Baseline handicapping rules</div>
            <textarea
              value={draftHandicapSummary}
              onChange={(e) => setDraftHandicapSummary(e.target.value)}
              rows={3}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
              placeholder="e.g. Baseline handicap: tour_players.starting_handicap. Adjustments: …"
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
              <input
                type="checkbox"
                checked={draftRehEnabled}
                onChange={(e) => setDraftRehEnabled(e.target.checked)}
              />
              Rehandicapping enabled
            </label>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: draftRehEnabled ? "#111" : "#777" }}>
              Rehandicapping rules summary
            </div>
            <textarea
              value={draftRehSummary}
              onChange={(e) => setDraftRehSummary(e.target.value)}
              rows={4}
              disabled={!draftRehEnabled}
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 10,
                border: "1px solid #ccc",
                background: draftRehEnabled ? "white" : "#f7f7f7",
              }}
              placeholder={
                draftRehEnabled
                  ? "Short summary shown on overview when rehandicapping = Yes"
                  : "Enable rehandicapping to edit this"
              }
            />
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={saveHandicappingEdits}
              disabled={savingHcp}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #2e7d32",
                background: savingHcp ? "#f7f7f7" : "white",
                cursor: savingHcp ? "default" : "pointer",
              }}
            >
              {savingHcp ? "Saving…" : "Save"}
            </button>

            <button
              type="button"
              onClick={cancelHandicappingEdits}
              disabled={savingHcp}
              style={{
                padding: "8px 10px",
                borderRadius: 10,
                border: "1px solid #ccc",
                background: "white",
                cursor: savingHcp ? "default" : "pointer",
              }}
            >
              Cancel
            </button>

            {saveMsg && (
              <div style={{ fontSize: 12, color: saveMsg.startsWith("Save failed") ? "crimson" : "#2e7d32" }}>
                {saveMsg}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
