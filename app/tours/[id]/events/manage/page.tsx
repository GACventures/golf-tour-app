"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type SettingsRow = {
  tour_id: string;

  // Teams (already existed)
  default_team_best_m: number | null;

  // Individual (Step 1)
  individual_mode: "ALL" | "BEST_N" | string;
  individual_best_n: number | null;
  individual_final_required: boolean;

  // Pairs (Step 1)
  pair_mode: "ALL" | "BEST_Q" | string;
  pair_best_q: number | null;
  pair_final_required: boolean;
};

function asIntOrNull(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i > 0 ? i : null;
}

function clampInt(v: number | null, min: number, max: number) {
  if (v == null) return null;
  const n = Math.floor(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

export default function ManageEventsPage() {
  const params = useParams<{ id: string }>();
  const tourId = params.id;
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  // Form state
  const [individualMode, setIndividualMode] = useState<"ALL" | "BEST_N">("ALL");
  const [individualBestN, setIndividualBestN] = useState<string>("");
  const [individualFinalRequired, setIndividualFinalRequired] = useState(false);

  const [pairMode, setPairMode] = useState<"ALL" | "BEST_Q">("ALL");
  const [pairBestQ, setPairBestQ] = useState<string>("");
  const [pairFinalRequired, setPairFinalRequired] = useState(false);

  const [teamBestY, setTeamBestY] = useState<string>("1");

  // A simple derived “summary” for confidence
  const preview = useMemo(() => {
    const n = asIntOrNull(individualBestN);
    const q = asIntOrNull(pairBestQ);
    const y = asIntOrNull(teamBestY) ?? 1;

    const indiv =
      individualMode === "ALL"
        ? "All rounds"
        : `Best ${n ?? "N"} rounds${individualFinalRequired ? " (Final required)" : ""}`;

    const pairs =
      pairMode === "ALL" ? "All rounds" : `Best ${q ?? "Q"} rounds${pairFinalRequired ? " (Final required)" : ""}`;

    const teams = `Best ${y} per hole, −1 per zero (all rounds)`;

    return { indiv, pairs, teams };
  }, [individualMode, individualBestN, individualFinalRequired, pairMode, pairBestQ, pairFinalRequired, teamBestY]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError("");
      setSavedMsg("");

      try {
        const { data, error: sErr } = await supabase
          .from("tour_grouping_settings")
          .select(
            "tour_id, default_team_best_m, individual_mode, individual_best_n, individual_final_required, pair_mode, pair_best_q, pair_final_required"
          )
          .eq("tour_id", tourId)
          .maybeSingle();

        if (sErr) throw new Error(sErr.message);

        // If missing row (shouldn’t happen after Step 1C, but handle anyway)
        if (!data) {
          const seed: SettingsRow = {
            tour_id: tourId,
            default_team_best_m: 1,
            individual_mode: "ALL",
            individual_best_n: null,
            individual_final_required: false,
            pair_mode: "ALL",
            pair_best_q: null,
            pair_final_required: false,
          };

          const { error: upErr } = await supabase.from("tour_grouping_settings").upsert(seed, { onConflict: "tour_id" });
          if (upErr) throw new Error(upErr.message);

          if (!alive) return;
          setIndividualMode("ALL");
          setIndividualBestN("");
          setIndividualFinalRequired(false);

          setPairMode("ALL");
          setPairBestQ("");
          setPairFinalRequired(false);

          setTeamBestY("1");
          return;
        }

        const row = data as SettingsRow;

        if (!alive) return;

        const imode = String(row.individual_mode ?? "ALL").toUpperCase() === "BEST_N" ? "BEST_N" : "ALL";
        setIndividualMode(imode);
        setIndividualBestN(row.individual_best_n != null ? String(row.individual_best_n) : "");
        setIndividualFinalRequired(row.individual_final_required === true);

        const pmode = String(row.pair_mode ?? "ALL").toUpperCase() === "BEST_Q" ? "BEST_Q" : "ALL";
        setPairMode(pmode);
        setPairBestQ(row.pair_best_q != null ? String(row.pair_best_q) : "");
        setPairFinalRequired(row.pair_final_required === true);

        const y = Number.isFinite(Number(row.default_team_best_m)) ? String(Number(row.default_team_best_m)) : "1";
        setTeamBestY(y);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load settings.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    void load();

    return () => {
      alive = false;
    };
  }, [tourId]);

  async function onSave() {
    setSaving(true);
    setError("");
    setSavedMsg("");

    try {
      // Parse + clamp inputs
      const nRaw = individualMode === "BEST_N" ? asIntOrNull(individualBestN) : null;
      const qRaw = pairMode === "BEST_Q" ? asIntOrNull(pairBestQ) : null;
      const yRaw = asIntOrNull(teamBestY) ?? 1;

      const n = clampInt(nRaw, 1, 99);
      const q = clampInt(qRaw, 1, 99);
      const y = clampInt(yRaw, 1, 99) ?? 1;

      const payload: SettingsRow = {
        tour_id: tourId,

        default_team_best_m: y,

        individual_mode: individualMode,
        individual_best_n: individualMode === "BEST_N" ? n : null,
        individual_final_required: individualFinalRequired,

        pair_mode: pairMode,
        pair_best_q: pairMode === "BEST_Q" ? q : null,
        pair_final_required: pairFinalRequired,
      };

      const { error: upErr } = await supabase.from("tour_grouping_settings").upsert(payload, { onConflict: "tour_id" });
      if (upErr) throw new Error(upErr.message);

      setSavedMsg("Saved ✅");
      // Refresh the previous page if they go back
    } catch (e: any) {
      setError(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 16 }}>Loading event settings…</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontWeight: 700, color: "crimson" }}>Error</div>
        <div style={{ marginTop: 8 }}>{error}</div>
        <div style={{ marginTop: 12 }}>
          <Link href={`/tours/${tourId}`}>← Back to Tour</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Manage events</h1>
        <Link href={`/tours/${tourId}`}>← Back to Tour</Link>
      </div>

      <p style={{ marginTop: 8, color: "#444" }}>
        These settings are saved per tour and used by leaderboards (desktop + mobile).
      </p>

      {/* Individual */}
      <section style={{ marginTop: 18, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Individual (Stableford)</div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label>
            Mode{" "}
            <select value={individualMode} onChange={(e) => setIndividualMode(e.target.value as any)}>
              <option value="ALL">All rounds</option>
              <option value="BEST_N">Best N rounds</option>
            </select>
          </label>

          <label>
            N{" "}
            <input
              style={{ width: 80 }}
              type="number"
              min={1}
              max={99}
              disabled={individualMode !== "BEST_N"}
              value={individualBestN}
              onChange={(e) => setIndividualBestN(e.target.value)}
              placeholder="e.g. 3"
            />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={individualFinalRequired}
              onChange={(e) => setIndividualFinalRequired(e.target.checked)}
            />
            Final required
          </label>
        </div>
      </section>

      {/* Pairs */}
      <section style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Pairs (Better Ball)</div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label>
            Mode{" "}
            <select value={pairMode} onChange={(e) => setPairMode(e.target.value as any)}>
              <option value="ALL">All rounds</option>
              <option value="BEST_Q">Best Q rounds</option>
            </select>
          </label>

          <label>
            Q{" "}
            <input
              style={{ width: 80 }}
              type="number"
              min={1}
              max={99}
              disabled={pairMode !== "BEST_Q"}
              value={pairBestQ}
              onChange={(e) => setPairBestQ(e.target.value)}
              placeholder="e.g. 2"
            />
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={pairFinalRequired} onChange={(e) => setPairFinalRequired(e.target.checked)} />
            Final required
          </label>
        </div>
      </section>

      {/* Teams */}
      <section style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Teams</div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label>
            Best Y per hole{" "}
            <input
              style={{ width: 80 }}
              type="number"
              min={1}
              max={99}
              value={teamBestY}
              onChange={(e) => setTeamBestY(e.target.value)}
            />
          </label>

          <div style={{ color: "#555" }}>Penalty: −1 for each zero among the considered scores</div>
        </div>
      </section>

      {/* Preview */}
      <section style={{ marginTop: 12, padding: 12, border: "1px dashed #bbb", borderRadius: 10, background: "#fafafa" }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Preview (what Tour Overview will show)</div>
        <div style={{ color: "#333" }}>
          <div>
            <strong>Individual:</strong> {preview.indiv}
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>Pairs:</strong> {preview.pairs}
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>Teams:</strong> {preview.teams}
          </div>
        </div>
      </section>

      <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #111",
            background: saving ? "#ddd" : "#111",
            color: saving ? "#333" : "#fff",
            fontWeight: 800,
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>

        {savedMsg ? <span style={{ color: "green", fontWeight: 700 }}>{savedMsg}</span> : null}

        <button
          type="button"
          onClick={() => router.push(`/tours/${tourId}`)}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "#fff",
            color: "#111",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
