"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const next = (sp.get("next") || "/m/admin").trim() || "/m/admin";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsg(null);
    setLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (!data.session) {
      setError("Signed in, but no session returned.");
      return;
    }

    router.push(next);
  }

  async function createFreshUser() {
    setError(null);
    setMsg(null);

    if (!email.trim() || !password) {
      setError("Enter an email and password first.");
      return;
    }

    setLoading(true);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    // With email confirmation disabled, session should exist immediately
    if (!data.session) {
      setError(
        "User created, but no session returned. Make sure email confirmation is disabled."
      );
      return;
    }

    setMsg("User created + signed in ✓");
    router.push(next);
  }

  async function signOut() {
    setError(null);
    setMsg(null);
    setLoading(true);

    const { error } = await supabase.auth.signOut();

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setMsg("Signed out ✓");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={signIn} className="w-full max-w-sm space-y-4 border rounded-lg p-4 bg-white">
        <h1 className="text-lg font-semibold">Login</h1>

        <div className="text-xs text-gray-600">
          After auth you’ll go to: <span className="font-mono">{next}</span>
        </div>

        <label className="block">
          <div className="text-sm text-gray-600">Email</div>
          <input
            type="email"
            className="mt-1 w-full border rounded-md px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoCapitalize="none"
            autoCorrect="off"
          />
        </label>

        <label className="block">
          <div className="text-sm text-gray-600">Password</div>
          <input
            type="password"
            className="mt-1 w-full border rounded-md px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <div className="mt-1 text-xs text-gray-500">
            Dev tip: use something simple you’ll remember.
          </div>
        </label>

        {error && <div className="text-sm text-red-600 whitespace-pre-wrap">{error}</div>}
        {msg && <div className="text-sm text-emerald-700 whitespace-pre-wrap">{msg}</div>}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-black text-white rounded-md py-2 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <button
          type="button"
          onClick={() => void createFreshUser()}
          disabled={loading}
          className="w-full border rounded-md py-2 font-semibold disabled:opacity-50"
        >
          Create fresh user (dev)
        </button>

        <button
          type="button"
          onClick={() => void signOut()}
          disabled={loading}
          className="w-full border rounded-md py-2 disabled:opacity-50"
        >
          Sign out
        </button>

        <div className="text-xs text-gray-600">
          Quick links:{" "}
          <Link className="underline" href="/m/admin">
            /m/admin
          </Link>{" "}
          ·{" "}
          <Link className="underline" href="/tours">
            /tours
          </Link>
        </div>
      </form>
    </div>
  );
}