import { handler } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';
import { requireUserId } from '@/lib/auth';

export const GET = handler(async (req, { params }: { params: { cardId: string } }) => {
  await requireUserId();
  const { cardId } = params;

  // Fetch the last 30 prices for the card
  const history = await db
    .select({
      priceUsd: schema.cardPrices.priceUsd,
      fetchedAt: schema.cardPrices.fetchedAt,
    })
    .from(schema.cardPrices)
    .where(eq(schema.cardPrices.cardId, cardId))
    .orderBy(desc(schema.cardPrices.fetchedAt))
    .limit(30);

  // Return in chronological order
  history.reverse();

  return { ok: true, data: { history } };
});
