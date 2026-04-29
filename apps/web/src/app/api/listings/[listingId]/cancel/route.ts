import { handler, ApiError } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { requireUserId } from '@/lib/auth';
import { ERROR_CODES } from '@pullvault/shared';

// POST /api/listings/:listingId/cancel — cancel a listing (seller only).
// Transaction: verify ownership, update listing status → cancelled, card status → held.
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ listingId: string }> }) => {
  const userId = await requireUserId();
  const { listingId } = await ctx.params;

  await db.transaction(async (tx) => {
    // 1. Lock listing
    const [listing] = await tx
      .select({
        id: schema.listings.id,
        sellerId: schema.listings.sellerId,
        status: schema.listings.status,
        userCardId: schema.listings.userCardId,
      })
      .from(schema.listings)
      .where(eq(schema.listings.id, listingId))
      .for('update');

    if (!listing) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, 'Listing not found');
    }

    if (listing.sellerId !== userId) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, 'You are not the seller of this listing');
    }

    if (listing.status !== 'active') {
      throw new ApiError(
        ERROR_CODES.VALIDATION,
        `Listing cannot be cancelled (current status: ${listing.status})`,
      );
    }

    // 2. Cancel listing
    await tx
      .update(schema.listings)
      .set({ status: 'cancelled', cancelledAt: new Date() })
      .where(eq(schema.listings.id, listingId));

    // 3. Return card to held
    await tx
      .update(schema.userCards)
      .set({ status: 'held' })
      .where(eq(schema.userCards.id, listing.userCardId));
  });

  return { ok: true };
});
