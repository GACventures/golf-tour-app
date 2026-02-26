import Link from "next/link";
import AdminGuard from "./_components/AdminGuard";

export default function MobileAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminGuard>
      <div className="min-h-[calc(100vh-2rem)] -mx-4 px-4 pb-8">
        <header className="sticky top-0 z-40 bg-gray-50/90 backdrop-blur border-b">
          <div className="max-w-md mx-auto py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">Admin</div>
              <div className="text-[11px] text-gray-600 truncate">Mobile setup / maintenance</div>
            </div>

            <nav className="flex items-center gap-3 text-sm">
              <Link className="underline underline-offset-4" href="/m/admin">
                Hub
              </Link>
              <Link className="underline underline-offset-4" href="/m/tours">
                Player view
              </Link>
            </nav>
          </div>
        </header>

        <div className="max-w-md mx-auto pt-4">{children}</div>
      </div>
    </AdminGuard>
  );
}