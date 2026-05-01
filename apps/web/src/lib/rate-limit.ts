import 'server-only';

import { NextResponse } from 'next/server';

import { getCache } from '@pullvault/shared';
import { logger } from '@pullvault/shared/logger';
import type { RateLimitConfig } from '@pullvault/shared/rate-limiter';
import { slidingWindowRateLimit } from '@pullvault/shared/rate-limiter';
import { ERROR_CODES } from '@pullvault/shared';

import { db, schema } from './db';

// =====================================================================
// B2 — Rate-limit helper for Next.js App Router routes.
// =====================================================================
// Usage inside a route (notice we return the NextResponse as-is — the
// `handler()` wrapper passes through any Response, so rate-limit 429s
// get their custom `Retry-After` + `X-RateLimit-*` headers without us
// losing the ApiError / envelope pattern for non-rate-limit errors).
//
//   export const POST = handler(async (req, ctx) => {
//     const userId = await requireUserId();
//     const rl = await checkRateLimit(req, userId, {
//       keyPrefix: 'purchase',
//       userConfig: RATE_LIMITS.PACK_PURCHASE_USER,
//       ipConfig: RATE_LIMITS.PACK_PURCHASE_IP,
//     });
//     if (rl) return rl;
//     // ... proceed
//   });

export interface RateLimitOptions {
  /** Per-user window (always enforced). */
  userConfig: RateLimitConfig;
  /** Optional per-IP window — catches multi-account traffic from one NAT. */
  ipConfig?: RateLimitConfig;
  /** Short prefix for Redis keys + rate_limit_events.endpoint column. */
  keyPrefix: string;
}

function extractIp(req: Request): string {
  // Order matches what Vercel/Railway proxies inject. We only trust these
  // headers in production if the edge is actually setting them; that's a
  // deploy-time concern (and already documented in architecture.md §9).
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return 'unknown';
}

function buildLimitedResponse(
  result: { limit: number; remaining: number; resetInMs: number },
  code: 'RATE_LIMITED' | 'IP_RATE_LIMITED',
  message: string,
): NextResponse {
  const resetAtMs = Date.now() + result.resetInMs;
  return NextResponse.json(
    {
      ok: false,
      error: {
        code,
        message,
        details: { retryAfterMs: result.resetInMs },
      },
    },
    {
      status: 429,
      headers: {
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(resetAtMs),
        // Retry-After is in SECONDS per RFC 7231 §7.1.3.
        'Retry-After': String(Math.max(1, Math.ceil(result.resetInMs / 1000))),
      },
    },
  );
}

/**
 * Fire-and-forget audit-log insert. Deliberately NOT awaited so a bad
 * DB round-trip can't delay the 429 response we just computed.
 */
function logRateLimitEvent(
  userId: string | null,
  ip: string | null,
  endpoint: string,
  limitType: 'user' | 'ip',
): void {
  db.insert(schema.rateLimitEvents)
    .values({
      userId,
      ip: ip === 'unknown' ? null : ip,
      endpoint,
      limitType,
    })
    .catch((err) => {
      logger.warn({ err, endpoint, limitType }, 'rate_limit_events insert failed (non-fatal)');
    });
}

/**
 * Returns a 429 NextResponse when the user or their IP has exceeded the
 * configured windows; returns null when the request should proceed.
 *
 * Always checks the per-user window first. Per-IP check is additive and
 * only runs when `ipConfig` is provided and the IP was discovered.
 */
export async function checkRateLimit(
  req: Request,
  userId: string,
  options: RateLimitOptions,
): Promise<NextResponse | null> {
  const redis = getCache();
  const ip = extractIp(req);

  // Per-user window.
  const userKey = `rl:${options.keyPrefix}:user:${userId}`;
  const userResult = await slidingWindowRateLimit(redis, userKey, options.userConfig);

  if (!userResult.allowed) {
    logRateLimitEvent(userId, ip, options.keyPrefix, 'user');
    return buildLimitedResponse(userResult, ERROR_CODES.RATE_LIMITED, 'Too many requests.');
  }

  // Optional per-IP window.
  if (options.ipConfig && ip !== 'unknown') {
    const ipKey = `rl:${options.keyPrefix}:ip:${ip}`;
    const ipResult = await slidingWindowRateLimit(redis, ipKey, options.ipConfig);
    if (!ipResult.allowed) {
      logRateLimitEvent(userId, ip, options.keyPrefix, 'ip');
      // Reuse 429 + the same RATE_LIMITED code so clients only branch once,
      // but surface a distinct message so humans see why.
      return buildLimitedResponse(
        ipResult,
        'IP_RATE_LIMITED',
        'Too many requests from this network.',
      );
    }
  }

  return null;
}
