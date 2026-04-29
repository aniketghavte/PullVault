import { handler, ApiError } from '@/lib/api';
import { requireUser, requireUserId } from '@/lib/auth';
import { ensureProfile } from '@/services/ensure-profile';
import { ERROR_CODES } from '@pullvault/shared';
import { buyPackSchema } from '@pullvault/shared';
import { purchasePack } from '@/services/pack-purchase';
import { publishInternal, INTERNAL_EVENTS } from '@/lib/realtime/publisher';
import { REDIS_KEYS } from '@pullvault/shared/constants';
import { db } from '@/lib/db';

// POST /api/drops/:dropId/purchase
//
// This is the P0 concurrency hot-path. The pack-purchase service runs
// a single SQL transaction that atomically:
//   1) decrements remaining_inventory (WHERE remaining > 0)
//   2) debits the user's available balance (WHERE balance >= price)
//   3) inserts an idempotent purchase row
//   4) draws N cards from the catalog using rarity weights
//   5) creates user_cards rows
//   6) writes ledger entries
//
// After the commit we publish inventory changes via Redis pub/sub
// so the realtime server can fan them out to Socket.io clients.

export const POST = handler(async (req: Request, ctx: { params: Promise<{ dropId: string }> }) => {
  const authUser = await requireUser();
  await ensureProfile(
    authUser.id,
    authUser.email ?? '',
    authUser.user_metadata?.handle,
  );
  const userId = authUser.id;
  const { dropId } = await ctx.params;
  const json = await req.json();

  const parsed = buyPackSchema.safeParse({ ...json, dropId });
  if (!parsed.success) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Invalid purchase request', parsed.error.flatten());
  }

  // Execute the atomic transaction
  const result = await purchasePack(db, userId, parsed.data);

  // AFTER the commit: publish events to Redis pub/sub (best-effort)
  await publishInternal(
    REDIS_KEYS.channel.dropEvents(result.dropId),
    INTERNAL_EVENTS.dropInventoryChanged,
    { dropId: result.dropId, remaining: result.remaining },
  );

  if (result.remaining === 0) {
    await publishInternal(
      REDIS_KEYS.channel.dropEvents(result.dropId),
      INTERNAL_EVENTS.dropSoldOut,
      { dropId: result.dropId },
    );
  }

  return { purchaseId: result.purchaseId };
});
