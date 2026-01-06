// app/m/tours/[id]/page.tsx
import Link from "next/link";

export default function MobileTourOverviewPage({ params }: { params: { id: string } }) {
  const tourId = params.id;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>Overview</h1>
      <div style={{ marginTop: 8, color: "#555", fontSize: 13 }}>
        Mobile tour home. We’ll add tour summary, today’s round, and quick links here.
      </div>

      <div style={{ marginTop: 14, padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Quick links</div>

        <div style={{ display: "grid", gap: 10 }}>
          <Link href={`/m/tours/${tourId}/scoring`} style={{ textDecoration: "underline" }}>
            Scoring access
          </Link>
          <Link href={`/m/tours/${tourId}/leaderboards`} style={{ textDecoration: "underline" }}>
            Leaderboards
          </Link>
          <Link href={`/tours/${tourId}/leaderboard`} style={{ textDecoration: "underline" }}>
            Desktop leaderboard
          </Link>
        </div>
      </div>
    </div>
  );
}
