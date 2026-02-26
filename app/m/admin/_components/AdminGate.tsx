"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { isAdminUserId } from "@/lib/admin";

type Props = {
  children: React.ReactNode;
};

export default function AdminGate({ children }: Props) {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  // minimal login form (OTP magic link)
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string>("");
  const [err, setErr] = useState<string>("");

  const isAdmin = useMemo(() => isAdminUserId(userId), [userId]);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      setLoading(true);
      setErr("");
      setMsg("");

      const { data, error } = await supabase.auth.getUser();
      if (!mounted) return;

      if (error) {
        // Not fatal; treat as signed out
        setUserId(null);
      } else {
        setUserId(data.user?.id ?? null);
      }
      setLoading(false);
    }

    void boot();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe();
    };
  }, []);

  async function sendMagicLink() {
    setErr("");
    setMsg("");
    const e = email.trim();
    if (!e) {
      setErr("Enter your email address.");
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: e,
      options: {
        // You can set this if you want to force returning to the admin hub.
        // emailRedirectTo: `${window.location.origin}/m/admin`,
      },
    });

    if (error) {
      setErr(error.message);
      return;
    }
    setMsg("Check your email for the sign-in link.");
  }

  async function signOut() {
    setErr("");
    setMsg("");
    const { error } = await supabase.auth.signOut();
    if (error) setErr(error.message);
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-md p-4">
        <div className="text-sm opacity-70">Loading…</div>
      </main>
    );
  }

  // Signed out
  if (!userId) {
    return (
      <main className="mx-auto max-w-md p-4 space-y-4">
        <div className="rounded-2xl border bg-white p-4 space-y-3">
          <div className="text-lg font-semibold">Admin sign-in</div>
          <div className="text-sm text-gray-600">
            This area is restricted. Sign in with your admin email.
          </div>

          {err ? (
            <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{err}</div>
          ) : null}
          {msg ? (
            <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{msg}</div>
          ) : null}

          <label className="block">
            <div className="text-sm opacity-70 mb-1">Email</div>
            <input
              className="w-full rounded-xl border px-3 py-2 text-sm"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              inputMode="email"
              placeholder="you@domain.com"
              autoCapitalize="none"
              autoCorrect="off"
            />
          </label>

          <button
            className="w-full rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => void sendMagicLink()}
            disabled={!email.trim()}
          >
            Send sign-in link
          </button>

          <div className="text-xs text-gray-500">
            Note: you must also set <code>NEXT_PUBLIC_ADMIN_USER_IDS</code> to your Supabase Auth user id(s).
          </div>
        </div>
      </main>
    );
  }

  // Signed in but not admin
  if (!isAdmin) {
    return (
      <main className="mx-auto max-w-md p-4 space-y-3">
        <div className="rounded-2xl border bg-white p-4 space-y-2">
          <div className="text-lg font-semibold text-red-600">Not authorized</div>
          <div className="text-sm text-gray-700">
            You are signed in, but this account is not allowed to access the admin hub.
          </div>
          <div className="text-xs text-gray-500">
            Signed in user id: <code>{userId}</code>
          </div>
          <button
            className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </main>
    );
  }

  return (
    <div>
      <div className="sticky top-0 z-40 border-b bg-white">
        <div className="mx-auto max-w-2xl px-4 py-3 flex items-center justify-between">
          <div className="text-sm font-semibold">Mobile Admin</div>
          <button
            className="text-sm underline opacity-80 hover:opacity-100"
            onClick={() => void signOut()}
          >
            Sign out
          </button>
        </div>
      </div>

      {children}
    </div>
  );
}