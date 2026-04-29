import type { ReactNode } from 'react';

import Link from 'next/link';

import { cn } from '@/lib/cn';

export function CapabilityCard({
  icon,
  title,
  description,
  href,
  linkLabel = 'Learn more',
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  href?: string;
  linkLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('space-y-3 rounded-lg', className)}>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg border border-hairline bg-white/30 flex items-center justify-center">
          {icon ?? (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M3 9H15M9 3V15"
                stroke="#212121"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <path
                d="M6.2 6.2L11.8 11.8"
                stroke="#212121"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          )}
        </div>
        <div className="text-featureHeading font-semibold">{title}</div>
      </div>
      <p className="text-bodyLarge text-ink/70">{description}</p>
      {href ? (
        <div>
          <Link href={href} className="text-actionBlue underline underline-offset-4 decoration-actionBlue/30 hover:decoration-actionBlue/60">
            {linkLabel}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

