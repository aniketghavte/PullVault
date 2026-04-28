import IORedis, { type Redis } from 'ioredis';

// We keep a few singleton connections by purpose:
// - publisher: Redis pub/sub PUBLISH (web API routes)
// - subscriber: Redis pub/sub SUBSCRIBE (realtime server)
// - cache: GET/SET/INCR for cache + atomic counters
// BullMQ Queue/Worker each want their *own* dedicated connection — use
// `newRedisConnection()` for those.

let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let cache: Redis | null = null;

export function getRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  return url;
}

function buildConnection(): Redis {
  return new IORedis(getRedisUrl(), {
    maxRetriesPerRequest: null, // BullMQ-compatible; safe for app code too
    enableReadyCheck: true,
    keepAlive: 30_000,
  });
}

export function getPublisher(): Redis {
  if (!publisher) publisher = buildConnection();
  return publisher;
}

export function getSubscriber(): Redis {
  if (!subscriber) subscriber = buildConnection();
  return subscriber;
}

export function getCache(): Redis {
  if (!cache) cache = buildConnection();
  return cache;
}

/** Use for BullMQ Queue/Worker, which each want their own connection. */
export function newRedisConnection(): Redis {
  return buildConnection();
}

export type { Redis };
