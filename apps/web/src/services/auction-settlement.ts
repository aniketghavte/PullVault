import 'server-only';

import { eq, and, sql } from 'drizzle-orm';
import type { DB } from '@pullvault/db';
import { schema } from '@/lib/db';
import { money, toMoneyString, feeOf } from '@pullvault/shared/money';
import { PLATFORM } from '@pullvault/shared';
import { logger } from '@pullvault/shared/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SettlementResult {
  settled: boolean;
  winnerId: string | null;
  finalPriceUSD: string | null;
  rescheduleEndAt: Date | null; // non-null if the auction was extended and we need to reschedule
}

// ---------------------------------------------------------------------------
// Settle Auction
// ---------------------------------------------------------------------------

/**
 * Settle an auction after its end_at has passed.
 *
 * Called by the BullMQ auction-close worker. Idempotent:
 *   - If already settled → noop
 *   - If end_at > now() → return reschedule hint
 *
 * Transaction:
 *   1. Lock auction FOR UPDATE
 *   2. If no bids: return card to seller, set settled
 *   3. If has winner: consume winning hold, credit seller, transfer card,
 *      write ledger entries, set settled + winner + final_price
 */
export async function settleAuction(
  db: DB,
  auctionId: string,
): Promise<SettlementResult> {
  return db.transaction(async (tx) => {
    // 1. Lock auction
    const [auction] = await tx
      .select()
      .from(schema.auctions)
      .where(eq(schema.auctions.id, auctionId))
      .for('update');

    if (!auction) {
      logger.warn({ auctionId }, 'auction-close: auction not found');
      return { settled: false, winnerId: null, finalPriceUSD: null, rescheduleEndAt: null };
    }

    // Already settled — idempotent noop
    if (auction.status === 'settled' || auction.status === 'cancelled') {
      return { settled: true, winnerId: auction.winnerId, finalPriceUSD: auction.finalPriceUsd, rescheduleEndAt: null };
    }

    // Not time yet — reschedule
    if (auction.endAt.getTime() > Date.now()) {
      logger.info({ auctionId, endAt: auction.endAt.toISOString() }, 'auction-close: not yet ended, rescheduling');
      return { settled: false, winnerId: null, finalPriceUSD: null, rescheduleEndAt: auction.endAt };
    }

    // 2. No bids case
    if (!auction.currentHighBidId) {
      // Return card to seller
      await tx
        .update(schema.userCards)
        .set({ status: 'held' })
        .where(eq(schema.userCards.id, auction.userCardId));

      await tx
        .update(schema.auctions)
        .set({ status: 'settled', settledAt: new Date() })
        .where(eq(schema.auctions.id, auctionId));

      logger.info({ auctionId }, 'auction settled with no bids');
      return { settled: true, winnerId: null, finalPriceUSD: null, rescheduleEndAt: null };
    }

    // 3. Has winner — settle with trade
    const winnerId = auction.currentHighBidderId!;
    const winningBidId = auction.currentHighBidId;
    const finalPrice = money(auction.currentHighBidUsd!);
    const fee = feeOf(finalPrice, PLATFORM.AUCTION_FEE_RATE);
    const netSeller = finalPrice.minus(fee);

    // Consume the winning hold
    await tx
      .update(schema.balanceHolds)
      .set({ status: 'consumed', resolvedAt: new Date() })
      .where(
        and(
          eq(schema.balanceHolds.referenceId, winningBidId),
          eq(schema.balanceHolds.status, 'held'),
        ),
      );

    // Debit winner's held balance (the funds were already moved from available to held at bid time)
    await tx
      .update(schema.profiles)
      .set({
        heldBalanceUsd: sql`${schema.profiles.heldBalanceUsd} - ${toMoneyString(finalPrice)}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.profiles.id, winnerId));

    // Credit seller
    await tx
      .update(schema.profiles)
      .set({
        availableBalanceUsd: sql`${schema.profiles.availableBalanceUsd} + ${toMoneyString(netSeller)}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.profiles.id, auction.sellerId));

    // Transfer card ownership
    await tx
      .update(schema.userCards)
      .set({
        ownerId: winnerId,
        status: 'held',
        acquiredFrom: 'auction',
        sourceRefId: auctionId,
        acquiredPriceUsd: toMoneyString(finalPrice),
        acquiredAt: new Date(),
      })
      .where(eq(schema.userCards.id, auction.userCardId));

    // Mark auction settled
    await tx
      .update(schema.auctions)
      .set({
        status: 'settled',
        settledAt: new Date(),
        winnerId,
        finalPriceUsd: toMoneyString(finalPrice),
      })
      .where(eq(schema.auctions.id, auctionId));

    // Ledger entries (3 rows: winner debit, seller credit, platform fee)
    await tx.insert(schema.ledgerEntries).values([
      {
        kind: 'auction_settlement_debit',
        userId: winnerId,
        counterpartyId: auction.sellerId,
        amountUsd: toMoneyString(finalPrice.neg()),
        referenceTable: 'auctions',
        referenceId: auctionId,
      },
      {
        kind: 'auction_settlement_credit',
        userId: auction.sellerId,
        counterpartyId: winnerId,
        amountUsd: toMoneyString(netSeller),
        referenceTable: 'auctions',
        referenceId: auctionId,
      },
      {
        kind: 'platform_fee',
        userId: null,
        amountUsd: toMoneyString(fee),
        referenceTable: 'auctions',
        referenceId: auctionId,
        metadata: { source: 'auction' },
      },
    ]);

    // Ledger: mark the winning bid hold as consumed
    await tx.insert(schema.ledgerEntries).values({
      kind: 'bid_consume',
      userId: winnerId,
      amountUsd: toMoneyString(finalPrice.neg()),
      referenceTable: 'bids',
      referenceId: winningBidId,
    });

    logger.info(
      { auctionId, winnerId, finalPriceUSD: toMoneyString(finalPrice), fee: toMoneyString(fee) },
      'auction settled with winner',
    );

    return {
      settled: true,
      winnerId,
      finalPriceUSD: toMoneyString(finalPrice),
      rescheduleEndAt: null,
    };
  });
}
