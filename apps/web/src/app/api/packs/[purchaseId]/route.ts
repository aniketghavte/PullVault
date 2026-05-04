import { handler, ApiError } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { requireUserId } from '@/lib/auth';
import { ERROR_CODES } from '@pullvault/shared';
import { toMoneyString } from '@pullvault/shared/money';

// GET /api/packs/:purchaseId
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ purchaseId: string }> }) => {
  const userId = await requireUserId();
  const { purchaseId } = await ctx.params;

  // Find the purchase
  const [purchase] = await db
    .select({
      id: schema.packPurchases.id,
      dropId: schema.packPurchases.dropId,
      tierCode: schema.packTiers.code,
      pricePaidUsd: schema.packPurchases.pricePaidUsd,
      sealed: schema.packPurchases.sealed,
      serverSeed: schema.packPurchases.serverSeed,
      serverSeedHash: schema.packPurchases.serverSeedHash,
      clientSeed: schema.packPurchases.clientSeed,
    })
    .from(schema.packPurchases)
    .innerJoin(schema.packTiers, eq(schema.packTiers.id, schema.packPurchases.tierId))
    .where(
      and(
        eq(schema.packPurchases.id, purchaseId),
        eq(schema.packPurchases.userId, userId),
      ),
    )
    .limit(1);

  if (!purchase) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, 'Purchase not found');
  }

  // Get the drawn cards
  const cardsRows = await db
    .select({
      position: schema.packPurchaseCards.position,
      drawPriceUsd: schema.packPurchaseCards.drawPriceUsd,
      cardId: schema.cards.id,
      name: schema.cards.name,
      set: schema.cards.setName,
      rarity: schema.cards.rarity,
      imageUrl: schema.cards.imageUrl,
      marketPriceUsd: schema.cards.marketPriceUsd,
    })
    .from(schema.packPurchaseCards)
    .innerJoin(schema.cards, eq(schema.cards.id, schema.packPurchaseCards.cardId))
    .where(eq(schema.packPurchaseCards.purchaseId, purchaseId))
    .orderBy(schema.packPurchaseCards.position);

  // In the real app, the "reveal" is purely frontend presentation. The cards are
  // already in the user's collection. To support the frontend's step-by-step
  // reveal tension, we tell it how many are "revealed". If the pack is sealed,
  // 0 are revealed. If unsealed, all are revealed. The frontend calls the reveal
  // endpoint to increment this.
  const revealedCount = purchase.sealed ? 0 : cardsRows.length;

  return {
    purchaseId: purchase.id,
    dropId: purchase.dropId,
    tierCode: purchase.tierCode,
    pricePaidUSD: toMoneyString(purchase.pricePaidUsd),
    sealed: purchase.sealed,
    serverSeed: purchase.sealed ? null : purchase.serverSeed,
    serverSeedHash: purchase.serverSeedHash,
    clientSeed: purchase.clientSeed ?? purchase.id,
    revealedCount,
    drawnCards: cardsRows.map((c) => ({
      rarity: c.rarity,
      drawPriceUSD: toMoneyString(c.drawPriceUsd),
      card: {
        name: c.name,
        set: c.set,
        rarity: c.rarity,
        imageUrl: c.imageUrl,
        marketPriceUSD: toMoneyString(c.marketPriceUsd),
      },
    })),
  };
});
