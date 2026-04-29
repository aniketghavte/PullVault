import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Props = {
  children: ReactNode;
  active?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

export function BlogFilterChip({ children, active, className, ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'rounded-pill border px-6 py-3 text-bodyLarge font-semibold transition-colors',
        active
          ? 'border-coral bg-coral text-nearBlack'
          : 'border-softCoral bg-softCoral/20 text-nearBlack/80 hover:bg-softCoral/35',
        className,
      )}
    >
      {children}
    </button>
  );
}

