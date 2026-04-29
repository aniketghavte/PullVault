import { handler, ApiError } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { requireUserId } from '@/lib/auth';
import { getPublisher } from '@pullvault/shared/redis';
import { ERROR_CODES, PLATFORM } from '@pullvault/shared';
import { buyListingSchema } from '@pullvault/shared';
import { money, feeOf } from '@pullvault/shared/money';

// POST /api/listings/:listingId/buy
// Atomic trade transaction:
//   BEGIN;
//     SELECT * FROM listings WHERE id=$1 FOR UPDATE;
//       -> abort if status != 'active' (ALREADY_SOLD)
//     SELECT available_balance FROM profiles WHERE id=$buyer FOR UPDATE;
//       -> abort if available_balance < price (INSUFFICIENT_FUNDS)
//     UPDATE profiles SET available = available - price WHERE id=$buyer;
//     UPDATE profiles SET available = available + (price - fee) WHERE id=$seller;
//     UPDATE user_cards SET owner_id=$buyer, status='held' WHERE id=$card;
//     UPDATE listings SET status='sold', buyer_id=$buyer, sold_at=now() WHERE id=$1;
//     INSERT INTO ledger_entries (...)  -- 3 rows: buyer debit, seller credit, platform fee
//   COMMIT;
// Then publish portfolio invalidation events for buyer + seller.
export const POST = handler(async (req: Request, ctx: { params: Promise<{ listingId: string }> }) => {
  const buyerId = await requireUserId();
  const { listingId } = await ctx.params;
  const rawBody = await req.text();
  const body =
    rawBody.trim().length === 0 ? {} : (JSON.parse(rawBody) as Record<string, unknown>);
  const parsed = buyListingSchema.safeParse({ ...body, listingId });
  
  if (!parsed.success) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Invalid request', parsed.error.flatten());
  }

  const { sellerId } = await db.transaction(async (tx) => {
    // 1. Lock listing
    const [listing] = await tx
      .select()
      .from(schema.listings)
      .where(eq(schema.listings.id, listingId))
      .for('update');

    if (!listing) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, 'Listing not found');
    }

    if (listing.status !== 'active') {
      throw new ApiError(ERROR_CODES.VALIDATION, `Listing is no longer active (status: ${listing.status})`);
    }

    if (listing.sellerId === buyerId) {
      throw new ApiError(ERROR_CODES.VALIDATION, 'You cannot buy your own listing');
    }

    // Calculate fee and net
    const price = money(listing.priceUsd);
    const fee = feeOf(price, PLATFORM.TRADE_FEE_RATE);
    const netSeller = price.minus(fee);

    // 2. Lock buyer profile
    const [buyerProfile] = await tx
      .select({ availableBalanceUsd: schema.profiles.availableBalanceUsd })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, buyerId))
      .for('update');

    if (!buyerProfile) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, 'Buyer profile not found');
    }

    if (money(buyerProfile.availableBalanceUsd).lt(price)) {
      throw new ApiError(ERROR_CODES.INSUFFICIENT_FUNDS, 'Insufficient funds to purchase this listing');
    }

    // 3. Lock seller profile (optional for locking since they only get money, but good practice)
    await tx
      .select({ id: schema.profiles.id })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, listing.sellerId))
      .for('update');

    // 4. Update balances
    // Debit buyer
    await tx.update(schema.profiles)
      .set({ availableBalanceUsd: money(buyerProfile.availableBalanceUsd).minus(price).toFixed(2) })
      .where(eq(schema.profiles.id, buyerId));

    // Credit seller
    const [sellerProfile] = await tx
      .select({ availableBalanceUsd: schema.profiles.availableBalanceUsd })
      .from(schema.profiles)
      .where(eq(schema.profiles.id, listing.sellerId));
    
    if (sellerProfile) {
      await tx.update(schema.profiles)
        .set({ availableBalanceUsd: money(sellerProfile.availableBalanceUsd).plus(netSeller).toFixed(2) })
        .where(eq(schema.profiles.id, listing.sellerId));
    }

    // 5. Update user_cards ownership and status
    await tx
      .update(schema.userCards)
      .set({ ownerId: buyerId, status: 'held', acquiredFrom: 'trade', sourceRefId: listing.id, acquiredPriceUsd: price.toFixed(2), acquiredAt: new Date() })
      .where(eq(schema.userCards.id, listing.userCardId));

    // 6. Mark listing as sold
    await tx
      .update(schema.listings)
      .set({ status: 'sold', buyerId, soldAt: new Date() })
      .where(eq(schema.listings.id, listingId));

    // 7. Insert ledger entries
    await tx.insert(schema.ledgerEntries).values([
      {
        userId: buyerId,
        kind: 'trade_purchase_debit',
        amountUsd: price.times(-1).toFixed(2),
        referenceTable: 'listings',
        referenceId: listingId,
      },
      {
        userId: listing.sellerId,
        kind: 'trade_sale_credit',
        amountUsd: netSeller.toFixed(2),
        referenceTable: 'listings',
        referenceId: listingId,
      },
      {
        // Platform fee ledger entry
        userId: null, 
        kind: 'platform_fee',
        amountUsd: fee.toFixed(2),
        referenceTable: 'listings',
        referenceId: listingId,
      }
    ]);

    return { sellerId: listing.sellerId };
  });

  // Publish portfolio invalidation events for both buyer and seller via Redis
  const redis = getPublisher();
  await redis.publish(`pv:portfolio:${buyerId}`, JSON.stringify({ event: 'portfolio:invalidate', payload: { userId: buyerId } }));
  await redis.publish(`pv:portfolio:${sellerId}`, JSON.stringify({ event: 'portfolio:invalidate', payload: { userId: sellerId } }));

  return { ok: true };
});
