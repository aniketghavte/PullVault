# Part B Updates

## B1 - Pack Economics Algorithm

**Goal:** Build a math-based algorithm that automatically adjusts rarity weights so the platform remains profitable even when card prices change.

### What to Build
- Standalone module: `packages/shared/src/pack-economics.ts`
- Input: current card prices
- Output: adjusted rarity weights
- Approach: constrained optimization

### Constraints and Targets
- **Target margin:** `15%`
  - Justification: low enough to keep user value perception, high enough to absorb price volatility.
- **Win rate floor:** `30%`
  - Justification: below this users churn; above `40%` house margin is at risk.
- **Constraint:** no tier can become negative EV for the platform.

### Core Formulas
```text
EV(pack) = cardCount × Σ(weight_r × avgPrice_r)
margin = (packPrice - EV) / packPrice
```

### Weight Solving Strategy
- Solve backward from target margin.
- Adjust rare/ultra weights until EV converges to target.
- Use commons as the balancing lever:
  - more commons -> lower EV -> higher margin.

### Simulation Endpoint
- `POST /api/admin/simulate-packs`
- Simulates `10,000` virtual openings using:
  - current weights
  - real card prices
- Returns:
  - win rate
  - average EV
  - margin distribution
  - projected P&L

### Edge Case to Handle
- **Card price spikes mid-drop**
  - Pack contents are sealed at purchase time using weights from that moment.
  - Existing `pack_purchase_cards` data preserves this snapshot.
  - Price changes only impact future purchases.

---

## B2 - Anti-Bot Rate Limiting

### What to Build
Implement a 3-layer anti-bot system in Redis.

### Layer 1 - Sliding Window Limiter (Atomic)
- Endpoint: purchase API
- Data structure: Redis sorted set (not a naive counter)
- Key format: `ratelimit:purchase:{userId}`
- Sorted set fields:
  - score: `timestamp`
  - value: `request_id`
- On each request:
  1. add current timestamp
  2. remove entries older than `60s`
  3. count remaining entries
  4. reject if count exceeds limit (`3 purchases / 60s`)
- Must run in a Lua script for atomicity and concurrency safety.

### Layer 2 - Purchase Fairness Queue
- Requirement: fastest HTTP client should not win by default.
- Queue incoming purchase requests via Redis/BullMQ delayed jobs.
- Apply random jitter delay per user: `0-2s`.
- Effect: millisecond bot bursts lose timing advantage.

### Layer 3 - Behavioral Signals
Track in Redis:
- time from page load to purchase click (`<200ms` is bot-like),
- whether user has ever revealed a pack,
- purchase velocity across drops.

### Actions and Data Storage
- Flag high bot-score accounts into `suspicious_accounts` for manual review.
- Do **not** block by default.
- Auto-block only if account hits `5x` the rate limit in one hour.
- Add table:
  - `rate_limit_events(user_id, ip, endpoint, action, created_at)`
- This table powers fraud metrics in B5.

---

## B3 - Auction Integrity

### What to Build

### Sniping Prevention (Sealed-Bid Phase)
- In final `60s`, when `extension_count >= 3`, switch auction to **sealed**.
- In sealed phase:
  - accept bids,
  - do not broadcast high bid publicly.
- At close, highest bid wins.
- Goal: prevent bots from knowing the exact amount to beat.

### Auction Status Flow
`live -> extended -> sealed -> settling -> settled`

Frontend behavior in sealed state:
- show: `"Sealed bidding active"`
- hide current high bid.

### Bid Validation Rules
- Max bid: `10x` current market price (fat-finger protection)
- Min interval between bids from same user: `5s`
- Enforce self-bidding prevention (`seller_id != bidder_id`)

### Wash-Trade Detection Job
- Run background job hourly (BullMQ)
- Flag patterns:
```sql
-- same two users traded same card more than once in 7 days
-- auction closed with 0 competing bidders at < 50% market value
-- user sold to and bought from same account in 30 days
```
- Persist flagged results to:
  - `flagged_activity(type, reference_id, reason, severity, reviewed)`

### Auction Analytics (Admin)
Add dashboard section with:
- avg final price / market value ratio
- snipe rate (`%` auctions with extensions)
- flag rate
- participation rate

---

## B4 - Provably Fair Pack Openings

This is the most technically distinct area and must be cryptographically verifiable.

### Purchase-Time Flow
1. Generate random `server_seed` (32 bytes, `crypto.randomBytes`).
2. Store `server_seed_hash = SHA256(server_seed)` in `pack_purchases`.
3. Show `server_seed_hash` to user immediately.
4. Generate each card draw entropy using:
   - `HMAC-SHA256(server_seed, user_id + purchase_id + position)`
5. Store real `server_seed` encrypted; reveal only after opening.

### Reveal-Time Flow
1. Expose `server_seed` to user.
2. User verifies:
   - `SHA256(server_seed) === server_seed_hash`
3. User recomputes card draws via same HMAC formula and compares output.

### Verification Page
- Route: `/verify/[purchaseId]`
- Runs entirely in browser (Web Crypto API).
- Inputs:
  - `server_seed`
  - `purchase_id`
  - `user_id`
- Recomputes card draws and compares to actual pack result.
- No server call needed after page load.

### Schema Changes
Add columns on `pack_purchases`:
- `server_seed_hash` (shown at purchase)
- `server_seed` (revealed after opening)
- `client_seed` (optional user-provided seed)

### Public Audit Log
- Endpoint: `GET /api/audit/packs`
- Aggregates actual rarity distribution vs advertised weights.
- Runs chi-squared test.
- Reports whether observed distribution is within expected tolerance.

---

## B5 - Extended Health Dashboard

Extend `/admin/economics` with 4 sections.

### 1) Fraud Metrics
- rate limit hits per hour
- flagged accounts count
- bot score distribution
- purchases blocked

### 2) Economic Health
- rolling 24h margin per tier (opened-pack EV vs pack price)
- alert if any tier margin drops below `10%`
- alert UI: red banner (query on page load; no real-time required)

### 3) Fairness Audit
- chi-squared test over last `1,000` pack openings
- display p-value and pass/fail:
  - pass condition: `p > 0.05`
- show number of users who used verification page

### 4) User Health
- daily drop engagement (`buyers / total inventory`)
- auction participation rate (`unique bidders / auctions`)
- D7 retention proxy (users who bought and returned within 7 days)