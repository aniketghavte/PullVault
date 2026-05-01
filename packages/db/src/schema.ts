import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// =====================================================================
// ENUMS
// =====================================================================

export const rarityEnum = pgEnum('rarity', [
  'common',
  'uncommon',
  'rare',
  'ultra_rare',
  'secret_rare',
]);

export const userCardStatusEnum = pgEnum('user_card_status', [
  'held',
  'listed',
  'in_auction',
  'transferred',
]);

export const dropStatusEnum = pgEnum('drop_status', [
  'scheduled',
  'live',
  'sold_out',
  'closed',
]);

export const auctionStatusEnum = pgEnum('auction_status', [
  'scheduled',
  'live',
  'extended',
  'settling',
  'settled',
  'cancelled',
]);

export const listingStatusEnum = pgEnum('listing_status', ['active', 'sold', 'cancelled']);

export const holdKindEnum = pgEnum('hold_kind', ['auction_bid']);
export const holdStatusEnum = pgEnum('hold_status', ['held', 'released', 'consumed']);

export const txKindEnum = pgEnum('tx_kind', [
  'deposit',
  'pack_purchase',
  'trade_sale_credit',
  'trade_purchase_debit',
  'auction_settlement_credit',
  'auction_settlement_debit',
  'platform_fee',
  'bid_hold',
  'bid_release',
  'bid_consume',
  'adjustment',
]);

// =====================================================================
// USERS
// =====================================================================
// We mirror auth.users (Supabase Auth) into a public.profiles row that
// owns balances and ledger references. The id matches auth.users.id.
export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey(), // == auth.users.id
    handle: varchar('handle', { length: 24 }).notNull(),
    email: text('email').notNull(),
    // available = spendable. held = locked in active auction bids.
    availableBalanceUsd: numeric('available_balance_usd', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    heldBalanceUsd: numeric('held_balance_usd', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    handleUx: uniqueIndex('profiles_handle_lower_ux').on(sql`lower(${t.handle})`),
    emailUx: uniqueIndex('profiles_email_lower_ux').on(sql`lower(${t.email})`),
    availableNonNeg: check(
      'profiles_available_nonneg',
      sql`${t.availableBalanceUsd} >= 0`,
    ),
    heldNonNeg: check('profiles_held_nonneg', sql`${t.heldBalanceUsd} >= 0`),
  }),
);

// =====================================================================
// CARD CATALOG (master + price)
// =====================================================================
export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    externalId: varchar('external_id', { length: 64 }).notNull(), // Pokemon TCG id
    name: text('name').notNull(),
    setCode: varchar('set_code', { length: 32 }).notNull(),
    setName: text('set_name').notNull(),
    number: varchar('number', { length: 16 }).notNull(),
    rarity: rarityEnum('rarity').notNull(),
    imageUrl: text('image_url').notNull(),
    // Latest known market price (denormalized hot field). Authoritative
    // history is in `card_prices`. Price engine updates both atomically.
    marketPriceUsd: numeric('market_price_usd', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    priceUpdatedAt: timestamp('price_updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    externalUx: uniqueIndex('cards_external_id_ux').on(t.externalId),
    rarityIx: index('cards_rarity_ix').on(t.rarity),
    setIx: index('cards_set_ix').on(t.setCode),
    priceNonNeg: check('cards_price_nonneg', sql`${t.marketPriceUsd} >= 0`),
  }),
);

export const cardPrices = pgTable(
  'card_prices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 24 }).notNull(), // 'tcgplayer' | 'pokemontcg' | 'simulated'
    priceUsd: numeric('price_usd', { precision: 14, scale: 2 }).notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byCardTimeIx: index('card_prices_card_time_ix').on(t.cardId, t.fetchedAt),
  }),
);

// =====================================================================
// PACK TIERS + DROPS
// =====================================================================
export const packTiers = pgTable('pack_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 24 }).notNull().unique(), // 'standard' | 'premium' | ...
  name: text('name').notNull(),
  priceUsd: numeric('price_usd', { precision: 14, scale: 2 }).notNull(),
  cardsPerPack: integer('cards_per_pack').notNull(),
  // { common: 0.7, uncommon: 0.22, rare: 0.07, ultra_rare: 0.009, secret_rare: 0.001 }
  rarityWeights: jsonb('rarity_weights').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // --- Auto-rebalance audit trail (B1 Fix 2) ---
  // Set by the BullMQ weight-rebalancer worker whenever a price refresh
  // pushes a tier's actual margin outside PACK_ECONOMICS.EMERGENCY_MARGIN_*.
  // Null ⇒ no auto-rebalance has ever fired for this tier.
  rebalancedAt: timestamp('rebalanced_at', { withTimezone: true }),
  rebalancedReason: text('rebalanced_reason'),
  // JSON blob with the PRE-rebalance snapshot, shape:
  //   { weights: {...}, marginPct: "0.0320", newMarginPct: "0.1500" }
  // Stored as jsonb so the admin log can reconstruct "before vs after"
  // without a separate history table.
  previousWeights: jsonb('previous_weights'),
});

