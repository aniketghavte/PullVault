import { and, asc, eq, isNull } from 'drizzle-orm';

import { handler, ApiError } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { ERROR_CODES } from '@pullvault/shared';

// Public endpoint: fetches only data required for client-side verification.
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ purchaseId: string }> }) => {
  const { purchaseId } = await ctx.params;

  const [purchase] = await db
    .select({
      id: schema.packPurchases.id,
      userId: schema.packPurchases.userId,
      sealed: schema.packPurchases.sealed,
      serverSeed: schema.packPurchases.serverSeed,
      serverSeedHash: schema.packPurchases.serverSeedHash,
      clientSeed: schema.packPurchases.clientSeed,
      rarityWeights: schema.packTiers.rarityWeights,
    })
    .from(schema.packPurchases)
    .innerJoin(schema.packTiers, eq(schema.packTiers.id, schema.packPurchases.tierId))
    .where(eq(schema.packPurchases.id, purchaseId))
    .limit(1);

  if (!purchase) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, 'Purchase not found');
  }

  const cards = await db
    .select({
      drawIndex: schema.packPurchaseCards.drawIndex,
      cardId: schema.packPurchaseCards.cardId,
      rarity: schema.cards.rarity,
      name: schema.cards.name,
      imageUrl: schema.cards.imageUrl,
    })
    .from(schema.packPurchaseCards)
    .innerJoin(schema.cards, eq(schema.cards.id, schema.packPurchaseCards.cardId))
    .where(eq(schema.packPurchaseCards.purchaseId, purchaseId))
    .orderBy(asc(schema.packPurchaseCards.drawIndex));

  return {
    id: purchase.id,
    serverSeed: purchase.sealed ? null : purchase.serverSeed,
    serverSeedHash: purchase.serverSeedHash,
    clientSeed: purchase.clientSeed ?? purchase.id,
    revealed: !purchase.sealed,
    tier: { rarityWeights: purchase.rarityWeights as Record<string, number> },
    cards: cards.map((c) => ({
      drawIndex: c.drawIndex,
      rarity: c.rarity,
      cardId: c.cardId,
      card: { name: c.name, imageUrl: c.imageUrl },
    })),
  };
});

export const POST = handler(async (_req: Request, ctx: { params: Promise<{ purchaseId: string }> }) => {
  const { purchaseId } = await ctx.params;
  await db
    .update(schema.packPurchases)
    .set({ verifiedAt: new Date() })
    .where(and(eq(schema.packPurchases.id, purchaseId), isNull(schema.packPurchases.verifiedAt)));
  return { ok: true };
});
