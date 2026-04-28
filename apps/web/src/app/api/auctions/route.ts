import { handler, ApiError } from '@/lib/api';
import { ERROR_CODES } from '@pullvault/shared';
import { createAuctionSchema } from '@pullvault/shared';

// GET /api/auctions    -> list live auctions
// POST /api/auctions   -> create a new auction (seller side)
//   Transaction: lock user_card, ensure status='held', set 'in_auction',
//   compute end_at = now() + duration, insert auctions row.
//   Then enqueue BullMQ delayed job at end_at to settle.
export const GET = handler(async () => ({ auctions: [] as unknown[] }));

export const POST = handler(async (req: Request) => {
  const parsed = createAuctionSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Invalid request', parsed.error.flatten());
  }
  throw new ApiError(ERROR_CODES.INTERNAL, 'Not implemented yet');
});
