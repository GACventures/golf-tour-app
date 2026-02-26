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
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border bg-white p-4">
        <div className="text-lg font-semibold">Mobile Admin Hub</div>
        <div className="mt-1 text-sm text-gray-600">
          Admin-only setup screens (separate from tour day use).
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3">
        <Tile title="Players" desc="Create/edit global players (handicap + gender)." href="/m/admin/players" />
        <Tile title="Courses" desc="Create/edit global courses + pars (M/F)." href="/m/admin/courses" />
        <Tile title="Tours" desc="Create tours + edit core tour configuration." href="/m/admin/tours" />
      </div>

      <div className="text-xs text-gray-500 pt-2">
        Note: This hub is UI-gated by your allowlist env var. If you later enable RLS on admin tables,
        we’ll add policies.
      </div>
    </div>
  );
}