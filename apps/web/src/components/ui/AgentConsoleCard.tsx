import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function AgentConsoleCard({
  className,
  title = 'Console',
  status,
  badges,
  children,
}: {
  className?: string;
  title?: string;
  status?: { label: string; tone?: 'green' | 'coral' | 'navy' };
  badges?: Array<string>;
  children?: ReactNode;
}) {
  const statusTone =
    status?.tone === 'coral'
      ? 'bg-softCoral/20 text-softCoral border-softCoral/30'
      : status?.tone === 'navy'
        ? 'bg-darkNavy/30 text-canvas border-darkNavy/30'
        : 'bg-green/20 text-deepEnterpriseGreen border-deepEnterpriseGreen/30';

  return (
    <div
      className={cn(
        'rounded-lg border border-cardBorder bg-nearBlack p-5 text-canvas',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-micro font-semibold text-canvas/90">{title}</div>
          {badges && badges.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {badges.map((b) => (
                <span
                  key={b}
                  className="rounded-full border border-canvas/10 bg-canvas/5 px-3 py-1 text-micro text-canvas/80"
                >
                  {b}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {status ? (
          <div
            className={cn(
              'rounded-full border px-3 py-1 text-micro whitespace-nowrap',
              statusTone,
            )}
          >
            {status.label}
          </div>
        ) : null}
      </div>

      {children ? <div className="mt-5 space-y-3">{children}</div> : null}
    </div>
  );
}

