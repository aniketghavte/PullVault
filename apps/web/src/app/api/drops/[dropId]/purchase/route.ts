import { handler, ApiError } from '@/lib/api';
import { ERROR_CODES } from '@pullvault/shared';
import { buyPackSchema } from '@pullvault/shared';

// POST /api/drops/:dropId/purchase
// THIS is the concurrency hot-path. The full implementation lives in the
// `services/pack-purchase` module: a single SQL transaction that
//   1) `UPDATE pack_drops SET remaining = remaining - 1 WHERE id = $1 AND remaining > 0 RETURNING ...`
//      (atomic decrement; 0 rows -> SOLD_OUT)
//   2) `UPDATE profiles SET available_balance = available_balance - price WHERE id = $u AND available_balance >= price`
//      (atomic debit; 0 rows -> INSUFFICIENT_FUNDS, then we re-increment inventory)
//   3) Insert pack_purchases (UNIQUE(user, idempotency_key) -> safe retries)
//   4) Draw N cards using rarity weights from a Postgres-side weighted random function
//   5) Insert pack_purchase_cards
//   6) Insert ledger_entries (debit user, credit platform_fee)
// Then publish `pv.drop.inventory_changed` over Redis pub/sub.
export const POST = handler(async (req: Request, ctx: { params: { dropId: string } }) => {
  const json = await req.json();
  const parsed = buyPackSchema.safeParse({ ...json, dropId: ctx.params.dropId });
  if (!parsed.success) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Invalid purchase request', parsed.error.flatten());
  }
  // TODO(pack-purchase): wire to services/pack-purchase.ts
  throw new ApiError(ERROR_CODES.INTERNAL, 'Not implemented yet');
});
