import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function ResearchTable({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('w-full divide-y divide-hairline border-t border-hairline', className)}>
      {children}
    </div>
  );
}

export function ResearchTableRow({
  left,
  center,
  right,
  className,
}: {
  left: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('py-5 grid items-center', center || right ? 'grid-cols-[1.2fr,0.9fr,0.7fr]' : 'grid-cols-1', className)}>
      <div className="space-y-2">{left}</div>
      {center ? <div className="space-y-2">{center}</div> : null}
      {right ? <div className="space-y-2 text-right">{right}</div> : null}
    </div>
  );
}

