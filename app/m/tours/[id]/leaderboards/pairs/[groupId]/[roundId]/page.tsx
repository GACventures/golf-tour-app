"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { netStablefordPointsForHole } from "@/lib/stableford";

/* ----------------------------------
   Types (LOCAL – no unsafe casting)
-----------------------------------*/
type Tee = "M" | "F";

type Player = {
  id: string;
  name: string;
  gender: Tee | null;
};

type ScoreRow = {
  hole: number;
  gross: number | null;
  pickup: boolean;
  net: number;
  shade: Shade;
};

type Shade = "ace" | "eagle" | "birdie" | "par" | "bogey" | "dbogey" | "none";

/* ----------------------------------
   Colour helpers (same as individual)
-----------------------------------*/
const BLUE_ACE = "#082B5C";
const BLUE_EAGLE = "#1757D6";
const BLUE_BIRDIE = "#4DA3FF";

function shadeForGross(gross: number | null, pickup: boolean, par: number): Shade {
  if (pickup) return "dbogey";
  if (!Number.isFinite(gross)) return "none";
  const diff = gross - par;
  if (diff <= -3) return "ace";
  if (diff === -2) return "eagle";
  if (diff === -1) return "birdie";
  if (diff === 0) return "par";
  if (diff === 1) return "bogey";
  return "dbogey";
}

function shadeStyle(shade: Shade): React.CSSProperties | undefined {
  if (shade === "ace") return { backgroundColor: BLUE_ACE, color: "white" };
  if (shade === "eagle") return { backgroundColor: BLUE_EAGLE, color: "white" };
  if (shade === "birdie") return { backgroundColor: BLUE_BIRDIE, color: "white" };
  return undefined;
}

