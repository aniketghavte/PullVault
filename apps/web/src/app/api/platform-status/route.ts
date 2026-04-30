import { sql } from 'drizzle-orm';
import { getCache } from '@pullvault/shared/redis';
import { logger } from '@pullvault/shared/logger';

import { ok } from '@/lib/api';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

type ServiceCheck = {
  ok: boolean;
};

type RedisCheck = ServiceCheck & {
  /** Human label for reviewer context (never includes secrets). */
  provider: 'Upstash' | 'Local/other';
};

async function checkDatabase(): Promise<boolean> {
  await db.execute(sql`SELECT 1`);
  return true;
}

async function checkRedis(): Promise<boolean> {
  const redis = getCache();
  const pong = await redis.ping();
  return pong === 'PONG';
}

function redisProviderLabel(): RedisCheck['provider'] {
  const url = process.env.REDIS_URL ?? '';
  if (url.includes('upstash.io')) return 'Upstash';
  return 'Local/other';
}

async function checkRealtime(baseUrl: string): Promise<boolean> {
  const url = `${baseUrl.replace(/\/$/, '')}/health`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 3500);
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL;
    const res = await fetch(url, {
      signal: ac.signal,
      cache: 'no-store',
      ...(origin ? { headers: { Origin: origin } } : {}),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch (err) {
    logger.warn({ err, url }, 'platform-status realtime check failed');
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** One aggregate check per reviewer page load — all checks run server-side once. */
export async function GET() {
  const realtimeUrl = (process.env.NEXT_PUBLIC_REALTIME_URL ?? '').trim();
  const provider = redisProviderLabel();

  const [dbResult, redisResult, rtResult] = await Promise.allSettled([
    checkDatabase(),
    checkRedis(),
    realtimeUrl.length > 0 ? checkRealtime(realtimeUrl) : Promise.resolve(null as boolean | null),
  ]);

  const databaseOk = dbResult.status === 'fulfilled' && dbResult.value;
  const redisOk = redisResult.status === 'fulfilled' && redisResult.value;
  let realtime: ServiceCheck & { configured: boolean };
  if (realtimeUrl.length === 0) {
    realtime = { ok: false, configured: false };
  } else {
    const rtOk = rtResult.status === 'fulfilled' && rtResult.value === true;
    realtime = { ok: rtOk, configured: true };
  }

  return ok({
    checkedAt: new Date().toISOString(),
    api: { ok: true } satisfies ServiceCheck,
    database: { ok: databaseOk } satisfies ServiceCheck,
    redis: { ok: redisOk, provider } satisfies RedisCheck,
    realtime,
  });
}
