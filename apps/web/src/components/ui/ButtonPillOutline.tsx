import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Props = {
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
};

export function ButtonPillOutline({ onClick, children, className, disabled, type }: Props) {
  return (
    <button
      type={type ?? 'button'}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center rounded-pill border border-nearBlack/15 bg-transparent px-5 py-2 text-button font-semibold text-nearBlack transition-colors hover:border-nearBlack/30 hover:bg-nearBlack/[0.03] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {children}
    </button>
  );
}

