# PullVault UI Integration Plan (Mock -> Real)

This document explains how to replace the current in-browser mock engine with the real backend feature-by-feature, while keeping the Cohere-inspired UI intact.

## Current state (what’s built)

- Pages render a fully clickable UI backed by an in-browser mock state engine:
  - `apps/web/src/lib/mock/*`
  - Pokemon catalog snapshot: `apps/web/src/lib/mock/catalog/snapshot.json`
- The real backend logic still exists in:
  - REST routes under `apps/web/src/app/api/*`
  - Realtime auctions/drop broadcasting under `apps/realtime/*`

The UI is designed so each user journey corresponds to exactly one backend “slice”:

1. Pack drops (`/drops`, `/drops/[dropId]`, pack purchase)
2. Pack reveal (`/packs/[purchaseId]/reveal`)
3. Portfolio (`/portfolio`, `/portfolio/[userCardId]`)
4. Marketplace trading (`/marketplace`, `/marketplace/[listingId]`)
5. Live auctions (`/auctions`, `/auctions/[auctionId]`)
6. Admin economics (`/admin/economics`)

## Environment gate: `USE_MOCK`

Introduce a boolean env var (server + client safe):

- `USE_MOCK=true` (default for this UI-only build)
- `USE_MOCK=false` (when swapping a slice to the real backend)

Implementation approach:

1. Create a thin adapter layer:
   - `apps/web/src/lib/apiClient.ts` that exports the same surface as `mockApi` for each slice.
2. In each page, import from `apiClient` instead of importing `mockApi` directly.
3. When `USE_MOCK=false`, `apiClient` calls the real REST routes and connects websocket state where needed.

This keeps the UI code unchanged while the backing implementation changes.

## Slice-by-slice integration order (8 steps)

The order is risk-ascending and respects the work-trial P0/P1/P2 priorities.

### 1. Auth (Supabase) - unblock userId

Replace the mock “logged in” context with real auth:

- Login: `(auth)/login` uses Supabase auth session.
- Signup: `(auth)/signup` uses Supabase auth creation.
- After auth, all reads/writes use the authenticated `userId`.

Files to wire:
- Replace UI calls to mock `me` with real session from `@supabase/ssr` and/or existing helpers.
- Enforce `x-realtime-token` and idempotency for any write routes when wiring later slices.

Why first: every P0 write path needs a real `userId`.

### 2. Card catalog + price engine - make valuation “alive” ✅

The bundled snapshot has been replaced by a real price pipeline:

- `POST /api/admin/catalog/refresh` (auth required) — forwards to the realtime
  app's trusted internal endpoint (`x-realtime-token` header) which enqueues a
  BullMQ job on `pv_queue_price_refresh`. Modes: `seed | full | hot`.
- BullMQ worker (`apps/realtime/src/queues/price-refresh.ts`) calls
  `apps/realtime/src/jobs/price-pipeline.ts`:
  - `runFullRefresh` paginates the Pokemon TCG API, upserts rows in
    `cards` keyed on `external_id`, appends history rows in `card_prices`
    inside one DB transaction, and publishes a tick batch on
    `pv:prices:ticks`.
  - `runHotRefresh` walks prices for cards referenced by live listings,
    auctions, and recent purchases (or random catalog rows as fallback)
    so the channel never goes silent.
  - `runSeedIfEmpty` runs a `full` only when `cards` is empty (used on
    bootstrap when `CATALOG_AUTOSEED=true`, the default).
- Public read API: `GET /api/cards?rarity=&q=&limit=&offset=` reads from
  `cards` (denormalized `market_price_usd` is the live valuation).
- `GET /api/admin/catalog/stats` returns row counts, by-rarity breakdown,
  and last write timestamps.
- `/admin/catalog` page now triggers the real worker, polls live stats,
  and listens to the `price:tick` Socket.io event so the live preview
  flashes in real time.

