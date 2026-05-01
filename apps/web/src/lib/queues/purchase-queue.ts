import 'server-only';

import { Queue, type ConnectionOptions } from 'bullmq';

import { newRedisConnection } from '@pullvault/shared';
import {
  PURCHASE_QUEUE_NAME,
  type PurchaseJobData,
  type PurchaseJobResult,
} from '@pullvault/shared/purchase-queue';

// =====================================================================
// B2 — Web-side handle into the BullMQ pack-purchase queue.
// =====================================================================
// The web app BOTH produces (purchase route enqueues with jitter) and
// polls (status route reads job state). BullMQ's Queue class is safe
// to construct in each process — internally it just talks to Redis
// using the queue name, so the realtime worker and the web API share
// the same jobs.

let singleton: Queue<PurchaseJobData, PurchaseJobResult> | null = null;

function bullConnection(): ConnectionOptions {
  return newRedisConnection() as unknown as ConnectionOptions;
}

export function getPurchaseQueue(): Queue<PurchaseJobData, PurchaseJobResult> {
  if (singleton) return singleton;
  singleton = new Queue<PurchaseJobData, PurchaseJobResult>(PURCHASE_QUEUE_NAME, {
    connection: bullConnection(),
    defaultJobOptions: {
      // Keep last 200 completed so the status poller still finds them
      // a few seconds after success. Failed retained longer for debugging.
      removeOnComplete: { count: 200, age: 300 },
      removeOnFail: { count: 500, age: 3600 },
      // Do NOT retry — pack-purchase is transactional; retrying a failed
      // purchase could double-publish "sold_out" or spam bot-signals.
      attempts: 1,
    },
  });
  return singleton;
}