export const packDrops = pgTable(
  'pack_drops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tierId: uuid('tier_id')
      .notNull()
      .references(() => packTiers.id),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    totalInventory: integer('total_inventory').notNull(),
    // remainingInventory is the *single source of truth* for concurrency.
    // We update with `UPDATE ... SET remaining = remaining - 1 WHERE remaining > 0`.
    remainingInventory: integer('remaining_inventory').notNull(),
    status: dropStatusEnum('status').notNull().default('scheduled'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scheduledIx: index('pack_drops_scheduled_ix').on(t.scheduledAt),
    statusIx: index('pack_drops_status_ix').on(t.status),
    inventoryNonNeg: check(
      'pack_drops_inventory_nonneg',
      sql`${t.remainingInventory} >= 0 AND ${t.remainingInventory} <= ${t.totalInventory}`,
    ),
  }),
);

// =====================================================================
// PACK PURCHASES + REVEALED CARDS
// =====================================================================
// Pack contents are decided server-side AT PURCHASE TIME (not reveal time).
// We materialize the chosen card_ids into pack_purchase_cards in the same
// transaction as the inventory decrement and balance debit.
export const packPurchases = pgTable(
  'pack_purchases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    dropId: uuid('drop_id')
      .notNull()
      .references(() => packDrops.id, { onDelete: 'restrict' }),
    tierId: uuid('tier_id')
      .notNull()
      .references(() => packTiers.id),
    pricePaidUsd: numeric('price_paid_usd', { precision: 14, scale: 2 }).notNull(),
    // Idempotency key from the client. UNIQUE per user prevents double-buy
    // on rapid retries.
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(),
    sealed: boolean('sealed').notNull().default(true),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idemUx: uniqueIndex('pack_purchases_user_idem_ux').on(t.userId, t.idempotencyKey),
    userIx: index('pack_purchases_user_ix').on(t.userId),
    dropIx: index('pack_purchases_drop_ix').on(t.dropId),
  }),
);

export const packPurchaseCards = pgTable(
  'pack_purchase_cards',
  {
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => packPurchases.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    // Snapshot of price at draw time -> used as cost basis later.
    drawPriceUsd: numeric('draw_price_usd', { precision: 14, scale: 2 }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.purchaseId, t.position] }),
  }),
);

// =====================================================================
// USER COLLECTION (one row per owned card instance)
// =====================================================================
// Even if two users own "the same" Pokemon card, each instance is a unique
// row. This is what gets traded/auctioned.
export const userCards = pgTable(
  'user_cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    acquiredFrom: varchar('acquired_from', { length: 24 }).notNull(), // 'pack' | 'trade' | 'auction'
    sourceRefId: uuid('source_ref_id'), // pack purchase id / listing id / auction id
    acquiredPriceUsd: numeric('acquired_price_usd', { precision: 14, scale: 2 }).notNull(),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
    status: userCardStatusEnum('status').notNull().default('held'),
  },
  (t) => ({
    ownerStatusIx: index('user_cards_owner_status_ix').on(t.ownerId, t.status),
    cardIx: index('user_cards_card_ix').on(t.cardId),
  }),
);

// =====================================================================
// LISTINGS (P2P trade)
// =====================================================================
// Constraint: a user_card can have AT MOST ONE active listing at a time.
// Enforced via partial unique index on (user_card_id) WHERE status='active'.
export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userCardId: uuid('user_card_id')
      .notNull()
      .references(() => userCards.id, { onDelete: 'restrict' }),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    priceUsd: numeric('price_usd', { precision: 14, scale: 2 }).notNull(),
    status: listingStatusEnum('status').notNull().default('active'),
    buyerId: uuid('buyer_id').references(() => profiles.id),
    soldAt: timestamp('sold_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeUx: uniqueIndex('listings_active_one_per_card_ux')
      .on(t.userCardId)
      .where(sql`status = 'active'`),
    sellerIx: index('listings_seller_ix').on(t.sellerId),
    statusIx: index('listings_status_ix').on(t.status),
    pricePos: check('listings_price_positive', sql`${t.priceUsd} > 0`),
  }),
);

