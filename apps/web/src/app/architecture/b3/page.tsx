import type { Metadata } from 'next';

import { DocArticle, DocCallout } from '@/components/architecture/DocArticle';
import { MermaidDiagram } from '@/components/architecture/MermaidDiagram';

export const metadata: Metadata = {
  title: 'B3 · Auction integrity',
  description:
    'Sealed final-minute bidding, bid validation, hourly wash-trade detection, and admin analytics for auction health.',
};

export default function ArchitectureB3Page() {
  return (
    <DocArticle
      title="B3 — Auction integrity"
      subtitle="Reduce bot advantage in extended auctions, reject abusive bids inside the same transaction, detect suspicious trade patterns offline, and surface metrics and flags to operators."
    >
      <section>
        <h2>1. Sealed-bid phase</h2>
        <p>
          When an auction has enough extensions and enters its final window, status can transition to{' '}
          <code>sealed</code>. Bids are still accepted and funds still held in the database, but{' '}
          <strong>reads</strong> hide the current high bid and redact bid amounts from recent activity on{' '}
          REST snapshots and Socket.io events — so late bots cannot calibrate to the exact amount to beat.
        </p>
        <p>
          Because the client no longer sees the real high bid id, optimistic concurrency based on
          &quot;expected high bid&quot; is skipped while sealed; serialization still comes from{' '}
          <code>SELECT … FOR UPDATE</code> on the auction row.
        </p>
      </section>

      <section>
        <h2>2. Bid validation (same transaction)</h2>
        <p>Before any balance hold:</p>
        <ul>
          <li>
            <strong>SELF_BID_FORBIDDEN</strong> — bidder cannot be the listing seller.
          </li>
          <li>
            <strong>BID_EXCEEDS_MAXIMUM</strong> — bid cannot exceed ~10× card market price (fat-finger guard).
          </li>
          <li>
            <strong>BID_TOO_FREQUENT</strong> — minimum spacing between the same user&apos;s bids on the same
            auction (e.g. 5 seconds).
          </li>
        </ul>
        <p>
          All enforced in <code>apps/web/src/services/auction-service.ts</code>; failures roll back with no
          hold and no pub/sub fan-out.
        </p>
      </section>

      <section>
        <h2>3. Wash-trade detection job</h2>
        <p>
          A repeatable BullMQ job runs hourly (<code>apps/realtime/src/queues/wash-trade.ts</code> +{' '}
          <code>jobs/wash-trade-detector.ts</code>). It evaluates listings and auction outcomes for patterns
          such as:
        </p>
        <ul>
          <li>Same two accounts flipping the same card repeatedly within a short window.</li>
          <li>Auctions settling far below market with almost no competitive bidding.</li>
          <li>Circular sales A→B→A on the same card within a month.</li>
        </ul>
        <p>
          Results insert into <code>flagged_activity</code> with dedupe on type + reference so reruns do not
          duplicate rows. Admins review via <code>/api/admin/flagged-activity</code>.
        </p>
      </section>

      <section>
        <h2>4. Admin analytics</h2>
        <p>
          <code>/api/admin/auction-analytics</code> aggregates auction health (e.g. price vs market, snipe
          rate, sealed usage). The economics page surfaces this beside ledger-driven economics and B5 health
          panels.
        </p>
      </section>

      <section>
        <h2>Sequence diagram</h2>
        <MermaidDiagram chart={`sequenceDiagram
  autonumber
  participant Bidder as Bidder UI
  participant API as Auction bid API
  participant DB as Postgres txn (FOR UPDATE)
  participant Redis as Redis pub/sub
  participant RT as Realtime socket server
  participant Viewers as Watching clients
  participant WQ as Wash-trade queue
  participant WD as Wash-trade detector
  participant Admin as Admin API/UI

  Bidder->>API: POST /api/auctions/[auctionId]/bid
  API->>DB: lock auction row + validate + hold balance + insert bid
  alt Rejected (self-bid, max cap, too frequent)
    DB-->>API: rollback
    API-->>Bidder: 4xx validation error
  else Accepted
    DB-->>API: commit
    API->>Redis: publish auction event after commit
    Redis->>RT: event envelope
    RT-->>Viewers: socket broadcast (sealed-safe payload if needed)
  end

  WQ->>WD: hourly detection run
  WD->>DB: analyze listing/auction patterns
  WD->>DB: upsert flagged_activity (deduped)
  Admin->>API: GET /api/admin/auction-analytics + /flagged-activity
  API->>DB: aggregate metrics and pending flags
  API-->>Admin: health KPIs + review queue`} />
      </section>

      <section>
        <h2>Files to read</h2>
        <ul>
          <li>
            <code>apps/web/src/services/auction-service.ts</code>
          </li>
          <li>
            <code>apps/web/src/app/api/auctions/[auctionId]/bid/route.ts</code>,{' '}
            <code>…/auctions/[auctionId]/route.ts</code>
          </li>
          <li>
            <code>apps/realtime/src/sockets/auction.ts</code>, <code>subscribers/auctions.ts</code>
          </li>
          <li>
            <code>apps/realtime/src/jobs/wash-trade-detector.ts</code>
          </li>
          <li>
            <code>packages/db/migrations/0003_easy_random.sql</code>
          </li>
        </ul>
      </section>

      <DocCallout title="Realtime consistency">
        Sealed transitions publish internal events so all watchers flip UI state without waiting for another
        bid.
      </DocCallout>
    </DocArticle>
  );
}
