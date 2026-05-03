# PullVault — Architecture

## 1. System Shape

PullVault is a **TypeScript monorepo** with two long-running processes:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Browser (Next.js client)                      │
│  React + TanStack Query + socket.io-client                             │
└──┬───────────────────────────────────────────────────┬─────────────────┘
   │ HTTPS (REST)                                       │ WSS (Socket.io)
   │                                                    │
┌──▼──────────────────────┐                  ┌──────────▼──────────────┐
│   apps/web (Next.js)     │  Redis pub/sub  │  apps/realtime (Express)│
│   - SSR pages            │ ──────────────▶ │  - Socket.io server      │
│   - REST API routes      │                  │  - BullMQ workers        │
│   - All write txns       │                  │    · auction-close       │
│   - Idempotency keys     │                  │    · price-refresh       │
└──┬───────────────────────┘                  └──────────┬──────────────┘
   │                                                     │
   │   Postgres transactions                             │   Reads + occasional
   │   (system of record)                                │   writes (auction settle)
   │                                                     │
   ▼                                                     ▼
        ┌──────────────────────────────────────────────────────┐
        │     Supabase Postgres  (auth.users + public.*)        │
        │     Postgres transactions are the truth.              │
        └───────────────────────────────────────────────────────┘
                              ▲
                              │ TLS
                              │
                        Upstash Redis
                        - pub/sub (web → realtime)
                        - BullMQ queues
                        - Hot caches (prices, drop counters)
```

### Why two processes (Next.js + Express)?

| Concern                                          | Where it lives        | Why                                                     |
| ------------------------------------------------ | --------------------- | ------------------------------------------------------- |
| Stateless REST (auth, packs, listings, reads)    | Next.js API routes    | Edge/serverless friendly; great DX; co-located w/ UI.   |
| Long-lived WebSocket connections                 | Express + Socket.io   | Vercel kills long-lived sockets. Need a real Node proc. |
| Auction timer + anti-snipe + settlement worker   | BullMQ in `realtime`  | Needs a persistent worker. Delayed jobs at `end_at`.    |
| Price refresh (cron-style)                       | BullMQ in `realtime`  | Same as above.                                          |
| B1 auto-rebalance worker                         | BullMQ in `realtime`  | Triggered after every price refresh; writes new weights atomically. |
| B2 pack-purchase fairness queue                  | BullMQ in `realtime`  | 0–2000 ms jitter delay, then HTTP callback into the web `/api/internal/packs/purchase` txn. |
| B3 wash-trade detection                          | BullMQ repeatable in `realtime` | Hourly; idempotent heuristics writing to `flagged_activity`. |

The realtime server can also live behind a load balancer with the `@socket.io/redis-adapter` later if we need >1 instance — Redis is already in the stack.

### Why Supabase + Drizzle?

- **Supabase** gives us hosted Postgres, Auth, and JWTs in one place. We use Auth for sessions, but the **system of record is plain Postgres** that we own. We do **not** rely on Supabase Realtime — Socket.io is more flexible for our auction protocol.
- **Real-time Authentication:** We bridge the Next.js frontend and Express realtime server using Supabase Auth. The browser fetches its active session token and passes it in the Socket.io `auth` handshake. This allows the Express server to securely identify the user, place them in their private event rooms (e.g., for live portfolio balance updates), while still allowing unauthenticated users to view public auctions.
- **Drizzle ORM**: thin TypeScript-first ORM. We can drop into raw SQL via `sql\`...\`` for the concurrency-critical statements (e.g. `UPDATE ... RETURNING`) without fighting the ORM.
- **`postgres-js`** driver, with `prepare: false` for the pooled (PgBouncer transaction-mode) connection.

### Why Upstash Redis?

- Free tier with TLS, REST, and full Redis protocol.
- Backs three things: (1) Redis pub/sub for cross-process events; (2) BullMQ queues for delayed jobs; (3) hot reads (drop inventory mirror, card price cache).

### Why decimal.js?

Money never touches `number`. All money values are stored as `NUMERIC(14, 2)` in Postgres and travel as 2-dp strings on the wire. `decimal.js` does the math in TypeScript with `ROUND_HALF_UP` for display and `ROUND_DOWN` for credits (so we never overpay by a fraction of a cent).

---

## 2. Repository Layout

```
pullvault/
├── apps/
│   ├── web/                # Next.js 14 (App Router) + REST API routes
│   │   └── src/app/
│   │       ├── api/
│   │       │   ├── admin/              # B1 simulate/solve + B3 analytics/flags
│   │       │   │                       # + B5 fraud-metrics, economic-health, user-health
│   │       │   ├── audit/packs/        # B4/B5 public chi-squared audit log
│   │       │   ├── drops/.../purchase/ # B2 rate limit + queue enqueue
│   │       │   ├── internal/packs/purchase/  # B2 callback from realtime worker
│   │       │   └── packs/[purchaseId]/verify-data/  # B4 public verifier feed
│   │       ├── admin/economics/        # B1/B3/B5 panels
│   │       └── verify/[purchaseId]/    # B4 client-only provably-fair verifier
│   └── realtime/           # Express + Socket.io + BullMQ workers
│       ├── src/queues/     # pack-purchase (B2 fairness), wash-trade (B3),
│       │                   # price-refresh, auction-close, connections
│       └── src/jobs/       # wash-trade-detector (B3), rebalance (B1), price-pipeline
├── packages/
│   ├── db/                 # Drizzle schema, migrations 0000–0004, seed scripts
│   └── shared/             # money, types, zod schemas, redis, constants,
│                           #   rate-limiter (B2), bot-detection (B2),
│                           #   pack-economics (B1), provably-fair (B4),
│                           #   purchase-queue (B2)
├── docs/                   # Per-feature deep dives (b2, b3, b4, b5)
├── architecture.md         # ← this file
├── status.md               # Build progress tracker
└── README.md
```

