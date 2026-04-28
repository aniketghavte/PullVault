---
name: test-project
description: Test PullVault end-to-end with focus on the concurrency cases the work-trial reviewers explicitly try to break. Use when the user asks to test, verify, validate, stress, race, or break the platform — pack drops, concurrent purchases, simultaneous bids, double-spend attempts, balance reconciliation, atomic trades, auction reconnects, or any "what happens if two users do X at once" scenario.
---

# Test PullVault

The trial review is explicit: **reviewers will open two browser tabs and try to break the system**. The tests below mirror exactly what they will do, plus the invariants we must preserve.

## Pre-flight

Before testing, make sure both processes are running:

```bash
pnpm dev
# web at http://localhost:3000, realtime at http://localhost:4000
```

Health checks:

```bash
curl http://localhost:3000/api/health
curl http://localhost:4000/health
```

You'll need at least 2 test users (created via the signup flow) with non-zero balances.

## A. Manual two-tab drill (mirrors the review call)

Open the same flow in two browser tabs (different users, or two sessions of the same user via incognito). Run each scenario.

### A1. Concurrent pack purchase on the last pack

1. Schedule a drop with `total_inventory = 1` (use Drizzle Studio or a SQL insert).
2. Open the drop page in **Tab 1** and **Tab 2** (different users).
3. Wait for the countdown to hit zero.
4. In both tabs, click "Buy" as close to simultaneously as possible.

**Pass criteria:**
- Exactly one user sees a successful purchase.
- The other user sees a clean "Sold Out" error (HTTP 409 / `SOLD_OUT`).
- `pack_drops.remaining_inventory` is **0**, never `-1`.
- The losing user's balance is **unchanged**.
- One row in `pack_purchases`, one row per drawn card in `pack_purchase_cards`.
- Ledger entries reconcile (see §C).

### A2. Concurrent listing purchase

1. User A lists a card.
2. User B and User C both load the listing page.
3. Click "Buy" simultaneously.

**Pass criteria:**
- Exactly one wins. The other gets `ALREADY_SOLD`.
- The card's `owner_id` matches the winner.
- The losing user's balance is unchanged.
- Three ledger entries: buyer debit, seller credit, platform fee.

### A3. Concurrent bids on the same auction

1. Create an auction.
2. User B and User C both place a bid for the **same amount** within ~50 ms.

**Pass criteria:**
- Exactly one bid is accepted.
- The other returns `BID_OUTBID` (or `BID_TOO_LOW` if the timing reordered them).
- `profiles.held_balance` for both bidders matches `balance_holds(status='held')` for that user.

### A4. Anti-snipe in action

1. Create an auction with a 30s anti-snipe window and ~1 minute duration.
2. With ~10 seconds left, place a bid.

**Pass criteria:**
- `auctions.end_at` shifts forward by the extension window.
- `auctions.extensions` increments by 1.
- All connected clients see the new countdown without a refresh.
- The auction-close BullMQ job for the new `end_at` is enqueued.

### A5. WebSocket disconnect mid-auction

1. Join an auction room.
2. Block the realtime port (firewall rule, or DevTools Network → Offline).
3. Place bids from another tab.
4. Re-enable the connection.

**Pass criteria:**
- On reconnect the client emits `auction:join` and immediately receives `auction:state` with the **current** high bid and end time.
- No phantom bids, no stale timer.

### A6. Server crash recovery

1. With an active auction running, kill `apps/realtime` (Ctrl-C).
2. Restart it.

**Pass criteria:**
- The auction-close worker reschedules pending close jobs based on `auctions.end_at`.
- Bids placed via the web API still commit (web doesn't depend on realtime for writes).
- Connected browsers reconnect and rejoin rooms.

## B. Scripted concurrency probe (faster than two tabs)

Use the snippet below as a starter. Save as `scripts/probe-pack-drop.ts` and run with `tsx`.

```ts
import { setTimeout as wait } from 'node:timers/promises';

// Fires N concurrent pack-purchase requests at the same drop.
async function buy(token: string, dropId: string, idemKey: string) {
  const res = await fetch(`http://localhost:3000/api/drops/${dropId}/purchase`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ dropId, idempotencyKey: idemKey }),
  });
  return { status: res.status, body: await res.json() };
}

