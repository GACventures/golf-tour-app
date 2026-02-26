"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";
import { isAdminUserId } from "@/lib/admin";

type GuardState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "not_authorized"; userId: string }
  | { status: "ok"; userId: string };

export default function AdminGuard(props: { children: React.ReactNode }) {
  const [state, setState] = useState<GuardState>({ status: "loading" });
  const [details, setDetails] = useState<string>("");

  const adminAllowlist = useMemo(() => {
    const raw = process.env.NEXT_PUBLIC_ADMIN_USER_IDS ?? "";
    return raw;
  }, []);

  async function check() {
    setDetails("");
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;

      const user = data?.user ?? null;
      if (!user) {
        setState({ status: "signed_out" });
        return;
      }

      const uid = user.id;
      if (!isAdminUserId(uid)) {
        setState({ status: "not_authorized", userId: uid });
        return;
      }

      setState({ status: "ok", userId: uid });
    } catch (e: any) {
      setDetails(e?.message ?? "Failed to check session.");
      setState({ status: "signed_out" });
    }
  }

  useEffect(() => {
    void check();

    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void check();
    });

    return () => {
      sub?.subscription?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.status === "loading") {
    return (
      <div className="p-4 max-w-md mx-auto">
        <div className="text-sm opacity-70">Checking admin access…</div>
      </div>
    );
  }

  if (state.status === "signed_out") {
    return (
      <div className="p-4 max-w-md mx-auto space-y-3">
        <div className="rounded-2xl border bg-white p-4">
          <div className="text-lg font-semibold">Admin access</div>
          <div className="mt-1 text-sm text-gray-600">
            You’re not signed in. Sign in first, then come back here.
          </div>

          {details ? (
            <div className="mt-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
              <div className="font-semibold">Error</div>
              <div className="mt-1">{details}</div>
            </div>
          ) : null}

          <div className="mt-3 text-sm">
            If you already have a sign-in page, use it. Otherwise, open desktop admin:
          </div>
          <div className="mt-2 flex gap-2 flex-wrap">
            <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href="/tours">
              Go to Tours (desktop/admin)
            </Link>
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => void check()}
            >
              Re-check
            </button>
          </div>
        </div>

        <div className="text-xs text-gray-500">
          Admin allowlist env: <code className="px-1 rounded bg-gray-100">{adminAllowlist || "(empty)"}</code>
        </div>
      </div>
    );
  }

  if (state.status === "not_authorized") {
    return (
      <div className="p-4 max-w-md mx-auto space-y-3">
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <div className="text-lg font-semibold text-amber-900">Not authorized</div>
          <div className="mt-1 text-sm text-amber-900">
            This admin hub is restricted.
          </div>

          <div className="mt-3 text-sm text-amber-900">
            Your userId is:
            <div className="mt-1 font-mono text-xs break-all rounded bg-white/60 border border-amber-200 p-2">
              {state.userId}
            </div>
          </div>

          <div className="mt-3 text-xs text-amber-900">
            Ensure <code className="px-1 rounded bg-white/60">NEXT_PUBLIC_ADMIN_USER_IDS</code> contains this UUID.
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Link className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50" href="/tours">
            Back to Tours
          </Link>
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => void check()}
          >
            Re-check
          </button>
        </div>
      </div>
    );
  }

  // ok
  return <>{props.children}</>;
}