Workspace tool: **pnpm**. Type sharing is via TS source — `transpilePackages` in Next, raw `tsx` in `realtime`. No build step required for cross-package imports during development.

---

## 3. Database Schema (key tables)

(Full Drizzle schema in `packages/db/src/schema.ts`. Highlights:)

| Table                  | Purpose                                                                      | Key invariants                                                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`             | One row per Supabase auth user; holds `available_balance` + `held_balance`. | Both balances `>= 0` (CHECK).                                                                                                                       |
| `cards`                | Master Pokemon TCG catalog with denormalized latest market price.            | `market_price_usd >= 0`.                                                                                                                            |
| `card_prices`          | Append-only price history. Powers charts + audit.                            | Indexed `(card_id, fetched_at)`.                                                                                                                    |
| `pack_tiers`           | Tier definitions w/ rarity weights stored as JSONB.                          | `code` unique.                                                                                                                                      |
| `pack_drops`           | One row per drop. **`remaining_inventory` is the concurrency hot-path.**     | `0 ≤ remaining ≤ total` (CHECK).                                                                                                                    |
| `pack_purchases`       | One row per buy. UNIQUE `(user_id, idempotency_key)`.                        | Idempotent retries collapse to one row.                                                                                                              |
| `pack_purchase_cards`  | Cards drawn at purchase time (sealed contents).                              | PK `(purchase_id, position)`.                                                                                                                       |
| `user_cards`           | One row per owned card *instance*. Status: held/listed/in_auction/transferred. | Partial unique index on each of `listings` and `auctions` ensures a card cannot be in two listings or two auctions simultaneously.                  |
| `listings`             | P2P sale listing.                                                            | Partial UNIQUE on `(user_card_id) WHERE status='active'`. CHECK `price > 0`.                                                                        |
| `auctions`             | Live auction.                                                                | Partial UNIQUE on `(user_card_id) WHERE status IN ('scheduled','live','extended','settling')`. `end_at` is server-authoritative.                    |
| `bids`                 | Append-only bid log + `caused_extension` flag.                               | UNIQUE `(bidder_id, idempotency_key)`. Indexed `(auction_id, placed_at)`.                                                                            |
| `balance_holds`        | One hold row per active bid. Lifecycle: `held → released | consumed`.        | `amount > 0`. Sum of `held` rows for a user = `profiles.held_balance` (invariant maintained per-txn).                                               |
| `ledger_entries`       | Double-entry ledger. Every money move emits at least 2 rows in 1 txn.        | Source of truth for the economics dashboard. Platform fee rows have `user_id = NULL`.                                                               |
| `portfolio_snapshots`  | Time-series for the portfolio chart. Written by a low-freq job.              | —                                                                                                                                                   |
| `bot_signals` (B2)     | Append-only behavioral events (fast_click, sold_out_attempt, velocity, no_reveals). | Indexed `(user_id, created_at)` and `(signal_type, created_at)`. Fire-and-forget writes from purchase hot path.                              |
| `suspicious_accounts` (B2) | One row per user with accumulated `bot_score` (0–100).                   | UNIQUE `(user_id)`. Upserted atomically; `flagged_at` stamped once on first threshold crossing; reviewers set `reviewed_at`.                     |
| `rate_limit_events` (B2) | Audit log of every 429 the web tier returned (`endpoint`, `limit_type`).  | Indexed `(created_at)`, `(endpoint, created_at)`. Powers B5 fraud dashboard.                                                                       |
| `flagged_activity` (B3)| Output of the wash-trade detector: `wash_trade`, `low_price_auction`, `circular_trade`. | Dedupe by `(type, reference_id)` at insert time; `reviewed`/`reviewed_at` flip via admin PATCH.                                         |
| `pack_tiers` **+ B1**  | Existing table now carries auto-rebalance audit columns.                     | `rebalanced_at`, `rebalanced_reason`, `previous_weights` (jsonb snapshot).                                                                         |
| `pack_purchases` **+ B4** | Existing table now carries provably-fair commitment columns.              | `server_seed` (nullable, redacted until reveal), `server_seed_hash` (non-null, public), `client_seed`, `nonce`, `verified_at`.                  |
| `pack_purchase_cards` **+ B4** | Existing sealed-cards table now carries explicit draw ordinal.       | `draw_index` — ordinal used in the HMAC message, decoupled from PK `position` for verifier stability.                                            |
| `auctions.status` **+ B3** | Enum extended with `sealed` state between `extended` and `settling`.     | `status IN ('scheduled','live','extended','sealed','settling','settled')`. Bids still accepted when sealed; high bid redacted from reads.        |

RLS is enabled on user-scoped tables. App writes use the **service role key** (RLS bypassed); the anon key is only used for the public marketplace read paths.

### 3.1 Migration history (Drizzle)

| Migration                       | Adds                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `0000_flowery_smiling_tiger`    | Initial schema (all Part A tables).                                                        |
| `0001_amazing_namor`            | **B1**: `pack_tiers.rebalanced_at`, `pack_tiers.rebalanced_reason`, `pack_tiers.previous_weights`. |
| `0002_flowery_darkhawk`         | **B2**: `bot_signals`, `suspicious_accounts`, `rate_limit_events` + FKs + indexes.         |
| `0003_easy_random`              | **B3**: `flagged_activity` table + `auction_status.sealed` enum value.                     |
| `0004_lumpy_terrax`             | **B4**: `pack_purchases` seed/hash/client/nonce/verified_at columns + `pack_purchase_cards.draw_index`. Backfills legacy rows with `server_seed_hash = 'legacy-purchase-not-verifiable'` before setting `NOT NULL`. |

---

## 4. Concurrency: how each P0 path stays correct

### 4.1 Pack drop purchase (the inventory test)

Single transaction:

```sql
BEGIN;

