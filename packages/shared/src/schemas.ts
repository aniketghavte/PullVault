import { z } from 'zod';
import { AUCTION_DURATIONS_MINUTES } from './constants';

// Money values on the wire are strings with up to 2 decimal places, non-negative.
export const moneyString = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'invalid money value');

export const uuid = z.string().uuid();

// ---- Auth / users ----
export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  handle: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[a-zA-Z0-9_]+$/, 'alphanumeric + underscore only'),
});

// ---- Pack drops ----
export const buyPackSchema = z.object({
  dropId: uuid,
  // idempotencyKey lets a flaky client retry without double-buying.
  idempotencyKey: z.string().min(8).max(64),
});

// ---- Listings (P2P trade) ----
export const createListingSchema = z.object({
  userCardId: uuid,
  priceUSD: moneyString,
});

export const buyListingSchema = z.object({
  listingId: uuid,
  idempotencyKey: z.string().min(8).max(64),
});

// ---- Auctions ----
export const createAuctionSchema = z.object({
  userCardId: uuid,
  startingBidUSD: moneyString,
  // Server validates that durationMinutes is one of AUCTION_DURATIONS_MINUTES.
  // We use `refine` instead of `z.union(z.literal(...))` so the literal list
  // can change without TS complaining about the tuple shape.
  durationMinutes: z
    .number()
    .int()
    .positive()
    .refine(
      (n): n is (typeof AUCTION_DURATIONS_MINUTES)[number] =>
        (AUCTION_DURATIONS_MINUTES as readonly number[]).includes(n),
      { message: 'unsupported duration' },
    ),
});

export const placeBidSchema = z.object({
  auctionId: uuid,
  amountUSD: moneyString,
  // Server checks this matches its own current high bid id; if not, the
  // client raced another bidder and we reject with BID_OUTBID.
  expectedCurrentHighBidId: uuid.nullable(),
  idempotencyKey: z.string().min(8).max(64),
});

// ---- Admin: pack economics (B1) ----
// Tier code is intentionally a free-form string here so the catalog can
// add new tiers (e.g. seasonal 'champion') without a shared-types release.
// The service validates tierCode against the live `pack_tiers` table.
const tierCodeString = z
  .string()
  .min(1)
  .max(24)
  .regex(/^[a-z0-9_]+$/, 'lowercase + underscore only');

// Optional rarity-weight overrides for "what-if" simulation.
const rarityWeightOverrideSchema = z
  .record(
    z.string().min(1).max(24),
    z.number().min(0).max(1),
  )
  .refine(
    (w) => {
      const sum = Object.values(w).reduce((acc, n) => acc + n, 0);
      // Allow small fp drift; the caller may submit 0.99999.
      return Math.abs(sum - 1) <= 0.01;
    },
    { message: 'rarity weights must sum to 1.0 (±0.01)' },
  );

export const simulatePacksSchema = z.object({
  // Undefined => simulate every active tier.
  tierCode: tierCodeString.optional(),
  // Trials per tier. Capped on the server too; this is the client-friendly cap.
  trials: z.number().int().positive().max(100_000).optional(),
  // What-if knobs. Both optional. Apply only to the simulated run; never
  // persisted.
  overrideWeights: rarityWeightOverrideSchema.optional(),
  overridePricePerPackUsd: moneyString.optional(),
  // Deterministic seed for reproducible runs (smoke tests, screenshots).
  seed: z.number().int().nonnegative().optional(),
});

export const solveWeightsSchema = z.object({
  tierCode: tierCodeString,
  // 0.05–0.50; defaults to PACK_ECONOMICS.TARGET_MARGIN_PCT in the service.
  targetMarginPct: z.number().min(0.05).max(0.5).optional(),
});

// ---- Socket.io events (typed) ----
// Server -> client
export const auctionEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('state'),
    payload: z.object({
      auctionId: uuid,
      currentHighBidUSD: moneyString.nullable(),
      currentHighBidderId: uuid.nullable(),
      endAt: z.string(),
      extensions: z.number().int().nonnegative(),
      watcherCount: z.number().int().nonnegative(),
    }),
  }),
  z.object({
    type: z.literal('bid'),
    payload: z.object({
      auctionId: uuid,
      bidId: uuid,
      bidderId: uuid,
      bidderHandle: z.string(),
      amountUSD: moneyString,
      placedAt: z.string(),
      causedExtension: z.boolean(),
      newEndAt: z.string(),
    }),
  }),
  z.object({
    type: z.literal('settled'),
    payload: z.object({
      auctionId: uuid,
      winnerId: uuid.nullable(),
      finalPriceUSD: moneyString.nullable(),
    }),
  }),
]);

export const dropEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('inventory'),
    payload: z.object({ dropId: uuid, remaining: z.number().int().nonnegative() }),
  }),
  z.object({
    type: z.literal('sold_out'),
    payload: z.object({ dropId: uuid }),
  }),
]);

export type AuctionEvent = z.infer<typeof auctionEventSchema>;
export type DropEvent = z.infer<typeof dropEventSchema>;
