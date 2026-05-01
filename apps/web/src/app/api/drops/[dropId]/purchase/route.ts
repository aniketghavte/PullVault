import { eq } from 'drizzle-orm';

import { ERROR_CODES, RATE_LIMITS } from '@pullvault/shared';
import { buyPackSchema } from '@pullvault/shared';
import {
  getPurchaseJitterMs,
  PURCHASE_JOB_TTL_MS,
  type PurchaseJobData,
} from '@pullvault/shared/purchase-queue';

import { handler, ApiError } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { ensureProfile } from '@/services/ensure-profile';
import { checkRateLimit } from '@/lib/rate-limit';
import { runPurchaseBotChecks, checkSoldOutAttempt } from '@/services/bot-detection';
import { getPurchaseQueue } from '@/lib/queues/purchase-queue';
import { db, schema } from '@/lib/db';

// =====================================================================
// POST /api/drops/:dropId/purchase
// =====================================================================
// B2 update: this is now a thin rate-limited + bot-checked ENQUEUE.
// The atomic purchase transaction still lives in `@/services/pack-purchase`
// and is run by the realtime worker after a 0-2s BullMQ jitter delay.
// The client gets back a jobId and polls /api/drops/purchase-status/:jobId.
//
// Why queue instead of run inline?
//   The assignment explicitly tests that "the fastest HTTP client
//   shouldn't win". A bot firing at T+0ms and a human clicking at
//   T+400ms both get a random 0-2000ms server-side delay via BullMQ,
//   so neither has a deterministic advantage once the drop goes live.

export const POST = handler(async (req: Request, ctx: { params: Promise<{ dropId: string }> }) => {
  const authUser = await requireUser();
  await ensureProfile(authUser.id, authUser.email ?? '', authUser.user_metadata?.handle);
  const userId = authUser.id;
  const { dropId } = await ctx.params;

  // ---------------------------------------------------------------------
  // 1) Rate limit (Layer 1). User window is strict (3/min), IP window is
  //    looser (10/min) to catch multi-account abuse from a single NAT.
  //    The helper returns a NextResponse on 429 which `handler()` passes
  //    through untouched — preserving our `Retry-After` + `X-RateLimit-*`
  //    headers that curlers + dashboards depend on.
  // ---------------------------------------------------------------------
  const rl = await checkRateLimit(req, userId, {
    keyPrefix: 'purchase',
    userConfig: RATE_LIMITS.PACK_PURCHASE_USER,
    ipConfig: RATE_LIMITS.PACK_PURCHASE_IP,
  });
  if (rl) return rl;

  // ---------------------------------------------------------------------
  // 2) Parse + validate. pageLoadTimestamp is optional; when present,
  //    bot-detection compares it against Date.now() to flag sub-500ms
  //    page-load-to-click times.
  // ---------------------------------------------------------------------
  const json = await req.json();
  const parsed = buyPackSchema.safeParse({ ...json, dropId });
  if (!parsed.success) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Invalid purchase request', parsed.error.flatten());
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';

  // ---------------------------------------------------------------------
  // 3) Fire-and-forget bot signals. Must never block / throw. If the DB
  //    is hot these resolve in ~3ms; even if they 500 we still enqueue.
  // ---------------------------------------------------------------------
  runPurchaseBotChecks(userId, ip, parsed.data.pageLoadTimestamp);

  // ---------------------------------------------------------------------
  // 4) Best-effort sold-out short-circuit + bot signal. This is NOT a
  //    correctness check (the worker's transaction is the source of
  //    truth); it just lets us flag script-kiddies who hammer a drop
  //    that already hit zero without paying the cost of a queued job.
  // ---------------------------------------------------------------------
  try {
    const [dropRow] = await db
      .select({
        remaining: schema.packDrops.remainingInventory,
        status: schema.packDrops.status,
      })
      .from(schema.packDrops)
      .where(eq(schema.packDrops.id, dropId))
      .limit(1);
    if (dropRow && (dropRow.remaining <= 0 || dropRow.status === 'sold_out')) {
      void checkSoldOutAttempt(userId, ip);
      throw new ApiError(ERROR_CODES.SOLD_OUT, 'This drop is sold out.');
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // Swallow other errors — the worker will make the authoritative call.
  }

  // ---------------------------------------------------------------------
  // 5) Enqueue with jitter (Layer 2). The worker runs the real atomic
  //    transaction after the delay; client polls for the result.
  // ---------------------------------------------------------------------
  const jitterMs = getPurchaseJitterMs();
  const queue = getPurchaseQueue();
  const job = await queue.add(
    'purchase',
    {
      userId,
      dropId: parsed.data.dropId,
      idempotencyKey: parsed.data.idempotencyKey,
      requestedAt: Date.now(),
      ip,
    } satisfies PurchaseJobData,
    {
      delay: jitterMs,
      // Same idempotency key → same job id → if a flaky client retries
      // during the jitter window, BullMQ returns the already-enqueued
      // job instead of creating a duplicate. The transactional
      // idempotency in pack-purchase still protects us at the DB layer.
      jobId: `purchase:${userId}:${parsed.data.idempotencyKey}`,
    },
  );

  return {
    jobId: job.id,
    estimatedDelayMs: jitterMs,
    // Absolute unix-ms the client can poll against without drift.
    readyAtMs: Date.now() + jitterMs,
    // Hard timeout the client should apply before giving up.
    timeoutMs: PURCHASE_JOB_TTL_MS,
    status: 'queued' as const,
  };
});