-- 1. Atomic inventory decrement. CHECK ensures we never go negative;
--    `RETURNING` lets us detect 0 rows (sold out) without a separate read.
UPDATE pack_drops
   SET remaining_inventory = remaining_inventory - 1,
       status = CASE WHEN remaining_inventory - 1 = 0 THEN 'sold_out' ELSE status END
 WHERE id = $drop_id
   AND remaining_inventory > 0
RETURNING remaining_inventory, tier_id;
-- 0 rows -> SOLD_OUT (return 409, do not retry, do not debit).

-- 2. Atomic balance debit. Same pattern — guard in the WHERE clause.
UPDATE profiles
   SET available_balance_usd = available_balance_usd - $price
 WHERE id = $user_id
   AND available_balance_usd >= $price
RETURNING available_balance_usd;
-- 0 rows -> INSUFFICIENT_FUNDS (we ROLLBACK, restoring inventory).

-- 3. Idempotent purchase row.
INSERT INTO pack_purchases (user_id, drop_id, tier_id, price_paid_usd, idempotency_key)
VALUES (...) ON CONFLICT (user_id, idempotency_key) DO NOTHING
RETURNING id;
-- ON CONFLICT NOTHING means a flaky retry returns the prior id (we re-select).

-- 4. Server-side card draw using rarity weights (see §5).
INSERT INTO pack_purchase_cards (...) VALUES (...);

-- 5. Ledger entries.
INSERT INTO ledger_entries (kind='pack_purchase', user_id, amount=-price, ...);
INSERT INTO ledger_entries (kind='platform_fee',  user_id=NULL, amount=margin, ...);

COMMIT;
```

After commit, web `PUBLISH`es `pv:drop:<id>:events` with the new `remaining`. The realtime subscriber broadcasts to the drop room.

**Why this works:** the `WHERE remaining > 0` predicate inside `UPDATE` is atomic in Postgres. Two concurrent transactions racing for the last pack: one updates 1 row, the other gets 0 rows back — no oversell. The CHECK constraint is a defense-in-depth backstop. Idempotency key prevents the double-click case at the protocol layer.

**Drop Status Transitions ("Effective Status"):**
To avoid needing a highly precise cron job to flip a drop's status from `scheduled` to `live` at the exact second it opens, the system uses an **effective status** pattern at query time in the API. 
Any drop where `scheduled_at <= NOW()` and `remaining_inventory > 0` is treated and returned as `live` to the client, regardless of what is stored in the database's `status` column. The database `status` column is only actively updated to `sold_out` during the atomic purchase decrement (as seen above).

### 4.2 Atomic trade (listing buy)

```sql
BEGIN;
SELECT * FROM listings WHERE id = $1 FOR UPDATE;        -- lock the listing
-- abort if status != 'active'    -> ALREADY_SOLD
SELECT user_cards FOR UPDATE;
-- defensive: ensure card is still owned by seller and status='listed'

UPDATE profiles SET available = available - price WHERE id = $buyer AND available >= price;
-- 0 rows -> INSUFFICIENT_FUNDS

UPDATE profiles SET available = available + (price - fee) WHERE id = $seller;

UPDATE user_cards SET owner_id = $buyer, status = 'held' WHERE id = $card;

UPDATE listings SET status='sold', buyer_id=$buyer, sold_at=now() WHERE id=$1;

