"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type ScoreEntryLayout = "classic" | "alt";

type Tour = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
  rehandicapping_enabled: boolean;
  score_entry_layout: ScoreEntryLayout;
  matchplay_active: boolean;
  image_url: string | null;
  handicap_rules_summary: string | null;
  rehandicapping_rules_summary: string | null;
  rehandicapping_rule_key: string | null;
};

function normalizeLayout(v: any): ScoreEntryLayout {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "alt" ? "alt" : "classic";
}

export default function MobileAdminTourConfigPage() {
  const params = useParams<{ id: string }>();
  const tourId = String(params?.id ?? "").trim();

  const [tour, setTour] = useState<Tour | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // drafts
  const [nameDraft, setNameDraft] = useState("");
  const [startDraft, setStartDraft] = useState("");
  const [endDraft, setEndDraft] = useState("");
  const [layoutDraft, setLayoutDraft] = useState<ScoreEntryLayout>("classic");
  const [matchplayDraft, setMatchplayDraft] = useState(true);
  const [rehandicapDraft, setRehandicapDraft] = useState(false);

  async function load() {
    setLoading(true);
    setErrorMsg("");
    setMsg("");

    try {
      const { data, error } = await supabase
        .from("tours")
        .select(
          "id,name,start_date,end_date,rehandicapping_enabled,score_entry_layout,matchplay_active,image_url,handicap_rules_summary,rehandicapping_rules_summary,rehandicapping_rule_key"
        )
        .eq("id", tourId)
        .single();

      if (error) throw new Error(error.message);

      const row = data as any;

      const t: Tour = {
        id: String(row.id),
        name: String(row.name),
        start_date: row.start_date ?? null,
        end_date: row.end_date ?? null,
        rehandicapping_enabled: row.rehandicapping_enabled === true,
        score_entry_layout: normalizeLayout(row.score_entry_layout),
        matchplay_active: row.matchplay_active !== false,
        image_url: row.image_url ?? null,
        handicap_rules_summary: row.handicap_rules_summary ?? null,
        rehandicapping_rules_summary: row.rehandicapping_rules_summary ?? null,
        rehandicapping_rule_key: row.rehandicapping_rule_key ?? null,
      };

      setTour(t);

      setNameDraft(t.name ?? "");
      setStartDraft(t.start_date ?? "");
      setEndDraft(t.end_date ?? "");
      setLayoutDraft(t.score_entry_layout);
      setMatchplayDraft(t.matchplay_active);
      setRehandicapDraft(t.rehandicapping_enabled);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to load tour.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!tourId) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tourId]);

  const dirty = useMemo(() => {
    if (!tour) return false;
    return (
      nameDraft.trim() !== (tour.name ?? "").trim() ||
      (startDraft.trim() || "") !== (tour.start_date ?? "") ||
      (endDraft.trim() || "") !== (tour.end_date ?? "") ||
      layoutDraft !== tour.score_entry_layout ||
      matchplayDraft !== tour.matchplay_active ||
      rehandicapDraft !== tour.rehandicapping_enabled
    );
  }, [tour, nameDraft, startDraft, endDraft, layoutDraft, matchplayDraft, rehandicapDraft]);

  async function save() {
    if (!tourId) return;

    setSaving(true);
    setErrorMsg("");
    setMsg("");

    try {
      const payload: any = {
        name: nameDraft.trim() || "Tour",
        start_date: startDraft.trim() || null,
        end_date: endDraft.trim() || null,
        score_entry_layout: layoutDraft,
        matchplay_active: matchplayDraft,
        rehandicapping_enabled: rehandicapDraft,
      };

      const { error } = await supabase.from("tours").update(payload).eq("id", tourId);
      if (error) throw new Error(error.message);

      setMsg("Saved ✅");
      await load();
      window.setTimeout(() => setMsg(""), 1500);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-sm opacity-70">Loading…</div>;

  if (errorMsg) {
    return (
      <div className="space-y-3">
        <div className="text-sm opacity-70">
          <Link className="underline" href="/m/admin/tours">
            ← Tours
          </Link>
        </div>
        <div className="rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-semibold">Error</div>
          <div className="mt-1">{errorMsg}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-sm opacity-70">
        <Link className="underline" href="/m/admin/tours">
          ← Tours
        </Link>{" "}
        <span className="opacity-50">/</span> Configure
      </div>

      {msg ? (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          {msg}
        </div>
      ) : null}

      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="text-lg font-semibold">Tour settings</div>

        <label className="block">
          <div className="text-xs font-semibold text-gray-700">Name</div>
          <input
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            disabled={saving}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <div className="text-xs font-semibold text-gray-700">Start date</div>
            <input
              type="date"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              value={startDraft}
              onChange={(e) => setStartDraft(e.target.value)}
              disabled={saving}
            />
          </label>

          <label className="block">
            <div className="text-xs font-semibold text-gray-700">End date</div>
            <input
              type="date"
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
              value={endDraft}
              onChange={(e) => setEndDraft(e.target.value)}
              disabled={saving}
            />
          </label>
        </div>

        <div className="rounded-xl border p-3 space-y-2">
          <div className="text-sm font-semibold">Score entry layout</div>
          <div className="flex gap-4 text-sm">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="layout"
                checked={layoutDraft === "classic"}
                onChange={() => setLayoutDraft("classic")}
                disabled={saving}
              />
              Classic
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="layout"
                checked={layoutDraft === "alt"}
                onChange={() => setLayoutDraft("alt")}
                disabled={saving}
              />
              Alt
            </label>
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
          <div>
            <div className="text-sm font-semibold">Matchplay</div>
            <div className="text-xs text-gray-600">Enable/disable matchplay features for this tour.</div>
          </div>
          <input
            type="checkbox"
            checked={matchplayDraft}
            onChange={(e) => setMatchplayDraft(e.target.checked)}
            disabled={saving}
          />
        </label>

        <label className="flex items-center justify-between gap-3 rounded-xl border p-3">
          <div>
            <div className="text-sm font-semibold">Rehandicapping</div>
            <div className="text-xs text-gray-600">Allow handicap recalculation between rounds.</div>
          </div>
          <input
            type="checkbox"
            checked={rehandicapDraft}
            onChange={(e) => setRehandicapDraft(e.target.checked)}
            disabled={saving}
          />
        </label>

        <button
          className="w-full rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
          disabled={saving || !dirty}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
      </section>

      <section className="rounded-2xl border bg-white p-4 space-y-2">
        <div className="text-lg font-semibold">Quick links</div>
        <div className="text-sm text-gray-600">
          These open your existing admin pages (may be less mobile-optimised, but functional).
        </div>

        <div className="grid grid-cols-1 gap-2">
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/tours/${tourId}`}>
            Open tour admin (desktop route)
          </Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/tours/${tourId}/players`}>
            Manage tour players
          </Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/tours/${tourId}/rounds`}>
            Manage rounds
          </Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/tours/${tourId}/events/manage`}>
            Manage events
          </Link>
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href={`/tours/${tourId}/groups`}>
            Manage pairs & teams
          </Link>
        </div>
      </section>
    </div>
  );
}