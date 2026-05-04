import { z } from 'zod';

import { ERROR_CODES } from '@pullvault/shared';
import { logger } from '@pullvault/shared/logger';
import { REDIS_KEYS } from '@pullvault/shared/constants';

import { handler, ApiError } from '@/lib/api';
import { serverEnv } from '@/lib/env';
import { db } from '@/lib/db';
import { purchasePack } from '@/services/pack-purchase';
import { publishInternal, INTERNAL_EVENTS } from '@/lib/realtime/publisher';

// =====================================================================
// POST /api/internal/packs/purchase
// =====================================================================
// Trust-boundary endpoint called by the realtime BullMQ pack-purchase
// worker after it has held a job for the jitter delay. We keep the atomic
// transaction in `@/services/pack-purchase` (unchanged by B2) and let the
// worker call us rather than duplicating ~250 lines of DB logic into the
// realtime app.
//
// Auth: shared `REALTIME_INTERNAL_TOKEN` header. This mirrors the existing
// web → realtime trust pattern in the opposite direction.

const bodySchema = z.object({
  userId: z.string().uuid(),
  dropId: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(64),
  clientSeed: z.string().min(1).max(128).optional(),
});

export const POST = handler(async (req: Request) => {
  // ---- 1. Token check ----
  const token = req.headers.get('x-realtime-token');
  const { REALTIME_INTERNAL_TOKEN } = serverEnv();
  if (!token || token !== REALTIME_INTERNAL_TOKEN) {
    throw new ApiError(ERROR_CODES.UNAUTHENTICATED, 'Internal token required.');
  }

  // ---- 2. Body validation ----
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      ERROR_CODES.VALIDATION,
      'Invalid internal purchase payload',
      parsed.error.flatten(),
    );
  }

  const { userId, dropId, idempotencyKey, clientSeed } = parsed.data;

  // ---- 3. Atomic purchase (the service throws ApiError on SOLD_OUT / INSUFFICIENT_FUNDS) ----
  const result = await purchasePack(db, userId, { dropId, idempotencyKey, clientSeed });

  // ---- 4. Publish Redis events (post-commit, same as pre-B2 behaviour) ----
  try {
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
    await publishInternal(
      REDIS_KEYS.channel.portfolio(userId),
      INTERNAL_EVENTS.portfolioInvalidated,
      { userId },
    );
  } catch (err) {
    logger.warn({ err, purchaseId: result.purchaseId }, 'post-commit publish failed (non-fatal)');
  }

  return {
    purchaseId: result.purchaseId,
    remaining: result.remaining,
  };
});
