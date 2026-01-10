import type { ReactNode } from 'react';

export default async function TourLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  // Next.js 16 typed routes may provide params as a Promise
  const { id: tourId } = await params;

  // If you previously used tourId for nav/header, re-add it later.
  // For now, keep this layout minimal to unblock the build.
  return <div className="min-h-screen">{children}</div>;
}

