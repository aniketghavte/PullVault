import 'server-only';

import { eq, sql } from 'drizzle-orm';
import type { DB } from '@pullvault/db';
import { schema } from '@pullvault/db';

import { ApiError } from '@/lib/api';
import { ERROR_CODES } from '@pullvault/shared';
import {
  PACK_ECONOMICS,
  PACK_TIERS,
  type PackTierCode,
} from '@pullvault/shared/constants';
import {
  computePackEV,
  createSeededRng,
  monteCarloSimulate,
  solveRarityWeights,
  type PackTierEconomicsInput,
  type RarityAvgPriceMap,
  type RarityPriceSamples,
  type SimulationResult,
  type SolvedWeights,
} from '@pullvault/shared/pack-economics';
import { toMoneyString } from '@pullvault/shared/money';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SimulateInput {
  tierCode?: string;
  trials?: number;
  overrideWeights?: Record<string, number>;
  overridePricePerPackUsd?: string;
  seed?: number;
}

export interface SolveInput {
  tierCode: string;
  targetMarginPct?: number;
}

export interface PriceContext {
  /** Mean market price across the catalog, per rarity. */
  avgByRarity: RarityAvgPriceMap;
  /** Raw price arrays per rarity; used by the MC sampler. */
  samplesByRarity: RarityPriceSamples;
  /** Number of rows the catalog has per rarity (defaults coverage). */
  countByRarity: Record<string, number>;
  /** True if the catalog has at least one priced card. */
  hasCatalog: boolean;
}

export interface SimulateResponse {
  context: { generatedAt: string; catalogCardCount: number };
  results: SimulationResult[];
  /** Aggregate health summary (whichever tiers are out of spec). */
  warnings: Array<{ tierCode: string; severity: 'warn' | 'error'; message: string }>;
}

export interface SolveResponse {
  tierCode: string;
  current: {
    weights: Record<string, number>;
    evPerPackUsd: string;
    marginPct: string;
  };
  recommended: SolvedWeights;
  targets: {
    marginPct: number;
    minMarginPct: number;
    winRateFloor: number;
    winRateCeiling: number;
  };
  /** MC verification of the recommended weights using current prices. */
  verification: SimulationResult;
}

// ---------------------------------------------------------------------------
// Price context loader
// ---------------------------------------------------------------------------

type CardPriceRow = {
  rarity: string;
  market_price_usd: string;
  // drizzle's `db.execute<T>` constrains T to Record<string, unknown>;
  // adding an index signature keeps strict tsc happy without losing the
  // typed columns above.
  [k: string]: unknown;
};

/**
 * Pull every card's `(rarity, market_price_usd)` once and bucket them in
 * memory. The catalog is small (low thousands at most) so this is cheap;
 * the alternative - sending one query per rarity - hammers the connection
 * pool unnecessarily.
 */
export async function loadPriceContext(db: DB): Promise<PriceContext> {
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
    countByRarity,
    hasCatalog: rows.length > 0,
  };
}

// ---------------------------------------------------------------------------
// Tier loader
// ---------------------------------------------------------------------------

/**
 * Loads tiers from the DB, falling back to the static `PACK_TIERS` constant
 * if no rows exist (e.g. fresh dev DB before seeding). Mirrors the fallback
 * pattern in `/api/admin/economics`.
 */
export async function loadTiers(db: DB): Promise<PackTierEconomicsInput[]> {
  const rows = await db
    .select({
      code: schema.packTiers.code,
      priceUsd: schema.packTiers.priceUsd,
      cardsPerPack: schema.packTiers.cardsPerPack,
      rarityWeights: schema.packTiers.rarityWeights,
      active: schema.packTiers.active,
    })
    .from(schema.packTiers)
    .where(eq(schema.packTiers.active, true));

  if (rows.length > 0) {
    return rows.map((row) => ({
      code: row.code,
      cardsPerPack: row.cardsPerPack,
      pricePerPackUsd: toMoneyString(row.priceUsd),
      rarityWeights: (row.rarityWeights ?? {}) as Record<string, number>,
    }));
  }

  return PACK_TIERS.map((t) => ({
    code: t.code,
    cardsPerPack: t.cardsPerPack,
    pricePerPackUsd: t.priceUSD,
    rarityWeights: { ...t.rarityWeights } as Record<string, number>,
  }));
}

// ---------------------------------------------------------------------------
// Simulation entry point
// ---------------------------------------------------------------------------

