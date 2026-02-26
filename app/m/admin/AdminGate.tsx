// app/m/admin/AdminGate.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

function parseAllowlist(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function AdminGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const allowRaw = process.env.NEXT_PUBLIC_ADMIN_USER_IDS;
  const bypassRaw = process.env.NEXT_PUBLIC_ADMIN_BYPASS;

  const allowlist = useMemo(() => parseAllowlist(allowRaw), [allowRaw]);
  const bypass = String(bypassRaw ?? "").toLowerCase() === "true";

  const [loading, setLoading] = useState(true);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>("");

  async function check() {
    setLoading(true);
    setErrorMsg("");

    // ✅ DEV BYPASS: lets you use mobile admin without signing in
    if (bypass) {
      setSessionUserId("DEV_BYPASS");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      setErrorMsg(error.message);
      setSessionUserId(null);
      setLoading(false);
      return;
    }

    const uid = data.session?.user?.id ?? null;
    setSessionUserId(uid);

    setLoading(false);
  }

  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAuthed = !!sessionUserId;
  const isAllowed =
    bypass || (sessionUserId ? allowlist.includes(sessionUserId) : false);

  if (loading) {
    return <div className="text-sm text-gray-600">Checking admin access…</div>;
  }

  if (!isAuthed && !bypass) {
    return (
      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="text-xl font-semibold">Admin access</div>
        <div className="text-sm text-gray-700">
          You’re not signed in. Sign in first, then come back here.
        </div>

        {errorMsg ? (
          <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            <div className="font-semibold">Error</div>
            <div className="mt-1">{errorMsg}</div>
          </div>
        ) : null}

        <div className="flex gap-2 flex-wrap">
          <Link
            href="/login"
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Go to Login
          </Link>

          <button
            onClick={() => void check()}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Re-check
          </button>
        </div>

        <div className="text-xs text-gray-500 pt-2">
          Admin allowlist env:{" "}
          <span className="font-mono">{allowRaw ? allowRaw : "(empty)"}</span>
        </div>
        <div className="text-xs text-gray-500">
          Current path: <span className="font-mono">{pathname}</span>
        </div>
      </div>
    );
  }

  if (!isAllowed) {
    return (
      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="text-xl font-semibold">Admin access</div>
        <div className="text-sm text-gray-700">
          You’re signed in, but your user is not on the admin allowlist.
        </div>

        <div className="rounded-xl border p-3 text-xs text-gray-700 space-y-1">
          <div>
            Your userId:{" "}
            <span className="font-mono">{sessionUserId ?? "—"}</span>
          </div>
          <div>
            Allowlist env:{" "}
            <span className="font-mono">{allowRaw ? allowRaw : "(empty)"}</span>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Link
            href="/tours"
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Go to Tours
          </Link>
          <button
            onClick={() => void check()}
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Re-check
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}