"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type SettingsRow = {
  tour_id: string;

  // Teams
  default_team_best_m: number | null;

  // Individual
  individual_mode: "ALL" | "BEST_N" | string;
  individual_best_n: number | null;
  individual_final_required: boolean;

  // Pairs
  pair_mode: "ALL" | "BEST_Q" | string;
  pair_best_q: number | null;
  pair_final_required: boolean;
};

type RoundRow = {
  id: string;
  tour_id: string;
  round_no: number | null;
  name: string | null;
};

type H2ZLegRow = {
  id?: string;
  tour_id: string;
  leg_no: number;
  start_round_no: number;
  end_round_no: number;
};

type BotBSettingsRow = {
  tour_id: string;
  enabled: boolean;
  round_nos: number[]; // int[]
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

function upper(v: any) {
  return String(v ?? "").trim().toUpperCase();
}

function uuidv4() {
  // Browser-safe UUID
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Fallback (very unlikely needed in modern browsers)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    // eslint-disable-next-line no-mixed-operators
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function uniqSortedInts(v: any): number[] {
  const arr = Array.isArray(v) ? v : [];
  const nums = arr
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.floor(n))
    .filter((n) => n > 0);
  nums.sort((a, b) => a - b);
  return Array.from(new Set(nums));
}

export default function ManageEventsPage() {
  const params = useParams<{ id: string }>();
  const tourId = String(params?.id ?? "").trim();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMsg, setSavedMsg] = useState("");

  // Form state — existing events settings
  const [individualMode, setIndividualMode] = useState<"ALL" | "BEST_N">("ALL");
  const [individualBestN, setIndividualBestN] = useState<string>("");
  const [individualFinalRequired, setIndividualFinalRequired] = useState(false);

  const [pairMode, setPairMode] = useState<"ALL" | "BEST_Q">("ALL");
  const [pairBestQ, setPairBestQ] = useState<string>("");
  const [pairFinalRequired, setPairFinalRequired] = useState(false);

  const [teamBestY, setTeamBestY] = useState<string>("1");

  // H2Z Legs state
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [h2zEnabled, setH2zEnabled] = useState<boolean>(false);
  const [legs, setLegs] = useState<Array<{ start_round_no: number; end_round_no: number }>>([]);

  // BotB state
  const [botbEnabled, setBotbEnabled] = useState<boolean>(false);
  const [botbRoundNos, setBotbRoundNos] = useState<number[]>([]);

  // Available round numbers for dropdowns
  const roundNumbers = useMemo(() => {
    const nums = rounds
      .map((r) => Number(r.round_no))
      .filter((n) => Number.isFinite(n)) as number[];
    nums.sort((a, b) => a - b);
    return Array.from(new Set(nums));
  }, [rounds]);

  const maxRoundNo = roundNumbers.length ? roundNumbers[roundNumbers.length - 1] : 1;

  // Preview summary
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

    const h2z =
      !h2zEnabled || legs.length === 0
        ? "Not configured"
        : legs.map((l, idx) => `Leg ${idx + 1}: R${l.start_round_no}–R${l.end_round_no}`).join(" · ");

    const botb =
      !botbEnabled
        ? "Disabled"
        : botbRoundNos.length === 0
        ? "Enabled (no rounds selected)"
        : `Enabled · Rounds: ${botbRoundNos.slice().sort((a, b) => a - b).map((x) => `R${x}`).join(", ")}`;

    return { indiv, pairs, teams, h2z, botb };
  }, [
    individualMode,
    individualBestN,
    individualFinalRequired,
    pairMode,
    pairBestQ,
    pairFinalRequired,
    teamBestY,
    h2zEnabled,
    legs,
    botbEnabled,
    botbRoundNos,
  ]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError("");
      setSavedMsg("");

      try {
        // 1) Load rounds (for dropdowns)
        const { data: rData, error: rErr } = await supabase
          .from("rounds")
          .select("id,tour_id,round_no,name")
          .eq("tour_id", tourId)
          .order("round_no", { ascending: true, nullsFirst: false });

        if (rErr) throw new Error(rErr.message);
        if (!alive) return;
        setRounds((rData ?? []) as RoundRow[]);

        // 2) Load tour_grouping_settings
        const { data, error: sErr } = await supabase
          .from("tour_grouping_settings")
          .select(
            "tour_id, default_team_best_m, individual_mode, individual_best_n, individual_final_required, pair_mode, pair_best_q, pair_final_required"
          )
          .eq("tour_id", tourId)
          .maybeSingle();

        if (sErr) throw new Error(sErr.message);

        // If missing row, seed it
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
        } else {
          const row = data as SettingsRow;
          if (!alive) return;

          const imode = upper(row.individual_mode) === "BEST_N" ? "BEST_N" : "ALL";
          setIndividualMode(imode);
          setIndividualBestN(row.individual_best_n != null ? String(row.individual_best_n) : "");
          setIndividualFinalRequired(row.individual_final_required === true);

          const pmode = upper(row.pair_mode) === "BEST_Q" ? "BEST_Q" : "ALL";
          setPairMode(pmode);
          setPairBestQ(row.pair_best_q != null ? String(row.pair_best_q) : "");
          setPairFinalRequired(row.pair_final_required === true);

          const y = Number.isFinite(Number(row.default_team_best_m)) ? String(Number(row.default_team_best_m)) : "1";
          setTeamBestY(y);
        }

        // 3) Load existing H2Z legs
        const { data: lData, error: lErr } = await supabase
          .from("tour_h2z_legs")
          .select("id,tour_id,leg_no,start_round_no,end_round_no")
          .eq("tour_id", tourId)
          .order("leg_no", { ascending: true });

        if (lErr) throw new Error(lErr.message);
        if (!alive) return;

        const existing = (lData ?? []) as H2ZLegRow[];
        if (existing.length) {
          setH2zEnabled(true);
          setLegs(
            existing
              .slice()
              .sort((a, b) => a.leg_no - b.leg_no)
              .map((x) => ({
                start_round_no: Number(x.start_round_no),
                end_round_no: Number(x.end_round_no),
              }))
          );
        } else {
          setH2zEnabled(false);
          setLegs([]);
        }

        // 4) Load BotB settings (optional row)
        const { data: bData, error: bErr } = await supabase
          .from("tour_botb_settings")
          .select("tour_id,enabled,round_nos")
          .eq("tour_id", tourId)
          .maybeSingle();

        if (bErr) throw new Error(bErr.message);
        if (!alive) return;

        if (!bData) {
          setBotbEnabled(false);
          setBotbRoundNos([]);
        } else {
          const row = bData as BotBSettingsRow;
          setBotbEnabled(row.enabled === true);
          setBotbRoundNos(uniqSortedInts((row as any).round_nos));
        }
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load settings.");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    if (tourId) void load();

    return () => {
      alive = false;
    };
  }, [tourId]);

  function addLeg() {
    const start = Math.min(1, maxRoundNo);
    const end = Math.min(maxRoundNo, start);
    setLegs((prev) => [...prev, { start_round_no: start, end_round_no: end }]);
    setH2zEnabled(true);
  }

  function removeLeg(idx: number) {
    setLegs((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateLeg(idx: number, patch: Partial<{ start_round_no: number; end_round_no: number }>) {
    setLegs((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        return { ...l, ...patch };
      })
    );
  }

  function validateH2Z(): string | null {
    if (!h2zEnabled) return null;
    if (legs.length === 0) return "H2Z is enabled but no legs are defined. Add at least 1 leg (or disable H2Z).";
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i];
      if (!Number.isFinite(l.start_round_no) || !Number.isFinite(l.end_round_no)) return `Leg ${i + 1}: invalid round numbers.`;
      if (l.start_round_no > l.end_round_no) return `Leg ${i + 1}: start round must be ≤ end round.`;
      if (l.start_round_no < 1 || l.end_round_no < 1) return `Leg ${i + 1}: round numbers must be ≥ 1.`;
    }
    return null;
  }

  function validateBotB(): string | null {
    if (!botbEnabled) return null;
    if (botbRoundNos.length === 0) return "BotB is enabled but no rounds are selected. Select at least 1 round (or disable BotB).";
    return null;
  }

  function toggleBotbRound(n: number) {
    setBotbRoundNos((prev) => {
      const set = new Set(prev);
      if (set.has(n)) set.delete(n);
      else set.add(n);
      const out = Array.from(set);
      out.sort((a, b) => a - b);
      return out;
    });
  }

  async function onSaveAll() {
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

      // Validate H2Z
      const h2zErr = validateH2Z();
      if (h2zErr) throw new Error(h2zErr);

      // Validate BotB
      const botbErr = validateBotB();
      if (botbErr) throw new Error(botbErr);

      // 1) Save tour_grouping_settings
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

      // 2) Save H2Z legs
      // Cleanest approach: delete existing legs for tour, then insert the new set
      const { error: delErr } = await supabase.from("tour_h2z_legs").delete().eq("tour_id", tourId);
      if (delErr) throw new Error(delErr.message);

      if (h2zEnabled && legs.length > 0) {
        const now = new Date().toISOString();
        const rows: H2ZLegRow[] = legs.map((l, idx) => ({
          id: uuidv4(),
          tour_id: tourId,
          leg_no: idx + 1,
          start_round_no: Number(l.start_round_no),
          end_round_no: Number(l.end_round_no),
        }));

        // If your table auto-fills created_at/updated_at, you can omit them.
        // We'll include them only if your schema requires them; Supabase will ignore extra if not present.
        const insertPayload = rows.map((r) => ({
          id: r.id,
          tour_id: r.tour_id,
          leg_no: r.leg_no,
          start_round_no: r.start_round_no,
          end_round_no: r.end_round_no,
          created_at: now,
          updated_at: now,
        }));

        const { error: insErr } = await supabase.from("tour_h2z_legs").insert(insertPayload);
        if (insErr) throw new Error(insErr.message);
      }

      // 3) Save BotB settings (upsert row)
      const botbPayload: BotBSettingsRow = {
        tour_id: tourId,
        enabled: botbEnabled === true,
        round_nos: uniqSortedInts(botbRoundNos),
      };

      const { error: botbUpErr } = await supabase.from("tour_botb_settings").upsert(botbPayload, { onConflict: "tour_id" });
      if (botbUpErr) throw new Error(botbUpErr.message);

      setSavedMsg("Saved ✅");
      setTimeout(() => setSavedMsg(""), 1500);
    } catch (e: any) {
      setError(e?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: 16 }}>Loading event settings…</div>;

  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ fontWeight: 800, color: "crimson" }}>Error</div>
        <div style={{ marginTop: 8 }}>{error}</div>
        <div style={{ marginTop: 12 }}>
          <Link href={`/tours/${tourId}`}>← Back to Tour</Link>
        </div>
      </div>
    );
  }

  const hasRounds = roundNumbers.length > 0;

  return (
    <div style={{ padding: 16, maxWidth: 820 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, margin: 0 }}>Manage events</h1>
        <Link href={`/tours/${tourId}`}>← Back to Tour</Link>
      </div>

      <p style={{ marginTop: 8, color: "#444" }}>These settings are saved per tour and used by leaderboards (desktop + mobile).</p>

      {/* Individual */}
      <section style={{ marginTop: 18, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Individual (Stableford)</div>

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
            <input type="checkbox" checked={individualFinalRequired} onChange={(e) => setIndividualFinalRequired(e.target.checked)} />
            Final required
          </label>
        </div>
      </section>

      {/* Pairs */}
      <section style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Pairs (Better Ball)</div>

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
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Teams</div>

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

      {/* BotB */}
      <section style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Best of the Best (BotB)</div>
        <div style={{ color: "#555", fontSize: 13, marginBottom: 10 }}>
          BotB score = <b>sum of Individual Stableford totals</b> for the selected rounds.
        </div>

        <label style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={botbEnabled}
            onChange={(e) => {
              const on = e.target.checked;
              setBotbEnabled(on);
              if (!on) setBotbRoundNos([]);
            }}
          />
          Enable BotB for this tour
        </label>

        {!hasRounds ? (
          <div style={{ padding: 10, borderRadius: 8, border: "1px solid #eee", background: "#fafafa", color: "#666" }}>
            No rounds with <code>round_no</code> found yet. Add rounds with round numbers first, then select BotB rounds.
          </div>
        ) : !botbEnabled ? (
          <div style={{ color: "#666" }}>BotB is disabled.</div>
        ) : (
          <div style={{ padding: 10, borderRadius: 10, border: "1px solid #eee", background: "white" }}>
            <div style={{ fontWeight: 800, marginBottom: 8 }}>Select rounds to include</div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {roundNumbers.map((n) => {
                const checked = botbRoundNos.includes(n);
                return (
                  <label key={n} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleBotbRound(n)} />
                    <span style={{ fontWeight: 800 }}>R{n}</span>
                  </label>
                );
              })}
            </div>

            <div style={{ marginTop: 10, fontSize: 12, color: botbRoundNos.length ? "#555" : "crimson", fontWeight: 700 }}>
              {botbRoundNos.length
                ? `Selected: ${botbRoundNos.map((x) => `R${x}`).join(", ")}`
                : "Select at least 1 round (required when BotB is enabled)."}
            </div>
          </div>
        )}
      </section>

      {/* H2Z Legs */}
      <section style={{ marginTop: 12, padding: 12, border: "1px solid #ddd", borderRadius: 10 }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Hero to Zero (H2Z)</div>
        <div style={{ color: "#555", fontSize: 13, marginBottom: 10 }}>
          Cumulative Stableford score on <b>Par 3 holes</b>, reset to <b>0</b> whenever a player scores <b>0 points</b> on a Par 3 hole.
          Legs define which rounds are included (e.g. R1–R3, R4–R6).
        </div>

        <label style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
          <input
            type="checkbox"
            checked={h2zEnabled}
            onChange={(e) => {
              const on = e.target.checked;
              setH2zEnabled(on);
              if (on && legs.length === 0) {
                setLegs([{ start_round_no: 1, end_round_no: Math.max(1, maxRoundNo) }]);
              }
              if (!on) setLegs([]);
            }}
          />
          Enable H2Z for this tour
        </label>

        {!hasRounds ? (
          <div style={{ padding: 10, borderRadius: 8, border: "1px solid #eee", background: "#fafafa", color: "#666" }}>
            No rounds with round numbers found yet. Add rounds (with round_no) first, then configure H2Z legs.
          </div>
        ) : !h2zEnabled ? (
          <div style={{ color: "#666" }}>H2Z is disabled.</div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div style={{ fontWeight: 800 }}>Legs</div>
              <button
                type="button"
                onClick={addLeg}
                style={{
                  padding: "8px 10px",
                  borderRadius: 10,
                  border: "1px solid #ccc",
                  background: "white",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                + Add leg
              </button>
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
              {legs.length === 0 ? (
                <div style={{ color: "#666" }}>No legs defined. Click “Add leg”.</div>
              ) : (
                legs.map((leg, idx) => {
                  const badRange = leg.start_round_no > leg.end_round_no;
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: 10,
                        borderRadius: 10,
                        border: `1px solid ${badRange ? "#f3c1c1" : "#eee"}`,
                        background: badRange ? "#fff2f2" : "white",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                        <div style={{ fontWeight: 900 }}>Leg {idx + 1}</div>
                        <button
                          type="button"
                          onClick={() => removeLeg(idx)}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 10,
                            border: "1px solid #ddd",
                            background: "white",
                            cursor: "pointer",
                            fontWeight: 800,
                          }}
                        >
                          Remove
                        </button>
                      </div>

                      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                        <label>
                          Start round{" "}
                          <select value={leg.start_round_no} onChange={(e) => updateLeg(idx, { start_round_no: Number(e.target.value) })}>
                            {roundNumbers.map((n) => (
                              <option key={n} value={n}>
                                R{n}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label>
                          End round{" "}
                          <select value={leg.end_round_no} onChange={(e) => updateLeg(idx, { end_round_no: Number(e.target.value) })}>
                            {roundNumbers.map((n) => (
                              <option key={n} value={n}>
                                R{n}
                              </option>
                            ))}
                          </select>
                        </label>

                        {badRange ? (
                          <span style={{ color: "crimson", fontWeight: 800 }}>Start must be ≤ End</span>
                        ) : (
                          <span style={{ color: "#666" }}>
                            Column heading: <b>H2Z: R{leg.start_round_no} - R{leg.end_round_no}</b>
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </section>

      {/* Preview */}
      <section style={{ marginTop: 12, padding: 12, border: "1px dashed #bbb", borderRadius: 10, background: "#fafafa" }}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Preview</div>
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
          <div style={{ marginTop: 4 }}>
            <strong>BotB:</strong> {preview.botb}
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>H2Z:</strong> {preview.h2z}
          </div>
        </div>
      </section>

      <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onSaveAll}
          disabled={saving}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #111",
            background: saving ? "#ddd" : "#111",
            color: saving ? "#333" : "#fff",
            fontWeight: 900,
            cursor: saving ? "default" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>

        {savedMsg ? <span style={{ color: "green", fontWeight: 900 }}>{savedMsg}</span> : null}

        <button
          type="button"
          onClick={() => router.push(`/tours/${tourId}`)}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ccc",
            background: "#fff",
            color: "#111",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Done
        </button>
      </div>

      <div style={{ marginTop: 10, color: "#666", fontSize: 12 }}>
        Tip: if you ever need to confirm the folder exists in PowerShell when it contains <code>[id]</code>, use <code>-LiteralPath</code>.
      </div>
    </div>
  );
}