Files involved:
- `apps/realtime/src/jobs/price-pipeline.ts` (new)
- `apps/realtime/src/queues/price-refresh.ts`
- `apps/realtime/src/routes/internal.ts` (`POST /internal/jobs/price-refresh`)
- `apps/web/src/lib/realtime/internal.ts` (new — token-authed client)
- `apps/web/src/app/api/admin/catalog/refresh/route.ts` (new)
- `apps/web/src/app/api/admin/catalog/stats/route.ts` (new)
- `apps/web/src/app/api/cards/route.ts` (new)
- `apps/web/src/app/admin/catalog/page.tsx`

Next-step UI mapping (slices 3–5):
- Reveal + portfolio should read `cards.market_price_usd` (already the
  authoritative valuation surface) and reuse the `price:tick` socket
  payload for live updates.

### 3. Pack drops (P0 concurrency) - real inventory decrement

Replace `/drops` and `/drops/[dropId]` buy calls:

- UI action: `buyPack(dropId)`
- Backend: call the real pack purchase route (atomic guarded updates).

Correctness target (from `architecture.md` §4.1):
- Exactly one of concurrent buyers wins the last pack.
- Balance debit and inventory decrement happen together in one DB transaction.

Files to wire:
- `apps/web/src/app/api/drops/route.ts`
- Subscribe the UI to drop inventory updates (Socket room):
  - `drop:<id>` via realtime server.

### 4. Pack reveal - read sealed contents created at purchase time

Replace reveal-presentation data source:

- UI reads `pack_purchase_cards` for the purchase
- Reveal step increments a `revealedCount` for UI only (contents are already sealed server-side).

Files to wire:
- `apps/web/src/app/api/packs/[purchaseId]/route.ts` (or equivalent)
- `/packs/[purchaseId]/reveal` page reads purchased draw cards rather than mock `drawnCards`.

### 5. Portfolio + price ticks - websocket updates

Replace portfolio reads:

- `/portfolio` reads `user_cards` + `cards.market_price_usd`
- Connect portfolio room websocket:
  - `portfolio:<userId>`

Files to wire:
- REST reads from portfolio routes
- Live updates via websocket price ticks

### 6. Marketplace (P0 atomic trade) - list + atomic buy

Replace marketplace trading calls:

- `/marketplace/[listingId]` “Buy card” calls the real listing buy route
- Trading fee and atomic transfer are validated server-side.

Correctness target (from `architecture.md` §4.2):
- Listing buy is atomic (money and card move together).
- No double-selling: listing status gate and card status gate prevent phantom inventory.

Files to wire:
- `apps/web/src/app/api/listings/route.ts`
- Listing state updates are refreshed by polling or websocket hooks (optional for MVP).

### 7. Auctions (P0 headline) - real realtime bidding + anti-snipe

Replace auctions UI data source:

- `/auctions` reads current auction rooms state
- `/auctions/[auctionId]` joins websocket room `auction:<id>`
- Place bid sends to the real route and updates UI from websocket broadcasts.

Correctness target (from `architecture.md` §4.3):
- Timer is server-authoritative.
- Anti-snipe extensions happen in the same DB transaction as bid acceptance.
- Reconnect pulls fresh snapshot from DB.

Files to wire:
- `apps/web/src/app/api/auctions/route.ts`
- Realtime socket events:
  - `pv.auction.extended`
  - `pv.bid.accepted`
  - `pv.auction.settled`

### 8. Admin economics - compute from ledger + real market prices ✅

Admin economics now reads real aggregates:

- `GET /api/admin/economics` computes:
  - `pack EV per tier` from current `cards.market_price_usd` and tier rarity weights
  - fee revenue directly from `ledger_entries` (`platform_fee`) split by listings/auctions
- `/admin/economics` now calls the real route (no mock API dependency)

Files wired:
- `apps/web/src/app/api/admin/economics/route.ts`
- `apps/web/src/app/admin/economics/page.tsx`

## Notes on implementation style

- Keep UI “surface” unchanged; only replace data adapters.
- Prefer idempotency keys for all write operations (pack purchase, bids, listing buys).
- Keep money math in `decimal.js` via `@pullvault/shared/money` utilities.

