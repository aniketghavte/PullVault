import { eq, sql } from 'drizzle-orm';

import { handler } from '@/lib/api';
import { requireUserId } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { PACK_ECONOMICS } from '@pullvault/shared/constants';
import {
  computePackEV,
  solveRarityWeights,
  type RarityAvgPriceMap,
  type RarityPriceSamples,
} from '@pullvault/shared/pack-economics';

type RebalanceAction = 'none' | 'rebalanced' | 'solve_failed';

type RebalanceResult = {
  tierCode: string;
  action: RebalanceAction;
  previousMarginPct: string;
  newMarginPct?: string;
  reason?: string;
  warnings?: Array<{ code: string; message: string }>;
};

type CardPriceRow = { rarity: string; market_price_usd: string };

async function loadPriceContext(): Promise<{
  avgByRarity: RarityAvgPriceMap;
  samplesByRarity: RarityPriceSamples;
}> {
  const rows = (await db.execute<CardPriceRow>(sql`
    SELECT rarity::text AS rarity, market_price_usd::text AS market_price_usd
    FROM ${schema.cards}
  `)) as unknown as CardPriceRow[];

  const samplesByRarity: Record<string, number[]> = {};
  const countByRarity: Record<string, number> = {};
  const totalSum: Record<string, number> = {};

  for (const row of rows) {
    const p = Number(row.market_price_usd);
    if (!Number.isFinite(p)) continue;
    (samplesByRarity[row.rarity] ??= []).push(p);
    countByRarity[row.rarity] = (countByRarity[row.rarity] ?? 0) + 1;
    totalSum[row.rarity] = (totalSum[row.rarity] ?? 0) + p;
  }

  const avgByRarity: RarityAvgPriceMap = {};
  for (const rarity of Object.keys(samplesByRarity)) {
    const count = countByRarity[rarity] ?? 0;
    avgByRarity[rarity] = count > 0 ? (totalSum[rarity] ?? 0) / count : 0;
  }

  return { avgByRarity, samplesByRarity };
}

async function runRebalanceNow(): Promise<RebalanceResult[]> {
  const prices = await loadPriceContext();
  const tiers = await db
    .select({
      id: schema.packTiers.id,
      code: schema.packTiers.code,
      priceUsd: schema.packTiers.priceUsd,
      cardsPerPack: schema.packTiers.cardsPerPack,
      rarityWeights: schema.packTiers.rarityWeights,
    })
    .from(schema.packTiers)
    .where(eq(schema.packTiers.active, true));

  const results: RebalanceResult[] = [];

  for (const tier of tiers) {
    const currentWeights = (tier.rarityWeights ?? {}) as Record<string, number>;
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
    if (!belowFloor && !aboveCeiling) {
      results.push({ tierCode: tier.code, action: 'none', previousMarginPct: currentEv.marginPct });
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

    const blocked = (solved.warnings ?? []).some(
      (w) => w.code === 'WIN_RATE_UNACHIEVABLE' || w.code === 'WIN_RATE_MARGIN_CONFLICT',
    );

    if (blocked || solved.reason === 'win_rate_unachievable' || solved.reason === 'win_rate_margin_conflict') {
      results.push({
        tierCode: tier.code,
        action: 'solve_failed',
        previousMarginPct: currentEv.marginPct,
        reason: solved.reason,
        warnings: solved.warnings,
      });
      continue;
    }

    const reason = belowFloor ? 'margin_too_low' : 'margin_too_high';
    await db
      .update(schema.packTiers)
      .set({
        rarityWeights: solved.weights,
        rebalancedAt: new Date(),
        rebalancedReason: reason,
        previousWeights: {
          weights: currentWeights,
          marginPct: currentEv.marginPct,
          newMarginPct: solved.marginPct,
        },
      })
      .where(eq(schema.packTiers.id, tier.id));

    results.push({
      tierCode: tier.code,
      action: 'rebalanced',
      previousMarginPct: currentEv.marginPct,
      newMarginPct: solved.marginPct,
      reason,
    });
  }

  return results;
}

// POST /api/admin/b1-lab/trigger-rebalance
// Demo helper: force-run the same rebalance logic without waiting for queue timing.
export const POST = handler(async () => {
  await requireUserId();
  const results = await runRebalanceNow();
  return { results, ranAt: new Date().toISOString() };
});
