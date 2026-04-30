import { handler } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth';
import { ensureProfile } from '@/services/ensure-profile';
import { toMoneyString } from '@pullvault/shared/money';

// GET /api/portfolio — joined view of user's cards + live prices + P&L.
export const GET = handler(async () => {
  const authUser = await requireUser();
  const userId = authUser.id;

  const profile = await ensureProfile(
    userId,
    authUser.email ?? '',
    authUser.user_metadata?.handle,
  );

  const rows = await db
    .select({
      userCardId: schema.userCards.id,
      status: schema.userCards.status,
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
    .where(eq(schema.userCards.ownerId, userId))
    .orderBy(schema.userCards.acquiredAt);

  const portfolio = rows.map((r) => ({
    userCardId: r.userCardId,
    status: r.status,
    acquiredPriceUSD: toMoneyString(r.acquiredPriceUsd),
    acquiredAt: r.acquiredAt.toISOString(),
    cardId: r.cardId,
    name: r.name,
    set: r.set,
    rarity: r.rarity,
    imageUrl: r.imageUrl,
    marketPriceUSD: toMoneyString(r.marketPriceUsd),
  }));

  return { 
    portfolio,
    availableBalanceUSD: toMoneyString(profile?.availableBalanceUsd ?? '0'),
    heldBalanceUSD: toMoneyString(profile?.heldBalanceUsd ?? '0'),
  };
});
