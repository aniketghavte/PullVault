import type { CatalogCard, CatalogRarity } from './catalog';

export type MoneyString = string; // "12.34" (2dp)

export type UserCardStatus = 'held' | 'listed' | 'in_auction' | 'transferred';

export type DropStatus = 'scheduled' | 'live' | 'sold_out' | 'closed';

export type AuctionStatus = 'scheduled' | 'live' | 'extended' | 'settling' | 'settled' | 'cancelled';

export type MockMe = {
  id: string;
  email: string;
  displayName: string;
  availableUSD: MoneyString;
  heldUSD: MoneyString;
};

export type UserCard = Omit<CatalogCard, 'marketPriceUSD' | 'id'> & {
  userCardId: string;
  ownerId: string;
  ownerHandle: string;
  acquiredPriceUSD: MoneyString;
  acquiredAt: string; // ISO
  status: UserCardStatus;
  marketPriceUSD: MoneyString; // current mocked market
};

export type Drop = {
  dropId: string;
  tierCode: string;
  tierName: string;
  priceUSD: MoneyString;
  totalInventory: number;
  remaining: number;
  scheduledAt: string; // ISO
  status: DropStatus;
};

export type DrawnCard = {
  card: Omit<UserCard, 'userCardId' | 'ownerId' | 'ownerHandle' | 'acquiredPriceUSD' | 'acquiredAt' | 'status'>;
  drawPriceUSD: MoneyString;
};

export type PackPurchase = {
  purchaseId: string;
  userId: string;
  dropId: string;
  tierCode: string;
  pricePaidUSD: MoneyString;
  purchasedAt: string; // ISO
  drawnCards: Array<{
    card: Omit<UserCard, 'userCardId' | 'ownerId' | 'ownerHandle' | 'acquiredPriceUSD' | 'acquiredAt' | 'status'>;
    drawPriceUSD: MoneyString;
    rarity: CatalogRarity;
  }>;
  revealedCount: number;
};

export type Listing = {
  listingId: string;
  userCardId: string;
  sellerId: string;
  sellerHandle: string;
  priceUSD: MoneyString;
  status: 'active' | 'sold' | 'cancelled';
  createdAt: string; // ISO
};

export type Bid = {
  bidId: string;
  auctionId: string;
  bidderId: string;
  bidderHandle: string;
  amountUSD: MoneyString;
  placedAt: string; // ISO
  causedExtension: boolean;
};

export type Auction = {
  auctionId: string;
  userCardId: string;
  sellerId: string;
  sellerHandle: string;
  card: Pick<UserCard, 'name' | 'set' | 'rarity' | 'imageUrl' | 'marketPriceUSD' | 'externalId'>;
  startingBidUSD: MoneyString;
  currentHighBidUSD: MoneyString;
  currentHighBidderId: string;
  currentHighBidderHandle: string;
  endAt: string; // ISO
  extensions: number;
  watcherCount: number;
  status: AuctionStatus;
  bids: Bid[]; // newest-first for UI convenience
};

export type LedgerEntry = {
  id: string;
  createdAt: string; // ISO
  kind: 'pack_purchase' | 'trade_purchase' | 'auction_bid_hold' | 'platform_fee' | 'bid_release' | 'auction_settlement_debit';
  userId: string | null;
  amountUSD: MoneyString; // negative for debits, positive for credits
  referenceId?: string;
};

export type MockState = {
  initialized: boolean;
  initializationError?: string;

  me: MockMe;
  heldAuctionAmounts: Record<string, MoneyString>; // auctionId -> held amount

  catalogGeneratedAt?: string;

  drops: Drop[];
  purchases: PackPurchase[];
  userCards: UserCard[];
  listings: Listing[];
  auctions: Auction[];
  ledger: LedgerEntry[];

  // Idempotency
  packPurchaseByIdempotencyKey: Record<string, string>; // key -> purchaseId
  bidsByIdempotencyKey: Record<string, string>; // key -> bidId
};

