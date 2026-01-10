import "./globals.css";
import Link from "next/link";
import DesktopChrome from "./_components/DesktopChrome";

export const metadata = {
  title: "Golf Tour App",
  description: "Stableford golf tour tracker",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen m-0 bg-gray-50 text-gray-900">
        {/* Global (desktop/admin) nav — hidden on /m routes */}
        <DesktopChrome>
          <header className="sticky top-0 z-50 border-b bg-white">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
              <Link href="/tours" className="font-semibold">
                Golf Tour App
              </Link>

              <nav className="flex flex-wrap items-center gap-4 text-sm">
                <Link className="underline-offset-4 hover:underline" href="/tours">
                  Tours
                </Link>
                <Link className="underline-offset-4 hover:underline" href="/courses">
                  Courses
                </Link>
                <Link className="underline-offset-4 hover:underline" href="/players">
                  Players
                </Link>
              </nav>
            </div>
          </header>
        </DesktopChrome>

        {/* Page content:
            - Keep desktop width/padding for non-mobile routes
            - For /m routes, children will render their own full-width layout
        */}
        <main className="mx-auto max-w-6xl px-4 py-4">{children}</main>
      </body>
    </html>
  );
}
