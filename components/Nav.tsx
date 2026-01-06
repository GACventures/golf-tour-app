'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Nav() {
  const pathname = usePathname();

  const linkStyle = (href: string) => ({
    fontWeight: pathname === href ? 'bold' as const : 'normal' as const,
    textDecoration: pathname === href ? 'underline' : 'none',
  });

  return (
    <nav style={{ display: 'flex', gap: 12 }}>
      <Link href="/" style={linkStyle('/')}>Home</Link>
      <Link href="/tours" style={linkStyle('/tours')}>Tours</Link>
      <Link href="/players" style={linkStyle('/players')}>Players</Link>
      <Link href="/courses" style={linkStyle('/courses')}>Courses</Link>
    </nav>
  );
}
