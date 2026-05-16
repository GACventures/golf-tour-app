"use client";

import { useEffect } from "react";
import { useParams, usePathname, useSearchParams } from "next/navigation";

function selectedPlayerKey(tourId: string) {
  return `golfTour:selectedPlayer:${tourId}`;
}

function lastPageKey(tourId: string, playerId: string) {
  return `golfTour:lastPage:${tourId}:${playerId}`;
}

export default function PlayerPageTracker() {
  const params = useParams<{ id?: string }>();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tourId = String(params?.id ?? "").trim();

  useEffect(() => {
    if (!tourId || !pathname) return;

    const playerId = localStorage.getItem(selectedPlayerKey(tourId));
    if (!playerId) return;

    // Only track actual tour pages.
    if (!pathname.startsWith(`/m/tours/${tourId}`)) return;

    // Never save the standalone player-entry page as the last page.
    if (pathname.startsWith("/m/player-entry/")) return;

    // Never save admin as the player's last page.
    if (pathname.startsWith(`/m/tours/${tourId}/admin`)) return;

    const qs = searchParams?.toString();
    const fullPath = qs ? `${pathname}?${qs}` : pathname;

    localStorage.setItem(lastPageKey(tourId, playerId), fullPath);
  }, [tourId, pathname, searchParams]);

  return null;
}