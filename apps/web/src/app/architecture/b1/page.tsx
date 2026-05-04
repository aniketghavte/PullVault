import type { Metadata } from 'next';

import { DocArticle, DocCallout } from '@/components/architecture/DocArticle';

export const metadata: Metadata = {
  title: 'B1 · Pack economics',
  description:
    'How PullVault targets margin and win rate with a rarity-weight solver, Monte Carlo simulation, and auto-rebalance after price refresh.',
};

export default function ArchitectureB1Page() {
  return (
    <DocArticle
      title="B1 — Pack economics algorithm"
      subtitle="Keep tiers profitable as card prices move: closed-form weight solving, Monte Carlo verification, and automated rebalancing wired to the price-refresh pipeline."
    >
      <section>
        <h2>Goal</h2>
        <p>
          When market prices drift, static rarity weights can destroy margin or player trust. B1 measures
          expected value (EV) per tier, solves new weights toward a target margin and win-rate band, proves
          outcomes with simulation, and can persist adjustments automatically when drift crosses guard
          rails.
        </p>
      </section>

      <section>
        <h2>End-to-end flow</h2>
        <ol>
          <li>
            <strong>Inputs</strong> — Live <code>cards.market_price_usd</code> bucketed by rarity; tier
            definitions in <code>pack_tiers</code> (price, cards per pack, JSON weights).
          </li>
          <li>
            <strong>Solver</strong> — <code>packages/shared/src/pack-economics.ts</code> adjusts non-common
            weights relative to common (single-parameter α), targeting <code>PACK_ECONOMICS</code> constants
            (e.g. 15% margin, win rate floor/ceiling).
          </li>
          <li>
            <strong>Simulation</strong> — Monte Carlo trials mirror production rarity rolls + uniform card
            pick within rarity; reports EV distribution, win rate, margin histogram.
          </li>
          <li>
            <strong>Admin APIs</strong> — <code>POST /api/admin/simulate-packs</code> and{' '}
            <code>POST /api/admin/solve-weights</code> expose this to operators; rebalance history via{' '}
            <code>/api/admin/rebalance-log</code>.
          </li>
          <li>
            <strong>Auto-rebalance</strong> — After BullMQ price refresh,{' '}
            <code>apps/realtime/src/jobs/rebalance.ts</code> recomputes margins; if a tier leaves safe
            bands, weights update atomically with audit columns on <code>pack_tiers</code> (
            <code>rebalanced_at</code>, <code>rebalanced_reason</code>, <code>previous_weights</code>).
          </li>
          <li>
            <strong>Purchase time</strong> — Existing purchases stay sealed; only future packs use new
            weights (per-row sealed contents in <code>pack_purchase_cards</code>).
          </li>
        </ol>
      </section>

      <section>
        <h2>Key formulas</h2>
        <pre>{`EV(card) = Σ_r weight_r × avgPrice_r
EV(pack) = cardsPerPack × EV(card)
margin   = (packPrice − EV(pack)) / packPrice`}</pre>
        <p>
          Win rate is the fraction of simulated packs whose total pull value exceeds pack price — tuned to
          stay between configured floor and ceiling.
        </p>
      </section>

      <section>
        <h2>Files to read</h2>
        <ul>
          <li>
            <code>packages/shared/src/pack-economics.ts</code> — pure math
          </li>
          <li>
            <code>packages/shared/src/constants.ts</code> — <code>PACK_ECONOMICS</code>
          </li>
          <li>
            <code>apps/web/src/services/pack-economics.ts</code> — DB-aware orchestration
          </li>
          <li>
            <code>apps/web/src/app/api/admin/simulate-packs/route.ts</code>,{' '}
            <code>solve-weights/route.ts</code>
          </li>
          <li>
            <code>apps/realtime/src/jobs/rebalance.ts</code> + hook from{' '}
            <code>apps/realtime/src/queues/price-refresh.ts</code>
          </li>
          <li>
            Migration <code>packages/db/migrations/0001_amazing_namor.sql</code>
          </li>
        </ul>
      </section>

      <DocCallout title="Operator note">
        Simulation and solver are safe to run anytime; promoting weights to production should remain a
        deliberate step so a bad price feed cannot silently rewrite the economy.
      </DocCallout>
    </DocArticle>
  );
}
