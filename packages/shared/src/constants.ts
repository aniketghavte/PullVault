// Tunable platform parameters. Justified in `architecture.md`.
// Keep values here; never hardcode them inside services or UI.

export const PLATFORM = {
  // Default starting balance for a new user. Paper trading => generous enough
  // to buy at least one of each pack tier, small enough to force engagement.
  DEFAULT_STARTING_BALANCE_USD: '500.00',

  // Trades and auctions both have a flat % fee on the buyer-paid price.
  // Seller receives gross - fee. House captures the fee.
  TRADE_FEE_RATE: '0.05', // 5%
  AUCTION_FEE_RATE: '0.07', // 7% (higher because it includes drama tax)

  // Auction bidding rules.
  MIN_BID_INCREMENT_USD: '1.00',
  MIN_BID_INCREMENT_PCT: '0.05', // whichever is greater wins

  // Anti-snipe: if a bid is placed within ANTI_SNIPE_WINDOW of end_at,
  // extend end_at by ANTI_SNIPE_EXTENSION. Repeat until quiet period.
  ANTI_SNIPE_WINDOW_SECONDS: 30,
  ANTI_SNIPE_EXTENSION_SECONDS: 30,
  // Hard cap so a stubborn pair can't extend forever (defensive).
  AUCTION_MAX_EXTENSIONS: 20,

  // Pack drop UX
  DROP_PRESALE_VISIBLE_HOURS: 12,
  DROP_PURCHASE_RATE_LIMIT_PER_USER_PER_DROP: 5,
} as const;

// Pack tier definitions. Numbers are JUSTIFIED in architecture.md.
// EV math: pack_price > sum(weight_i * E[price | rarity_i])
// We aim for ~10–18% house margin per tier on expected value.
export const PACK_TIERS = [
  {
    code: 'standard',
    name: 'Standard Booster',
    priceUSD: '4.99',
    cardsPerPack: 5,
    rarityWeights: {
      common: 0.7,
      uncommon: 0.22,
      rare: 0.07,
      ultra_rare: 0.009,
      secret_rare: 0.001,
    },
  },
  {
    code: 'premium',
    name: 'Premium Booster',
    priceUSD: '14.99',
    cardsPerPack: 7,
    rarityWeights: {
      common: 0.5,
      uncommon: 0.3,
      rare: 0.16,
      ultra_rare: 0.035,
      secret_rare: 0.005,
    },
  },
  {
    code: 'elite',
    name: 'Elite Vault',
    priceUSD: '49.99',
    cardsPerPack: 10,
    rarityWeights: {
      common: 0.3,
      uncommon: 0.35,
      rare: 0.25,
      ultra_rare: 0.085,
      secret_rare: 0.015,
    },
  },
  {
    code: 'whale',
    name: 'Whale Crate',
    priceUSD: '199.99',
    cardsPerPack: 15,
    rarityWeights: {
      common: 0.15,
      uncommon: 0.35,
      rare: 0.35,
      ultra_rare: 0.12,
      secret_rare: 0.03,
    },
  },
] as const;

export type PackTierCode = (typeof PACK_TIERS)[number]['code'];
export type Rarity = keyof (typeof PACK_TIERS)[number]['rarityWeights'];

// Auction durations offered in the UI. Server validates against this list.
export const AUCTION_DURATIONS_MINUTES = [5, 15, 60, 240, 1440] as const;
export type AuctionDurationMinutes = (typeof AUCTION_DURATIONS_MINUTES)[number];

// Redis key namespaces. Keep them centralized to avoid typos.
export const REDIS_KEYS = {
  // Pub/sub channels: realtime server subscribes; web's API routes publish.
  channel: {
    auctionEvents: (auctionId: string) => `pv:auction:${auctionId}:events`,
    dropEvents: (dropId: string) => `pv:drop:${dropId}:events`,
    portfolio: (userId: string) => `pv:portfolio:${userId}`,
    priceTicks: 'pv:prices:ticks',
  },
  // Cache keys
  cache: {
    cardPrice: (cardId: string) => `pv:price:${cardId}`,
    dropInventory: (dropId: string) => `pv:drop:${dropId}:remaining`,
    userBalance: (userId: string) => `pv:balance:${userId}`,
  },
  // BullMQ queue names
  queue: {
    // BullMQ queue names cannot contain ":".
    auctionClose: 'pv_queue_auction_close',
    priceRefresh: 'pv_queue_price_refresh',
    packReveal: 'pv_queue_pack_reveal',
  },
} as const;

export const SOCKET_ROOMS = {
  auction: (auctionId: string) => `auction:${auctionId}`,
  drop: (dropId: string) => `drop:${dropId}`,
  portfolio: (userId: string) => `portfolio:${userId}`,
} as const;
