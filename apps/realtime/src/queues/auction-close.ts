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

      // Dynamic import to avoid circular dependencies — the settlement
      // service lives in the web app package but is shared via the db package.
      const { getDb, schema } = await import('@pullvault/db');
      const { eq, and, sql } = await import('drizzle-orm');
      const { getPublisher, INTERNAL_EVENTS } = await import('@pullvault/shared');
      const { money, toMoneyString, feeOf } = await import('@pullvault/shared/money');
      const { PLATFORM } = await import('@pullvault/shared/constants');
      const { REDIS_KEYS: keys } = await import('@pullvault/shared/constants');
      
      const db = getDb();

      // Run settlement in a single transaction
      const result = await db.transaction(async (tx) => {
        // 1. Lock auction
        const [auction] = await tx
          .select()
          .from(schema.auctions)
          .where(eq(schema.auctions.id, auctionId))
          .for('update');

        if (!auction) {
          logger.warn({ auctionId }, 'auction-close: not found');
          return { settled: false, rescheduleEndAt: null as Date | null, winnerId: null as string | null };
        }

        if (auction.status === 'settled' || auction.status === 'cancelled') {
          return { settled: true, rescheduleEndAt: null as Date | null, winnerId: auction.winnerId };
        }

        if (auction.endAt.getTime() > Date.now()) {
          return { settled: false, rescheduleEndAt: auction.endAt, winnerId: null as string | null };
        }

        // No bids
        if (!auction.currentHighBidId) {
          await tx.update(schema.userCards).set({ status: 'held' }).where(eq(schema.userCards.id, auction.userCardId));
          await tx.update(schema.auctions).set({ status: 'settled', settledAt: new Date() }).where(eq(schema.auctions.id, auctionId));
          logger.info({ auctionId }, 'auction settled with no bids');
          return { settled: true, rescheduleEndAt: null as Date | null, winnerId: null as string | null };
        }

        // Has winner
        const winnerId = auction.currentHighBidderId!;
        const winningBidId = auction.currentHighBidId;
        const finalPrice = money(auction.currentHighBidUsd!);
        const fee = feeOf(finalPrice, PLATFORM.AUCTION_FEE_RATE);
        const netSeller = finalPrice.minus(fee);

        // Consume winning hold
        await tx.update(schema.balanceHolds)
          .set({ status: 'consumed', resolvedAt: new Date() })
          .where(and(eq(schema.balanceHolds.referenceId, winningBidId), eq(schema.balanceHolds.status, 'held')));

        // Debit winner's held
        await tx.update(schema.profiles)
          .set({ heldBalanceUsd: sql`${schema.profiles.heldBalanceUsd} - ${toMoneyString(finalPrice)}`, updatedAt: new Date() })
          .where(eq(schema.profiles.id, winnerId));

        // Credit seller
        await tx.update(schema.profiles)
          .set({ availableBalanceUsd: sql`${schema.profiles.availableBalanceUsd} + ${toMoneyString(netSeller)}`, updatedAt: new Date() })
          .where(eq(schema.profiles.id, auction.sellerId));

        // Transfer card
        await tx.update(schema.userCards)
          .set({ ownerId: winnerId, status: 'held', acquiredFrom: 'auction', sourceRefId: auctionId, acquiredPriceUsd: toMoneyString(finalPrice), acquiredAt: new Date() })
          .where(eq(schema.userCards.id, auction.userCardId));

        // Mark settled
        await tx.update(schema.auctions)
          .set({ status: 'settled', settledAt: new Date(), winnerId, finalPriceUsd: toMoneyString(finalPrice) })
          .where(eq(schema.auctions.id, auctionId));

        // Ledger entries
        await tx.insert(schema.ledgerEntries).values([
          { kind: 'auction_settlement_debit', userId: winnerId, counterpartyId: auction.sellerId, amountUsd: toMoneyString(finalPrice.neg()), referenceTable: 'auctions', referenceId: auctionId },
          { kind: 'auction_settlement_credit', userId: auction.sellerId, counterpartyId: winnerId, amountUsd: toMoneyString(netSeller), referenceTable: 'auctions', referenceId: auctionId },
          { kind: 'platform_fee', userId: null, amountUsd: toMoneyString(fee), referenceTable: 'auctions', referenceId: auctionId, metadata: { source: 'auction' } },
        ]);

        logger.info({ auctionId, winnerId, finalPriceUSD: toMoneyString(finalPrice) }, 'auction settled with winner');
        return { settled: true, rescheduleEndAt: null as Date | null, winnerId };
      });

      if (result.rescheduleEndAt) {
        await scheduleAuctionClose(auctionId, result.rescheduleEndAt);
        return;
      }

      if (result.settled) {
        // Publish settlement event
        try {
          const pub = getPublisher();
          const channel = keys.channel.auctionEvents(auctionId);
          await pub.publish(channel, JSON.stringify({
            event: INTERNAL_EVENTS.auctionSettled,
            emittedAt: new Date().toISOString(),
            payload: { auctionId, winnerId: result.winnerId, finalPriceUSD: null },
          }));
        } catch (err) {
          logger.warn({ err, auctionId }, 'failed to publish settlement event');
        }
      }
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
