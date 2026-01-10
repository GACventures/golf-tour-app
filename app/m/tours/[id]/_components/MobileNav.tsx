// app/m/tours/[id]/_components/MobileNav.tsx
"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import React from "react";
import { Flag, Trophy, Medal, BarChart3, MoreHorizontal } from "lucide-react";

function isActive(pathname: string, href: string) {
  if (pathname === href) return true;
  return pathname.startsWith(href + "/");
}

type NavItem = {
  key: string;
  label: string;
  href: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
};

export default function MobileNav() {
  const params = useParams<{ id: string }>();
  const tourId = params.id;
  const pathname = usePathname();

  const items: NavItem[] = [
    { key: "rounds", label: "Rounds", href: `/m/tours/${tourId}/rounds`, Icon: Flag },
    { key: "boards", label: "Boards", href: `/m/tours/${tourId}/leaderboards`, Icon: Trophy },
    {
      key: "competitions",
      label: "Competitions",
      href: `/m/tours/${tourId}/competitions`,
      Icon: Medal,
    },
    { key: "stats", label: "Stats", href: `/m/tours/${tourId}/stats`, Icon: BarChart3 },
    { key: "more", label: "More", href: `/m/tours/${tourId}/more`, Icon: MoreHorizontal },
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
          const color = active ? "#111827" : "#6b7280";
          const border = active ? "1px solid #111827" : "1px solid #e5e7eb";
          const bg = active ? "#f9fafb" : "white";

          return (
            <Link
              key={it.key}
              href={it.href}
              style={{
                textDecoration: "none",
                color,
                border,
                background: bg,
                borderRadius: 10,
                padding: "8px 6px",
                textAlign: "center",
                fontSize: 12,
                fontWeight: active ? 800 : 600,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                lineHeight: 1.1,
              }}
              aria-current={active ? "page" : undefined}
            >
              <it.Icon size={18} className="shrink-0" />
              <span>{it.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
