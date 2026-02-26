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

export default function MobileAdminToursPage() {
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
        .order("created_at", { ascending: false } as any); // created_at not in your pasted schema but often exists; ignore if not

      // If created_at order fails in your DB, fallback to name ordering
      if (error) {
        const { data: data2, error: error2 } = await supabase
          .from("tours")
          .select("id,name,start_date,end_date")
          .order("name", { ascending: true });
        if (error2) throw new Error(error2.message);
        setTours((data2 ?? []).map((t: any) => ({
          id: String(t.id),
          name: String(t.name),
          start_date: t.start_date ?? null,
          end_date: t.end_date ?? null,
        })));
        return;
      }

      setTours((data ?? []).map((t: any) => ({
        id: String(t.id),
        name: String(t.name),
        start_date: t.start_date ?? null,
        end_date: t.end_date ?? null,
      })));
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

      // jump to config page for the new tour (mobile)
      if (id) window.location.href = `/m/admin/tours/${id}`;
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to add tour.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-sm opacity-70">
        <Link className="underline" href="/m/admin">
          ← Admin hub
        </Link>{" "}
        <span className="opacity-50">/</span> Tours
      </div>

      {errorMsg ? (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-semibold">Error</div>
          <div className="mt-1">{errorMsg}</div>
        </div>
      ) : null}

      <section className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="text-lg font-semibold">Create tour</div>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-xl border px-3 py-2 text-sm"
            placeholder="Tour name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving}
          />
          <button
            className="rounded-xl bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
            disabled={!canAdd}
            onClick={() => void addTour()}
          >
            {saving ? "Saving…" : "Add"}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border bg-white">
        <div className="p-4 flex items-center justify-between">
          <div className="text-lg font-semibold">Tours</div>
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            onClick={() => void loadTours()}
            disabled={loading || saving}
          >
            Refresh
          </button>
        </div>

        {loading ? <div className="px-4 pb-4 text-sm opacity-70">Loading…</div> : null}
        {!loading && tours.length === 0 ? <div className="px-4 pb-4 text-sm opacity-70">No tours yet.</div> : null}

        <ul className="divide-y">
          {tours.map((t) => (
            <li key={t.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold truncate">{t.name}</div>
                <div className="text-xs text-gray-600 mt-1">
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

              <Link
                className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50 shrink-0"
                href={`/m/admin/tours/${t.id}`}
              >
                Configure
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}