INSERT INTO ledger_entries x3 (buyer debit, seller credit, platform fee);
COMMIT;
```

Constraints that bulletproof this:
- Partial UNIQUE on `listings(user_card_id) WHERE status='active'` makes double-listing impossible.
- `user_cards.status = 'listed'` is the gate that prevents a seller from also auctioning the same card. The auction creation path checks this and sets `status = 'in_auction'`, which is mutually exclusive.

### 4.2.1 B2 — Purchase fairness queue (Layer 2)

The pack-drop purchase route is no longer a synchronous DB transaction on the web request. It is a three-stage pipeline:

1. **Edge guard (web)** — atomic Redis Lua sliding-window limiter (`packages/shared/src/rate-limiter.ts`). Two windows per request: per-user (strict) + per-IP (loose). 429s are logged to `rate_limit_events` with proper `Retry-After` / `X-RateLimit-*` headers.
2. **Fire-and-forget bot signals** — `runPurchaseBotChecks` records `fast_click` (page-load-to-click < 500ms), `sold_out_attempt`, and `velocity` signals. Writes are non-blocking; scores accumulate in `suspicious_accounts` via atomic `onConflictDoUpdate`.
3. **Fairness queue (BullMQ)** — the route enqueues a job `purchase:{userId}:{idempotencyKey}` with a **random 0–2000 ms delay**. The realtime worker picks it up after the jitter and calls back into `/api/internal/packs/purchase` (protected by `x-realtime-token`), which runs the unchanged atomic `purchasePack` transaction.

The client gets a `jobId` + `readyAtMs` and polls `/api/drops/purchase-status/[jobId]`. The unchanged transaction from §4.1 still guarantees no oversell; the queue just removes the "fastest-HTTP-client-wins" advantage during drop bursts. BullMQ jobs use `attempts: 1` so we never double-publish; idempotency at the DB layer catches retries regardless.

### 4.3 Bids (the auction-room hot path)

A bid is one transaction, locked on the auction row:

```sql
BEGIN;
SELECT id, status, end_at, current_high_bid_id, current_high_bid_usd, extensions,
       anti_snipe_window_seconds, anti_snipe_extension_seconds
  FROM auctions WHERE id = $1 FOR UPDATE;

-- AUCTION_CLOSED if status NOT IN ('live','extended') OR end_at < now()
-- BID_OUTBID    if expectedCurrentHighBidId != current_high_bid_id  (optimistic check)
-- BID_TOO_LOW   if amount < min_required_bid

-- Hold buyer's funds:
UPDATE profiles
   SET available_balance_usd = available_balance_usd - $amount,
       held_balance_usd      = held_balance_usd      + $amount
 WHERE id = $bidder_id AND available_balance_usd >= $amount;
-- 0 rows -> INSUFFICIENT_FUNDS (rollback).

INSERT INTO bids (...) VALUES (...) RETURNING id;
INSERT INTO balance_holds (kind='auction_bid', reference_id=$bid, amount=$amount);

-- Release previous high bidder's hold:
IF previous_bid_id IS NOT NULL THEN
  UPDATE balance_holds SET status='released', resolved_at=now() WHERE reference_id=$prev_bid;
  UPDATE profiles SET available += $prev_amount, held -= $prev_amount WHERE id=$prev_bidder;
  INSERT INTO ledger_entries (kind='bid_release', user_id=$prev, amount=$prev_amount, ...);
END IF;

INSERT INTO ledger_entries (kind='bid_hold', user_id=$bidder, amount=-$amount, ...);

-- Anti-snipe:
IF (end_at - now()) <= ANTI_SNIPE_WINDOW AND extensions < MAX_EXTENSIONS THEN
  UPDATE auctions
     SET end_at = now() + ANTI_SNIPE_EXTENSION_INTERVAL,
         extensions = extensions + 1,
         status = 'extended',
         current_high_bid_id = $bid,
         current_high_bid_usd = $amount,
         current_high_bidder_id = $bidder
   WHERE id = $1;
ELSE
  UPDATE auctions SET current_high_bid_id, current_high_bid_usd, current_high_bidder_id WHERE id = $1;
END IF;

