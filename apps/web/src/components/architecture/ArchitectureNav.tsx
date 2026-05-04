'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/architecture', label: 'Overview' },
  { href: '/architecture/b1', label: 'B1 · Pack economics' },
  { href: '/architecture/b2', label: 'B2 · Anti-bot & limits' },
  { href: '/architecture/b3', label: 'B3 · Auction integrity' },
  { href: '/architecture/b4', label: 'B4 · Provably fair packs' },
  { href: '/architecture/b5', label: 'B5 · Platform health' },
] as const;

export function ArchitectureNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Architecture documentation"
      className="rounded-lg border border-borderLight bg-canvas p-4 shadow-sm lg:sticky lg:top-24"
    >
      <div className="mb-3 font-mono text-micro font-semibold uppercase tracking-wide text-slate">
        Navigate
      </div>
      <ul className="flex flex-col gap-1">
        {LINKS.map(({ href, label }) => {
          const active = pathname === href || (href !== '/architecture' && pathname.startsWith(href));
          return (
            <li key={href}>
              <Link
                href={href}
                className={`block rounded-md px-2 py-1.5 text-caption transition-colors ${
                  active
                    ? 'bg-paleBlueWash font-semibold text-ink'
                    : 'text-slate hover:bg-stone/80 hover:text-ink'
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
