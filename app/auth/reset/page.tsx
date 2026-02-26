"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

function parseHashTokens(hash: string): { access_token?: string; refresh_token?: string; type?: string } {
  // hash looks like: #access_token=...&refresh_token=...&type=recovery
  const h = (hash ?? "").replace(/^#/, "").trim();
  const params = new URLSearchParams(h);
  const access_token = params.get("access_token") ?? undefined;
  const refresh_token = params.get("refresh_token") ?? undefined;
  const type = params.get("type") ?? undefined;
  return { access_token, refresh_token, type };
}

export default function ResetPasswordPage() {
  const router = useRouter();

  const [status, setStatus] = useState<"checking" | "ready" | "saving" | "done" | "error">("checking");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");

  const canSave = useMemo(() => {
    if (status !== "ready") return false;
    if (!pw1 || pw1.length < 8) return false;
    if (pw1 !== pw2) return false;
    return true;
  }, [status, pw1, pw2]);

  useEffect(() => {
    let alive = true;

    async function initFromRecoveryLink() {
      setStatus("checking");
      setErrorMsg("");

      try {
        // Recovery tokens usually arrive in the URL hash
        const { access_token, refresh_token, type } = parseHashTokens(window.location.hash);

        // If already has a session, allow reset anyway
        const { data: existing } = await supabase.auth.getSession();
        if (!alive) return;

        if (!existing.session) {
          if (!access_token || !refresh_token) {
            throw new Error(
              "Missing recovery tokens. Re-open the latest password reset email link, or request a new reset."
            );
          }
          // Establish session from the recovery tokens
          const { error } = await supabase.auth.setSession({ access_token, refresh_token });
          if (error) throw error;
        }

        // Optional sanity: type should be "recovery", but don't hard fail
        // (some setups omit it)
        if (type && type !== "recovery") {
          // still ok
        }

        // Clean up hash so tokens aren’t left sitting in the URL
        if (window.location.hash) {
          window.history.replaceState(null, "", window.location.pathname + window.location.search);
        }

        if (!alive) return;
        setStatus("ready");
      } catch (e: any) {
        if (!alive) return;
        setStatus("error");
        setErrorMsg(e?.message ?? "Failed to initialize password reset.");
      }
    }

    void initFromRecoveryLink();
    return () => {
      alive = false;
    };
  }, []);

  async function onSave() {
    setErrorMsg("");
    if (!canSave) return;

    setStatus("saving");
    try {
      const { error } = await supabase.auth.updateUser({ password: pw1 });
      if (error) throw error;

      setStatus("done");

      // After successful reset, send them to the mobile admin hub.
      // (session should now exist)
      router.replace("/m/admin");
    } catch (e: any) {
      setStatus("ready");
      setErrorMsg(e?.message ?? "Failed to set new password.");
    }
  }

  return (
    <main className="mx-auto max-w-md p-4 space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Reset password</h1>
        <div className="text-sm opacity-70">
          This page is used only from the Supabase password recovery email link.
        </div>
      </header>

      {status === "checking" ? (
        <div className="rounded-xl border bg-white p-3 text-sm opacity-70">Checking recovery link…</div>
      ) : null}

      {status === "error" ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-semibold">Error</div>
          <div className="mt-1 whitespace-pre-wrap">{errorMsg}</div>
          <div className="mt-3 text-sm">
            <Link className="underline" href="/tours">
              Go to Tours
            </Link>
          </div>
        </div>
      ) : null}

      {status === "ready" || status === "saving" ? (
        <section className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="text-sm opacity-70">Choose a new password (min 8 characters).</div>

          <div className="space-y-2">
            <label className="block">
              <div className="text-sm opacity-70 mb-1">New password</div>
              <input
                className="w-full rounded-xl border px-3 py-2 text-sm"
                type="password"
                autoComplete="new-password"
                value={pw1}
                onChange={(e) => setPw1(e.target.value)}
                disabled={status === "saving"}
              />
            </label>

            <label className="block">
              <div className="text-sm opacity-70 mb-1">Confirm new password</div>
              <input
                className="w-full rounded-xl border px-3 py-2 text-sm"
                type="password"
                autoComplete="new-password"
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                disabled={status === "saving"}
              />
            </label>

            {pw1 && pw1.length < 8 ? <div className="text-xs text-red-700">Password must be at least 8 characters.</div> : null}
            {pw1 && pw2 && pw1 !== pw2 ? <div className="text-xs text-red-700">Passwords do not match.</div> : null}
            {errorMsg ? <div className="text-xs text-red-700">{errorMsg}</div> : null}
          </div>

          <button
            className="w-full rounded-xl bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
            disabled={!canSave}
            onClick={() => void onSave()}
          >
            {status === "saving" ? "Saving…" : "Set new password"}
          </button>
        </section>
      ) : null}
    </main>
  );
}