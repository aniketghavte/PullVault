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
│   └── realtime/           # Express + Socket.io + BullMQ workers
├── packages/
│   ├── db/                 # Drizzle schema, migrations, seed scripts
│   └── shared/             # money, types, zod schemas, redis, constants
├── architecture.md         # ← this file
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

RLS is enabled on user-scoped tables. App writes use the **service role key** (RLS bypassed); the anon key is only used for the public marketplace read paths.

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

### 5.3 Card-draw algorithm (server-side)

1. Roll `cardsPerPack` rarities by `weighted_random(rarityWeights)` — implemented in Postgres as a function over `random()`.
2. For each chosen rarity, `SELECT id FROM cards WHERE rarity = $r ORDER BY random() LIMIT 1` (server-seeded; client cannot influence). For performance at scale we can pre-bucket card IDs in Redis sets and pull randomly there.
3. Snapshot the card's current `market_price_usd` into `pack_purchase_cards.draw_price_usd` — that becomes the user's cost basis for P&L.

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

---

## 11. Scope Cuts & Trade-offs

We deliberately did NOT build (yet):
- **Pack reveal animation polish.** The reveal logic is correct; visuals are minimal.
- **Offer system on listings** — listings are fixed-price only.
- **Multi-currency.** USD only, paper trading.
- **Real money rails** (Stripe). Default starting balance is $500; admin can credit accounts via a hidden ledger entry path.
- **Deposit/withdraw flows.** Out of scope for this trial.
- **Mobile native.** Responsive Web only.

These are explicit and listed in the README. Code paths that would lead to them are clearly marked `TODO`, not silently faked.
