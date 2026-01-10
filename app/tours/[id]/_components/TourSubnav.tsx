"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export default function TourSubnav({ tourId }: { tourId: string }) {
  // 1) Prefer prop (normal case)
  const propId = String(tourId ?? "").trim();

  // 2) Fallback to route param if prop is missing/invalid
  const params = useParams<{ id?: string }>();
  const paramId = String(params?.id ?? "").trim();

  const tid =
    propId && propId !== "undefined" && propId !== "null" && isLikelyUuid(propId)
      ? propId
      : paramId && paramId !== "undefined" && paramId !== "null" && isLikelyUuid(paramId)
      ? paramId
      : "";

  // ✅ Fail-safe: never generate broken /tours/undefined/... links
  if (!tid) {
    return (
      <div style={{ marginTop: 10, color: "#777", fontSize: 14 }}>
        Tour navigation unavailable (missing tour id).
      </div>
    );
  }

  const base = `/tours/${tid}`;

  return (
    <div style={{ marginTop: 10, display: "flex", gap: 14, flexWrap: "wrap" }}>
      <Link href={`${base}`}>Overview</Link>
      <Link href={`${base}/leaderboard`}>Leaderboards</Link>
      <Link href={`${base}/competitions`}>Side competitions</Link>
      <Link href={`${base}/rounds`}>Rounds</Link>
      <Link href={`${base}/players`}>Players (This Tour)</Link>
      <Link href={`${base}/groups`}>Pairs &amp; Teams</Link>
      <Link href={`${base}/tee-times`}>Tee times / groupings</Link>
    </div>
  );
}
