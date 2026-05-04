import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { ArchitectureNav } from '@/components/architecture/ArchitectureNav';

export const metadata: Metadata = {
  title: 'Architecture',
  description:
    'How PullVault works: monorepo layout, Postgres transactions, Redis, realtime, and Part B features B1–B5.',
};

export default function ArchitectureLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-[70vh]">
      <div className="mx-auto w-full max-w-7xl px-4 py-12 lg:py-16">
        <div className="flex flex-col gap-10 lg:flex-row lg:gap-12 lg:items-start">
          <aside className="shrink-0 lg:w-56">
            <ArchitectureNav />
          </aside>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </div>
  );
}
