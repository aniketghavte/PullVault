import { handler, ApiError } from '@/lib/api';
import { ERROR_CODES } from '@pullvault/shared';
import { buyListingSchema } from '@pullvault/shared';

// POST /api/listings/:listingId/buy
// Atomic trade transaction:
//   BEGIN;
//     SELECT * FROM listings WHERE id=$1 FOR UPDATE;
//       -> abort if status != 'active' (ALREADY_SOLD)
//     SELECT available_balance FROM profiles WHERE id=$buyer FOR UPDATE;
//       -> abort if available_balance < price (INSUFFICIENT_FUNDS)
//     UPDATE profiles SET available = available - price WHERE id=$buyer;
//     UPDATE profiles SET available = available + (price - fee) WHERE id=$seller;
//     UPDATE user_cards SET owner_id=$buyer, status='held' WHERE id=$card;
//     UPDATE listings SET status='sold', buyer_id=$buyer, sold_at=now() WHERE id=$1;
//     INSERT INTO ledger_entries (...)  -- 3 rows: buyer debit, seller credit, platform fee
//   COMMIT;
// Then publish portfolio invalidation events for buyer + seller.
export const POST = handler(async (req: Request, ctx: { params: { listingId: string } }) => {
  const parsed = buyListingSchema.safeParse({ ...(await req.json()), listingId: ctx.params.listingId });
  if (!parsed.success) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Invalid request', parsed.error.flatten());
  }
  throw new ApiError(ERROR_CODES.INTERNAL, 'Not implemented yet');
});
