"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

function parseAllowlist(v: string | undefined): Set<string> {
  const raw = String(v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(raw);
}

export default function AdminGate(props: { children: React.ReactNode }) {
  const bypass = String(process.env.NEXT_PUBLIC_ADMIN_BYPASS ?? "").toLowerCase() === "true";

  const allowlist = useMemo(
    () => parseAllowlist(process.env.NEXT_PUBLIC_ADMIN_USER_IDS),
    []
  );

  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [reason, setReason] = useState<string>("");

  useEffect(() => {
    let alive = true;

    async function run() {
      // ✅ DEV BYPASS: no auth required
      if (bypass) {
        if (!alive) return;
        setAllowed(true);
        setLoading(false);
        return;
      }

      // Otherwise: require a session + allowlisted UID
      setLoading(true);
      setReason("");

      const { data, error } = await supabase.auth.getSession();
      if (!alive) return;

      if (error) {
        setAllowed(false);
        setReason(error.message || "Auth error.");
        setLoading(false);
        return;
      }

      const uid = data.session?.user?.id ?? "";
      if (!uid) {
        setAllowed(false);
        setReason("You’re not signed in. Sign in first, then come back here.");
        setLoading(false);
        return;
      }

      if (allowlist.size > 0 && !allowlist.has(uid)) {
        setAllowed(false);
        setReason(`Not authorized for mobile admin. (userId: ${uid})`);
        setLoading(false);
        return;
      }

      setAllowed(true);
      setLoading(false);
    }

    void run();

    // Also re-check if auth state changes (login/logout in another tab)
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void run();
    });

    return () => {
      alive = false;
      sub?.subscription?.unsubscribe();
    };
  }, [bypass, allowlist]);

  if (loading) {
    return (
      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm text-gray-600">Checking admin access…</div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <div className="text-lg font-semibold">Admin access</div>
          <div className="mt-1 text-sm text-amber-900">{reason || "Not authorized."}</div>
        </div>

        <div className="rounded-2xl border bg-white p-4 space-y-2">
          <div className="text-sm font-semibold">What to do</div>
          <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
            <li>
              For dev bypass, set <code className="px-1 rounded bg-gray-100">NEXT_PUBLIC_ADMIN_BYPASS=true</code> and restart the dev server.
            </li>
            <li>
              Or sign in via <Link className="underline" href="/login">/login</Link> then return here.
            </li>
            <li>
              Or add your user id to <code className="px-1 rounded bg-gray-100">NEXT_PUBLIC_ADMIN_USER_IDS</code>.
            </li>
          </ul>
        </div>
      </div>
    );
  }

  return <>{props.children}</>;
}