// =====================================================================
// AUCTIONS
// =====================================================================
// Like listings, only ONE active auction per user_card. The auction's
// end_at is the server-authoritative timer; anti-snipe extends it.
export const auctions = pgTable(
  'auctions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userCardId: uuid('user_card_id')
      .notNull()
      .references(() => userCards.id, { onDelete: 'restrict' }),
    sellerId: uuid('seller_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    startingBidUsd: numeric('starting_bid_usd', { precision: 14, scale: 2 }).notNull(),
    // Denormalized current high bid (kept in sync inside the bid txn).
    currentHighBidId: uuid('current_high_bid_id'),
    currentHighBidUsd: numeric('current_high_bid_usd', { precision: 14, scale: 2 }),
    currentHighBidderId: uuid('current_high_bidder_id').references(() => profiles.id),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    extensions: integer('extensions').notNull().default(0),
    antiSnipeWindowSeconds: integer('anti_snipe_window_seconds').notNull(),
    antiSnipeExtensionSeconds: integer('anti_snipe_extension_seconds').notNull(),
    status: auctionStatusEnum('status').notNull().default('scheduled'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    winnerId: uuid('winner_id').references(() => profiles.id),
    finalPriceUsd: numeric('final_price_usd', { precision: 14, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeUx: uniqueIndex('auctions_active_one_per_card_ux')
      .on(t.userCardId)
      .where(sql`status in ('scheduled','live','extended','settling')`),
    statusIx: index('auctions_status_ix').on(t.status),
    endAtIx: index('auctions_end_at_ix').on(t.endAt),
    sellerIx: index('auctions_seller_ix').on(t.sellerId),
    startingPos: check('auctions_starting_positive', sql`${t.startingBidUsd} > 0`),
  }),
);

export const bids = pgTable(
  'bids',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    auctionId: uuid('auction_id')
      .notNull()
      .references(() => auctions.id, { onDelete: 'cascade' }),
    bidderId: uuid('bidder_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    amountUsd: numeric('amount_usd', { precision: 14, scale: 2 }).notNull(),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    causedExtension: boolean('caused_extension').notNull().default(false),
    // Idempotency for the bidder's client.
    idempotencyKey: varchar('idempotency_key', { length: 64 }).notNull(),
  },
  (t) => ({
    auctionTimeIx: index('bids_auction_time_ix').on(t.auctionId, t.placedAt),
    idemUx: uniqueIndex('bids_bidder_idem_ux').on(t.bidderId, t.idempotencyKey),
    amountPos: check('bids_amount_positive', sql`${t.amountUsd} > 0`),
  }),
);

// =====================================================================
// BALANCE HOLDS (auction bids reserve funds without debiting yet)
// =====================================================================
// Lifecycle:
//   bid placed -> create hold(status='held'), profiles.held += amount
//   outbid     -> hold(status='released'),    profiles.held -= amount
//   won        -> hold(status='consumed'),    profiles.held -= amount,
//                 (price moves to seller via auction settlement txn)
export const balanceHolds = pgTable(
  'balance_holds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'restrict' }),
    kind: holdKindEnum('kind').notNull(),
    referenceId: uuid('reference_id').notNull(), // e.g. bid id
    amountUsd: numeric('amount_usd', { precision: 14, scale: 2 }).notNull(),
    status: holdStatusEnum('status').notNull().default('held'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({
    userStatusIx: index('balance_holds_user_status_ix').on(t.userId, t.status),
    refIx: index('balance_holds_reference_ix').on(t.referenceId),
    amountPos: check('balance_holds_amount_positive', sql`${t.amountUsd} > 0`),
  }),
);

// =====================================================================
// LEDGER (canonical source of truth for the dashboard)
// =====================================================================
// Every money-changing operation appends one or more rows here in the
// same DB transaction. Sum(ledger.amount_usd WHERE user_id=X) MUST equal
// X's total balance change. Platform fee rows have user_id = NULL.
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: txKindEnum('kind').notNull(),
    userId: uuid('user_id').references(() => profiles.id), // NULL = platform house
    counterpartyId: uuid('counterparty_id').references(() => profiles.id),
    amountUsd: numeric('amount_usd', { precision: 14, scale: 2 }).notNull(), // signed
    referenceTable: varchar('reference_table', { length: 32 }).notNull(),
    referenceId: uuid('reference_id').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIx: index('ledger_user_ix').on(t.userId, t.createdAt),
    refIx: index('ledger_reference_ix').on(t.referenceTable, t.referenceId),
    kindIx: index('ledger_kind_ix').on(t.kind, t.createdAt),
  }),
);