const DROP_ID = process.env.DROP_ID!;
const TOKENS = (process.env.TOKENS ?? '').split(',').filter(Boolean);

const results = await Promise.all(
  TOKENS.map((t, i) => buy(t, DROP_ID, `probe-${Date.now()}-${i}`)),
);
const success = results.filter((r) => r.status === 200).length;
const sold = results.filter((r) => r.body?.error?.code === 'SOLD_OUT').length;
console.log({ success, sold, total: results.length });
// Expect: success === inventory, sold === total - inventory.
await wait(0);
```

Then verify with SQL:

```sql
SELECT remaining_inventory FROM pack_drops WHERE id = :dropId;        -- 0
SELECT count(*) FROM pack_purchases WHERE drop_id = :dropId;          -- = inventory
SELECT count(*) FROM pack_purchase_cards p
  JOIN pack_purchases pp ON pp.id = p.purchase_id
  WHERE pp.drop_id = :dropId;                                         -- = inventory * cards_per_pack
```

## C. Invariants to verify after every probe

Run these queries against Postgres and assert they all return `true` / 0 rows:

```sql
-- 1. No negative balances.
SELECT id FROM profiles
 WHERE available_balance_usd < 0 OR held_balance_usd < 0;
-- expected: 0 rows

-- 2. held_balance reconciles to active holds.
SELECT p.id, p.held_balance_usd, COALESCE(SUM(h.amount_usd), 0) AS hold_sum
  FROM profiles p
  LEFT JOIN balance_holds h ON h.user_id = p.id AND h.status = 'held'
 GROUP BY p.id
HAVING p.held_balance_usd <> COALESCE(SUM(h.amount_usd), 0);
-- expected: 0 rows

-- 3. Ledger reconciles per user.
SELECT user_id,
       (SELECT available_balance_usd + held_balance_usd FROM profiles WHERE id = user_id) AS balance,
       SUM(amount_usd) AS ledger_sum
  FROM ledger_entries
 WHERE user_id IS NOT NULL
 GROUP BY user_id
HAVING SUM(amount_usd) <> (SELECT available_balance_usd + held_balance_usd FROM profiles WHERE id = user_id);
-- expected: 0 rows

-- 4. No double-listed cards.
SELECT user_card_id, COUNT(*) FROM listings WHERE status = 'active' GROUP BY 1 HAVING COUNT(*) > 1;
-- expected: 0 rows

-- 5. No card simultaneously listed AND in auction.
SELECT uc.id FROM user_cards uc
 WHERE EXISTS (SELECT 1 FROM listings l WHERE l.user_card_id = uc.id AND l.status = 'active')
   AND EXISTS (SELECT 1 FROM auctions a WHERE a.user_card_id = uc.id
               AND a.status IN ('scheduled','live','extended','settling'));
-- expected: 0 rows
```

If any returns rows, **stop and find the bug before continuing**. These are the invariants the reviewers will check.

## D. UI smoke test

After backend tests pass:

- [ ] Sign up → see balance ($500 default).
- [ ] Browse drops → countdown ticks toward zero.
- [ ] Buy at drop time → reveal page renders cards one by one with rarity + price.
- [ ] Portfolio shows pulled cards with live `marketPrice`.
- [ ] List a card → it appears in `/marketplace`.
- [ ] Buy a listing in another tab → portfolio updates without manual refresh.
- [ ] Start an auction → bid in another tab → both tabs see the new high bid live.
- [ ] Bid in last 30s → end time extends in both tabs.
- [ ] After settlement, card moves to winner; ledger reconciles.

## E. After every test session

```bash
pnpm typecheck    # no TS errors
pnpm lint         # no lint errors
```

Update `architecture.md` if you discovered a new edge case worth documenting, and the README's "Scope Cuts" if you decided to defer something.
