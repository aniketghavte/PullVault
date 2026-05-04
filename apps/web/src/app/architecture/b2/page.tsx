import type { Metadata } from 'next';

import { DocArticle, DocCallout } from '@/components/architecture/DocArticle';

export const metadata: Metadata = {
  title: 'B2 · Anti-bot & rate limiting',
  description:
    'Three-layer defense: Redis Lua sliding windows, BullMQ fairness jitter for pack purchases, and behavioral scoring without silent bans.',
};

export default function ArchitectureB2Page() {
  return (
    <DocArticle
      title="B2 — Anti-bot & rate limiting"
      subtitle="Hard limits stop abuse at the edge; a fairness queue removes millisecond timing advantages on drops; soft signals feed review queues — not automatic blocks on the hot path."
    >
      <section>
        <h2>Why three layers?</h2>
        <p>
          Pack drops are the highest contention surface. Bots win by speed and retry spam. B2 separates{' '}
          <strong>atomic enforcement</strong> (must be correct under concurrency) from{' '}
          <strong>fair ordering</strong> (remove pure latency advantage) from{' '}
          <strong>detection</strong> (pattern scoring for humans to review).
        </p>
      </section>

      <section>
        <h2>Layer 1 — Sliding window (Redis Lua)</h2>
        <p>
          <code>packages/shared/src/rate-limiter.ts</code> runs one Lua script per check: trim expired
          entries from a sorted set, count current window, optionally add this request. That sequence is
          atomic — two parallel requests cannot both pass when only one slot remains.
        </p>
        <p>
          Typical usage: per-user and per-IP windows on <code>POST /api/drops/[dropId]/purchase</code>, bids,
          and listing buys. On block, the API returns 429 with <code>Retry-After</code> and{' '}
          <code>X-RateLimit-*</code> headers and appends a row to <code>rate_limit_events</code> for B5 fraud
          dashboards.
        </p>
      </section>

      <section>
        <h2>Layer 2 — Fairness queue (BullMQ)</h2>
        <p>
          The purchase route does not run the DB transaction inline. It enqueues a job whose delay is{' '}
          <strong>random 0–2000 ms</strong>. The realtime worker in{' '}
          <code>apps/realtime/src/queues/pack-purchase.ts</code> invokes{' '}
          <code>POST /api/internal/packs/purchase</code> with <code>x-realtime-token</code>, which calls the
          same <code>purchasePack</code> service as before.
        </p>
        <p>
          The browser receives a <code>jobId</code> and polls{' '}
          <code>/api/drops/purchase-status/[jobId]</code> until the transaction completes or fails. Jobs use a
          single attempt to avoid duplicate side effects; idempotency keys still dedupe at the database.
        </p>
      </section>

      <section>
        <h2>Layer 3 — Behavioral signals</h2>
        <p>
          Fire-and-forget hooks record signals like very fast click-to-buy, repeated sold-out attempts, and
          velocity across drops. Rows land in <code>bot_signals</code>; upserts into{' '}
          <code>suspicious_accounts</code> accumulate <code>bot_score</code>. High scores flag accounts for
          review in admin UI — they do <strong>not</strong> silently block checkout on the default path.
        </p>
      </section>

      <section>
        <h2>Data flow (happy path)</h2>
        <ol>
          <li>Browser POST purchase with idempotency key and optional B4 <code>clientSeed</code>.</li>
          <li>Web: rate limit passes → bot checks enqueue → BullMQ job scheduled.</li>
          <li>Worker wakes after jitter → internal web route → single Postgres txn (inventory, balance, cards, ledger).</li>
          <li>Response path: job result → client poll → UI continues to reveal flow.</li>
        </ol>
      </section>

      <section>
        <h2>Files to read</h2>
        <ul>
          <li>
            <code>packages/shared/src/rate-limiter.ts</code>, <code>purchase-queue.ts</code>,{' '}
            <code>constants.ts</code> (<code>RATE_LIMITS</code>)
          </li>
          <li>
            <code>apps/web/src/app/api/drops/[dropId]/purchase/route.ts</code>
          </li>
          <li>
            <code>apps/web/src/app/api/internal/packs/purchase/route.ts</code>
          </li>
          <li>
            <code>apps/web/src/services/bot-detection.ts</code>
          </li>
          <li>
            <code>apps/realtime/src/queues/pack-purchase.ts</code>
          </li>
          <li>
            <code>packages/db/migrations/0002_flowery_darkhawk.sql</code>
          </li>
        </ul>
      </section>

      <DocCallout title="Security posture">
        Rate limits and queue secrets must be tuned per environment. Internal purchase callbacks must never be
        exposed without the shared realtime token.
      </DocCallout>
    </DocArticle>
  );
}
