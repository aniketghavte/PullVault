import { logger } from '@pullvault/shared/logger';
import {
  PURCHASE_QUEUE_NAME,
  type PurchaseJobData,
  type PurchaseJobResult,
} from '@pullvault/shared/purchase-queue';

import { env } from '../env.js';
import { Queue, Worker, bullConnection } from './connections.js';

// =====================================================================
// B2 Layer 2 — Pack-purchase worker.
// =====================================================================
// Jobs arrive from the web API with a 0-2000ms delay (BullMQ handles the
// wait). When this worker picks one up we call back into the web app's
// trusted internal endpoint, which runs the existing atomic transaction
// (`purchasePack()`) and publishes the Redis events.
//
// Delegating to web keeps `pack-purchase.ts` as the single source of
// truth (the assignment explicitly says don't touch it) without forcing
// this app to re-implement ~250 lines of transaction logic.

let queue: Queue<PurchaseJobData, PurchaseJobResult> | null = null;

/**
 * Exposed so other realtime code (or ops commands) can enqueue, but the
 * PRIMARY producer is the web app — this Queue instance is mostly here
 * to mirror the auction-close / price-refresh pattern.
 */
export function getPackPurchaseQueue(): Queue<PurchaseJobData, PurchaseJobResult> {
  if (queue) return queue;
  queue = new Queue<PurchaseJobData, PurchaseJobResult>(PURCHASE_QUEUE_NAME, {
    connection: bullConnection(),
    defaultJobOptions: {
      removeOnComplete: { count: 200, age: 300 },
      removeOnFail: { count: 500, age: 3600 },
      attempts: 1,
    },
  });
  return queue;
}

function getWebInternalUrl(): string {
  return env.WEB_INTERNAL_URL ?? env.NEXT_PUBLIC_APP_URL;
}

export function startPackPurchaseWorker() {
  const worker = new Worker<PurchaseJobData, PurchaseJobResult>(
    PURCHASE_QUEUE_NAME,
    async (job) => {
      const started = Date.now();
      const waited = started - job.data.requestedAt;
      logger.info(
        { jobId: job.id, userId: job.data.userId, dropId: job.data.dropId, waitedMs: waited },
        'pack-purchase job picked up',
      );

      const url = new URL('/api/internal/packs/purchase', getWebInternalUrl()).toString();

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-realtime-token': env.REALTIME_INTERNAL_TOKEN,
          },
          body: JSON.stringify({
            userId: job.data.userId,
            dropId: job.data.dropId,
            idempotencyKey: job.data.idempotencyKey,
          }),
        });
      } catch (err) {
        logger.error({ err, jobId: job.id, url }, 'pack-purchase worker: fetch threw');
        const result: PurchaseJobResult = {
          success: false,
          errorCode: 'INTERNAL',
          errorMessage: 'web internal endpoint unreachable',
        };
        return result;
      }

      const text = await res.text().catch(() => '');
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }

      if (!res.ok) {
        const errBody = parsed as
          | { error?: { code?: string; message?: string } }
          | null;
        const code = errBody?.error?.code ?? 'INTERNAL';
        const message = errBody?.error?.message ?? `web returned ${res.status}`;
        logger.warn(
          { jobId: job.id, status: res.status, code, message },
          'pack-purchase worker: non-2xx from web',
        );
        const result: PurchaseJobResult = {
          success: false,
          errorCode: code,
          errorMessage: message,
        };
        return result;
      }

      const okBody = parsed as { ok: true; data: { purchaseId: string; remaining: number } } | null;
      if (!okBody?.ok || !okBody.data?.purchaseId) {
        logger.warn({ jobId: job.id, body: parsed }, 'pack-purchase worker: unexpected ok body');
        const result: PurchaseJobResult = {
          success: false,
          errorCode: 'INTERNAL',
          errorMessage: 'malformed response from web',
        };
        return result;
      }

      logger.info(
        {
          jobId: job.id,
          userId: job.data.userId,
          dropId: job.data.dropId,
          purchaseId: okBody.data.purchaseId,
          totalMs: Date.now() - job.data.requestedAt,
        },
        'pack-purchase job completed',
      );

      return {
        success: true,
        purchaseId: okBody.data.purchaseId,
        completedAt: new Date().toISOString(),
      } satisfies PurchaseJobResult;
    },
    {
      connection: bullConnection(),
      // Concurrency must stay >1 so a held jitter job doesn't block others,
      // but small enough to not overwhelm the web app. 8 is the same default
      // BullMQ uses and comfortably handles drop bursts given DB is the
      // real bottleneck.
      concurrency: 8,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'pack-purchase job failed (attempts=1, no retry)');
  });

  return worker;
}
