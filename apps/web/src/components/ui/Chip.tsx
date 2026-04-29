import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

type Props = {
  children: ReactNode;
  active?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

export function Chip({ children, active, className, ...rest }: Props) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'rounded-full border px-4 py-2 text-button font-semibold transition-colors',
        active
          ? 'border-coral bg-coral text-nearBlack'
          : 'border-coral/40 bg-softCoral/20 text-nearBlack/80 hover:bg-softCoral/30',
        className,
      )}
    >
      {children}
    </button>
  );
}

