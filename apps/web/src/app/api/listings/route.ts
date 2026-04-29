import { handler, ApiError } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { requireUserId } from '@/lib/auth';
import { ERROR_CODES } from '@pullvault/shared';
import { createListingSchema } from '@pullvault/shared';
import { toMoneyString } from '@pullvault/shared/money';

// GET /api/listings — paginated list of active listings with card joins.
export const GET = handler(async () => {
  const rows = await db
    .select({
      listingId: schema.listings.id,
      userCardId: schema.listings.userCardId,
      sellerId: schema.listings.sellerId,
      priceUsd: schema.listings.priceUsd,
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
    .where(eq(schema.listings.status, 'active'))
    .orderBy(schema.listings.createdAt);

  const listings = rows.map((r) => ({
    listingId: r.listingId,
    userCardId: r.userCardId,
    sellerId: r.sellerId,
    sellerHandle: r.sellerHandle,
    priceUSD: toMoneyString(r.priceUsd),
    status: 'active',
    card: {
      ...r.card,
      marketPriceUSD: toMoneyString(r.card.marketPriceUsd),
    },
  }));

  return { listings };
});

// POST /api/listings — create a new listing for a user_card the caller owns.
export const POST = handler(async (req: Request) => {
  const userId = await requireUserId();
  const parsed = createListingSchema.safeParse(await req.json());
  
  if (!parsed.success) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Invalid listing', parsed.error.flatten());
  }

  const { userCardId, priceUSD } = parsed.data;

  const result = await db.transaction(async (tx) => {
    // 1. Lock the user card
    const [card] = await tx
      .select({ id: schema.userCards.id, ownerId: schema.userCards.ownerId, status: schema.userCards.status })
      .from(schema.userCards)
      .where(eq(schema.userCards.id, userCardId))
      .for('update');

    if (!card) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, 'Card not found');
    }

    if (card.ownerId !== userId) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, 'You do not own this card');
    }

    if (card.status !== 'held') {
      throw new ApiError(ERROR_CODES.VALIDATION, `Card cannot be listed because it is currently ${card.status}`);
    }

    // 2. Update card status to 'listed'
    await tx
      .update(schema.userCards)
      .set({ status: 'listed' })
      .where(eq(schema.userCards.id, userCardId));

    // 3. Create the listing
    const [listing] = await tx
      .insert(schema.listings)
      .values({
        userCardId,
        sellerId: userId,
        priceUsd: priceUSD,
        status: 'active',
      })
      .returning({ id: schema.listings.id });

    return listing;
  });

  return { listingId: result!.id };
});