// =====================================================================
// PORTFOLIO SNAPSHOTS (for time-series chart on collection view)
// =====================================================================
export const portfolioSnapshots = pgTable(
  'portfolio_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    totalValueUsd: numeric('total_value_usd', { precision: 14, scale: 2 }).notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userTimeIx: index('portfolio_snapshots_user_time_ix').on(t.userId, t.capturedAt),
  }),
);

// =====================================================================
// B2 — Anti-bot signals, scored-account flags, and rate-limit audit log.
// =====================================================================
// These tables are append-only (signals + events) or 1-row-per-user
// (suspicious_accounts) by design. They feed the fraud dashboard in B5
// and are deliberately decoupled from the hot purchase/bid paths so any
// write failure is non-fatal (the caller fires and forgets).
export const botSignals = pgTable(
  'bot_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => profiles.id, { onDelete: 'set null' }),
    ip: text('ip'),
    // Signal type enumeration (kept as free text so new heuristics can be
    // added without a migration):
    //   'fast_click'        - purchase submitted < 500ms after page load
    //   'sold_out_attempt'  - user hammered a drop that had zero remaining
    //   'velocity'          - 3+ purchases in the last 60s
    //   'no_reveals'        - bought 5+ packs and never opened any
    signalType: text('signal_type').notNull(),
    // Raw signal detail — stored as a short string so the dashboard can
    // render "320ms", "4 purchases/min", etc. without a JSON parse.
    value: text('value'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userTimeIx: index('bot_signals_user_time_ix').on(t.userId, t.createdAt),
    typeTimeIx: index('bot_signals_type_time_ix').on(t.signalType, t.createdAt),
  }),
);

// One row per user. botScore accumulates from recordBotSignal() upserts.
// Score thresholds (see services/bot-detection.ts):
//   0-30   : normal
//   31-60  : suspicious — add extra jitter to this user's purchases
//   61-100 : likely bot — surfaced in admin review, NOT auto-blocked.
export const suspiciousAccounts = pgTable(
  'suspicious_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .unique()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    botScore: integer('bot_score').notNull().default(0),
    flaggedAt: timestamp('flagged_at', { withTimezone: true }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scoreIx: index('suspicious_accounts_score_ix').on(t.botScore),
    flaggedIx: index('suspicious_accounts_flagged_ix').on(t.flaggedAt),
  }),
);

// Append-only record of every 429 response. Feeds the fraud dashboard
// (B5): "how many users hit rate limits in the last hour?".
export const rateLimitEvents = pgTable(
  'rate_limit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => profiles.id, { onDelete: 'set null' }),
    ip: text('ip'),
    // Logical endpoint — matches the `keyPrefix` passed to checkRateLimit:
    //   'purchase' | 'bid' | 'listing-buy' | 'auth' | ...
    endpoint: text('endpoint').notNull(),
    // 'user' when the per-user window tripped; 'ip' when the per-IP window did.
    limitType: text('limit_type').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIx: index('rate_limit_events_created_ix').on(t.createdAt),
    userTimeIx: index('rate_limit_events_user_time_ix').on(t.userId, t.createdAt),
    endpointTimeIx: index('rate_limit_events_endpoint_time_ix').on(t.endpoint, t.createdAt),
  }),
);

// =====================================================================
// Type helpers (inferred row types)
// =====================================================================
export type Profile = typeof profiles.$inferSelect;
export type Card = typeof cards.$inferSelect;
export type PackTier = typeof packTiers.$inferSelect;
export type PackDrop = typeof packDrops.$inferSelect;
export type PackPurchase = typeof packPurchases.$inferSelect;
export type UserCard = typeof userCards.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type Auction = typeof auctions.$inferSelect;
export type Bid = typeof bids.$inferSelect;
export type BalanceHold = typeof balanceHolds.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type BotSignal = typeof botSignals.$inferSelect;
export type SuspiciousAccount = typeof suspiciousAccounts.$inferSelect;
export type RateLimitEvent = typeof rateLimitEvents.$inferSelect;
