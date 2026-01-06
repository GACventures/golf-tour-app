// app/m/tours/[id]/_components/MobileNav.tsx
"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import React from "react";

function isActive(pathname: string, href: string) {
  // active if exact match OR within that section
  if (pathname === href) return true;
  return pathname.startsWith(href + "/");
}

export default function MobileNav() {
  const params = useParams<{ id: string }>();
  const tourId = params.id;
  const pathname = usePathname();

  const items = [
    { key: "overview", label: "Overview", href: `/m/tours/${tourId}` },
    { key: "tee", label: "Tee times", href: `/m/tours/${tourId}/tee-times` },
    { key: "scoring", label: "Scoring", href: `/m/tours/${tourId}/scoring` },
    { key: "leaderboards", label: "Boards", href: `/m/tours/${tourId}/leaderboards` },
    { key: "more", label: "More", href: `/m/tours/${tourId}/more` },
  ];

  return (
    <nav
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        borderTop: "1px solid #e5e7eb",
        background: "white",
        padding: "10px 10px 12px",
        paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
      }}
    >
      <div
        style={{
          maxWidth: 860,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 8,
        }}
      >
        {items.map((it) => {
          const active = isActive(pathname, it.href);
          return (
            <Link
              key={it.key}
              href={it.href}
              style={{
                textDecoration: "none",
                color: active ? "#111827" : "#6b7280",
                border: active ? "1px solid #111827" : "1px solid #e5e7eb",
                background: active ? "#f9fafb" : "white",
                borderRadius: 10,
                padding: "8px 6px",
                textAlign: "center",
                fontSize: 12,
                fontWeight: active ? 800 : 600,
              }}
            >
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
