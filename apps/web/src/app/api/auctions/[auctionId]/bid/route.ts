import { handler, ApiError } from '@/lib/api';
import { ERROR_CODES } from '@pullvault/shared';
import { placeBidSchema } from '@pullvault/shared';

// POST /api/auctions/:auctionId/bid
// Bid lifecycle in ONE transaction:
//   BEGIN;
//     SELECT * FROM auctions WHERE id=$a FOR UPDATE;
//       - abort if status not in ('live','extended') OR end_at < now() (AUCTION_CLOSED)
//     min_bid = max(starting, current_high + max(MIN_INC_USD, current_high * MIN_INC_PCT))
//       - abort if amount < min_bid (BID_TOO_LOW)
//     -- optimistic check that client wasn't racing:
//     IF expectedCurrentHighBidId IS DISTINCT FROM auctions.current_high_bid_id -> BID_OUTBID
//     SELECT available FROM profiles WHERE id=$bidder FOR UPDATE;
//       - abort if available < amount (INSUFFICIENT_FUNDS)
//     -- Place hold:
//     UPDATE profiles SET available -= amount, held += amount WHERE id=$bidder;
//     INSERT INTO bids ...
//     INSERT INTO balance_holds (kind='auction_bid', reference_id=bid.id, amount);
//     -- Release previous high bidder's hold:
//     IF previous_bid IS NOT NULL THEN
//       UPDATE balance_holds SET status='released', resolved_at=now() WHERE reference_id=prev_bid.id;
//       UPDATE profiles SET available += prev_amount, held -= prev_amount WHERE id=prev_bidder;
//       INSERT ledger_entries (bid_release rows)
//     -- Anti-snipe:
//     IF (end_at - now()) <= ANTI_SNIPE_WINDOW AND extensions < MAX:
//       UPDATE auctions SET end_at = now() + ANTI_SNIPE_EXTENSION,
//                          extensions = extensions + 1,
//                          status='extended';
//     UPDATE auctions SET current_high_bid_id, current_high_bid_usd, current_high_bidder_id;
//     INSERT ledger_entries (bid_hold for new bidder)
//   COMMIT;
// Publish `pv.bid.accepted` over Redis pub/sub for the realtime fan-out.
export const POST = handler(async (req: Request, ctx: { params: { auctionId: string } }) => {
  const parsed = placeBidSchema.safeParse({ ...(await req.json()), auctionId: ctx.params.auctionId });
  if (!parsed.success) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Invalid bid', parsed.error.flatten());
  }
  throw new ApiError(ERROR_CODES.INTERNAL, 'Not implemented yet');
});
