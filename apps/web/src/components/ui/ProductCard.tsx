import type { ReactNode } from 'react';
import Link from 'next/link';

import { cn } from '@/lib/cn';

export function ProductCard({
  className,
  title,
  subtitle,
  ctaHref,
  ctaLabel,
  ctaOnClick,
  children,
}: {
  className?: string;
  title: string;
  subtitle?: string;
  ctaHref?: string;
  ctaLabel?: string;
  ctaOnClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-sm border border-cardBorder bg-stone p-6',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-featureHeading font-semibold text-ink">{title}</div>
          {subtitle ? <div className="mt-1 text-bodyLarge text-ink/70">{subtitle}</div> : null}
        </div>
        {ctaHref && ctaLabel ? (
          <Link
            href={ctaHref}
            className="rounded-pill bg-nearBlack px-6 py-2.5 text-button font-semibold text-canvas hover:bg-black transition-colors"
          >
            {ctaLabel}
          </Link>
        ) : ctaOnClick && ctaLabel ? (
          <button
            type="button"
            onClick={ctaOnClick}
            className="rounded-pill bg-nearBlack px-6 py-2.5 text-button font-semibold text-canvas hover:bg-black transition-colors"
          >
            {ctaLabel}
          </button>
        ) : null}
      </div>

      {children ? <div className="mt-5">{children}</div> : null}
    </div>
  );
}

