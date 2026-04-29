import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function ContactFormCard({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mx-auto w-full max-w-md rounded-lg border border-cardBorder bg-canvas p-7', className)}>
      {children}
    </div>
  );
}