export async function runPackSimulation(
  db: DB,
  input: SimulateInput,
): Promise<SimulateResponse> {
  const trials = clampTrials(input.trials);
  const tiers = await loadTiers(db);
  const target = input.tierCode
    ? tiers.filter((t) => t.code === input.tierCode)
    : tiers;

  if (target.length === 0) {
    throw new ApiError(
      ERROR_CODES.NOT_FOUND,
      input.tierCode
        ? `No active pack tier with code "${input.tierCode}".`
        : 'No active pack tiers configured.',
    );
  }

  const prices = await loadPriceContext(db);
  if (!prices.hasCatalog) {
    throw new ApiError(
      ERROR_CODES.CONFLICT,
      'Card catalog is empty. Seed the catalog before simulating packs.',
    );
  }

  const rng = input.seed !== undefined ? createSeededRng(input.seed) : Math.random;

  const results: SimulationResult[] = [];
  const warnings: SimulateResponse['warnings'] = [];

  for (const tier of target) {
    const effectiveTier: PackTierEconomicsInput = {
      ...tier,
      pricePerPackUsd: input.overridePricePerPackUsd ?? tier.pricePerPackUsd,
      rarityWeights: input.overrideWeights ?? tier.rarityWeights,
    };
    const result = monteCarloSimulate(
      effectiveTier,
      prices.samplesByRarity,
      trials,
      rng,
    );
    results.push(result);

    const margin = Number(result.avgMarginPct);
    if (margin < PACK_ECONOMICS.MIN_MARGIN_PCT) {
      warnings.push({
        tierCode: tier.code,
        severity: 'error',
        message: `Average margin ${(margin * 100).toFixed(1)}% is below the ${(PACK_ECONOMICS.MIN_MARGIN_PCT * 100).toFixed(0)}% floor.`,
      });
    } else if (margin < PACK_ECONOMICS.TARGET_MARGIN_PCT) {
      warnings.push({
        tierCode: tier.code,
        severity: 'warn',
        message: `Margin ${(margin * 100).toFixed(1)}% is below target ${(PACK_ECONOMICS.TARGET_MARGIN_PCT * 100).toFixed(0)}%; consider re-solving weights.`,
      });
    }
    if (result.winRate < PACK_ECONOMICS.WIN_RATE_FLOOR) {
      warnings.push({
        tierCode: tier.code,
        severity: 'warn',
        message: `Win rate ${(result.winRate * 100).toFixed(1)}% is below floor ${(PACK_ECONOMICS.WIN_RATE_FLOOR * 100).toFixed(0)}%; users may churn.`,
      });
    } else if (result.winRate > PACK_ECONOMICS.WIN_RATE_CEILING) {
      warnings.push({
        tierCode: tier.code,
        severity: 'warn',
        message: `Win rate ${(result.winRate * 100).toFixed(1)}% is above ceiling ${(PACK_ECONOMICS.WIN_RATE_CEILING * 100).toFixed(0)}%; the house bleeds.`,
      });
    }
  }

  const catalogCardCount = Object.values(prices.countByRarity).reduce(
    (acc, n) => acc + n,
    0,
  );

  return {
    context: { generatedAt: new Date().toISOString(), catalogCardCount },
    results,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Weight solver entry point
// ---------------------------------------------------------------------------

export async function runWeightSolver(
  db: DB,
  input: SolveInput,
): Promise<SolveResponse> {
  const tiers = await loadTiers(db);
  const tier = tiers.find((t) => t.code === input.tierCode);
  if (!tier) {
    throw new ApiError(
      ERROR_CODES.NOT_FOUND,
      `No active pack tier with code "${input.tierCode}".`,
    );
  }

  const prices = await loadPriceContext(db);
  if (!prices.hasCatalog) {
    throw new ApiError(
      ERROR_CODES.CONFLICT,
      'Card catalog is empty. Seed the catalog before solving weights.',
    );
  }

  const targetMarginPct = input.targetMarginPct ?? PACK_ECONOMICS.TARGET_MARGIN_PCT;
  if (targetMarginPct < PACK_ECONOMICS.MIN_MARGIN_PCT) {
    throw new ApiError(
      ERROR_CODES.VALIDATION,
      `Target margin must be at least ${(PACK_ECONOMICS.MIN_MARGIN_PCT * 100).toFixed(0)}%.`,
    );
  }

  const currentEv = computePackEV(tier, prices.avgByRarity);
  // `priceSamples` activates the secondary win-rate correction loop in the
  // shared solver (B1 Fix 1). Without it we'd only guarantee margin; with
  // it we also enforce the 30% win-rate floor.
  const recommended = solveRarityWeights(tier, prices.avgByRarity, {
    targetMarginPct,
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
  });

  // Verify by Monte-Carlo using the recommended weights and full samples.
  const verification = monteCarloSimulate(
    { ...tier, rarityWeights: recommended.weights },
    prices.samplesByRarity,
    PACK_ECONOMICS.DEFAULT_SIM_TRIALS,
  );

  return {
    tierCode: tier.code,
    current: {
      weights: { ...tier.rarityWeights },
      evPerPackUsd: currentEv.evPerPackUsd,
      marginPct: currentEv.marginPct,
    },
    recommended,
    targets: {
      marginPct: targetMarginPct,
      minMarginPct: PACK_ECONOMICS.MIN_MARGIN_PCT,
      winRateFloor: PACK_ECONOMICS.WIN_RATE_FLOOR,
      winRateCeiling: PACK_ECONOMICS.WIN_RATE_CEILING,
    },
    verification,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampTrials(trials: number | undefined): number {
  const n = trials ?? PACK_ECONOMICS.DEFAULT_SIM_TRIALS;
  if (!Number.isInteger(n) || n <= 0) return PACK_ECONOMICS.DEFAULT_SIM_TRIALS;
  return Math.min(n, PACK_ECONOMICS.MAX_SIM_TRIALS);
}

// Re-export tier code type so the API layer doesn't need to import it from
// two separate paths.
export type { PackTierCode };
