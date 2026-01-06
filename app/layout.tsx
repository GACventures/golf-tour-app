import Link from 'next/link';

export const metadata = {
  title: 'Golf Tour App',
  description: 'Stableford golf tour tracker',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'Arial, sans-serif' }}>
        <div style={{ padding: 16, borderBottom: '1px solid #ddd' }}>
          <nav style={{ display: 'flex', gap: 12 }}>
            <Link href="/">Home</Link>
            <Link href="/tours">Tours</Link>
            <Link href="/players">Players</Link>
            <Link href="/courses">Courses</Link>
          </nav>
        </div>

        <main style={{ padding: 16 }}>{children}</main>
      </body>
    </html>
  );
}
