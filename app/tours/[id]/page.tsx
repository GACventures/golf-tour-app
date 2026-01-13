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

// (other types unchanged — omitted here for brevity)
type Course = { id: string; name: string; tour_id: string | null };
type Player = { id: string; name: string; start_handicap: number };
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

  // Edit state (safe + explicit)
  const [editing, setEditing] = useState(false);
  const [rehEnabled, setRehEnabled] = useState(false);
  const [handicapSummary, setHandicapSummary] = useState("");
  const [rehSummary, setRehSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  async function loadTour() {
    setLoading(true);
    setError("");

    const { data, error } = await supabase
      .from("tours")
      .select("id,name,rehandicapping_enabled,handicap_rules_summary,rehandicapping_rules_summary")
      .eq("id", tourId)
      .maybeSingle();

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setTour(data as Tour);

    setRehEnabled(data?.rehandicapping_enabled === true);
    setHandicapSummary(data?.handicap_rules_summary ?? "");
    setRehSummary(data?.rehandicapping_rules_summary ?? "");

    setLoading(false);
  }

  useEffect(() => {
    void loadTour();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  async function saveHandicappingSettings() {
    setSaving(true);
    setSaveMsg("");

    const { error } = await supabase
      .from("tours")
      .update({
        rehandicapping_enabled: rehEnabled,
        handicap_rules_summary: cleanText(handicapSummary),
        rehandicapping_rules_summary: rehEnabled ? cleanText(rehSummary) : null,
      })
      .eq("id", tourId);

    if (error) {
      setSaveMsg(`Save failed: ${error.message}`);
      setSaving(false);
      return;
    }

    setSaveMsg("Saved ✓");
    setEditing(false);
    await loadTour();
    setSaving(false);
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
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>{tour?.name}</h1>

      {/* MAIN OVERVIEW CONTENT (unchanged above) */}
      <div style={{ marginTop: 24 }}>
        <Link href={`/tours/${tourId}/players`}>Manage players →</Link>
      </div>

      <div style={{ marginTop: 24 }}>
        <Link href={`/tours/${tourId}/rounds`}>Manage rounds →</Link>
      </div>

      {/* ===================== */}
      {/* REHANDICAPPING (BOTTOM) */}
      {/* ===================== */}
      <h2 style={{ marginTop: 48, fontSize: 18, fontWeight: 700 }}>Handicapping</h2>

      {!editing ? (
        <div style={{ marginTop: 8, color: "#333", lineHeight: 1.5 }}>
          <div>
            <strong>Baseline rules:</strong>{" "}
            <span style={{ color: "#555" }}>
              {cleanText(tour?.handicap_rules_summary) ??
                "Not specified."}
            </span>
          </div>

          <div style={{ marginTop: 8 }}>
            <strong>Rehandicapping:</strong>{" "}
            <span style={{ fontWeight: 600 }}>
              {tour?.rehandicapping_enabled ? "Yes" : "No"}
            </span>
          </div>

          <div style={{ marginTop: 6, color: "#555" }}>
            {tour?.rehandicapping_enabled
              ? cleanText(tour?.rehandicapping_rules_summary) ??
                "Rehandicapping enabled (no summary set)."
              : "No rehandicapping."}
          </div>

          <button
            type="button"
            onClick={() => setEditing(true)}
            style={{ marginTop: 12 }}
          >
            Edit handicapping rules
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 12, maxWidth: 720 }}>
          <label style={{ display: "block", fontWeight: 600 }}>
            Baseline handicapping rules
          </label>
          <textarea
            value={handicapSummary}
            onChange={(e) => setHandicapSummary(e.target.value)}
            rows={3}
            style={{ width: "100%", marginTop: 6 }}
          />

          <label style={{ display: "block", marginTop: 12 }}>
            <input
              type="checkbox"
              checked={rehEnabled}
              onChange={(e) => setRehEnabled(e.target.checked)}
              style={{ marginRight: 6 }}
            />
            Rehandicapping enabled
          </label>

          {rehEnabled && (
            <>
              <label style={{ display: "block", marginTop: 12, fontWeight: 600 }}>
                Rehandicapping rules summary
              </label>
              <textarea
                value={rehSummary}
                onChange={(e) => setRehSummary(e.target.value)}
                rows={4}
                style={{ width: "100%", marginTop: 6 }}
              />
            </>
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
            <button onClick={saveHandicappingSettings} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
          </div>

          {saveMsg && (
            <div style={{ marginTop: 8, fontSize: 13 }}>{saveMsg}</div>
          )}
        </div>
      )}
    </div>
  );
}
