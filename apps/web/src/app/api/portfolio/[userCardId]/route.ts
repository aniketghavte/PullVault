import { handler, ApiError } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { requireUserId } from '@/lib/auth';
import { toMoneyString } from '@pullvault/shared/money';
import { ERROR_CODES } from '@pullvault/shared';

// GET /api/portfolio/:userCardId — returns a single card detail from the user's portfolio.
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ userCardId: string }> }) => {
  const userId = await requireUserId();
  const { userCardId } = await ctx.params;

  const [row] = await db
    .select({
      userCardId: schema.userCards.id,
      status: schema.userCards.status,
      acquiredFrom: schema.userCards.acquiredFrom,
      sourceRefId: schema.userCards.sourceRefId,
      acquiredPriceUsd: schema.userCards.acquiredPriceUsd,
      acquiredAt: schema.userCards.acquiredAt,
      cardId: schema.cards.id,
      name: schema.cards.name,
      set: schema.cards.setCode,
      rarity: schema.cards.rarity,
      imageUrl: schema.cards.imageUrl,
      marketPriceUsd: schema.cards.marketPriceUsd,
    })
    .from(schema.userCards)
    .innerJoin(schema.cards, eq(schema.cards.id, schema.userCards.cardId))
    .where(
      and(
        eq(schema.userCards.id, userCardId),
        eq(schema.userCards.ownerId, userId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, 'Card not found in your portfolio');
  }

  // Find any active listings for this card
  const [activeListing] = await db
    .select({ listingId: schema.listings.id })
    .from(schema.listings)
    .where(
      and(
        eq(schema.listings.userCardId, userCardId),
        eq(schema.listings.status, 'active'),
      ),
    )
    .limit(1);

  // Find any active auctions for this card
  const [activeAuction] = await db
    .select({ auctionId: schema.auctions.id })
    .from(schema.auctions)
    .where(
      and(
        eq(schema.auctions.userCardId, userCardId),
        eq(schema.auctions.status, 'live'), // We could check 'extended' too, or just check 'in_auction' status on userCards
      ),
    )
    .limit(1);

  return {
    card: {
      userCardId: row.userCardId,
      status: row.status,
      acquiredFrom: row.acquiredFrom,
      sourceRefId: row.sourceRefId,
      acquiredPriceUSD: toMoneyString(row.acquiredPriceUsd),
      acquiredAt: row.acquiredAt.toISOString(),
      cardId: row.cardId,
      name: row.name,
      set: row.set,
      rarity: row.rarity,
      imageUrl: row.imageUrl,
      marketPriceUSD: toMoneyString(row.marketPriceUsd),
    },
    activeListing: activeListing ?? null,
    activeAuction: activeAuction ?? null,
  };
});
