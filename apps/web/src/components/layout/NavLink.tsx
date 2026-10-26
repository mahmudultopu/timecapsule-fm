'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Header link that marks the current section with aria-current. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className="block whitespace-nowrap rounded-full px-3 py-1.5 text-mist transition-colors hover:bg-white/10 hover:text-paper aria-[current=page]:bg-white/12 aria-[current=page]:text-paper"
    >
      {children}
    </Link>
  );
}
