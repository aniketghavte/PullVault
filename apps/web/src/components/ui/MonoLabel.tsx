import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function MonoLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('font-mono text-monoLabel uppercase tracking-[0.28px] text-mutedSlate', className)}>
      {children}
    </span>
  );
}

