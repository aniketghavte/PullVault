# Services

Domain logic, framework-free where possible. Each file is one slice:

- `pack-purchase.ts` — atomic decrement + draw + grant
- `pack-reveal.ts` — open sealed pack -> grant cards
- `listings.ts` — create / cancel / buy listing (atomic trade)
- `auctions.ts` — create / settle auction
- `bids.ts` — bid placement + anti-snipe + hold lifecycle
- `pricing.ts` — TCGPlayer / Pokemon TCG fetchers + price walk simulator
- `economics.ts` — EV calculator, ledger aggregation
- `portfolio.ts` — owned-cards aggregation with live prices

All write operations MUST run inside `db.transaction(...)` and must
publish a Redis pub/sub event AFTER the commit (never inside).
