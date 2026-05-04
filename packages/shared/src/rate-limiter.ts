import type { Redis } from 'ioredis';

// =====================================================================
// Sliding-window rate limiter — atomic via Redis Lua.
// =====================================================================
// Two ZADD / ZCARD-style commands issued back-to-back from Node would
// race: two requests can both read ZCARD = limit-1 and both succeed.
// A Lua script runs end-to-end inside Redis with NO interleaving, so
// concurrent callers against the same key can never both pass the
// check. This is the whole point of the atomicity requirement.
//
// The window is a sorted set where the score is the unix-ms timestamp
// and the member is a unique request id. We:
//   1. trim entries older than (now - windowMs)
//   2. count what's left
//   3. if count >= max  → return blocked (+ resetInMs from oldest entry)
//   4. else              → ZADD this request, PEXPIRE the key
//
// Returns a 4-element array [allowed, remaining, resetInMs, limit]
// so the caller can set RFC-compliant 429 headers.

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local requestId = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)

local count = redis.call('ZCARD', key)

if count >= max then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local resetInMs = window
  if oldest[2] then
    resetInMs = (tonumber(oldest[2]) + window) - now
    if resetInMs < 0 then resetInMs = 0 end
  end
  return {0, 0, resetInMs, max}
end

redis.call('ZADD', key, now, requestId)
redis.call('PEXPIRE', key, window)

return {1, max - count - 1, window, max}
`;

export interface RateLimitConfig {
  /** Window size in milliseconds. */
  windowMs: number;
  /** Max requests allowed inside the window. */
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Remaining requests in the current window. 0 when blocked. */
  remaining: number;
  /** Milliseconds until the next request would be allowed. */
  resetInMs: number;
  /** The configured limit (mirrored into headers). */
  limit: number;
}

/**
 * Atomic sliding-window rate limit check.
 *
 * Usage:
 *   const r = await slidingWindowRateLimit(redis, `rl:purchase:user:${userId}`, {
 *     windowMs: 60_000, max: 3
 *   });
 *   if (!r.allowed) return new Response('Too many requests', { status: 429 });
 */
export async function slidingWindowRateLimit(
  redis: Redis,
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const now = Date.now();
  // requestId must be unique per call so ZADD doesn't collapse entries
  // from the same millisecond (Math.random keeps it cheap and good-enough).
  const requestId = `${now}-${Math.random().toString(36).slice(2, 10)}`;

  // ioredis `eval(script, numkeys, key1..., arg1...)` returns `unknown`.
  const raw = (await redis.eval(
    SLIDING_WINDOW_LUA,
    1,
    key,
    String(now),
    String(config.windowMs),
    String(config.max),
    requestId,
  )) as [number, number, number, number];

  return {
    allowed: raw[0] === 1,
    remaining: Math.max(0, raw[1]),
    resetInMs: Math.max(0, raw[2]),
    limit: raw[3],
  };
}
