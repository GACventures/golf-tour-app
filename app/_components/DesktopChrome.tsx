// app/_components/DesktopChrome.tsx
"use client";

import React from "react";
import { usePathname } from "next/navigation";

export default function DesktopChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Hide desktop header/nav for mobile routes
  if (pathname?.startsWith("/m")) return null;

  return <>{children}</>;
}
