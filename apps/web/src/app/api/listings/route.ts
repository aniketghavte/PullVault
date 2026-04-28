import { handler, ApiError } from '@/lib/api';
import { ERROR_CODES } from '@pullvault/shared';
import { createListingSchema } from '@pullvault/shared';

// GET /api/listings — paginated list of active listings with card joins.
// POST /api/listings — create a new listing for a user_card the caller owns.
//   Transaction: SELECT user_cards FOR UPDATE -> verify owner + status='held'
//   -> UPDATE user_cards SET status='listed' -> INSERT listings.
export const GET = handler(async () => ({ listings: [] as unknown[] }));

export const POST = handler(async (req: Request) => {
  const parsed = createListingSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Invalid listing', parsed.error.flatten());
  }
  throw new ApiError(ERROR_CODES.INTERNAL, 'Not implemented yet');
});
