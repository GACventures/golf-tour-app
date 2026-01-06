// app/m/tours/[id]/layout.tsx
import type { ReactNode } from "react";
import MobileNav from "./_components/MobileNav";

export default function MobileTourLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#fff",
      }}
    >
      <div style={{ padding: 14, borderBottom: "1px solid #eee" }}>
        <div style={{ fontSize: 16, fontWeight: 800 }}>Tour (Mobile)</div>
        <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>
          Use the menu below to navigate.
        </div>
      </div>

      <main style={{ flex: 1, padding: 14, paddingBottom: 86 }}>{children}</main>

      <MobileNav />
    </div>
  );
}
