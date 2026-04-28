import { REDIS_KEYS } from '@pullvault/shared/constants';
import { logger } from '@pullvault/shared/logger';
import { Queue, Worker, bullConnection } from './connections.js';

export type PriceRefreshJob = { mode: 'full' | 'hot'; cardIds?: string[] };

let queue: Queue<PriceRefreshJob> | null = null;
export function getPriceRefreshQueue() {
  if (queue) return queue;
  queue = new Queue<PriceRefreshJob>(REDIS_KEYS.queue.priceRefresh, {
    connection: bullConnection(),
    defaultJobOptions: { attempts: 3, removeOnComplete: 500 },
  });
  return queue;
}

// Scheduled by `repeat` so we don't depend on external cron.
//   full   -> rotate through entire catalog, once per ~30 minutes
//   hot    -> only cards that are currently traded/auctioned, every ~30 seconds
//             (cheaper, much fresher prices where they matter).
export function startPriceRefreshWorker() {
  const worker = new Worker<PriceRefreshJob>(
    REDIS_KEYS.queue.priceRefresh,
    async (job) => {
      logger.info({ mode: job.data.mode }, 'price refresh job');
      // TODO: implement the price pipeline:
      //   - mode=hot:  fetch latest prices for active card_ids
      //                 (those referenced by listings/auctions/recent purchases).
      //   - mode=full: paginate the catalog and refresh in batches.
      //   For each updated card:
      //     UPDATE cards SET market_price_usd, price_updated_at;
      //     INSERT INTO card_prices (card_id, source, price_usd);
      //     PUBLISH pv:prices:ticks { cardId, priceUSD, ts };
    },
    { connection: bullConnection(), concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'price-refresh job failed');
  });

  // Self-bootstrap repeating jobs.
  void (async () => {
    const q = getPriceRefreshQueue();
    await q.add('hot', { mode: 'hot' }, { repeat: { every: 30_000 }, jobId: 'price-refresh:hot' });
    await q.add(
      'full',
      { mode: 'full' },
      { repeat: { every: 30 * 60_000 }, jobId: 'price-refresh:full' },
    );
  })();

  return worker;
}
