import { REDIS_KEYS } from '@pullvault/shared/constants';
import { logger } from '@pullvault/shared/logger';
import { Queue, Worker, bullConnection } from './connections.js';

export type AuctionCloseJob = { auctionId: string };

let queue: Queue<AuctionCloseJob> | null = null;
export function getAuctionCloseQueue() {
  if (queue) return queue;
  queue = new Queue<AuctionCloseJob>(REDIS_KEYS.queue.auctionClose, {
    connection: bullConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  });
  return queue;
}

// When an auction is created, web schedules a delayed job at end_at.
// When anti-snipe extends, web ALSO schedules a NEW delayed job for the
// new end_at (we accept the cost of an extra wakeup; the worker re-checks
// end_at vs now() and bails if it's not actually time).
export function startAuctionCloseWorker() {
  const worker = new Worker<AuctionCloseJob>(
    REDIS_KEYS.queue.auctionClose,
    async (job) => {
      const { auctionId } = job.data;
      logger.info({ auctionId, jobId: job.id }, 'auction-close job picked up');
      // TODO: implement settlement transaction:
      //   BEGIN;
      //     SELECT * FROM auctions WHERE id=$1 FOR UPDATE;
      //       - if status = 'settled' -> noop, return.
      //       - if end_at > now() -> reschedule for new end_at, return.
      //     IF current_high_bid IS NULL:
      //       UPDATE auctions SET status='settled', settled_at=now();
      //       UPDATE user_cards SET status='held' WHERE id=$card; -- return to seller
      //     ELSE:
      //       UPDATE balance_holds SET status='consumed' WHERE reference_id=$bid;
      //       UPDATE profiles (winner): held -= price.
      //       UPDATE profiles (seller): available += price - fee.
      //       UPDATE user_cards SET owner_id=$winner, status='held'.
      //       INSERT ledger_entries (winner debit, seller credit, platform fee).
      //       UPDATE auctions SET status='settled', winner_id, final_price_usd, settled_at;
      //   COMMIT;
      // Then publish pv.auction.settled.
    },
    {
      connection: bullConnection(),
      concurrency: 4,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'auction-close job failed');
  });

  return worker;
}

export async function scheduleAuctionClose(auctionId: string, endAt: Date) {
  const q = getAuctionCloseQueue();
  const delay = Math.max(0, endAt.getTime() - Date.now());
  await q.add(
    'close',
    { auctionId },
    {
      delay,
      // jobId allows us to overwrite the previous schedule if anti-snipe
      // extended the auction. We use a deterministic id per auction.
      jobId: `auction-close:${auctionId}:${endAt.getTime()}`,
    },
  );
}
