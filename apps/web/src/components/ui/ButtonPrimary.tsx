import Link from 'next/link';
import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Props = {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
};

export function ButtonPrimary({ href, onClick, children, className, disabled, type }: Props) {
  const base =
    'inline-flex items-center justify-center rounded-pill bg-nearBlack px-6 py-3 text-button font-semibold text-canvas transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50';

  if (href) {
    return (
      <Link href={href} className={cn(base, className)}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type ?? 'button'} onClick={onClick} className={cn(base, className)} disabled={disabled}>
      {children}
    </button>
  );
}

