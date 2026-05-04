import type { Metadata } from 'next';

import { DocArticle, DocCallout } from '@/components/architecture/DocArticle';

export const metadata: Metadata = {
  title: 'B4 · Provably fair packs',
  description:
    'Commit–reveal server seeds, HMAC-SHA256 draws, client verification, and a public statistical audit API.',
};

export default function ArchitectureB4Page() {
  return (
    <DocArticle
      title="B4 — Provably fair pack openings"
      subtitle="Users can verify that rarity outcomes match a committed server seed and published algorithm — without trusting opaque server randomness."
    >
      <section>
        <h2>Commitment model</h2>
        <p>
          At purchase time the server generates a random <code>serverSeed</code>, stores{' '}
          <code>SHA256(serverSeed)</code> as <code>server_seed_hash</code> (always visible), and keeps the raw
          seed row-only until the pack is fully revealed. An optional <code>clientSeed</code> from the request
          (defaulting to <code>purchaseId</code>) mixes user-visible entropy into each draw message.
        </p>
      </section>

      <section>
        <h2>Deterministic draws</h2>
        <p>
          For each card index <code>i</code>, <code>packages/shared/src/provably-fair.ts</code> computes an
          HMAC-SHA256 over a canonical message, maps the digest to a uniform float in [0, 1), and walks the
          tier&apos;s rarity CDF in fixed rarity order. Selected cards are persisted with{' '}
          <code>draw_index</code> matching that index.
        </p>
        <p>
          The actual purchase transaction still runs atomically with inventory and balance updates — draws are
          not a second phase.
        </p>
      </section>

      <section>
        <h2>Reveal & API redaction</h2>
        <p>
          While cards remain unrevealed (&quot;sealed&quot; pack state), public APIs omit the raw{' '}
          <code>serverSeed</code>. After the last reveal action, the seed is copied to the durable exposure
          column so clients can verify. <code>GET /api/packs/[purchaseId]</code> always returns hash + client
          seed for transparency.
        </p>
      </section>

      <section>
        <h2>Verification page</h2>
        <p>
          Public route <code>/verify/&lt;purchaseId&gt;</code> loads data from{' '}
          <code>/api/packs/[purchaseId]/verify-data</code>, runs <code>verifyPurchase</code> entirely in the
          browser using Web Crypto, and can POST back to stamp <code>verified_at</code>. You can paste a real
          purchase id after opening a pack. Manual seed editing proves tampering fails the hash check.
        </p>
      </section>

      <section>
        <h2>Public audit API</h2>
        <p>
          <code>GET /api/audit/packs</code> aggregates recent opens, compares empirical rarity frequencies to
          expectations, and reports a chi-squared style fairness summary — usable by anyone without admin auth.
          B5&apos;s admin fairness panel reuses this endpoint.
        </p>
      </section>

      <section>
        <h2>Files to read</h2>
        <ul>
          <li>
            <code>packages/shared/src/provably-fair.ts</code>
          </li>
          <li>
            <code>apps/web/src/services/pack-purchase.ts</code>
          </li>
          <li>
            <code>apps/web/src/app/api/packs/[purchaseId]/reveal/route.ts</code>,{' '}
            <code>…/verify-data/route.ts</code>
          </li>
          <li>
            <code>apps/web/src/app/verify/[purchaseId]/page.tsx</code>
          </li>
          <li>
            <code>apps/web/src/app/api/audit/packs/route.ts</code>
          </li>
          <li>
            <code>packages/db/migrations/0004_lumpy_terrax.sql</code>
          </li>
        </ul>
      </section>

      <DocCallout title="Legacy purchases">
        Rows created before B4 received a placeholder hash during migration; those packs cannot be
        cryptographically verified like post-B4 purchases.
      </DocCallout>
    </DocArticle>
  );
}
