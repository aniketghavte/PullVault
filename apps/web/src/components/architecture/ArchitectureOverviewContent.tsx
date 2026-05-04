import Link from 'next/link';

import { DocCallout } from '@/components/architecture/DocArticle';

export function ArchitectureOverviewContent() {
  return (
    <>
      <section id="shape">
        <h2>1. System shape</h2>
        <p>
          PullVault is a <strong>TypeScript monorepo</strong> with two long-running application processes:
          <strong> apps/web</strong> (Next.js with REST API routes and all money writes) and{' '}
          <strong>apps/realtime</strong> (Express + Socket.io + BullMQ workers for delayed jobs, pub/sub
          fan-out, and background integrity jobs).
        </p>
        <pre>{`┌─────────────────────────────────────────────────────────────┐
│  Browser (React, TanStack Query, socket.io-client)         │
└──────┬──────────────────────────────────────┬──────────────┘
       │ HTTPS (REST)                         │ WSS
┌──────▼──────────────────┐    ┌───────────▼────────────────┐
│  apps/web (Next.js)       │    │  apps/realtime (Express)   │
│  · API routes, DB txns    │───▶│  · Socket.io               │
│  · Idempotency keys       │    │  · BullMQ (close, refresh,  │
│                           │    │    pack queue, wash-trade) │
└──────┬────────────────────┘    └───────────┬────────────────┘
       │                                     │
       └──────────────┬──────────────────────┘
                      ▼
        ┌─────────────────────────────┐
        │  Supabase Postgres (truth)  │
        └─────────────────────────────┘
                      ▲
                      │  Upstash Redis: pub/sub, BullMQ, caches
`}</pre>
        <h3>Why two processes?</h3>
        <ul>
          <li>
            <strong>Next.js</strong> — stateless HTTP, great for auth, catalog, and co-located UI.
          </li>
          <li>
            <strong>Express + Socket.io</strong> — long-lived WebSockets do not run well on typical
            serverless; a dedicated Node process holds auction rooms and scheduled work.
          </li>
          <li>
            <strong>BullMQ in realtime</strong> — auction close at <code>end_at</code>, price refresh,
            B1 auto-rebalance after prices, B2 pack-purchase fairness delay, B3 hourly wash-trade
            detection.
          </li>
        </ul>
      </section>

      <section id="stack">
        <h2>2. Core technology choices</h2>
        <ul>
          <li>
            <strong>Supabase + Drizzle</strong> — Auth and JWTs; the app&apos;s system of record is
            plain Postgres. Realtime product events use Socket.io, not Supabase Realtime.
          </li>
          <li>
            <strong>Upstash Redis</strong> — pub/sub (web → realtime), BullMQ queues, and read-through
            caches (e.g. card prices).
          </li>
          <li>
            <strong>decimal.js</strong> — money is never a JS <code>number</code>; values are
            2-decimal strings end-to-end.
          </li>
        </ul>
      </section>

      <section id="repo">
        <h2>3. Repository layout (high level)</h2>
        <pre>{`pullvault/
├── apps/web/          Next.js App Router, REST APIs, admin UI, verify page
├── apps/realtime/     Express, Socket.io, BullMQ workers & subscribers
├── packages/db/       Drizzle schema + migrations 0000–0004
└── packages/shared/   Types, zod, money, rate-limiter, pack-economics,
                       provably-fair, purchase-queue, constants`}</pre>
        <DocCallout title="pnpm workspace">
          Packages are consumed as TypeScript source (<code>transpilePackages</code> in Next). No separate
          build step required for local cross-package imports during development.
        </DocCallout>
      </section>

      <section id="schema">
        <h2>4. Database: what matters</h2>
        <p>
          Full schema lives in <code>packages/db/src/schema.ts</code>. Financial correctness relies on:
        </p>
        <ul>
          <li>
            <code>profiles</code> — <code>available_balance_usd</code> + <code>held_balance_usd</code>{' '}
            (auction holds).
          </li>
          <li>
            <code>pack_drops</code> — <code>remaining_inventory</code> is the hot path for concurrent
            purchases; atomic <code>UPDATE … WHERE remaining &gt; 0 RETURNING</code> prevents oversell.
          </li>
          <li>
            <code>pack_purchases</code> + <code>pack_purchase_cards</code> — sealed contents at purchase;
            B4 adds seed commitment columns and <code>draw_index</code>.
          </li>
          <li>
            <code>ledger_entries</code> — double-entry truth for revenue and fees; economics dashboards read
            here.
          </li>
          <li>
            <strong>B2 tables:</strong> <code>bot_signals</code>, <code>suspicious_accounts</code>,{' '}
            <code>rate_limit_events</code>.
          </li>
          <li>
            <strong>B3:</strong> <code>flagged_activity</code>; <code>auction_status</code> includes{' '}
            <code>sealed</code>.
          </li>
        </ul>
        <h3>Migrations (Drizzle)</h3>
        <table>
          <thead>
            <tr>
              <th>Migration</th>
              <th>Purpose</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>0001_amazing_namor</code>
              </td>
              <td>B1 — rebalance audit columns on pack_tiers</td>
            </tr>
            <tr>
              <td>
                <code>0002_flowery_darkhawk</code>
              </td>
              <td>B2 — bot signals, suspicious accounts, rate limit events</td>
            </tr>
            <tr>
              <td>
                <code>0003_easy_random</code>
              </td>
              <td>B3 — flagged_activity + sealed enum</td>
            </tr>
            <tr>
              <td>
                <code>0004_lumpy_terrax</code>
              </td>
              <td>B4 — provably fair columns + draw_index + legacy hash backfill</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section id="concurrency">
        <h2>5. Concurrency paths (P0)</h2>
        <h3>Pack purchase</h3>
        <p>
          One transaction: decrement drop inventory (guarded), debit balance (guarded), idempotent
          purchase row, draw cards (B4: deterministic HMAC draws), write ledger. After commit, web
          publishes to Redis; realtime broadcasts drop inventory to the room.
        </p>
        <h3>B2 fairness queue (before the txn)</h3>
        <p>
          The public purchase route runs Redis Lua rate limits, optional bot signals, then enqueues a
          BullMQ job with 0–2000 ms jitter. The realtime worker calls{' '}
          <code>/api/internal/packs/purchase</code> with a shared secret — that handler runs the same
          atomic transaction as above. The client polls job status until complete.
        </p>
        <h3>Listing buy</h3>
        <p>
          Lock listing and cards <code>FOR UPDATE</code>, verify active listing, move balances and
          ownership, write ledger — all in one commit.
        </p>
        <h3>Auction bid</h3>
        <p>
          Lock auction <code>FOR UPDATE</code>. B3 adds validation (no self-bid, max 10× market, min 5 s
          between own bids). Place hold on bidder; release previous high bidder; anti-snipe may extend{' '}
          <code>end_at</code>. B3 sealed phase: after enough extensions, final minute can switch status to{' '}
          <code>sealed</code> — high bid hidden on REST and sockets; optimistic &quot;expected high bid&quot;
          check is skipped while sealed because the client is intentionally blind.
        </p>
      </section>

      <section id="realtime">
        <h2>6. Realtime pipeline</h2>
        <p>
          After mutations, web publishes to Redis channels like <code>pv:auction:&lt;id&gt;:events</code>.
          Realtime subscribes and emits Socket.io events to rooms (<code>auction:&lt;id&gt;</code>,{' '}
          <code>drop:&lt;id&gt;</code>, <code>portfolio:&lt;userId&gt;</code>). If Redis drops a message,
          the next HTTP read still returns authoritative Postgres state.
        </p>
      </section>

      <section id="caching">
        <h2>7. Caching rule</h2>
        <p>
          <strong>Cache reads, never money writes.</strong> Balances and auction settlement inputs are read
          inside the same transaction that mutates them. Card prices may be cached in Redis with TTL;
          user balances are never cached for decisions.
        </p>
      </section>

      <section id="security">
        <h2>8. Security model (summary)</h2>
        <ul>
          <li>Server-side only service role for writes; RLS on user tables for defense in depth.</li>
          <li>Socket handshake validates JWT for private portfolio rooms.</li>
          <li>
            Internal callbacks (pack purchase from worker) require{' '}
            <code>x-realtime-token</code>.
          </li>
          <li>Mutations use idempotency keys where double-submit would hurt.</li>
          <li>Zod validates API boundaries.</li>
          <li>B4: users can verify pack outcomes in the browser without trusting server recomputation.</li>
        </ul>
      </section>

      <section id="part-b">
        <h2>9. Part B features (B1–B5)</h2>
        <p>
          These layers sit on top of the core platform. Each has a dedicated guide with file paths,
          data flow, and operational notes:
        </p>
        <div className="not-prose mt-6 grid gap-4 sm:grid-cols-2">
          {[
            {
              href: '/architecture/b1',
              title: 'B1 — Pack economics',
              desc: 'Solver, Monte Carlo simulation, auto-rebalance after price refresh.',
            },
            {
              href: '/architecture/b2',
              title: 'B2 — Anti-bot & rate limiting',
              desc: 'Lua sliding windows, fairness queue, behavioral signals.',
            },
            {
              href: '/architecture/b3',
              title: 'B3 — Auction integrity',
              desc: 'Sealed bidding, bid rules, wash-trade job, admin analytics.',
            },
            {
              href: '/architecture/b4',
              title: 'B4 — Provably fair packs',
              desc: 'Seed commitment, HMAC draws, verify page, public audit API.',
            },
            {
              href: '/architecture/b5',
              title: 'B5 — Platform health',
              desc: 'Admin dashboard: fraud, economics, fairness, user metrics.',
            },
          ].map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-lg border border-borderLight bg-canvas p-5 shadow-sm transition hover:border-coral/40 hover:shadow-md"
            >
              <div className="font-semibold text-caption text-ink group-hover:text-coral">{card.title}</div>
              <p className="mt-2 text-micro leading-relaxed text-slate">{card.desc}</p>
              <div className="mt-3 text-micro font-medium text-actionBlue">Read guide →</div>
            </Link>
          ))}
        </div>
      </section>

      <section id="admin">
        <h2>10. Admin & audit (B5)</h2>
        <p>
          <Link href="/admin/economics" className="font-medium text-actionBlue underline underline-offset-2">
            /admin/economics
          </Link>{' '}
          aggregates fraud metrics, rolling margins, chi-squared fairness (from the same data as{' '}
          <code>/api/audit/packs</code>), and user health — loaded in parallel with refresh timestamps per
          section.
        </p>
      </section>

      <section id="scope">
        <h2>11. Intentional scope limits</h2>
        <ul>
          <li>No Stripe — paper USD balance.</li>
          <li>Fixed-price listings only (no offers).</li>
          <li>Responsive web, not native apps.</li>
        </ul>
      </section>
    </>
  );
}
