import { REDIS_KEYS } from '@pullvault/shared/constants';
import { logger } from '@pullvault/shared/logger';

import { env } from '../env.js';
import { runFullRefresh, runHotRefresh, runSeedIfEmpty } from '../jobs/price-pipeline.js';
import { Queue, Worker, bullConnection } from './connections.js';

export type PriceRefreshJob = {
  mode: 'full' | 'hot' | 'seed';
  pages?: number;
  sample?: number;
};

let queue: Queue<PriceRefreshJob> | null = null;
export function getPriceRefreshQueue() {
  if (queue) return queue;
  queue = new Queue<PriceRefreshJob>(REDIS_KEYS.queue.priceRefresh, {
    connection: bullConnection(),
    defaultJobOptions: { attempts: 3, removeOnComplete: 500, removeOnFail: 500 },
  });
  return queue;
}

/**
 * Modes:
 *   - full : paginate the Pokemon TCG API and upsert the catalog
 *   - hot  : drift prices for cards referenced by live listings/auctions/recent purchases
 *   - seed : full refresh ONLY if the catalog is currently empty
 *
 * Workers MUST be idempotent — they may run twice on retry. Each upsert is
 * keyed on `cards.external_id` and each price-history insert is append-only,
 * so re-running a job is safe.
 */
export function startPriceRefreshWorker() {
  const worker = new Worker<PriceRefreshJob>(
    REDIS_KEYS.queue.priceRefresh,
    async (job) => {
      const data = job.data;
      logger.info({ mode: data.mode, jobId: job.id }, 'price-refresh job picked up');

      try {
        if (data.mode === 'full') {
          const { upserts } = await runFullRefresh({ pages: data.pages ?? env.PRICE_REFRESH_FULL_PAGES });
          logger.info({ upserts }, 'price-refresh full complete');
          return { upserts };
        }
        if (data.mode === 'seed') {
          const result = await runSeedIfEmpty({ pages: data.pages ?? env.PRICE_REFRESH_FULL_PAGES });
          logger.info(result, 'price-refresh seed complete');
          return result;
        }
        const { updated } = await runHotRefresh({ sample: data.sample ?? env.PRICE_REFRESH_HOT_SAMPLE });
        logger.info({ updated }, 'price-refresh hot complete');
        return { updated };
      } catch (err) {
        logger.error({ err, mode: data.mode }, 'price-refresh job error');
        throw err;
      }
    },
    { connection: bullConnection(), concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'price-refresh job failed');
  });

  void (async () => {
    const q = getPriceRefreshQueue();
    if (env.CATALOG_AUTOSEED) {
      await q.add('seed', { mode: 'seed' }, { jobId: 'price-refresh:seed:bootstrap' });
    }
    await q.add(
      'hot',
      { mode: 'hot' },
      { repeat: { every: env.PRICE_REFRESH_HOT_INTERVAL_MS }, jobId: 'price-refresh:hot' },
    );
    await q.add(
      'full',
      { mode: 'full' },
      { repeat: { every: env.PRICE_REFRESH_FULL_INTERVAL_MS }, jobId: 'price-refresh:full' },
    );
  })();

  return worker;
}

/** Programmatically enqueue a one-shot refresh from the trusted internal route. */
export async function enqueuePriceRefresh(payload: PriceRefreshJob): Promise<{ jobId: string }> {
  const q = getPriceRefreshQueue();
  const job = await q.add(`${payload.mode}-adhoc`, payload, {
    removeOnComplete: 100,
    removeOnFail: 100,
  });
  return { jobId: job.id ?? 'unknown' };
}
