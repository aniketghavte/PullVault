import { z } from 'zod';

import { ApiError, handler } from '@/lib/api';
import { requireUserId } from '@/lib/auth';
import { triggerPriceRefresh } from '@/lib/realtime/internal';
import { ERROR_CODES } from '@pullvault/shared';

const bodySchema = z.object({
  mode: z.enum(['full', 'hot', 'seed']).default('full'),
  pages: z.number().int().positive().max(8).optional(),
  sample: z.number().int().positive().max(500).optional(),
});

/**
 * POST /api/admin/catalog/refresh
 * Authenticated trigger for the realtime BullMQ price-refresh worker.
 * Body: { mode?: 'full' | 'hot' | 'seed', pages?: number, sample?: number }
 */
export const POST = handler(async (req: Request) => {
  await requireUserId();
  const json = await req
    .json()
    .catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Invalid refresh payload', parsed.error.flatten());
  }

  const result = await triggerPriceRefresh(parsed.data);
  if (!result.ok) {
    throw new ApiError(ERROR_CODES.INTERNAL, result.error.message);
  }
  return { jobId: result.data.jobId, mode: result.data.mode };
});