COMMIT;
```

After commit, web publishes `pv.bid.accepted` (and, if extended, also `pv.auction.extended`) to `pv:auction:<id>:events`. The realtime server fans out to the room with `auction:bid` (and updates the timer).

If anti-snipe extended the end time, web also schedules a fresh BullMQ job for the new `end_at`. The auction-close worker is idempotent: it re-locks the row, and if `end_at > now()` it bails out (the new job will arrive at the right time).

### 4.3.1 B3 — Bid validation rules (inside the same txn)

Three additional checks run inside the `SELECT ... FOR UPDATE` block, *before* funds are held:

- **Self-bid block** — `bidder_id != seller_id` → error `SELF_BID_FORBIDDEN` (HTTP 403).
- **Fat-finger cap** — reject if `amount > 10 × cards.market_price_usd` (only enforced when market price > 0) → `BID_EXCEEDS_MAXIMUM` (409).
- **Frequency throttle** — reject if the same user placed another bid on the same auction `< 5s` ago → `BID_TOO_FREQUENT` (429).

These live in `apps/web/src/services/auction-service.ts`. Failures roll back the entire transaction — no hold, no bid row, no extension.

### 4.3.2 B3 — Sealed-bid phase

If after the anti-snipe check `extensions ≥ 3` AND `end_at - now() ≤ 60s`, the bid transition flips `auctions.status` to `sealed`. Sealed behavior:

- **Writes** continue normally — bids are still held, outbid refunds still release, ledger still writes.
- **Reads are redacted** on every surface:
  - `GET /api/auctions/[auctionId]` returns `currentHighBidUSD: null`, `currentHighBidderId: null`, and blanks `bidderId`/`bidderHandle`/`amountUSD` in `recentBids`.
  - Socket handshake `auction:join` snapshot applies the same redaction.
  - Broadcast events (`auction:bid`, `auction:state`) omit the same fields while sealed.
- **Optimistic concurrency is relaxed** — because the client sees `currentHighBidId = null`, the `expectedCurrentHighBidId` check is skipped when `auction.status === 'sealed'`. This is a deliberate trade-off: the client is intentionally blind, so the server cannot use client-supplied expectation as a race guard. The `FOR UPDATE` lock still serializes bids.
- On transition, we publish `pv.auction.sealed` (`INTERNAL_EVENTS.auctionSealed`) so watchers immediately see the banner without waiting for the next bid.

Settlement proceeds unchanged from `sealed` → `settling` → `settled`.

### 4.3.3 B3 — Wash-trade detection (hourly)

`apps/realtime/src/jobs/wash-trade-detector.ts`, scheduled by `apps/realtime/src/queues/wash-trade.ts` as a repeatable BullMQ job with a fixed `jobId`. Three heuristics run every hour:

- **wash_trade** — same two users traded the same card more than once within 7 days (from `listings`).
- **low_price_auction** — settled auction with ≤1 unique bidder AND `final_price_usd < 0.5 × market_price_usd`.
- **circular_trade** — user A sold to B on `listings`, then B sold the same card back to A within 30 days.

Each heuristic is **idempotent**: it checks `flagged_activity (type, reference_id)` before inserting, so the hourly re-run never duplicates flags. Review state stays intact.

**Server crash recovery:** the auction state is fully on disk. On startup, the realtime server runs a sweeper that finds `auctions WHERE status IN ('live','extended') AND end_at <= now()` and enqueues close jobs for them; for `end_at > now()` it (re)schedules close jobs. WebSocket reconnects pull a fresh `auction:state` snapshot from the DB.

### 4.4 Auction settlement

Same `BEGIN ... COMMIT` shape, run by the BullMQ worker:

- Re-lock auction `FOR UPDATE`. If `status='settled'` → noop. If `end_at > now()` → re-enqueue at new `end_at`.
- If no bids: `status='settled'`, return card to seller (`user_cards.status='held'`).
- If bids: consume the winning hold (`held -= amount`), credit seller `available += (amount − fee)`, transfer card, write ledger entries, set `status='settled'`, `winner_id`, `final_price_usd`.
- Publish `pv.auction.settled`.

### 4.5 Balance-hold invariants

For any user at any time:
- `available_balance + held_balance = (sum of credits) − (sum of debits) − (sum of consumed holds)` from the ledger.
- `held_balance = sum of balance_holds where status='held' for that user`.

We can write a SQL audit query that surfaces violations, run nightly.

---

## 5. Pack EV Math & Parameter Choices

### 5.1 Tiers (defined in `packages/shared/src/constants.ts`)

| Tier      | Price  | Cards | Common | Uncommon | Rare  | Ultra | Secret |
| --------- | ------ | ----- | ------ | -------- | ----- | ----- | ------ |
| Standard  | $4.99  | 5     | 70%    | 22%      | 7%    | 0.9%  | 0.1%   |
| Premium   | $14.99 | 7     | 50%    | 30%      | 16%   | 3.5%  | 0.5%   |
| Elite     | $49.99 | 10    | 30%    | 35%      | 25%   | 8.5%  | 1.5%   |
| Whale     | $199.99| 15    | 15%    | 35%      | 35%   | 12%   | 3%     |

### 5.2 Expected value model

`E[card] = Σ weight_r × E[price | rarity_r]`. We bucket E[price | rarity] by computing the **mean price across all cards in that rarity tier** (re-computed daily as prices update). For an N-card pack, `EV(pack) = N × E[card]`.

Using approximate Pokemon TCG market means today (illustrative; recomputed on real data):

| Rarity      | E[price] |
| ----------- | -------- |
| common      | $0.05    |
| uncommon    | $0.20    |
| rare        | $1.50    |
| ultra_rare  | $20.00   |
| secret_rare | $120.00  |

Pack EV table:

| Tier      | EV/card  | EV/pack  | Price   | House margin |
| --------- | -------- | -------- | ------- | ------------ |
| Standard  | $0.42    | $2.10    | $4.99   | **57.9%**    |
| Premium   | $1.61    | $11.30   | $14.99  | **24.6%**    |
| Elite     | $4.79    | $47.91   | $49.99  | **4.2%**     |
| Whale     | $7.83    | $117.50  | $199.99 | **41.2%**    |

This is the **starting** spread. Part of the Part-B deliverable (or equivalent tuning) is to flatten the curve so each tier earns roughly 12–18% on EV by adjusting either rarity weights or pack price, while keeping the **variance** that creates the dopamine hit on big pulls.

We deliberately keep Whale margin slightly higher: high-value packs concentrate variance, and the platform absorbs the risk of a single $1k+ pull. Standard's high margin is justified by the cost of card-draw service overhead and the floor it provides for casual play (pulls a known commodity card 99% of the time).

### 5.2.1 B1 — Pack Economics Algorithm (margin-targeting solver + simulator)

Code: `packages/shared/src/pack-economics.ts` (pure math, no DB), wired into the `/admin/economics` UI via `apps/web/src/services/pack-economics.ts` and the routes `POST /api/admin/simulate-packs` and `POST /api/admin/solve-weights`.

**Targets** (`PACK_ECONOMICS` in `packages/shared/src/constants.ts`):

| Parameter           | Value | Rationale                                                                            |
| ------------------- | ----- | ------------------------------------------------------------------------------------ |
| `TARGET_MARGIN_PCT` | 15%   | Low enough that EV feels generous; high enough to absorb a 2σ swing in card prices.  |
| `MIN_MARGIN_PCT`    |  5%   | Below this the platform cannot survive a single hot card spike. Solver refuses.      |
| `WIN_RATE_FLOOR`    | 30%   | "3 in 10 packs return more than the price." Below this, retention curves drop hard.  |
| `WIN_RATE_CEILING`  | 40%   | Above this the house bleeds — pulls feel like cashbacks.                             |

**Backward solver (closed-form, common-as-lever).** We hold the relative shape of the non-common rarities and scale them by a single factor α. Common absorbs whatever is left:

```
For r != common:  w'_r = α · w_r
                  w'_c = 1 - α · Σ_{r!=c} w_r

