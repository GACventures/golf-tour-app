// app/m/tours/[id]/scoring/page.tsx
import Link from "next/link";

export default function MobileScoringAccessPage({ params }: { params: { id: string } }) {
  const tourId = params.id;

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>Scoring access</h1>
      <div style={{ marginTop: 8, color: "#555", fontSize: 13 }}>
        Placeholder. Next we’ll build: pick “Me”, pick “Buddy”, then generate the correct score entry link.
      </div>

      <div style={{ marginTop: 14, padding: 12, border: "1px solid #eee", borderRadius: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>Existing scoring pages (already working)</div>
        <div style={{ fontSize: 13, color: "#555" }}>
          You already have round mobile scoring under <code>/rounds/[roundId]/mobile</code>.
          We’ll wire that into this mobile tour flow next.
        </div>

        <div style={{ marginTop: 10 }}>
          <Link href={`/tours/${tourId}`} style={{ textDecoration: "underline" }}>
            Back to Tour (desktop)
          </Link>
        </div>
      </div>
    </div>
  );
}
