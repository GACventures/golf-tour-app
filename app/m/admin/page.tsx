// app/m/admin/page.tsx
"use client";

import Link from "next/link";

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

export default function MobileAdminHubPage() {
  const bypass =
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_ADMIN_BYPASS === "1";

  return (
    <div className="space-y-3">
      {/* DEV BYPASS BADGE */}
      {bypass && (
        <div className="rounded-xl border border-amber-400 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          ⚠ DEV MODE — Admin auth bypass is ENABLED
        </div>
      )}

      <div className="rounded-2xl border bg-white p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-lg font-semibold">Mobile Admin Hub</div>
            <div className="mt-1 text-sm text-gray-600">
              Admin-only setup screens (separate from tour day use).
            </div>
          </div>

          {bypass && (
            <span className="shrink-0 rounded-full bg-amber-500 px-2 py-1 text-[11px] font-bold text-white">
              DEV
            </span>
          )}
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

      {bypass && (
        <div className="text-xs text-amber-700 pt-2">
          Admin auth is bypassed via{" "}
          <code className="rounded bg-amber-100 px-1">
            NEXT_PUBLIC_ADMIN_BYPASS=1
          </code>
          .  
          <br />
          Remove this before enabling real security.
        </div>
      )}
    </div>
  );
}