import { ERROR_CODES } from '@pullvault/shared';
import type { PurchaseJobResult } from '@pullvault/shared/purchase-queue';

import { handler, ApiError } from '@/lib/api';
import { requireUserId } from '@/lib/auth';
import { getPurchaseQueue } from '@/lib/queues/purchase-queue';

// =====================================================================
// GET /api/drops/purchase-status/:jobId
// =====================================================================
// Polling endpoint the drop page hits every ~500ms after enqueueing a
// purchase. Returns one of:
//   { status: 'queued'    }  — BullMQ delayed, waiting, or active
//   { status: 'completed' , result }
//   { status: 'failed'    , error }
//
// We authenticate + check the job payload belongs to the caller so one
// user can't poll another user's purchase job.

type StatusResponse =
  | { status: 'queued'; state: string; delayMs: number | null }
  | { status: 'completed'; result: PurchaseJobResult }
  | { status: 'failed'; errorCode?: string; errorMessage?: string };

export const GET = handler(async (_req: Request, ctx: { params: Promise<{ jobId: string }> }) => {
  const userId = await requireUserId();
  const { jobId } = await ctx.params;

  const queue = getPurchaseQueue();
  const job = await queue.getJob(jobId);
  if (!job) {
    // BullMQ sweeps completed jobs on `removeOnComplete`. If the client
    // polls late we may have already gc'd — surface NOT_FOUND so the UI
    // can fall back to refreshing the drop page to resolve ambiguity.
    throw new ApiError(ERROR_CODES.NOT_FOUND, 'Purchase job not found or expired.');
  }

  // Guard: only the enqueueing user may read this job. `data.userId` is
  // set by the purchase route from the authenticated session, so it's
  // trustworthy.
  if (job.data?.userId !== userId) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, 'Not your job.');
  }

  const state = await job.getState();

  if (state === 'completed') {
    const result = job.returnvalue as PurchaseJobResult;
    return { status: 'completed' as const, result } satisfies StatusResponse;
  }

  if (state === 'failed') {
    // `failedReason` is a string set by the worker's catch branch.
    return {
      status: 'failed' as const,
      errorCode: (job.returnvalue as PurchaseJobResult | undefined)?.errorCode ?? 'INTERNAL',
      errorMessage: job.failedReason ?? 'Purchase failed.',
    } satisfies StatusResponse;
  }

  // waiting / delayed / active / stalled all look "queued" to the client.
  const delayRemaining =
    typeof job.delay === 'number' && job.processedOn === undefined && job.timestamp
      ? Math.max(0, job.timestamp + job.delay - Date.now())
      : null;

  return {
    status: 'queued' as const,
    state,
    delayMs: delayRemaining,
  } satisfies StatusResponse;
});
