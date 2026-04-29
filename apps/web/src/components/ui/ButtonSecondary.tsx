import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Props = {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
};

export function ButtonSecondary({ href, onClick, children, className }: Props) {
  const base =
    'inline-flex items-center justify-center rounded-pill px-2 py-1 text-button font-semibold text-actionBlue underline decoration-actionBlue/40 underline-offset-4 transition-colors hover:decoration-actionBlue hover:decoration-solid';

  if (href) {
    return (
      <Link href={href} className={cn(base, className)}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={cn(base, className)}>
      {children}
    </button>
  );
}

