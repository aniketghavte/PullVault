import 'server-only';

import { logger } from '@pullvault/shared/logger';

import { clientEnv, serverEnv } from '../env';

const REALTIME_BASE_URL = process.env.REALTIME_INTERNAL_URL ?? clientEnv.NEXT_PUBLIC_REALTIME_URL;

type InternalResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

/**
 * Thin authenticated client for the realtime app's `/internal/*` endpoints.
 * Web -> realtime hops always carry the shared `REALTIME_INTERNAL_TOKEN`.
 */
async function callInternal<T>(path: string, body?: unknown, init?: RequestInit): Promise<InternalResponse<T>> {
  const env = serverEnv();
  const url = new URL(path.replace(/^\/+/, '/'), REALTIME_BASE_URL).toString();
  try {
    const res = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'x-realtime-token': env.REALTIME_INTERNAL_TOKEN,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      ...init,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      logger.warn({ status: res.status, url, parsed }, 'realtime internal call failed');
      return {
        ok: false,
        error: {
          code: (parsed as { error?: { code?: string } } | null)?.error?.code ?? 'INTERNAL',
          message:
            (parsed as { error?: { message?: string } } | null)?.error?.message ?? `realtime returned ${res.status}`,
        },
      };
    }
    return parsed as InternalResponse<T>;
  } catch (err) {
    logger.error({ err, url }, 'realtime internal call threw');
    return { ok: false, error: { code: 'INTERNAL', message: 'realtime unreachable' } };
  }
}

export async function triggerPriceRefresh(payload: {
  mode?: 'full' | 'hot' | 'seed';
  pages?: number;
  sample?: number;
}): Promise<InternalResponse<{ jobId: string; mode: string }>> {
  return callInternal<{ jobId: string; mode: string }>('/internal/jobs/price-refresh', {
    mode: payload.mode ?? 'full',
    ...(payload.pages !== undefined ? { pages: payload.pages } : {}),
    ...(payload.sample !== undefined ? { sample: payload.sample } : {}),
  });
}

/**
 * Schedule a BullMQ delayed job for auction settlement at the given end time.
 * Called after auction creation and after anti-snipe extension.
 */
export async function scheduleAuctionCloseJob(payload: {
  auctionId: string;
  endAt: string; // ISO
}): Promise<InternalResponse<{ auctionId: string }>> {
  return callInternal<{ auctionId: string }>('/internal/jobs/auction-close', {
    auctionId: payload.auctionId,
    endAt: payload.endAt,
  });
}