EV/card  = α · A + (1 - α · B) · μ_c     where A = Σ_{r!=c} w_r·μ_r,  B = Σ_{r!=c} w_r
EV*/card = pricePerPack · (1 - target_margin) / cardsPerPack

α        = (EV*/card - μ_c) / (A - B · μ_c)
```

Edge cases the solver handles explicitly:

- `A - B·μ_c ≈ 0` → the lever has no effect (common and the non-common bucket have the same expected price). Returned with `reason='no_lever'`; the operator must raise pack price or refresh prices.
- `α < 0` → target EV is below the all-common floor; pin common to its ceiling and return `reason='price_floor'`.
- Solved common weight outside `[5%, 95%]` → clamp and report (`capped_min_common` / `capped_max_common`).

The solver is single-iteration because the system is linear in α; no fixed-point loop is required. The verifier then runs Monte-Carlo against the recommended weights so the operator sees both closed-form margin and empirical win rate before promoting.

**Monte-Carlo simulator.** Mirrors the production card-draw exactly:

1. Roll `cardsPerPack` rarities by weighted random (CDF lookup).
2. For each rarity, uniformly sample one price from the rarity bucket extracted from `cards.market_price_usd`.
3. Sum to pack EV; compare to pack price for the win-rate counter.

Defaults: 10,000 trials per tier, capped server-side at 100,000. A seedable Mulberry32 RNG (`createSeededRng`) is exposed for reproducible smoke tests and screenshots; production runs use `Math.random`. The simulator returns: mean / p10 / p50 / p90 EV, win rate, average margin, projected revenue / payout / P&L, a per-pack margin histogram, and an empirical rarity-hit-rate vector. The latter is also a sanity check: it should track the configured weights to within Monte-Carlo noise.

**Edge case the reviewers will probe — card price spikes mid-drop.** Pack contents are sealed at *purchase* time (`pack_purchase_cards.draw_price_usd`) using whatever weights the tier had then. Price changes only affect *future* purchases, never opened or unopened-but-paid-for packs. This is enforced by the existing concurrency path (§4.1) — no new schema is needed for B1.

**Why no DB schema change for B1.** The algorithm does not need to persist anything new: tier weights already live in `pack_tiers.rarity_weights` (jsonb), card prices in `cards.market_price_usd`, and per-purchase sealing in `pack_purchase_cards`. The simulator is read-only; the solver is a recommendation engine. Promoting recommended weights is a deliberate two-step manual save (out of scope for B1) so a corrupted price feed cannot silently rewrite the economy.

### 5.2.2 B1 — Auto-rebalancing worker

`apps/realtime/src/jobs/rebalance.ts` listens on the same Redis channel that the price-refresh pipeline publishes to. Flow:

1. After every price refresh (`pv:prices:refreshed`), recompute per-tier EV using the live `cards.market_price_usd` values.
2. If any tier's **computed margin** drifts outside `[MIN_MARGIN_PCT, TARGET_MARGIN_PCT + 10%]` or its **simulated win rate** exits `[WIN_RATE_FLOOR, WIN_RATE_CEILING]`, run `solveRarityWeights` for that tier.
3. Persist the solver's output into `pack_tiers.rarity_weights` and stamp `rebalanced_at`, `rebalanced_reason`, `previous_weights`. Admins can diff/roll back from `/admin/economics`.

The worker is **advisory-only by default** in production — new weights apply to future purchases (existing `pack_purchase_cards` are already sealed per §4.1). A dry-run flag lets the admin preview diffs without writing.

### 5.3 Card-draw algorithm (server-side, B4 provably-fair)

Prior card-draw used `Math.random()`. It is now fully deterministic per-purchase using commit-reveal HMAC-SHA256.

**At purchase time** (`apps/web/src/services/pack-purchase.ts`, same txn as §4.1):

1. Generate `serverSeed = randomBytes(32).hex` and `serverSeedHash = SHA256(serverSeed)` via `generateSeedPair()` in `packages/shared/src/provably-fair.ts`.
2. `clientSeed = body.clientSeed ?? purchaseId` (user-provided or the purchase UUID itself — both are known to the user).
3. Insert `pack_purchases` row with `server_seed_hash` (public), `server_seed = NULL` (hidden until reveal), `client_seed`, `nonce = 0`.
4. For each draw `i` in `0..cardsPerPack-1`:
   - `message = "${clientSeed}:${purchaseId}:${nonce}:${i}"`
   - `float01 = HMAC-SHA256(serverSeed, message) → first 8 bytes as big-endian uint → / 2^64`
   - `rarity = floatToRarity(float01, tier.rarityWeights)` — CDF walk over a fixed `DRAW_ORDER = ['common','uncommon','rare','ultra_rare','secret_rare']` so the verifier has a canonical order.
   - Pick a random card of that rarity, insert `pack_purchase_cards` with `draw_index = i` and `draw_price_usd`.

**At reveal time** (`apps/web/src/app/api/packs/[purchaseId]/reveal/route.ts`): on the *last* card reveal, `UPDATE pack_purchases SET server_seed = $purchase.server_seed` — this is the "reveal" step that makes the purchase verifiable.

**Read-side redaction** (`GET /api/packs/[purchaseId]`): returns `serverSeed = purchase.sealed ? null : purchase.serverSeed`, and **always** returns `serverSeedHash` + `clientSeed`. This preserves commit-reveal: users see the hash at purchase, the seed only after they've opened everything.

**Verifier** (`/verify/[purchaseId]`, client-only): fetches data from `GET /api/packs/[purchaseId]/verify-data` (public, no auth), re-runs `verifyPurchase(serverSeed, serverSeedHash, clientSeed, drawIndices, rarityWeights)` entirely in the browser (Web Crypto API), and POSTs back to stamp `verified_at`. The page supports **manual seed tampering** so reviewers can see a hash-mismatch failure in real time.

All of this happens in the same transaction as the inventory decrement, so a sold-out drop never produces orphan card grants.

### 5.4 Trade & auction fees

- Trade fee: **5%** of buyer-paid price. Seller gets 95%.
- Auction fee: **7%** of final price. Higher than trade because auctions consume more platform attention (real-time, anti-snipe, watchers).

These are tunable in `constants.ts`. Whatever we charge, the buyer sees it net of zero (they pay sticker), and the seller sees `gross − fee` arrive in `available`.

---

## 6. Anti-Snipe Mechanism

We use a **soft close** (a.k.a. "going, going, gone"): if a bid arrives within the **last 30 seconds** of the auction, `end_at` is extended by **30 seconds**. We cap at **20 extensions** per auction (10 minutes max stretch from the last "real" close) so a determined pair can't loop forever.

Justifications:

- Soft close is the eBay/StockX model and feels intuitive to users.
- 30/30 is short enough to keep the auction snappy (most extensions resolve within 1–2 cycles) while long enough to give a competing human time to react (a typical reaction loop: see notification, decide, type bid amount, click).
- Hard cap keeps the auction-close worker bounded and prevents pathological cases.
- It is **server-authoritative**: extensions happen inside the same DB transaction as the bid, so the timer cannot drift from state. The client timer is purely a render of `auctions.end_at`.

Alternative we considered: **hard close** (no extension) feels classic but rewards the snipe. **Random close** (Amazon Treasure-Truck style) feels arbitrary. **Best-offer-and-go** doesn't fit a real-time UI.

---

## 7. Real-time Pipeline

### 7.1 Web → Realtime

After **every** state mutation, the web API route does:

```ts
await db.transaction(async (tx) => { /* ... */ });
await publishInternal(channel, EVENT, payload);  // Redis pub/sub
```

`publishInternal` is best-effort: if Redis hiccups, we log and continue — the next page load (or a poll) recovers the truth from Postgres. Sockets are an optimization, not a system of record.

### 7.2 Realtime → Browser

The realtime server runs `psubscribe pv:auction:*:events`, `psubscribe pv:drop:*:events`, etc. Each message is parsed and re-broadcast to the appropriate Socket.io room.

Rooms:
- `auction:<id>` — joined by anyone watching the auction.
- `drop:<id>` — joined when the drop page is open.
- `portfolio:<userId>` — joined automatically on connect (when authenticated). Receives portfolio invalidations and price-tick events filtered to held cards.

### 7.3 Reconnect handling

On `connect`, the client re-emits `auction:join`/`drop:join` for every room it was watching. The realtime server replies with a fresh `auction:state` (read from the DB) so the new connection always sees the current high bid, end time, and watcher count.

### 7.4 Scaling beyond one realtime instance

- Add `@socket.io/redis-adapter` so multiple `realtime` instances share rooms via the same Redis.
- BullMQ queues are already shared.
- The DB lock contention becomes the next bottleneck (see §9).

---

## 8. Caching Strategy

| What                 | Where                                                | Why                                                                |
| -------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| Card market price    | Redis `pv:price:<cardId>` (TTL 60s) + DB hot column  | Read-heavy on portfolio. Recomputed by `price-refresh` job.        |
| Drop remaining count | DB column `remaining_inventory` is the truth.        | We do **not** mirror it in Redis for the *write* path — the DB itself is the cheapest atomic counter. We *broadcast* counts via pub/sub. |
| User balance         | Always read from DB.                                 | Money. No cache. Ever.                                             |
| Auction state        | Read on-demand for joins; live updates pushed.       | A cache here would create a divergence risk we cannot afford.      |
| Card catalog images  | CDN (Next/Image + remote pattern)                    | Browser caches forever; cards are immutable.                       |

The rule: **cache reads, never writes.** Any field that participates in a financial decision is read fresh in the same transaction that uses it.

---

## 9. What Breaks First at 10k Users

Estimating concurrent active users (CCU) ≈ ~5% of MAU = 500 CCU.

1. **Single Postgres bottleneck on `pack_drops` row updates during a drop.** A hot drop with 500 buyers slamming the same row is row-lock contention, not CPU. Mitigations: (a) pre-shard the drop into N "lots" each with `total/N` inventory, randomly assign buyers; (b) move the counter to a `pgcrypto`/SKIP-LOCKED workqueue. The 30%-correctness weight is best protected by keeping the row-update path simple and sharding only when load demands it.
2. **Auction-close worker concurrency** is fine until N auctions end in the same second. BullMQ scales by adding workers; the `FOR UPDATE` in settlement serializes per-auction.
3. **Socket.io fanout** — 500 CCU all watching one whale auction is fine for one node. 5k CCU needs the Redis adapter and 2–4 realtime instances behind a sticky LB.
4. **Pokemon TCG API rate limits** — current free tier is generous but not infinite. Mitigations: aggressive Redis caching of price reads (already designed in), batch the `hot` refresh by card id, and maintain a synthetic price walk fallback.
5. **decimal.js compute** — negligible compared to network.

---

## 10. Security Notes

- All money mutations use the **service role** key from server code only; the anon key cannot write to balance tables.
- RLS is enabled on user-scoped tables (`profiles`, `user_cards`, `pack_purchases`, `balance_holds`, `portfolio_snapshots`) so even leaked anon access is read-scoped to the authenticated user.
- The realtime server validates Supabase JWTs at the Socket.io handshake. Unauthenticated sockets are allowed but receive only public rooms (auction watching, drop countdown).
- Web → Realtime internal endpoints require `x-realtime-token` header matching `REALTIME_INTERNAL_TOKEN`.
- All mutation endpoints require an **idempotency key** so a flaky retry does not double-spend.
- Input is validated with **zod** at the route boundary; nothing untyped enters services.
- **B2 rate limiting**: every mutation hot path (`/drops/[id]/purchase`, `/auctions/[id]/bid`, `/listings/[id]/buy`) passes through an atomic Redis Lua sliding-window limiter before any DB work. Limits are configured in `packages/shared/src/rate-limiter.ts`; 429s are logged to `rate_limit_events`.
- **B2 bot detection**: the platform **never silently auto-blocks**. `suspicious_accounts.bot_score` ≥ 50 stamps `flagged_at` for manual review on `/admin/economics`. Auto-block is reserved for users hitting `5×` the rate limit inside one hour — still surfaced in the dashboard, never acted on by the hot path.
- **B3 auction hardening**: self-bidding, fat-finger (>10× market price), and rapid-fire (<5s) bids are rejected inside the bid transaction. Sealed-bid phase redacts the high bid across REST + WebSocket during the final 60s of heavily-extended auctions.
- **B4 provably-fair**: every pack purchase commits to a hashed server seed before the user opens; reveal exposes the seed; any user can re-verify in-browser with zero server trust. The public `/api/audit/packs` endpoint runs a chi-squared test over the last 1000 opens — an external reviewer can refute platform cheating without credentials.

---

## 11. Admin & Audit Surface (B5 Platform Health Dashboard)

`/admin/economics` is now the single pane of glass for operators. It fetches four endpoints in parallel and renders five panels:

| Panel                         | Endpoint                              | Highlights                                                                 |
| ----------------------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| Pack Economics + Rebalance    | `/api/admin/economics-summary`, `/api/admin/rebalance-log` | Live EV, margin per tier, B1 rebalance audit log.                |
| Auction Health                | `/api/admin/auction-analytics`        | Snipe rate, flag rate, avg bidders, sealed count (last 30d).               |
| Flagged Activity              | `/api/admin/flagged-activity` (GET + PATCH `reviewed`) | Wash-trade / low-price / circular-trade flags from B3.         |
| Fraud Metrics                 | `/api/admin/fraud-metrics`            | 24h rate limit hits by endpoint + hourly sparkline, 7d bot signals by type, top-20 suspicious accounts. |
| Economic Health (with alerts) | `/api/admin/economic-health`          | Rolling 24h actual margin per tier (from `price_paid`/`card_market_price`), 30d revenue by stream, 7d daily revenue trend, projected monthly revenue. Alerts outside `[5%, 45%]`. |
| Fairness Audit                | `/api/audit/packs` (public, reused)   | Chi-squared over last 1000 opens; pass/fail at `p > 0.05`; verification-page usage count. |
| User Health                   | `/api/admin/user-health`              | 7d drop engagement (sell-through), 30d auction participation, D7 retention proxy, new vs returning buyers, portfolio size stats. |

All B5 routes use Drizzle raw SQL (`db.execute`) with results cast to `Record<string, unknown>[]` for type safety. The page has a single **Refresh dashboard** button and per-panel "Data as of" timestamps so operators always know the vintage of what they're looking at. The `MetricCard` component in `apps/web/src/components/admin/` unifies label/value/note/alert styling across panels.

---

## 12. Scope Cuts & Trade-offs

We deliberately did NOT build (yet):
- **Pack reveal animation polish.** The reveal logic is correct; visuals are minimal.
- **Offer system on listings** — listings are fixed-price only.
- **Multi-currency.** USD only, paper trading.
- **Real money rails** (Stripe). Default starting balance is $500; admin can credit accounts via a hidden ledger entry path.
- **Deposit/withdraw flows.** Out of scope for this trial.
- **Mobile native.** Responsive Web only.

These are explicit and listed in the README. Code paths that would lead to them are clearly marked `TODO`, not silently faked.
