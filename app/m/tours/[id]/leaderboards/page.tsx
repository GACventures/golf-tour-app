// app/m/tours/[id]/leaderboards/page.tsx
import Link from "next/link";

export default function MobileLeaderboardsPage({ params }: { params: { id: string } }) {
  const tourId = params.id;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>Leaderboards</h1>
      <div style={{ marginTop: 8, color: "#555", fontSize: 13 }}>
        Placeholder. Next we’ll reuse your existing tour leaderboard logic and make it mobile-friendly.
      </div>

      <div style={{ marginTop: 14, padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>For now</div>
        <Link href={`/tours/${tourId}/leaderboard`} style={{ textDecoration: "underline" }}>
          Open desktop leaderboard
        </Link>
      </div>
    </div>
  );
}
