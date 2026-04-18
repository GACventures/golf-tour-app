"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Tour = {
  id: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
};

export default function ToursPage() {
  const [tours, setTours] = useState<Tour[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [name, setName] = useState("");

  async function loadTours() {
    setLoading(true);
    setErrorMsg("");

    try {
      const { data, error } = await supabase
        .from("tours")
        .select("id,name,start_date,end_date")
        .order("created_at", { ascending: false } as any);

      if (error) {
        const { data: fallbackData, error: fallbackError } = await supabase
          .from("tours")
          .select("id,name,start_date,end_date")
          .order("name", { ascending: true });

        if (fallbackError) throw new Error(fallbackError.message);

        setTours(
          (fallbackData ?? []).map((t: any) => ({
            id: String(t.id),
            name: String(t.name ?? ""),
            start_date: t.start_date ?? null,
            end_date: t.end_date ?? null,
          }))
        );
        return;
      }

      setTours(
        (data ?? []).map((t: any) => ({
          id: String(t.id),
          name: String(t.name ?? ""),
          start_date: t.start_date ?? null,
          end_date: t.end_date ?? null,
        }))
      );
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to load tours.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadTours();
  }, []);

  const canAdd = useMemo(() => !saving && name.trim().length > 0, [saving, name]);

  async function addTour() {
    if (!canAdd) return;

    setSaving(true);
    setErrorMsg("");

    try {
      const { data, error } = await supabase
        .from("tours")
        .insert({ name: name.trim() })
        .select("id")
        .single();

      if (error) throw new Error(error.message);

      const id = String((data as any)?.id ?? "");
      setName("");
      await loadTours();

      if (id) {
        window.location.href = `/admin/tours/${id}`;
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to add tour.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
      <div className="text-sm text-gray-600">
        <Link className="underline" href="/admin">
          ← Admin hub
        </Link>{" "}
        <span className="opacity-50">/</span> Tours
      </div>

      {errorMsg ? (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <div className="font-semibold">Error</div>
          <div className="mt-1">{errorMsg}</div>
        </div>
      ) : null}

      <section className="rounded-2xl border bg-white p-5 space-y-4 shadow-sm">
        <div className="text-xl font-semibold text-gray-900">Create tour</div>

        <div className="flex flex-col sm:flex-row gap-3">
          <input
            className="flex-1 rounded-xl border px-4 py-3 text-sm"
            placeholder="Tour name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
          />
          <button
            className="rounded-xl bg-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
            disabled={!canAdd}
            onClick={() => void addTour()}
          >
            {saving ? "Saving..." : "Add tour"}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border bg-white shadow-sm overflow-hidden">
        <div className="p-5 flex items-center justify-between gap-3 border-b">
          <div className="text-xl font-semibold text-gray-900">Tours</div>
          <button
            className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            onClick={() => void loadTours()}
            disabled={loading || saving}
          >
            Refresh
          </button>
        </div>

        {loading ? <div className="p-5 text-sm text-gray-600">Loading...</div> : null}

        {!loading && tours.length === 0 ? (
          <div className="p-5 text-sm text-gray-600">No tours yet.</div>
        ) : null}

        {!loading && tours.length > 0 ? (
          <ul className="divide-y">
            {tours.map((t) => (
              <li key={t.id} className="p-5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-semibold text-gray-900 truncate">{t.name}</div>
                  <div className="text-sm text-gray-600 mt-1">
                    {t.start_date || t.end_date ? (
                      <>
                        Dates:{" "}
                        <span className="font-medium">
                          {t.start_date ?? "TBD"} – {t.end_date ?? "TBD"}
                        </span>
                      </>
                    ) : (
                      "Dates: TBD"
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
                    href={`/tours/${t.id}`}
                  >
                    View
                  </Link>

                  <Link
                    className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-gray-50"
                    href={`/tours/${t.id}/leaderboard`}
                  >
                    Leaderboard
                  </Link>

                  <Link
                    className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
                    href={`/admin/tours/${t.id}`}
                  >
                    Configure
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}