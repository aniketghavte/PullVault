import { handler, ApiError } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { toMoneyString } from '@pullvault/shared/money';
import { ERROR_CODES } from '@pullvault/shared';

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ listingId: string }> }) => {
  const { listingId } = await ctx.params;

  const [row] = await db
    .select({
      listingId: schema.listings.id,
      userCardId: schema.listings.userCardId,
      sellerId: schema.listings.sellerId,
      priceUsd: schema.listings.priceUsd,
      status: schema.listings.status,
      sellerHandle: schema.profiles.handle,
      card: {
        id: schema.cards.id,
        name: schema.cards.name,
        set: schema.cards.setCode,
        rarity: schema.cards.rarity,
        imageUrl: schema.cards.imageUrl,
        marketPriceUsd: schema.cards.marketPriceUsd,
      },
    })
    .from(schema.listings)
    .innerJoin(schema.userCards, eq(schema.userCards.id, schema.listings.userCardId))
    .innerJoin(schema.cards, eq(schema.cards.id, schema.userCards.cardId))
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.listings.sellerId))
    .where(eq(schema.listings.id, listingId))
    .limit(1);

  if (!row) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, 'Listing not found');
  }

  return {
    listing: {
      listingId: row.listingId,
      userCardId: row.userCardId,
      sellerId: row.sellerId,
      sellerHandle: row.sellerHandle,
      priceUSD: toMoneyString(row.priceUsd),
      status: row.status,
    },
    card: {
      ...row.card,
      marketPriceUSD: toMoneyString(row.card.marketPriceUsd),
    },
  };
});
