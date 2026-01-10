// app/tours/[id]/layout.tsx
import TourSubnav from "./_components/TourSubnav";

export default function TourLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const tourId = params.id;

  return (
    <div className="space-y-4">
      <TourSubnav tourId={tourId} />
      {children}
    </div>
  );
}
