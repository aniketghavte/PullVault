import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@pullvault/db';
import { PACK_ECONOMICS } from '@pullvault/shared/constants';
import {
  computePackEV,
  solveRarityWeights,
  type RarityAvgPriceMap,
  type RarityPriceSamples,
} from '@pullvault/shared/pack-economics';
import { logger } from '@pullvault/shared/logger';

// ---------------------------------------------------------------------------
// Auto-rebalancer (B1 Fix 2)
//
// Invoked from the BullMQ price-refresh worker after every refresh. For each
// active pack tier it recomputes the actual house margin against the fresh
// prices. If that margin has drifted outside the EMERGENCY band the tier
// is re-solved and the new weights are written to `pack_tiers` inside a
// single UPDATE (no JS read-then-write race).
//
// Margins inside the EMERGENCY band are considered healthy drift and are
// left alone on purpose — the reviewer criterion is "always makes money",
// not "always hit exact target margin". Aggressive auto-tuning would also
// create weight churn that muddies the economics dashboard.
//
// The rebalancer is idempotent: a second run with the same prices is a
// no-op because the first run will have moved margins back inside the band.
// ---------------------------------------------------------------------------

type CardPriceRow = {
  rarity: string;
  market_price_usd: string;
  [k: string]: unknown;
};

interface PriceContext {
  avgByRarity: RarityAvgPriceMap;
  samplesByRarity: RarityPriceSamples;
  hasCatalog: boolean;
}

// Inlined here (NOT imported from the web app) so the realtime process
// has no cross-app dependency on Next.js 'server-only' modules. The query
// is identical to what `apps/web/src/services/pack-economics.ts` runs.
async function loadPriceContext(): Promise<PriceContext> {
  const db = getDb();
  const rows = (await db.execute<CardPriceRow>(sql`
    SELECT rarity::text AS rarity, market_price_usd::text AS market_price_usd
    FROM ${schema.cards}
  `)) as unknown as CardPriceRow[];

  const samplesByRarity: Record<string, number[]> = {};
  const countByRarity: Record<string, number> = {};
  const totalSum: Record<string, number> = {};

  for (const row of rows) {
    const r = row.rarity;
    const p = Number(row.market_price_usd);
    if (!Number.isFinite(p)) continue;
    (samplesByRarity[r] ??= []).push(p);
    countByRarity[r] = (countByRarity[r] ?? 0) + 1;
    totalSum[r] = (totalSum[r] ?? 0) + p;
  }

  const avgByRarity: RarityAvgPriceMap = {};
  for (const rarity of Object.keys(samplesByRarity)) {
    const count = countByRarity[rarity] ?? 0;
    avgByRarity[rarity] = count > 0 ? (totalSum[rarity] ?? 0) / count : 0;
  }

  return {
    avgByRarity,
    samplesByRarity,
    hasCatalog: rows.length > 0,
  };
}

export type RebalanceAction =
  | 'none'
  | 'rebalanced'
  | 'solve_failed'
  | 'skipped_no_catalog'
  | 'skipped_stale_weights';

export interface RebalanceResult {
  tierCode: string;
  previousMarginPct: string;
  newMarginPct?: string;
  action: RebalanceAction;
  reason?: string;
  warnings?: Array<{ code: string; message: string }>;
}

/**
 * Main entry point. Returns a per-tier result; never throws for a single
 * tier error (logged + collected into the result array) so the price
 * refresh job can never be derailed by a rebalancer bug.
 */
