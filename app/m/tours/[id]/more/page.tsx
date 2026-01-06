// app/m/tours/[id]/more/page.tsx
import Link from "next/link";

export default function MobileMorePage({ params }: { params: { id: string } }) {
  const tourId = params.id;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>More</h1>
      <div style={{ marginTop: 8, color: "#555", fontSize: 13 }}>
        Placeholder. This is where “Other competitions” and “Key stats” will live.
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        <Link href={`/m/tours/${tourId}/competitions`} style={{ textDecoration: "underline" }}>
          Other competition results
        </Link>
        <Link href={`/m/tours/${tourId}/stats`} style={{ textDecoration: "underline" }}>
          Key statistics by player
        </Link>
      </div>
    </div>
  );
}
