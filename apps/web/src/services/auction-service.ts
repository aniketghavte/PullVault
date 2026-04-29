import 'server-only';

import { eq, and, sql } from 'drizzle-orm';
import type { DB } from '@pullvault/db';
import { schema } from '@/lib/db';
import { money, toMoneyString, feeOf } from '@pullvault/shared/money';
import { ApiError } from '@/lib/api';
import { ERROR_CODES, PLATFORM } from '@pullvault/shared';
import { logger } from '@pullvault/shared/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CreateAuctionInput {
  userCardId: string;
  startingBidUSD: string;
  durationMinutes: number;
}

export interface CreateAuctionResult {
  auctionId: string;
  endAt: Date;
}

interface PlaceBidInput {
  auctionId: string;
  amountUSD: string;
  expectedCurrentHighBidId: string | null;
  idempotencyKey: string;
}

export interface PlaceBidResult {
  bidId: string;
  auctionId: string;
  amountUSD: string;
  causedExtension: boolean;
  newEndAt: string;
  newExtensions: number;
  previousHighBidderId: string | null;
  previousHighBidAmount: string | null;
}

// ---------------------------------------------------------------------------
// Create Auction
// ---------------------------------------------------------------------------

/**
 * Create a new auction for a user_card the caller owns.
 *
 * Transaction:
 *   1. Lock user_card FOR UPDATE, verify status='held' + owner
 *   2. Set user_card.status = 'in_auction'
 *   3. Insert auctions row with computed end_at
 *   4. Return auction ID + end_at for BullMQ scheduling
 */
export async function createAuction(
  db: DB,
  userId: string,
  input: CreateAuctionInput,
): Promise<CreateAuctionResult> {
  return db.transaction(async (tx) => {
    // 1. Lock user_card
    const [card] = await tx
      .select({
        id: schema.userCards.id,
        ownerId: schema.userCards.ownerId,
        status: schema.userCards.status,
      })
      .from(schema.userCards)
      .where(eq(schema.userCards.id, input.userCardId))
      .for('update');

    if (!card) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, 'Card not found');
    }

    if (card.ownerId !== userId) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, 'You do not own this card');
    }

    if (card.status !== 'held') {
      throw new ApiError(
        ERROR_CODES.CARD_LOCKED,
        `Card cannot be auctioned because it is currently ${card.status}`,
      );
    }

    // 2. Set card status to 'in_auction'
    await tx
      .update(schema.userCards)
      .set({ status: 'in_auction' })
      .where(eq(schema.userCards.id, input.userCardId));

    // 3. Insert auction row
    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + input.durationMinutes * 60_000);

    const [auction] = await tx
      .insert(schema.auctions)
      .values({
        userCardId: input.userCardId,
        sellerId: userId,
        startingBidUsd: input.startingBidUSD,
        startAt,
        endAt,
        antiSnipeWindowSeconds: PLATFORM.ANTI_SNIPE_WINDOW_SECONDS,
        antiSnipeExtensionSeconds: PLATFORM.ANTI_SNIPE_EXTENSION_SECONDS,
        status: 'live',
      })
      .returning({ id: schema.auctions.id });

    if (!auction) {
      throw new ApiError(ERROR_CODES.INTERNAL, 'Failed to create auction');
    }

    logger.info(
      { auctionId: auction.id, userId, userCardId: input.userCardId, endAt: endAt.toISOString() },
      'auction created',
    );

    return { auctionId: auction.id, endAt };
  });
}

// ---------------------------------------------------------------------------
// Place Bid
// ---------------------------------------------------------------------------

/**
 * Place a bid on a live auction.
 *
 * This is a concurrency hot-path. Single DB transaction that:
 *   1. Locks the auction row FOR UPDATE
 *   2. Validates status, timing, bid amount, optimistic concurrency
 *   3. Holds buyer's funds (available -= amount, held += amount)
 *   4. Releases previous high bidder's hold (if any)
 *   5. Applies anti-snipe extension if needed
 *   6. Updates auction denormalized columns
 *   7. Writes ledger entries
 */
