import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function DarkFeatureBand({
  children,
  tone = 'green',
  className,
}: {
  children: ReactNode;
  tone?: 'green' | 'navy';
  className?: string;
}) {
  return (
    <section className={cn('w-full py-20 px-4', tone === 'green' ? 'bg-deepEnterpriseGreen text-canvas' : 'bg-darkNavy text-canvas', className)}>
      <div className="mx-auto w-full max-w-7xl">{children}</div>
    </section>
  );
}

