// app/m/tours/[id]/matches/format/[roundId]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RoundRow = {
  id: string;
  round_no: number | null;
  round_date?: string | null; // may not exist
  played_on?: string | null; // may not exist
  created_at: string | null;
  courses?: { name: string } | { name: string }[] | null;
};

type GroupRow = { id: string; name: string | null };

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

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isMissingColumnError(msg: string, column: string) {
  const m = String(msg ?? "").toLowerCase();
  const c = column.toLowerCase();
  return m.includes("does not exist") && (m.includes(`.${c}`) || m.includes(`"${c}"`) || m.includes(` ${c} `));
}

function getCourseName(r: RoundRow | null) {
  if (!r) return "";
  const c: any = r.courses;
  if (!c) return "";
  if (Array.isArray(c)) return c?.[0]?.name ?? "";
  return c?.name ?? "";
}

function pickBestRoundDateISO(r: RoundRow | null): string | null {
  if (!r) return null;
  return (r as any).round_date ?? (r as any).played_on ?? r.created_at ?? null;
}

function parseDateForDisplay(s: string | null): Date | null {
  if (!s) return null;
  const raw = String(s).trim();
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const iso = isDateOnly ? `${raw}T00:00:00.000Z` : raw;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtAuMelbourneDate(d: Date | null): string {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Melbourne",
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")} ${get("year")}`.replace(/\s+/g, " ");
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

export default function MatchesFormatRoundDetailPage() {
  const params = useParams<{ id?: string; roundId?: string }>();
  const tourId = String(params?.id ?? "").trim();
  const roundId = String(params?.roundId ?? "").trim();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [errorMsg, setErrorMsg] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  const [round, setRound] = useState<RoundRow | null>(null);
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [existing, setExisting] = useState<SettingsRow | null>(null);

  // form state
  const [format, setFormat] = useState<MatchFormat>("INDIVIDUAL_MATCHPLAY");
  const [groupAId, setGroupAId] = useState<string>("");
  const [groupBId, setGroupBId] = useState<string>("");
  const [doublePoints, setDoublePoints] = useState<boolean>(false);

  useEffect(() => {
    if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId)) return;

    let alive = true;

    async function fetchRound(selectCols: string) {
      return supabase.from("rounds").select(selectCols).eq("id", roundId).single();
    }

    async function load() {
      setLoading(true);
      setErrorMsg("");
      setSaveMsg("");

      try {
        // 1) Round meta with column-fallback (round_date may not exist)
        const baseCols = "id,round_no,created_at,courses(name)";
        const cols1 = `${baseCols},round_date,played_on`;
        const cols2 = `${baseCols},played_on`;

        let rRow: any = null;

        const r1 = await fetchRound(cols1);
        if (r1.error) {
          if (isMissingColumnError(r1.error.message, "round_date")) {
            const r2 = await fetchRound(cols2);
            if (r2.error) {
              if (isMissingColumnError(r2.error.message, "played_on")) {
                const r3 = await fetchRound(baseCols);
                if (r3.error) throw r3.error;
                rRow = r3.data;
              } else {
                throw r2.error;
              }
            } else {
              rRow = r2.data;
            }
          } else {
            throw r1.error;
          }
        } else {
          rRow = r1.data;
        }

        // 2) Tour groups (teams/pairs) - fixed for tour => round_id is null
        const { data: gRows, error: gErr } = await supabase
          .from("tour_groups")
          .select("id,name")
          .eq("tour_id", tourId)
          .is("round_id", null)
          .order("name", { ascending: true });
        if (gErr) throw gErr;

        // 3) Existing settings (one per round)
        const { data: sRow, error: sErr } = await supabase
          .from("match_round_settings")
          .select("id,tour_id,round_id,group_a_id,group_b_id,format,double_points,created_at,updated_at")
          .eq("round_id", roundId)
          .maybeSingle();
        if (sErr) throw sErr;

        if (!alive) return;

        setRound(rRow as any);
        setGroups((gRows ?? []) as any);

        const ex = (sRow ?? null) as any as SettingsRow | null;
        setExisting(ex);

        if (ex) {
          setFormat(ex.format);
          setGroupAId(ex.group_a_id);
          setGroupBId(ex.group_b_id);
          setDoublePoints(ex.double_points === true);
        } else {
          // defaults: first two groups if present
          const arr = (gRows ?? []) as any[];
          const a = arr?.[0]?.id ? String(arr[0].id) : "";
          const b = arr?.[1]?.id ? String(arr[1].id) : "";
          setGroupAId(a);
          setGroupBId(b);
          setDoublePoints(false);
          setFormat("INDIVIDUAL_MATCHPLAY");
        }
      } catch (e: any) {
        if (!alive) return;
        setErrorMsg(e?.message ?? "Failed to load match format setup.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [tourId, roundId]);

  const roundTitle = useMemo(() => {
    const rn = round?.round_no;
    const label = rn != null ? `Round ${rn}` : "Round";
    const d = fmtAuMelbourneDate(parseDateForDisplay(pickBestRoundDateISO(round)));
    const course = getCourseName(round);
    const bits = [label, d || "", course || ""].filter(Boolean);
    return bits.join(" · ");
  }, [round]);

  const dirty = useMemo(() => {
    if (!existing) return Boolean(groupAId && groupBId);
    return (
      existing.format !== format ||
      existing.group_a_id !== groupAId ||
      existing.group_b_id !== groupBId ||
      (existing.double_points === true) !== (doublePoints === true)
    );
  }, [existing, format, groupAId, groupBId, doublePoints]);

  const canSave = useMemo(() => {
    if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId)) return false;
    if (!isLikelyUuid(groupAId) || !isLikelyUuid(groupBId)) return false;
    if (groupAId === groupBId) return false;
    return dirty && !saving;
  }, [tourId, roundId, groupAId, groupBId, dirty, saving]);

  async function save() {
    setSaving(true);
    setErrorMsg("");
    setSaveMsg("");

    try {
      const payload = {
        tour_id: tourId,
        round_id: roundId,
        group_a_id: groupAId,
        group_b_id: groupBId,
        format,
        double_points: doublePoints === true,
      };

      const { data, error } = await supabase
        .from("match_round_settings")
        .upsert(payload, { onConflict: "round_id" })
        .select("id,tour_id,round_id,group_a_id,group_b_id,format,double_points,created_at,updated_at")
        .single();

      if (error) throw error;

      const saved = data as any as SettingsRow;
      setExisting(saved);
      setSaveMsg(`Saved: ${formatLabel(saved.format)}${saved.double_points ? " (double points)" : ""}.`);
    } catch (e: any) {
      const msg = String(e?.message ?? "Save failed.");
      if (msg.toLowerCase().includes("match_round_settings_groups_distinct")) {
        setErrorMsg("Team A and Team B must be different.");
      } else if (msg.toLowerCase().includes("match_round_settings_format_check")) {
        setErrorMsg("Invalid format value (does not match database constraint).");
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!isLikelyUuid(tourId) || !isLikelyUuid(roundId)) {
    return (
      <div className="min-h-dvh bg-white text-gray-900 pb-10">
        <div className="mx-auto w-full max-w-md px-4 py-6">
          <div className="rounded-2xl border p-4 text-sm">Missing or invalid tour/round id in route.</div>
          <div className="mt-4">
            <Link className="underline text-sm" href={`/m/tours/${safeText(tourId)}/matches/format`}>
              Back
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const pillBase = "flex-1 h-10 rounded-xl border text-sm font-semibold flex items-center justify-center";
  const pillActive = "border-gray-900 bg-gray-900 text-white";
  const pillIdle = "border-gray-200 bg-white text-gray-900";

  return (
    <div className="min-h-dvh bg-white text-gray-900 pb-10">
      <div className="sticky top-0 z-10 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto w-full max-w-md px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-semibold">Matches – Format</div>
            <div className="truncate text-sm text-gray-500">{roundTitle || "Configure this round"}</div>
          </div>

          <Link
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm active:bg-gray-50"
            href={`/m/tours/${tourId}/matches/format`}
          >
            Back
          </Link>
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 py-4 space-y-4">
        {loading ? (
          <div className="space-y-3">
            <div className="h-24 rounded-2xl border bg-white" />
            <div className="h-24 rounded-2xl border bg-white" />
          </div>
        ) : errorMsg ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{errorMsg}</div>
        ) : (
          <>
            {/* Format */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Format</div>
                <div className="mt-1 text-xs text-gray-600">Choose the scoring format for this round.</div>
              </div>

              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={`${pillBase} ${format === "INDIVIDUAL_MATCHPLAY" ? pillActive : pillIdle}`}
                    onClick={() => {
                      setSaveMsg("");
                      setErrorMsg("");
                      setFormat("INDIVIDUAL_MATCHPLAY");
                    }}
                    aria-pressed={format === "INDIVIDUAL_MATCHPLAY"}
                  >
                    Ind Matchplay
                  </button>

                  <button
                    type="button"
                    className={`${pillBase} ${format === "BETTERBALL_MATCHPLAY" ? pillActive : pillIdle}`}
                    onClick={() => {
                      setSaveMsg("");
                      setErrorMsg("");
                      setFormat("BETTERBALL_MATCHPLAY");
                    }}
                    aria-pressed={format === "BETTERBALL_MATCHPLAY"}
                  >
                    Better Ball
                  </button>

                  <button
                    type="button"
                    className={`${pillBase} ${format === "INDIVIDUAL_STABLEFORD" ? pillActive : pillIdle}`}
                    onClick={() => {
                      setSaveMsg("");
                      setErrorMsg("");
                      setFormat("INDIVIDUAL_STABLEFORD");
                    }}
                    aria-pressed={format === "INDIVIDUAL_STABLEFORD"}
                  >
                    Stableford
                  </button>
                </div>

                <div className="text-xs text-gray-600">
                  Selected: <span className="font-semibold text-gray-900">{formatLabel(format)}</span>
                </div>
              </div>
            </section>

            {/* Teams + double points */}
            <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="p-4 border-b">
                <div className="text-sm font-semibold text-gray-900">Teams</div>
                <div className="mt-1 text-xs text-gray-600">
                  Select the two tour groups that are competing this round (Team A vs Team B).
                </div>
              </div>

              <div className="p-4 space-y-3">
                {groups.length < 2 ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    This tour has fewer than 2 groups in <span className="font-semibold">tour_groups</span>. Create at least two
                    teams/pairs before configuring matches.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Team A</label>
                        <select
                          className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-sm"
                          value={groupAId}
                          onChange={(e) => {
                            setSaveMsg("");
                            setErrorMsg("");
                            setGroupAId(e.target.value);
                          }}
                        >
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {safeText(g.name, "(unnamed)")}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1">Team B</label>
                        <select
                          className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 shadow-sm"
                          value={groupBId}
                          onChange={(e) => {
                            setSaveMsg("");
                            setErrorMsg("");
                            setGroupBId(e.target.value);
                          }}
                        >
                          {groups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {safeText(g.name, "(unnamed)")}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {groupAId === groupBId ? <div className="text-xs text-red-700">Team A and Team B must be different.</div> : null}

                    <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">Double points</div>
                        <div className="text-xs text-gray-600">If enabled, all match points for this round are doubled.</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSaveMsg("");
                          setErrorMsg("");
                          setDoublePoints((v) => !v);
                        }}
                        className={`h-9 w-20 rounded-xl border text-sm font-semibold shadow-sm ${
                          doublePoints ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-900"
                        }`}
                        aria-pressed={doublePoints}
                      >
                        {doublePoints ? "On" : "Off"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </section>

            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-gray-600">{dirty ? "Change pending" : "No pending change"}</div>

              <button
                type="button"
                onClick={save}
                disabled={!canSave}
                className={`h-10 rounded-xl px-4 text-sm font-semibold border shadow-sm ${
                  !canSave
                    ? "border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed"
                    : "border-gray-900 bg-gray-900 text-white active:bg-gray-800"
                }`}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>

            {saveMsg ? <div className="text-sm text-green-700">{saveMsg}</div> : null}

            {existing ? (
              <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
                Next: we’ll add match setup (player assignments) for this round based on the selected format.
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
