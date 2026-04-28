import { handler, ApiError } from '@/lib/api';
import { ERROR_CODES } from '@pullvault/shared';

// POST /api/packs/:purchaseId/reveal
// Marks the pack as opened and atomically grants the pre-determined cards
// to the user (insert into user_cards, set pack_purchases.sealed=false).
// Pack contents were locked at purchase time — this endpoint cannot
// influence what's inside.
export const POST = handler(async () => {
  throw new ApiError(ERROR_CODES.INTERNAL, 'Not implemented yet');
});
