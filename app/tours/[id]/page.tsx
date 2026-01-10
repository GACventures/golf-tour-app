"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { supabase } from "@/lib/supabaseClient";

type Tour = { id: string; name: string };

// Courses are now often GLOBAL (tour_id can be null)
type Course = { id: string; name: string; tour_id: string | null };

// Global player library row (displayed via tour_players join)
type Player = { id: string; name: string; start_handicap: number };

// Tour membership row (join)
type TourPlayerRow = {
  tour_id: string;
  player_id: string;
  starting_handicap: number;
  players: { id: string; name: string; start_handicap: number } | null;
};

type Round = { id: string; tour_id: string; course_id: string | null; name: string; round_no: number | null; created_at: string | null };

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

function roundLabel(r: { id: string; name: string | null; round_no: number | null }) {
  const nm = (r.name ?? "").trim();
  if (r.round_no) return `Round ${r.round_no}${nm ? `: ${nm}` : ""}`;
  if (nm) return nm;
  return r.id;
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

  // Pairs/Teams detail for Overview
  const [tourGroups, setTourGroups] = useState<TourGroupRow[]>([]);
  const [tourGroupMembers, setTourGroupMembers] = useState<TourGroupMemberRow[]>([]);

  async function loadAll() {
    setLoading(true);
    setError("");

    try {
      // Tour
      const { data: tourData, error: tourErr } = await supabase
        .from("tours")
        .select("id,name")
        .eq("id", tourId)
        .maybeSingle();

      if (tourErr) throw new Error(tourErr.message);
      if (!tourData) throw new Error("Tour not found (or you do not have access).");

      setTour(tourData as Tour);

      // Rounds (load EARLY so we can fetch the referenced course ids)
      const { data: roundData, error: roundErr } = await supabase
        .from("rounds")
        .select("id,tour_id,course_id,name,round_no,created_at")
        .eq("tour_id", tourId)
        .order("created_at", { ascending: true });

      if (roundErr) throw new Error(roundErr.message);

      const roundList = (roundData ?? []) as Round[];
      setRounds(roundList);

      // ✅ Courses: fetch by the course_ids used by these rounds (works for GLOBAL courses too)
      const courseIds = Array.from(new Set(roundList.map((r) => r.course_id).filter(Boolean))) as string[];
      if (courseIds.length) {
        const { data: cData, error: cErr } = await supabase
          .from("courses")
          .select("id,name,tour_id")
          .in("id", courseIds);

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
      setTourPlayers((tpData ?? []) as TourPlayerRow[]);

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

  if (loading) return <div style={{ padding: 16 }}>Loading tour…</div>;

  if (error)
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: "crimson", fontWeight: 700 }}>Error</div>
        <div style={{ marginTop: 8 }}>{error}</div>
      </div>
    );

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
    </div>
  );
}
