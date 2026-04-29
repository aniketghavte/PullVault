import { handler, ApiError } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { eq, and } from 'drizzle-orm';
import { requireUserId } from '@/lib/auth';
import { ERROR_CODES } from '@pullvault/shared';
import { z } from 'zod';

const bodySchema = z.object({ position: z.number().int().min(0) }).passthrough();

// POST /api/packs/:purchaseId/reveal
export const POST = handler(async (req: Request, ctx: { params: Promise<{ purchaseId: string }> }) => {
  const userId = await requireUserId();
  const { purchaseId } = await ctx.params;
  
  // The frontend calls this endpoint with the current position it wants to reveal.
  // In the real system, the cards are already in the user's collection, so this
  // is just presentation pacing.
  let position = 0;
  try {
    const json = await req.json();
    const parsed = bodySchema.parse(json);
    position = parsed.position;
  } catch {
    // If no body or invalid, assume 0
  }

  // Verify ownership
  const [purchase] = await db
    .select({
      id: schema.packPurchases.id,
      sealed: schema.packPurchases.sealed,
    })
    .from(schema.packPurchases)
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

  // Get total cards to know if we should mark it completely unsealed
  const cardsRows = await db
    .select({ position: schema.packPurchaseCards.position })
    .from(schema.packPurchaseCards)
    .where(eq(schema.packPurchaseCards.purchaseId, purchaseId));

  const totalCards = cardsRows.length;
  const newRevealedCount = position + 1;

  // If this is the last card, unseal the pack permanently
  if (purchase.sealed && newRevealedCount >= totalCards) {
    await db
      .update(schema.packPurchases)
      .set({ sealed: false, openedAt: new Date() })
      .where(eq(schema.packPurchases.id, purchaseId));
  }

  return { revealedCount: newRevealedCount };
});