export async function placeBid(
  db: DB,
  userId: string,
  input: PlaceBidInput,
): Promise<PlaceBidResult> {
  return db.transaction(async (tx) => {
    // 1. Lock auction row
    const [auction] = await tx
      .select()
      .from(schema.auctions)
      .where(eq(schema.auctions.id, input.auctionId))
      .for('update');

    if (!auction) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, 'Auction not found');
    }

    // 2. Validate status
    if (!['live', 'extended'].includes(auction.status)) {
      throw new ApiError(ERROR_CODES.AUCTION_CLOSED, 'Auction is not accepting bids');
    }

    if (auction.endAt.getTime() <= Date.now()) {
      throw new ApiError(ERROR_CODES.AUCTION_CLOSED, 'Auction has ended');
    }

    // Cannot bid on your own auction
    if (auction.sellerId === userId) {
      throw new ApiError(ERROR_CODES.VALIDATION, 'You cannot bid on your own auction');
    }

    // 3. Optimistic concurrency check
    if (input.expectedCurrentHighBidId !== (auction.currentHighBidId ?? null)) {
      throw new ApiError(
        ERROR_CODES.BID_OUTBID,
        'Another bid was placed. Refresh and try again.',
      );
    }

    // 4. Compute minimum required bid
    const currentHigh = auction.currentHighBidUsd
      ? money(auction.currentHighBidUsd)
      : money(auction.startingBidUsd);
    const hasExistingBid = !!auction.currentHighBidId;

    let minRequired;
    if (!hasExistingBid) {
      // No bids yet — minimum is the starting bid
      minRequired = money(auction.startingBidUsd);
    } else {
      const minUsd = money(PLATFORM.MIN_BID_INCREMENT_USD);
      const minPct = money(PLATFORM.MIN_BID_INCREMENT_PCT);
      const incFromPct = currentHigh.times(minPct);
      const increment = incFromPct.gt(minUsd) ? incFromPct : minUsd;
      minRequired = currentHigh.plus(increment);
    }

    if (money(input.amountUSD).lt(minRequired)) {
      throw new ApiError(
        ERROR_CODES.BID_TOO_LOW,
        `Bid must be at least ${toMoneyString(minRequired)}`,
      );
    }

    // 5. Lock buyer profile and check funds
    const [buyerProfile] = await tx
      .select({
        availableBalanceUsd: schema.profiles.availableBalanceUsd,
        heldBalanceUsd: schema.profiles.heldBalanceUsd,
      })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, userId))
      .for('update');

    if (!buyerProfile) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, 'Profile not found');
    }

    if (money(buyerProfile.availableBalanceUsd).lt(money(input.amountUSD))) {
      throw new ApiError(ERROR_CODES.INSUFFICIENT_FUNDS, 'Not enough funds to place this bid');
    }

    // 6. Hold buyer's funds
    await tx
      .update(schema.profiles)
      .set({
        availableBalanceUsd: sql`${schema.profiles.availableBalanceUsd} - ${input.amountUSD}`,
        heldBalanceUsd: sql`${schema.profiles.heldBalanceUsd} + ${input.amountUSD}`,
        updatedAt: new Date(),
      })
      .where(eq(schema.profiles.id, userId));

    // 7. Insert bid row
    const [bid] = await tx
      .insert(schema.bids)
      .values({
        auctionId: input.auctionId,
        bidderId: userId,
        amountUsd: input.amountUSD,
        idempotencyKey: input.idempotencyKey,
        causedExtension: false, // updated below if anti-snipe fires
      })
      .onConflictDoNothing({
        target: [schema.bids.bidderId, schema.bids.idempotencyKey],
      })
      .returning({ id: schema.bids.id });

    if (!bid) {
      // Idempotent retry — find the existing bid
      const [existing] = await tx
        .select({ id: schema.bids.id })
        .from(schema.bids)
        .where(
          and(
            eq(schema.bids.bidderId, userId),
            eq(schema.bids.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new ApiError(ERROR_CODES.INTERNAL, 'Bid idempotency conflict');
      }

      // Return the existing bid result (noop)
      return {
        bidId: existing.id,
        auctionId: input.auctionId,
        amountUSD: input.amountUSD,
        causedExtension: false,
        newEndAt: auction.endAt.toISOString(),
        newExtensions: auction.extensions,
        previousHighBidderId: null,
        previousHighBidAmount: null,
      };
    }

    // 8. Insert balance_hold
    await tx.insert(schema.balanceHolds).values({
      userId,
      kind: 'auction_bid',
      referenceId: bid.id,
      amountUsd: input.amountUSD,
      status: 'held',
    });

    // 9. Release previous high bidder's hold (if any)
    let previousHighBidderId: string | null = null;
    let previousHighBidAmount: string | null = null;

    if (auction.currentHighBidId && auction.currentHighBidderId) {
      previousHighBidderId = auction.currentHighBidderId;
      previousHighBidAmount = auction.currentHighBidUsd;

      // Release the hold
      await tx
        .update(schema.balanceHolds)
        .set({ status: 'released', resolvedAt: new Date() })
        .where(
          and(
            eq(schema.balanceHolds.referenceId, auction.currentHighBidId),
            eq(schema.balanceHolds.status, 'held'),
          ),
        );

      // Restore previous bidder's funds
      const prevAmount = auction.currentHighBidUsd!;
      await tx
        .update(schema.profiles)
        .set({
          availableBalanceUsd: sql`${schema.profiles.availableBalanceUsd} + ${prevAmount}`,
          heldBalanceUsd: sql`${schema.profiles.heldBalanceUsd} - ${prevAmount}`,
          updatedAt: new Date(),
        })
        .where(eq(schema.profiles.id, auction.currentHighBidderId));

      // Ledger: release previous bidder's hold
      await tx.insert(schema.ledgerEntries).values({
        kind: 'bid_release',
        userId: auction.currentHighBidderId,
        amountUsd: toMoneyString(prevAmount),
        referenceTable: 'bids',
        referenceId: auction.currentHighBidId,
      });
    }

    // 10. Ledger: hold new bidder's funds
    await tx.insert(schema.ledgerEntries).values({
      kind: 'bid_hold',
      userId,
      amountUsd: toMoneyString(money(input.amountUSD).neg()),
      referenceTable: 'bids',
      referenceId: bid.id,
    });

    // 11. Anti-snipe check
    const remainingMs = auction.endAt.getTime() - Date.now();
    const antiSnipeWindowMs = auction.antiSnipeWindowSeconds * 1000;
    const maxExtensions = PLATFORM.AUCTION_MAX_EXTENSIONS;
    let causedExtension = false;
    let newEndAt = auction.endAt;
    let newExtensions = auction.extensions;

    if (remainingMs <= antiSnipeWindowMs && auction.extensions < maxExtensions) {
      causedExtension = true;
      newEndAt = new Date(Date.now() + auction.antiSnipeExtensionSeconds * 1000);
      newExtensions = auction.extensions + 1;

      // Mark bid as causing extension
      await tx
        .update(schema.bids)
        .set({ causedExtension: true })
        .where(eq(schema.bids.id, bid.id));
    }

    // 12. Update auction denormalized state
    await tx
      .update(schema.auctions)
      .set({
        currentHighBidId: bid.id,
        currentHighBidUsd: input.amountUSD,
        currentHighBidderId: userId,
        endAt: newEndAt,
        extensions: newExtensions,
        status: causedExtension ? 'extended' : auction.status,
      })
      .where(eq(schema.auctions.id, input.auctionId));

    logger.info(
      {
        bidId: bid.id,
        auctionId: input.auctionId,
        userId,
        amountUSD: input.amountUSD,
        causedExtension,
        newEndAt: newEndAt.toISOString(),
      },
      'bid placed',
    );

    return {
      bidId: bid.id,
      auctionId: input.auctionId,
      amountUSD: input.amountUSD,
      causedExtension,
      newEndAt: newEndAt.toISOString(),
      newExtensions,
      previousHighBidderId,
      previousHighBidAmount,
    };
  });
}
