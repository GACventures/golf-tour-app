"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function LoginClient() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    // You can change this to /m/admin if you prefer
    router.push("/tours");
  }

  async function sendMagicLink() {
    setError(null);
    setInfo(null);

    const trimmed = email.trim();
    if (!trimmed) {
      setError("Please enter your email first.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        // After clicking the email link, user lands back in your app
        // and will be signed in. We send them straight to mobile admin.
        emailRedirectTo: `${window.location.origin}/m/admin`,
      },
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setInfo("Magic link sent. Check your email on this device and open the link.");
  }

  async function signOut() {
    setError(null);
    setInfo(null);
    setLoading(true);

    const { error } = await supabase.auth.signOut();

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setInfo("Signed out.");
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={signInWithPassword} className="w-full max-w-sm space-y-4 border rounded-lg p-4 bg-white">
        <h1 className="text-lg font-semibold">Login</h1>

        <label className="block">
          <div className="text-sm text-gray-600">Email</div>
          <input
            type="email"
            className="mt-1 w-full border rounded-md px-3 py-2"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>

        <label className="block">
          <div className="text-sm text-gray-600">Password</div>
          <input
            type="password"
            className="mt-1 w-full border rounded-md px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>

        {error ? <div className="text-sm text-red-600">{error}</div> : null}
        {info ? <div className="text-sm text-emerald-700">{info}</div> : null}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-black text-white rounded-md py-2 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in (password)"}
        </button>

        <button
          type="button"
          disabled={loading || !email.trim()}
          onClick={sendMagicLink}
          className="w-full border rounded-md py-2 disabled:opacity-50"
        >
          {loading ? "Sending…" : "Send magic link (passwordless)"}
        </button>

        <button
          type="button"
          disabled={loading}
          onClick={signOut}
          className="w-full text-sm underline disabled:opacity-50"
        >
          Sign out
        </button>

        <div className="text-xs text-gray-500 leading-relaxed">
          Magic link will redirect back to:{" "}
          <code className="px-1 rounded bg-gray-100">/m/admin</code>
        </div>
      </form>
    </div>
  );
}