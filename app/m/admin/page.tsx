// app/m/admin/page.tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

/* ---------------- helpers ---------------- */

function parseAdminIds(): Set<string> {
  const raw = (process.env.NEXT_PUBLIC_ADMIN_USER_IDS ?? "").trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function isBypassOn(): boolean {
  return String(process.env.NEXT_PUBLIC_ADMIN_BYPASS ?? "").toLowerCase() === "true";
}

/* ---------------- UI bits ---------------- */

function Tile(props: { title: string; desc: string; href: string }) {
  return (
    <Link
      href={props.href}
      className="block rounded-2xl border bg-white p-4 active:scale-[0.99] transition"
    >
      <div className="text-lg font-semibold">{props.title}</div>
      <div className="mt-1 text-sm text-gray-600">{props.desc}</div>
      <div className="mt-3 text-sm underline underline-offset-4">Open →</div>
    </Link>
  );
}

/* ---------------- page ---------------- */

export default function MobileAdminHubPage() {
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [userId, setUserId] = useState<string>("");

  const bypass = isBypassOn();
  const adminIds = useMemo(() => parseAdminIds(), []);

  useEffect(() => {
    let alive = true;

    async function checkAccess() {
      setChecking(true);

      // 🔓 DEV BYPASS
      if (bypass) {
        if (!alive) return;
        setAllowed(true);
        setChecking(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id ?? "";

      if (!alive) return;

      setUserId(uid);
      setAllowed(uid !== "" && adminIds.has(uid));
      setChecking(false);
    }

    void checkAccess();
    return () => {
      alive = false;
    };
  }, [bypass, adminIds]);

  /* ---------- states ---------- */

  if (checking) {
    return <div className="p-4 text-sm opacity-70">Checking admin access…</div>;
  }

  if (!allowed) {
    return (
      <div className="p-4 space-y-3 max-w-md">
        <h1 className="text-xl font-semibold">Admin access</h1>

        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {userId ? (
            <>
              <div className="font-semibold">Not authorized</div>
              <div className="mt-1 text-xs font-mono break-all">{userId}</div>
            </>
          ) : (
            <>
              <div className="font-semibold">You’re not signed in</div>
              <div className="mt-1">Sign in, then return here.</div>
            </>
          )}
        </div>

        <div className="flex gap-2">
          <Link href="/login" className="rounded-xl border px-3 py-2 text-sm">
            Login
          </Link>
          <Link href="/tours" className="rounded-xl border px-3 py-2 text-sm">
            Desktop admin
          </Link>
        </div>

        <div className="text-xs opacity-60">
          Dev bypass is <strong>OFF</strong>
        </div>
      </div>
    );
  }

  /* ---------- allowed ---------- */

  return (
    <div className="space-y-3 p-4">
      <div className="rounded-2xl border bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Mobile Admin Hub</div>
            <div className="mt-1 text-sm text-gray-600">
              Admin-only setup screens (separate from tour day use).
            </div>
          </div>

          {bypass ? (
            <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">
              DEV BYPASS
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <Tile
          title="Players"
          desc="Create/edit global players (handicap + gender)."
          href="/m/admin/players"
        />
        <Tile
          title="Courses"
          desc="Create/edit global courses + pars (M/F)."
          href="/m/admin/courses"
        />
        <Tile
          title="Tours"
          desc="Create tours + edit core tour configuration."
          href="/m/admin/tours"
        />
      </div>

      <div className="text-xs text-gray-500 pt-2">
        Admin gating is via env vars. Disable bypass before production.
      </div>
    </div>
  );
}