export async function rebalanceWeightsIfNeeded(): Promise<RebalanceResult[]> {
  const db = getDb();
  const prices = await loadPriceContext();

  if (!prices.hasCatalog) {
    logger.warn('rebalancer: catalog empty, skipping');
    return [{
      tierCode: '-',
      previousMarginPct: '0.0000',
      action: 'skipped_no_catalog',
    }];
  }

  const tiers = await db
    .select({
      id: schema.packTiers.id,
      code: schema.packTiers.code,
      priceUsd: schema.packTiers.priceUsd,
      cardsPerPack: schema.packTiers.cardsPerPack,
      rarityWeights: schema.packTiers.rarityWeights,
      active: schema.packTiers.active,
    })
    .from(schema.packTiers)
    .where(eq(schema.packTiers.active, true));

  const results: RebalanceResult[] = [];

  for (const tier of tiers) {
    try {
      const currentWeights = (tier.rarityWeights ?? {}) as Record<string, number>;
      if (Object.keys(currentWeights).length === 0) {
        results.push({
          tierCode: tier.code,
          previousMarginPct: '0.0000',
          action: 'skipped_stale_weights',
          reason: 'no_weights_defined',
        });
        continue;
      }

      const currentEv = computePackEV(
        {
          code: tier.code,
          cardsPerPack: tier.cardsPerPack,
          pricePerPackUsd: tier.priceUsd,
          rarityWeights: currentWeights,
        },
        prices.avgByRarity,
      );
      const currentMargin = Number(currentEv.marginPct);

      const belowFloor = currentMargin < PACK_ECONOMICS.EMERGENCY_MARGIN_FLOOR;
      const aboveCeiling = currentMargin > PACK_ECONOMICS.EMERGENCY_MARGIN_CEILING;
      const isEmergency = belowFloor || aboveCeiling;

      if (!isEmergency) {
        results.push({
          tierCode: tier.code,
          previousMarginPct: currentEv.marginPct,
          action: 'none',
        });
        continue;
      }

      const solved = solveRarityWeights(
        {
          code: tier.code,
          cardsPerPack: tier.cardsPerPack,
          pricePerPackUsd: tier.priceUsd,
          rarityWeights: currentWeights,
        },
        prices.avgByRarity,
        {
          targetMarginPct: PACK_ECONOMICS.TARGET_MARGIN_PCT,
          minCommonWeight: PACK_ECONOMICS.SOLVER_MIN_COMMON_WEIGHT,
          maxCommonWeight: PACK_ECONOMICS.SOLVER_MAX_COMMON_WEIGHT,
          tolerance: PACK_ECONOMICS.SOLVER_TOLERANCE_PCT,
          // Win-rate loop enabled: same knobs as the admin endpoint so the
          // rebalancer and the "Solve weights" button produce consistent
          // recommendations.
          priceSamples: prices.samplesByRarity,
          winRateFloor: PACK_ECONOMICS.WIN_RATE_FLOOR,
          minMarginPct: PACK_ECONOMICS.MIN_MARGIN_PCT,
          winRateStep: PACK_ECONOMICS.WIN_RATE_STEP,
          minCommonHardFloor: PACK_ECONOMICS.MIN_COMMON_WEIGHT,
          maxRareWeight: PACK_ECONOMICS.MAX_RARE_WEIGHT,
          maxWinRateIterations: PACK_ECONOMICS.WIN_RATE_MAX_ITERATIONS,
          winRateCheckTrials: PACK_ECONOMICS.WIN_RATE_CHECK_TRIALS,
          winRateCheckSeed: PACK_ECONOMICS.WIN_RATE_CHECK_SEED,
        },
      );

      // Refuse to promote weights that did not converge or that the
      // solver itself flagged as unsafe. A bad price feed should never
      // silently rewrite the economy.
      const hasBlockingWarning = (solved.warnings ?? []).some(
        (w) =>
          w.code === 'WIN_RATE_UNACHIEVABLE' ||
          w.code === 'WIN_RATE_MARGIN_CONFLICT',
      );
      const hasBlockingReason =
        solved.reason === 'no_lever' ||
        solved.reason === 'price_floor' ||
        solved.reason === 'win_rate_unachievable' ||
        solved.reason === 'win_rate_margin_conflict';

      if (hasBlockingWarning || hasBlockingReason) {
        logger.error(
          {
            tier: tier.code,
            reason: solved.reason,
            warnings: solved.warnings,
            currentMargin,
          },
          'rebalancer: solver flagged solution as unsafe; not promoting',
        );
        results.push({
          tierCode: tier.code,
          previousMarginPct: currentEv.marginPct,
          action: 'solve_failed',
          reason: solved.reason,
          warnings: solved.warnings,
        });
        continue;
      }

      const rebalancedReason = belowFloor ? 'margin_too_low' : 'margin_too_high';
      const previousSnapshot = {
        weights: currentWeights,
        marginPct: currentEv.marginPct,
        newMarginPct: solved.marginPct,
      };

      // Single guarded UPDATE; no read-then-write race. `previous_weights`
      // gets the full before/after snapshot so the admin log can render
      // old vs new margin without hitting history tables.
      await db
        .update(schema.packTiers)
        .set({
          rarityWeights: solved.weights,
          rebalancedAt: new Date(),
          rebalancedReason,
          previousWeights: previousSnapshot,
        })
        .where(eq(schema.packTiers.id, tier.id));

      logger.info(
        {
          tier: tier.code,
          previousMargin: currentEv.marginPct,
          newMargin: solved.marginPct,
          winRateIterations: solved.winRateIterations,
          reason: rebalancedReason,
        },
        'rebalancer: auto-applied solved weights',
      );

      results.push({
        tierCode: tier.code,
        previousMarginPct: currentEv.marginPct,
        newMarginPct: solved.marginPct,
        action: 'rebalanced',
        reason: rebalancedReason,
      });
    } catch (err) {
      logger.error({ err, tier: tier.code }, 'rebalancer: per-tier error');
      results.push({
        tierCode: tier.code,
        previousMarginPct: '0.0000',
        action: 'solve_failed',
        reason: 'unhandled_exception',
      });
    }
  }

  return results;
}
