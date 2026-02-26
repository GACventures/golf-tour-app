"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function parseAllowlist(raw: string | undefined | null): Set<string> {
  return new Set(
    String(raw ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
  );
}

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // ✅ DEV BYPASS: if set, do NOT require login / session / allowlist
  const bypass = process.env.NEXT_PUBLIC_ADMIN_BYPASS === "1";
  if (bypass) {
    return <>{children}</>;
  }

  // Normal gating (only used when bypass is OFF)
  const allowRaw = process.env.NEXT_PUBLIC_ADMIN_USER_IDS;
  const allow = useMemo(() => parseAllowlist(allowRaw), [allowRaw]);

  const [checking, setChecking] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  async function check() {
    setChecking(true);
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id ?? null;
    setUserId(uid);
    setChecking(false);
  }

  useEffect(() => {
    void check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => void check());
    return () => sub.subscription.unsubscribe();
  }, []);

  const authed = !!userId;
  const allowed = authed && allow.has(userId!);

  if (checking) {
    return (
      <div className="rounded-2xl border bg-white p-4">
        <div className="text-sm opacity-70">Checking admin access…</div>
      </div>
    );
  }

  if (!authed || !allowed) {
    return (
      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="text-xl font-semibold">Admin access</div>

        {!authed ? (
          <div className="text-sm text-gray-700">You’re not signed in.</div>
        ) : (
          <div className="text-sm text-gray-700">You’re signed in, but not allowlisted.</div>
        )}

        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <div className="font-semibold">Error</div>
          <div className="mt-1">{!authed ? "Auth session missing!" : "Not authorized."}</div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href="/login">
            Go to Login
          </Link>
          <button className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" onClick={() => void check()}>
            Re-check
          </button>
        </div>

        <div className="pt-2 text-xs text-gray-500 space-y-1">
          <div>
            Admin allowlist env: <span className="font-mono">{allowRaw ? allowRaw : "(empty)"}</span>
          </div>
          <div>
            Current path: <span className="font-mono">{pathname}</span>
          </div>
          <div>
            Current userId: <span className="font-mono">{userId ?? "(none)"}</span>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}