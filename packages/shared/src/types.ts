// Domain types shared across web + realtime + db.
// These are the shapes that flow over HTTP and Socket.io.
// DB row types live in @pullvault/db; map them into these at the boundary.

export type UUID = string;

export type Rarity = 'common' | 'uncommon' | 'rare' | 'ultra_rare' | 'secret_rare';

export type UserCardStatus = 'held' | 'listed' | 'in_auction' | 'transferred';

export type AuctionStatus =
  | 'scheduled'
  | 'live'
  | 'extended'
  | 'settling'
  | 'settled'
  | 'cancelled';

export type ListingStatus = 'active' | 'sold' | 'cancelled';

export type DropStatus = 'scheduled' | 'live' | 'sold_out' | 'closed';

export type TransactionKind =
  | 'pack_purchase'
  | 'trade_sale'
  | 'trade_purchase'
  | 'auction_settlement_credit'
  | 'auction_settlement_debit'
  | 'platform_fee'
  | 'deposit'
  | 'bid_hold'
  | 'bid_release';

export interface CardSummary {
  id: UUID;
  externalId: string; // Pokemon TCG / TCGPlayer id
  name: string;
  set: string;
  rarity: Rarity;
  imageUrl: string;
  marketPriceUSD: string; // 2dp string
  priceUpdatedAt: string; // ISO
}

export interface UserCardSummary extends CardSummary {
  userCardId: UUID;
  acquiredPriceUSD: string;
  acquiredAt: string;
  status: UserCardStatus;
}

export interface PortfolioSnapshot {
  userId: UUID;
  totalValueUSD: string;
  totalCostBasisUSD: string;
  unrealizedPnlUSD: string;
  cards: UserCardSummary[];
  generatedAt: string;
}

export interface BalanceSummary {
  userId: UUID;
  availableUSD: string;
  heldUSD: string;
  totalUSD: string;
}

export interface AuctionRoomState {
  auctionId: UUID;
  card: CardSummary;
  sellerId: UUID;
  status: AuctionStatus;
  startingBidUSD: string;
  currentHighBidUSD: string | null;
  currentHighBidderId: UUID | null;
  endAt: string; // ISO, server-authoritative
  extensions: number;
  watcherCount: number;
  recentBids: BidEvent[];
}

export interface BidEvent {
  bidId: UUID;
  auctionId: UUID;
  bidderId: UUID;
  bidderHandle: string;
  amountUSD: string;
  placedAt: string;
  causedExtension: boolean;
}

export interface DropState {
  dropId: UUID;
  tierCode: string;
  tierName: string;
  priceUSD: string;
  totalInventory: number;
  remaining: number;
  scheduledAt: string;
  status: DropStatus;
}

// API response envelopes
export interface ApiOk<T> {
  ok: true;
  data: T;
}
export interface ApiErr {
  ok: false;
  error: { code: string; message: string; details?: unknown };
}
export type ApiResponse<T> = ApiOk<T> | ApiErr;

// Standardized error codes (keep small + stable; clients can branch on them).
export const ERROR_CODES = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION: 'VALIDATION',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  SOLD_OUT: 'SOLD_OUT',
  ALREADY_SOLD: 'ALREADY_SOLD',
  CARD_LOCKED: 'CARD_LOCKED', // listed or in auction
  RATE_LIMITED: 'RATE_LIMITED',
  AUCTION_CLOSED: 'AUCTION_CLOSED',
  BID_TOO_LOW: 'BID_TOO_LOW',
  BID_OUTBID: 'BID_OUTBID',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
