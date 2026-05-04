import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { ApiError, handler } from '@/lib/api';
import { requireUserId } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { ERROR_CODES } from '@pullvault/shared';

const bodySchema = z.object({
  cardId: z.string().uuid(),
  newPrice: z.union([z.number().positive(), z.string().min(1)]),
});

// POST /api/admin/b1-lab/spike-price
// Demo helper: directly patch one card's market price.
export const POST = handler(async (req: Request) => {
  await requireUserId();

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Invalid spike payload', parsed.error.flatten());
  }

  const { cardId } = parsed.data;
  const newPrice = Number(parsed.data.newPrice);
  if (!Number.isFinite(newPrice) || newPrice <= 0) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'newPrice must be a positive number');
  }

  const [card] = await db
    .select({
      id: schema.cards.id,
      name: schema.cards.name,
      rarity: schema.cards.rarity,
      oldPrice: schema.cards.marketPriceUsd,
    })
    .from(schema.cards)
    .where(eq(schema.cards.id, cardId))
    .limit(1);

  if (!card) throw new ApiError(ERROR_CODES.NOT_FOUND, 'Card not found');

  await db
    .update(schema.cards)
    .set({ marketPriceUsd: newPrice.toFixed(2), priceUpdatedAt: new Date() })
    .where(eq(schema.cards.id, cardId));

  return {
    cardId,
    name: card.name,
    rarity: card.rarity,
    oldPrice: card.oldPrice,
    newPrice: newPrice.toFixed(2),
    message: `Price updated from $${card.oldPrice} to $${newPrice.toFixed(2)}`,
  };
});
