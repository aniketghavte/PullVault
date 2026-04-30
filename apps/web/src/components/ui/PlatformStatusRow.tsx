'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

type PlatformStatusPayload = {
  checkedAt: string;
  api: { ok: boolean };
  database: { ok: boolean };
  redis: { ok: boolean; provider: 'Upstash' | 'Local/other' };
  realtime: { ok: boolean; configured: boolean };
};

/** Single-flight fetch so React Strict Mode remount still only hits the API once per tab/session. */
let statusInflight: Promise<PlatformStatusPayload> | null = null;

async function fetchPlatformStatusOnce(): Promise<PlatformStatusPayload> {
  if (!statusInflight) {
    statusInflight = (async () => {
      const res = await fetch('/api/platform-status', { cache: 'no-store' });
      const json = (await res.json()) as { ok: boolean; data?: PlatformStatusPayload };
      if (!json.ok || !json.data) {
        throw new Error('platform-status unavailable');
      }
      return json.data;
    })();
  }
  return statusInflight;
}

function Indicator({ ok, label }: { ok: boolean | null; label: string }) {
  const tone =
    ok === null ? 'text-canvas/60' : ok ? 'text-emerald-300' : 'text-amber-300';
  const dot = ok === null ? 'bg-canvas/40' : ok ? 'bg-emerald-400' : 'bg-amber-400';

  return (
    <span className={cn('inline-flex items-center gap-1.5 shrink-0', tone)} title={label}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} aria-hidden />
      <span>{label}</span>
    </span>
  );
}

export function PlatformStatusRow() {
  const [payload, setPayload] = useState<PlatformStatusPayload | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchPlatformStatusOnce()
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="w-full border-b border-canvas/15 bg-nearBlack/90 px-4 py-1.5">
      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-micro text-canvas/90">
        <span className="text-canvas/50 uppercase tracking-wide text-[10px] font-semibold">
          System status
        </span>
        {error && (
          <span className="text-amber-300" role="status">
            Could not load status
          </span>
        )}
        {!error && !payload && (
          <span className="text-canvas/60" aria-live="polite">
            Checking services…
          </span>
        )}
        {!error && payload && (
          <>
            <Indicator ok={payload.api.ok} label="API" />
            <Indicator ok={payload.database.ok} label="Postgres" />
            <Indicator
              ok={payload.redis.ok}
              label={payload.redis.provider === 'Upstash' ? `Redis (${payload.redis.provider})` : 'Redis'}
            />
            {!payload.realtime.configured ? (
              <span className="text-canvas/55" title="Set NEXT_PUBLIC_REALTIME_URL">
                Realtime · not configured
              </span>
            ) : (
              <Indicator ok={payload.realtime.ok} label="Realtime" />
            )}
          </>
        )}
      </div>
    </div>
  );
}