/* ----------------------------------
   Page
-----------------------------------*/
export default function PairsRoundDetailPage() {
  const params = useParams<{ id: string; groupId: string; roundId: string }>();
  const router = useRouter();

  const tourId = params.id;
  const groupId = params.groupId;
  const roundId = params.roundId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [players, setPlayers] = useState<Player[]>([]);
  const [rows, setRows] = useState<
    Array<{
      hole: number;
      a: ScoreRow;
      b: ScoreRow;
      better: number;
      contribA: boolean;
      contribB: boolean;
    }>
  >([]);

  /* ----------------------------------
     Load data
  -----------------------------------*/
  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        setLoading(true);

        // 1. Pair members (ordered)
        const { data: gm, error: gmErr } = await supabase
          .from("tour_group_members")
          .select("player_id, position, players(id,name,gender)")
          .eq("group_id", groupId);

        if (gmErr) throw gmErr;
        if (!gm || gm.length !== 2) throw new Error("Pair must have exactly 2 players");

        const members = gm
          .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0))
          .map((m: any) => ({
            id: String(m.player_id),
            name: String(m.players?.name ?? ""),
            gender: (m.players?.gender ?? "M") as Tee,
          }));

        // 2. Course + pars
        const { data: round } = await supabase
          .from("rounds")
          .select("course_id")
          .eq("id", roundId)
          .single();

        const courseId = round?.course_id;
        if (!courseId) throw new Error("Missing course");

        const { data: pars } = await supabase
          .from("pars")
          .select("hole_number, par, stroke_index")
          .eq("course_id", courseId)
          .eq("tee", "M");

        // 3. Scores
        const { data: scores } = await supabase
          .from("scores")
          .select("player_id,hole_number,strokes,pickup")
          .eq("round_id", roundId)
          .in(
            "player_id",
            members.map((m) => m.id)
          );

        // 4. Playing handicaps
        const { data: rps } = await supabase
          .from("round_players")
          .select("player_id,playing_handicap")
          .eq("round_id", roundId);

        const hcpByPlayer = new Map(
          (rps ?? []).map((r: any) => [r.player_id, Number(r.playing_handicap) || 0])
        );

        const byPlayerHole = new Map<string, any>();
        for (const s of scores ?? []) {
          byPlayerHole.set(`${s.player_id}|${s.hole_number}`, s);
        }

        const resultRows = [];

        for (let hole = 1; hole <= 18; hole++) {
          const parRow = pars?.find((p: any) => p.hole_number === hole);
          if (!parRow) continue;

          const makeScore = (pid: string): ScoreRow => {
            const s = byPlayerHole.get(`${pid}|${hole}`);
            const gross = Number.isFinite(s?.strokes) ? Number(s.strokes) : null;
            const pickup = s?.pickup === true;
            const raw = pickup ? "P" : gross?.toString() ?? "";

            const net =
              raw && parRow
                ? netStablefordPointsForHole({
                    rawScore: raw,
                    par: parRow.par,
                    strokeIndex: parRow.stroke_index,
                    playingHandicap: hcpByPlayer.get(pid) ?? 0,
                  })
                : 0;

            return {
              hole,
              gross,
              pickup,
              net,
              shade: shadeForGross(gross, pickup, parRow.par),
            };
          };

          const a = makeScore(members[0].id);
          const b = makeScore(members[1].id);

          const better = Math.max(a.net, b.net);
          const contribA = a.net === better && better > 0;
          const contribB = b.net === better && better > 0;

          resultRows.push({ hole, a, b, better, contribA, contribB });
        }

        if (!alive) return;
        setPlayers(members);
        setRows(resultRows);
      } catch (e: any) {
        if (alive) setError(e.message ?? "Failed to load pair detail");
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, [groupId, roundId]);

  /* ----------------------------------
     Totals
  -----------------------------------*/
  const totals = useMemo(() => {
    let front = 0,
      back = 0,
      total = 0,
      contrib = 0;

    for (const r of rows) {
      const bb = r.better;
      total += bb;
      if (r.hole <= 9) front += bb;
      else back += bb;

      if (r.contribA) contrib += r.a.net;
      if (r.contribB) contrib += r.b.net;
    }

    return { front, back, total, contrib };
  }, [rows]);

  /* ----------------------------------
     Render
  -----------------------------------*/
  if (loading) return <div className="p-4">Loading…</div>;
  if (error) return <div className="p-4 text-red-600">{error}</div>;

  return (
    <div className="min-h-dvh bg-white text-gray-900 px-4 py-4">
      <button
        onClick={() => router.back()}
        className="mb-3 rounded-md border px-3 py-1 text-sm"
      >
        Back
      </button>

      <div className="text-lg font-bold mb-2">
        {players[0].name} / {players[1].name}
      </div>

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b">
            <th>Hole</th>
            <th>{players[0].name}</th>
            <th>Net</th>
            <th>{players[1].name}</th>
            <th>Net</th>
            <th>BB</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.hole} className="border-b text-center">
              <td>{r.hole}</td>

              <td style={shadeStyle(r.a.shade)}>{r.a.pickup ? "P" : r.a.gross ?? ""}</td>
              <td className={r.contribA ? "border border-dotted" : ""}>{r.a.net}</td>

              <td style={shadeStyle(r.b.shade)}>{r.b.pickup ? "P" : r.b.gross ?? ""}</td>
              <td className={r.contribB ? "border border-dotted" : ""}>{r.b.net}</td>

              <td className="font-bold">{r.better}</td>
            </tr>
          ))}

          <tr className="font-bold">
            <td>Out</td>
            <td colSpan={4}></td>
            <td>{totals.front}</td>
          </tr>
          <tr className="font-bold">
            <td>In</td>
            <td colSpan={4}></td>
            <td>{totals.back}</td>
          </tr>
          <tr className="font-bold">
            <td>Total</td>
            <td colSpan={4}></td>
            <td>{totals.total}</td>
          </tr>
          <tr className="font-bold">
            <td>Contribution</td>
            <td colSpan={4}></td>
            <td>{totals.contrib}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
