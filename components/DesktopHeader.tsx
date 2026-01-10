"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function DesktopHeader() {
  const pathname = usePathname();

  // Leave mobile hierarchy untouched
  if (pathname?.startsWith("/m")) return null;

  return (
    <header className="sticky top-0 z-50 border-b bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-4">
          <Link href="/tours" className="font-semibold">
            Golf Tour App
          </Link>

          <nav className="flex items-center gap-3 text-sm">
            <Link className="underline-offset-4 hover:underline" href="/tours">
              Tours
            </Link>
            <span className="opacity-30">•</span>
            <Link className="underline-offset-4 hover:underline" href="/courses">
              Courses
            </Link>
            <span className="opacity-30">•</span>
            <Link className="underline-offset-4 hover:underline" href="/players">
              Players
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
