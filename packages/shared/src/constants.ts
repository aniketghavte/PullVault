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

  // B3 - Sealed-bid phase. Once an auction has been extended this many
  // times AND the timer shows <= SEAL_SECONDS_LEFT, the next accepted
  // bid flips status to 'sealed' and broadcasts redact `currentHighBid`
  // + `currentHighBidderId`. Threshold of 3 extensions matches the brief
  // and keeps normal back-and-forth auctions fully transparent.
  SEAL_EXTENSIONS_THRESHOLD: 3,
  SEAL_SECONDS_LEFT: 60,

  // B3 - Bid validation rules.
  // Fat-finger cap: no bid may exceed this multiple of the card's market
  // price. 10x lets even hype-driven overpays through while stopping
  // "I meant $50, typed $500000" mistakes.
  MAX_BID_MARKET_MULTIPLIER: 10,
  // Minimum gap between consecutive bids from the same user on the same
  // auction. Stops rapid micro-bidding / spray scripts. 5s is loose
  // enough that a deliberate counter-bid in the final seconds is fine.
  MIN_BID_INTERVAL_SECONDS: 5,

  // Pack drop UX
  DROP_PRESALE_VISIBLE_HOURS: 12,
  DROP_PURCHASE_RATE_LIMIT_PER_USER_PER_DROP: 5,
} as const;

// Pack-economics tuning (B1).
// These targets justify the rarity-weight solver and the simulator output.
// See architecture.md §5 for the long-form rationale.
export const PACK_ECONOMICS = {
  // House margin we aim for on every tier. Below 5% the platform cannot
  // absorb price shocks on big pulls; above ~25% the EV feels stingy and
  // user retention suffers.
  TARGET_MARGIN_PCT: 0.15,
  // Hard floor: the solver refuses to publish weights below this margin.
  MIN_MARGIN_PCT: 0.05,
  // Win rate floor: at least 30% of opened packs must return more than
  // their cost, otherwise users churn. Above 40% the house bleeds.
  WIN_RATE_FLOOR: 0.3,
  WIN_RATE_CEILING: 0.4,
  // Solver knobs (margin-alpha clamps — see pack-economics.solveRarityWeights).
  SOLVER_TOLERANCE_PCT: 0.001,
  SOLVER_MIN_COMMON_WEIGHT: 0.05,
  SOLVER_MAX_COMMON_WEIGHT: 0.95,
  // Win-rate adjustment loop (secondary pass AFTER the margin solve).
  // Hard floor on the common weight during the win-rate correction; tighter
  // than SOLVER_MIN_COMMON_WEIGHT because once the margin lever has settled
  // we refuse to build packs where commons < 20% (too volatile, too whale-y).
  MIN_COMMON_WEIGHT: 0.2,
  // Ceiling on the rare weight during the win-rate correction. Above 30%
  // the pack degenerates into a "rare every time" product and loses variance.
  MAX_RARE_WEIGHT: 0.3,
  // Step size: each iteration shifts 5% probability from common into rare.
  WIN_RATE_STEP: 0.05,
  // Cap on the loop — at step 0.05, 20 iters covers moving 1.0 of mass.
  WIN_RATE_MAX_ITERATIONS: 20,
  // Fast MC trial count inside the loop. Must be big enough that win-rate
  // noise (~1/sqrt(N)) is small vs WIN_RATE_STEP impact. 2000 gives ~±1%.
  WIN_RATE_CHECK_TRIALS: 2_000,
  // Deterministic seed for in-loop MC so the loop converges reproducibly.
  WIN_RATE_CHECK_SEED: 42,
  // Simulation knobs (admin-facing simulator).
  DEFAULT_SIM_TRIALS: 10_000,
  MAX_SIM_TRIALS: 100_000,
  // --- Auto-rebalancer (B1 Fix 2) ---
  // "Emergency" band outside which the BullMQ rebalancer will auto-apply
  // solved weights after a price refresh. Margins between the band are
  // considered healthy drift and are left alone.
  EMERGENCY_MARGIN_FLOOR: 0.05,
  EMERGENCY_MARGIN_CEILING: 0.45,
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
    // B2 — purchases are enqueued with 0-2s jitter so bots firing at T+0ms
    // and humans clicking at T+400ms both get a randomized delay, erasing
    // the "fastest HTTP client wins" advantage.
    packPurchase: 'pv_queue_pack_purchase',
  },
} as const;

// =====================================================================
// B2 — Rate-limit configs. Tuned per endpoint.
// =====================================================================
// Intentionally strict on the "money moves" hot paths (purchase/bid/buy)
// and generous on read endpoints. Values are justified by the work-trial
// brief: 3 pack buys/min is well above any legitimate user; 5 bids/min
// still allows spirited bidding but blocks micro-bid scripts.
export const RATE_LIMITS = {
  // Pack purchase: 3 per minute per user (strict — the P0 concurrency path).
  PACK_PURCHASE_USER: { windowMs: 60_000, max: 3 },
  // Pack purchase: 10 per minute per IP (catches multi-account from one NAT).
  PACK_PURCHASE_IP: { windowMs: 60_000, max: 10 },
  // Bid placement: 5 per minute per user (prevents rapid micro-bids).
  BID_USER: { windowMs: 60_000, max: 5 },
  // Listing buy: 5 per minute per user (same ceiling as bids).
  LISTING_BUY_USER: { windowMs: 60_000, max: 5 },
  // General API: 60 per minute per user — for future per-endpoint use.
  API_GENERAL_USER: { windowMs: 60_000, max: 60 },
  // Auth attempts: 5 per 15 minutes per IP — for future use in login routes.
  AUTH_IP: { windowMs: 900_000, max: 5 },
} as const;

export type RateLimitKey = keyof typeof RATE_LIMITS;

export const SOCKET_ROOMS = {
  auction: (auctionId: string) => `auction:${auctionId}`,
  drop: (dropId: string) => `drop:${dropId}`,
  portfolio: (userId: string) => `portfolio:${userId}`,
} as const;
