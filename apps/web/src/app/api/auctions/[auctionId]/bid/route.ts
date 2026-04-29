import { handler, ApiError } from '@/lib/api';
import { requireUserId } from '@/lib/auth';
import { ERROR_CODES } from '@pullvault/shared';
import { placeBidSchema } from '@pullvault/shared';
import { placeBid } from '@/services/auction-service';
import { publishInternal, INTERNAL_EVENTS } from '@/lib/realtime/publisher';
import { REDIS_KEYS } from '@pullvault/shared/constants';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { scheduleAuctionCloseJob } from '@/lib/realtime/internal';

// POST /api/auctions/:auctionId/bid
//
// P0 concurrency hot-path. Places a bid via a single DB transaction that:
//   - Locks the auction row, validates timing + amount + optimistic concurrency
//   - Holds buyer's funds, releases previous high bidder's hold
//   - Applies anti-snipe extensions
//   - Updates auction denormalized state + writes ledger entries
//
// After commit, publishes bid.accepted + optional auction.extended via Redis.
export const POST = handler(async (req: Request, ctx: { params: Promise<{ auctionId: string }> }) => {
  const userId = await requireUserId();
  const { auctionId } = await ctx.params;
  const body = await req.json();

  const parsed = placeBidSchema.safeParse({ ...body, auctionId });
  if (!parsed.success) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Invalid bid', parsed.error.flatten());
  }

  // Get bidder handle for the event payload
  const [bidderProfile] = await db
    .select({ handle: schema.profiles.handle })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, userId))
    .limit(1);

  const result = await placeBid(db, userId, parsed.data);

  // AFTER commit: publish events to Redis pub/sub
  const channel = REDIS_KEYS.channel.auctionEvents(auctionId);

  await publishInternal(channel, INTERNAL_EVENTS.bidAccepted, {
    auctionId,
    bidId: result.bidId,
    bidderId: userId,
    bidderHandle: bidderProfile?.handle ?? 'Unknown',
    amountUSD: result.amountUSD,
    placedAt: new Date().toISOString(),
    causedExtension: result.causedExtension,
    newEndAt: result.newEndAt,
  });

  if (result.causedExtension) {
    await publishInternal(channel, INTERNAL_EVENTS.auctionExtended, {
      auctionId,
      newEndAt: result.newEndAt,
      extensions: result.newExtensions,
      currentHighBidUSD: result.amountUSD,
      currentHighBidderId: userId,
    });

    // Schedule a new close job at the new end time
    await scheduleAuctionCloseJob({
      auctionId,
      endAt: result.newEndAt,
    });
  }

  // Notify previous high bidder's portfolio of fund release
  if (result.previousHighBidderId) {
    await publishInternal(
      REDIS_KEYS.channel.portfolio(result.previousHighBidderId),
      INTERNAL_EVENTS.portfolioInvalidated,
      { userId: result.previousHighBidderId },
    );
  }

  // Notify current bidder's portfolio of fund hold
  await publishInternal(
    REDIS_KEYS.channel.portfolio(userId),
    INTERNAL_EVENTS.portfolioInvalidated,
    { userId },
  );

  return { bidId: result.bidId, causedExtension: result.causedExtension };
});
