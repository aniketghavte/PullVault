// Pack-economics math (B1).
//
// Pure, IO-free module. Given current card prices and a tier definition,
// it computes:
//
//   1. Closed-form expected value (EV) of a pack.
//   2. A backward-solver that adjusts rarity weights so the pack hits a
//      target house margin (15% by default), using `common` as the lever
//      because `more commons -> lower EV -> higher margin`.
//   3. A Monte-Carlo simulator that mirrors the actual server-side card
//      draw (weighted_random rarity -> uniform price sample from that
//      rarity bucket), reporting win-rate, mean / p10 / p50 / p90 EV,
//      margin distribution, and projected platform P&L.
//
// Money headline numbers (`evPerPackUsd`, `marginPct`, ...) are computed
// with `decimal.js` to stay consistent with the rest of the platform's
// money policy (see `money.ts` and `.cursor/rules/money.mdc`).
//
// The MC inner loop uses plain `number` arithmetic for throughput - it is
// a projection, never a settlement, so a sub-cent rounding drift across
// 10k synthetic draws is acceptable. Aggregates are folded back into
// `Decimal` before they leave this module.

import Decimal from 'decimal.js';
import { money, toMoneyString } from './money';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RarityWeightMap = Record<string, number>;
export type RarityAvgPriceMap = Record<string, string | number>;
export type RarityPriceSamples = Record<string, ReadonlyArray<string | number>>;

export interface PackTierEconomicsInput {
  /** Tier code, e.g. `standard` / `premium`. */
  code: string;
  /** Number of cards per pack. */
  cardsPerPack: number;
  /** Pack price in USD as a 2dp string. */
  pricePerPackUsd: string;
  /** Map of rarity -> weight. Must sum to ~1; we re-normalize defensively. */
  rarityWeights: RarityWeightMap;
}

export interface PackEVResult {
  evPerCardUsd: string;
  evPerPackUsd: string;
  /** Pack price - EV. Positive => house captures value. */
  marginUsd: string;
  /** (Pack price - EV) / Pack price as a 4dp string, e.g. `"0.1500"` for 15%. */
  marginPct: string;
}

export type SolverReason =
  | 'converged'
  | 'capped_min_common'
  | 'capped_max_common'
  | 'no_lever'
  | 'price_floor'
  | 'win_rate_unachievable'
  | 'win_rate_margin_conflict';

export type SolverWarningCode =
  | 'WIN_RATE_UNACHIEVABLE'
  | 'WIN_RATE_MARGIN_CONFLICT'
  | 'WIN_RATE_NO_RARE_BUCKET';

export interface SolverWarning {
  code: SolverWarningCode;
  message: string;
}

export interface SolvedWeights {
  weights: RarityWeightMap;
  evPerCardUsd: string;
  evPerPackUsd: string;
  marginPct: string;
  iterations: number;
  converged: boolean;
  reason: SolverReason;
  /** Human-readable explanation of any clamp the solver had to apply. */
  notes: string;
  /**
   * Number of secondary win-rate adjustment iterations performed. Present
   * only when `priceSamples` was supplied to enable the win-rate loop.
   */
  winRateIterations?: number;
  /** Empirical win rate of the final weights (MC-verified). */
  verificationWinRate?: number;
  /** Structured warnings from the win-rate correction pass. */
  warnings?: SolverWarning[];
}

export interface SolveWeightsOptions {
  /** Target house margin as a fraction, e.g. `0.15` for 15%. Default 0.15. */
  targetMarginPct?: number;
  /** Floor on the common weight. Default 0.05 (no rare-only packs). */
  minCommonWeight?: number;
  /** Ceiling on the common weight. Default 0.95 (no all-common packs). */
  maxCommonWeight?: number;
  /** Acceptable margin error around target. Default 0.001 (0.1%). */
  tolerance?: number;
  /** Common rarity key. Default `common`. */
  commonRarity?: string;
  /**
   * When provided, the solver runs a secondary loop that shifts probability
   * from `commonRarity` into `rareRarity` (default `rare`) until the MC win
   * rate ≥ `winRateFloor`, or until a hard guard-rail fires.
   *
   * Supplying samples is how a caller says "I want you to also satisfy the
   * 30% win-rate floor, not just the margin target." Without samples the
   * function preserves its original margin-only behavior.
   */
  priceSamples?: RarityPriceSamples;
  /** Rare rarity key used by the win-rate loop. Default `rare`. */
  rareRarity?: string;
  /** Win-rate floor; below this the loop keeps iterating. Default 0.30. */
  winRateFloor?: number;
  /**
   * Minimum margin the solver refuses to drop below during win-rate fixes.
   * Default 0.05 (same as `PACK_ECONOMICS.MIN_MARGIN_PCT`).
   */
  minMarginPct?: number;
  /** Per-iteration shift from common into rare. Default 0.05 (5%). */
  winRateStep?: number;
  /**
   * Hard floor on common weight during the win-rate loop. Tighter than
   * `minCommonWeight` used by the margin solve. Default 0.20.
   */
  minCommonHardFloor?: number;
  /**
   * Hard ceiling on rare weight during the win-rate loop. Prevents the
   * "all rare" degenerate pack. Default 0.30.
   */
  maxRareWeight?: number;
  /** Max iterations of the win-rate correction loop. Default 20. */
  maxWinRateIterations?: number;
  /** Trials for the in-loop quick MC check. Default 2000. */
  winRateCheckTrials?: number;
  /** Seed for the in-loop MC (deterministic convergence). Default 42. */
  winRateCheckSeed?: number;
}

export interface MarginBucket {
  /** Inclusive lower bound of margin range, e.g. `"-0.10"` => -10%. */
  fromPct: string;
  /** Exclusive upper bound. */
  toPct: string;
  count: number;
}

export interface SimulationResult {
  tierCode: string;
  trials: number;
  /** Pack price (snapshot) used for the simulation. */
  pricePerPackUsd: string;
  /** Mean pack EV across trials. */
  avgPackEvUsd: string;
  /** Closed-form EV (deterministic) for sanity-checking the MC mean. */
  closedFormEvUsd: string;
  /** Sample p10/p50/p90 of pack EV. */
  p10PackEvUsd: string;
  p50PackEvUsd: string;
  p90PackEvUsd: string;
  /** Mean house margin over trials, 4dp. */
  avgMarginPct: string;
  /** Fraction of packs that beat the pack price (i.e. user wins). */
  winRate: number;
  /** Sum of pack prices (revenue) and pack EVs (payout) across trials. */
  totalRevenueUsd: string;
  totalPayoutEvUsd: string;
  /** Projected house P&L = revenue - payout. */
  projectedHousePnlUsd: string;
  /** Histogram of per-pack margin: (price - ev) / price. */
  marginBuckets: MarginBucket[];
  /** Empirical rarity hit rate per draw position averaged across trials. */
  rarityHitRate: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function toNumber(value: string | number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function normalizeWeights(weights: RarityWeightMap): RarityWeightMap {
  let sum = 0;
  for (const v of Object.values(weights)) sum += Math.max(0, v);
  if (sum <= 0) return { ...weights };
  const out: RarityWeightMap = {};
  for (const [k, v] of Object.entries(weights)) {
    out[k] = Math.max(0, v) / sum;
  }
  return out;
}

/** Build a cumulative-weight table for a single weighted draw in O(log n). */
function buildCdf(weights: RarityWeightMap): { keys: string[]; cdf: number[] } {
  const keys = Object.keys(weights);
  const cdf = new Array<number>(keys.length);
  let acc = 0;
  for (let i = 0; i < keys.length; i++) {
    acc += Math.max(0, weights[keys[i]!] ?? 0);
    cdf[i] = acc;
  }
  // Normalize so binary-search target lives in [0, 1).
  if (acc > 0) {
    for (let i = 0; i < cdf.length; i++) cdf[i] = cdf[i]! / acc;
  }
  return { keys, cdf };
}

function pickRarity(cdf: number[], keys: string[], r: number): string {
  // Linear scan is faster than bisect for ~5 buckets.
  for (let i = 0; i < cdf.length; i++) {
    if (r <= cdf[i]!) return keys[i]!;
  }
  return keys[keys.length - 1]!;
}

function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (q <= 0) return sortedAsc[0]!;
  if (q >= 1) return sortedAsc[sortedAsc.length - 1]!;
  const idx = (sortedAsc.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo]!;
  const frac = idx - lo;
  return sortedAsc[lo]! * (1 - frac) + sortedAsc[hi]! * frac;
}

// ---------------------------------------------------------------------------
// 1) Closed-form expected value
// ---------------------------------------------------------------------------

/**
 * Closed-form EV:
 *   E[card]  = Σ_r weight_r × avgPrice_r
 *   EV(pack) = cardsPerPack × E[card]
 *
 * `avgPriceByRarity` is typically the mean of `cards.market_price_usd` per
 * rarity bucket. Missing rarities are treated as $0 - this is intentional;
 * if a tier mentions a rarity that has no cards in the catalog, every draw
 * of that rarity returns $0 and the operator should be alerted.
 */
export function computePackEV(
  tier: PackTierEconomicsInput,
  avgPriceByRarity: RarityAvgPriceMap,
): PackEVResult {
  const weights = normalizeWeights(tier.rarityWeights);
  let evPerCard = money(0);
  for (const [rarity, weight] of Object.entries(weights)) {
    const avg = money(avgPriceByRarity[rarity] ?? 0);
    evPerCard = evPerCard.plus(avg.times(weight));
  }
  const evPerPack = evPerCard.times(tier.cardsPerPack);
  const price = money(tier.pricePerPackUsd);
  const margin = price.minus(evPerPack);
  const marginPct = price.isZero() ? money(0) : margin.dividedBy(price);
  return {
    evPerCardUsd: toMoneyString(evPerCard),
    evPerPackUsd: toMoneyString(evPerPack),
    marginUsd: toMoneyString(margin),
    marginPct: marginPct.toFixed(4, Decimal.ROUND_HALF_UP),
  };
}

// ---------------------------------------------------------------------------
// 2) Backward-solver for rarity weights
// ---------------------------------------------------------------------------

/**
 * Solve rarity weights so the pack hits `targetMarginPct`, using `common`
 * as the lever.
 *
 * Strategy: hold the *shape* of the non-common rarities (their relative
 * proportions stay fixed) and scale them by a single factor `α`. The
 * common weight absorbs the rest:
 *
 *   w'_common = 1 - α × Σ_{r != common} w_r
 *   w'_r     = α × w_r              (for r != common)
 *
 * EV per card simplifies to:
 *   EV = α × A + (1 - α × B) × μ_c
 *   where A = Σ_{r!=c} w_r × μ_r,  B = Σ_{r!=c} w_r
 *
 * Solving for α:
 *   α = ( EV* - μ_c ) / ( A - B × μ_c )
 *
 * Edge cases:
 *   - If A - B × μ_c == 0   => the lever has no effect (`no_lever`).
 *     Happens when all non-common rarities have the same expected price
 *     as common (degenerate catalog).
 *   - If solved α implies common weight outside [min,max], we clamp and
 *     report the resulting (best-effort) margin. The caller can decide
 *     whether to raise pack price instead.
 *   - If targetEV < μ_c × cardsPerPack, no positive α can hit the target
 *     (you'd need NEGATIVE rare weight). We clamp common to its max and
 *     report `price_floor`.
 */
export function solveRarityWeights(
  tier: PackTierEconomicsInput,
  avgPriceByRarity: RarityAvgPriceMap,
  opts: SolveWeightsOptions = {},
): SolvedWeights {
  const targetMarginPct = opts.targetMarginPct ?? 0.15;
  const minCommonWeight = opts.minCommonWeight ?? 0.05;
  const maxCommonWeight = opts.maxCommonWeight ?? 0.95;
  const tolerance = opts.tolerance ?? 0.001;
  const commonRarity = opts.commonRarity ?? 'common';

  const weights = normalizeWeights(tier.rarityWeights);
  const muC = toNumber(avgPriceByRarity[commonRarity] ?? 0);

  // A = Σ_{r!=c} w_r × μ_r ;  B = Σ_{r!=c} w_r
  let A = 0;
  let B = 0;
  for (const [rarity, weight] of Object.entries(weights)) {
    if (rarity === commonRarity) continue;
    A += weight * toNumber(avgPriceByRarity[rarity] ?? 0);
    B += weight;
  }

  const N = tier.cardsPerPack;
  const P = toNumber(tier.pricePerPackUsd);
  const targetEvPerCard = (P * (1 - targetMarginPct)) / N;

  const denom = A - B * muC;
  let alpha: number;
  let reason: SolverReason = 'converged';
  let notes = '';

  if (Math.abs(denom) < 1e-9) {
    alpha = 1;
    reason = 'no_lever';
    notes =
      'All non-common rarities have the same expected price as common; ' +
      'the common-as-lever knob has no effect. Consider raising the pack ' +
      'price or refreshing card prices.';
  } else {
    alpha = (targetEvPerCard - muC) / denom;
  }

  // Translate alpha to the implied common weight.
  let commonWeight = 1 - alpha * B;

  if (alpha < 0) {
    // Target EV is below the all-common floor. Pin to max common and
    // report the resulting (still positive) margin.
    commonWeight = maxCommonWeight;
    reason = 'price_floor';
    notes =
      `Target margin ${(targetMarginPct * 100).toFixed(1)}% is below the ` +
      `all-common pack EV ($${(muC * N).toFixed(2)}). Pinning common to ` +
      `${(maxCommonWeight * 100).toFixed(0)}%; raise pack price to recover margin.`;
  } else if (commonWeight > maxCommonWeight) {
    commonWeight = maxCommonWeight;
    reason = reason === 'converged' ? 'capped_max_common' : reason;
    notes ||=
      `Solver wanted common weight = ${((1 - alpha * B) * 100).toFixed(1)}%; ` +
      `clamped to ceiling ${(maxCommonWeight * 100).toFixed(0)}%.`;
  } else if (commonWeight < minCommonWeight) {
    commonWeight = minCommonWeight;
    reason = 'capped_min_common';
    notes =
      `Solver wanted common weight = ${((1 - alpha * B) * 100).toFixed(1)}%; ` +
      `clamped to floor ${(minCommonWeight * 100).toFixed(0)}%.`;
  }

  // Recompute alpha from the (possibly clamped) common weight.
  const finalAlpha = B > 0 ? (1 - commonWeight) / B : 0;

  // Re-distribute non-common share proportionally.
  const newWeights: RarityWeightMap = {};
  newWeights[commonRarity] = commonWeight;
  for (const [rarity, weight] of Object.entries(weights)) {
    if (rarity === commonRarity) continue;
    newWeights[rarity] = weight * finalAlpha;
  }

  // Final renormalize (defensive against fp drift).
  let finalWeights: RarityWeightMap = normalizeWeights(newWeights);
  let ev = computePackEV({ ...tier, rarityWeights: finalWeights }, avgPriceByRarity);
  const achievedMargin = Number(ev.marginPct);
  const converged = Math.abs(achievedMargin - targetMarginPct) <= tolerance;

  // -------------------------------------------------------------------------
  // Win-rate correction loop (B1 Fix 1).
  //
  // The margin solve above is closed-form; it guarantees EV hits the target
  // but says nothing about variance. The win-rate floor (30% of opened
  // packs returning > pack price) requires enough probability mass on the
  // mid-value bucket (`rare`). If the loop is enabled (caller provides
  // `priceSamples`), we iteratively shift probability from common → rare
  // until the MC win rate clears the floor, or we hit a guard-rail.
  //
  // Guard-rails (any triggers a warning + break):
  //   1. common weight at `minCommonHardFloor` (commons can't go lower)
  //   2. rare weight at `maxRareWeight`         (rares can't go higher)
  //   3. pack margin below `minMarginPct`       (platform can't lose money)
  //
  // Everything in this loop is deterministic once `winRateCheckSeed` is
  // set, so the same inputs always produce the same output — important
  // for the auto-rebalancer (Fix 2) which expects reproducible results.
  // -------------------------------------------------------------------------
  let winRateIterations = 0;
  let verificationWinRate: number | undefined;
  const warnings: SolverWarning[] = [];

  if (opts.priceSamples) {
    const rareRarity = opts.rareRarity ?? 'rare';
    const winRateFloor = opts.winRateFloor ?? 0.3;
    const minMarginPct = opts.minMarginPct ?? 0.05;
    const winRateStep = opts.winRateStep ?? 0.05;
    const minCommonHardFloor = opts.minCommonHardFloor ?? 0.2;
    const maxRareWeight = opts.maxRareWeight ?? 0.3;
    const maxWinRateIterations = opts.maxWinRateIterations ?? 20;
    const winRateCheckTrials = opts.winRateCheckTrials ?? 2_000;
    const winRateCheckSeed = opts.winRateCheckSeed ?? 42;

    if (!(rareRarity in finalWeights)) {
      warnings.push({
        code: 'WIN_RATE_NO_RARE_BUCKET',
        message:
          `Tier "${tier.code}" has no "${rareRarity}" bucket; cannot run the ` +
          `win-rate correction loop. Add the bucket or choose a different ` +
          `"rareRarity" in solver options.`,
      });
    } else {
      let simResult = monteCarloSimulate(
        { ...tier, rarityWeights: finalWeights },
        opts.priceSamples,
        winRateCheckTrials,
        createSeededRng(winRateCheckSeed),
      );

      while (
        simResult.winRate < winRateFloor &&
        winRateIterations < maxWinRateIterations
      ) {
        const currentCommon = finalWeights[commonRarity] ?? 0;
        const currentRare = finalWeights[rareRarity] ?? 0;

        // Honor BOTH guard-rails in one clamp so we can report whichever
        // fires first with the correct reason.
        const commonBudget = Math.max(0, currentCommon - minCommonHardFloor);
        const rareBudget = Math.max(0, maxRareWeight - currentRare);
        const shifted = Math.min(winRateStep, commonBudget, rareBudget);

        if (shifted < 0.001) {
          reason = 'win_rate_unachievable';
          warnings.push({
            code: 'WIN_RATE_UNACHIEVABLE',
            message:
              `Cannot reach win rate floor of ${(winRateFloor * 100).toFixed(0)}% ` +
              `without violating the common floor (${(minCommonHardFloor * 100).toFixed(0)}%) ` +
              `or rare ceiling (${(maxRareWeight * 100).toFixed(0)}%) constraints. ` +
              `Current win rate: ${(simResult.winRate * 100).toFixed(1)}%. ` +
              `Consider lowering pack price or adding more mid-value cards to the pool.`,
          });
          break;
        }

        const candidate: RarityWeightMap = {
          ...finalWeights,
          [commonRarity]: currentCommon - shifted,
          [rareRarity]: currentRare + shifted,
        };

        // Margin guard: stop if shifting more would take the platform below
        // the absolute floor. The caller may promote the final weights even
        // if this fires — margin simply won't be at the original target.
        const candidateEv = computePackEV(
          { ...tier, rarityWeights: candidate },
          avgPriceByRarity,
        );
        const candidateMargin = Number(candidateEv.marginPct);

        if (candidateMargin < minMarginPct) {
          reason = 'win_rate_margin_conflict';
          warnings.push({
            code: 'WIN_RATE_MARGIN_CONFLICT',
            message:
              `Win rate floor (${(winRateFloor * 100).toFixed(0)}%) and ` +
              `margin floor (${(minMarginPct * 100).toFixed(0)}%) cannot both be satisfied. ` +
              `Achieved win rate: ${(simResult.winRate * 100).toFixed(1)}% at margin ` +
              `${(Number(ev.marginPct) * 100).toFixed(1)}%; shifting more would drop ` +
              `margin to ${(candidateMargin * 100).toFixed(1)}%.`,
          });
          break;
        }

        finalWeights = normalizeWeights(candidate);
        ev = candidateEv;
        simResult = monteCarloSimulate(
          { ...tier, rarityWeights: finalWeights },
          opts.priceSamples,
          winRateCheckTrials,
          createSeededRng(winRateCheckSeed),
        );
        winRateIterations++;
      }

      verificationWinRate = simResult.winRate;
    }
  }

  const result: SolvedWeights = {
    weights: finalWeights,
    evPerCardUsd: ev.evPerCardUsd,
    evPerPackUsd: ev.evPerPackUsd,
    marginPct: ev.marginPct,
    iterations: 1,
    converged,
    reason,
    notes,
  };

  if (opts.priceSamples) {
    result.winRateIterations = winRateIterations;
    if (verificationWinRate !== undefined) {
      result.verificationWinRate = verificationWinRate;
    }
    if (warnings.length > 0) {
      result.warnings = warnings;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// 3) Monte-Carlo simulator
// ---------------------------------------------------------------------------

const DEFAULT_MARGIN_BUCKET_EDGES = [
  -0.5, -0.25, -0.1, 0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 1.01,
];

/**
 * Run `trials` virtual pack openings.
 *
 * Each pack:
 *   1. Roll `cardsPerPack` rarities by weighted random.
 *   2. For each rarity, uniformly sample one price from `priceSamples[rarity]`.
 *   3. Sum into pack EV; compare to pack price for win-rate.
 *
 * If a rarity bucket has no samples, draws of that rarity contribute $0.
 * That mirrors the "no cards in catalog for this rarity" production case.
 */
export function monteCarloSimulate(
  tier: PackTierEconomicsInput,
  priceSamples: RarityPriceSamples,
  trials: number,
  rng: () => number = Math.random,
): SimulationResult {
  if (trials <= 0 || !Number.isFinite(trials)) {
    throw new RangeError('trials must be a positive integer');
  }

  const weights = normalizeWeights(tier.rarityWeights);
  const { keys, cdf } = buildCdf(weights);

  // Pre-flatten price samples per rarity into Float64Array for speed.
  const samplesByRarity: Record<string, Float64Array> = {};
  for (const rarity of keys) {
    const raw = priceSamples[rarity];
    if (!raw || raw.length === 0) {
      samplesByRarity[rarity] = new Float64Array();
      continue;
    }
    const arr = new Float64Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = toNumber(raw[i]!);
    samplesByRarity[rarity] = arr;
  }

  const price = toNumber(tier.pricePerPackUsd);
  const N = tier.cardsPerPack;

  const packEvs = new Float64Array(trials);
  let wins = 0;
  let totalEv = 0;

  // Closed-form mean for sanity check.
  const avgByRarity: RarityAvgPriceMap = {};
  for (const rarity of keys) {
    const arr = samplesByRarity[rarity]!;
    if (arr.length === 0) {
      avgByRarity[rarity] = 0;
      continue;
    }
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i]!;
    avgByRarity[rarity] = s / arr.length;
  }
  const closedForm = computePackEV(tier, avgByRarity);

  // Hit-rate counters.
  const rarityHits: Record<string, number> = {};
  for (const rarity of keys) rarityHits[rarity] = 0;

  for (let t = 0; t < trials; t++) {
    let packEv = 0;
    for (let i = 0; i < N; i++) {
      const rarity = pickRarity(cdf, keys, rng());
      rarityHits[rarity] = (rarityHits[rarity] ?? 0) + 1;
      const samples = samplesByRarity[rarity]!;
      if (samples.length === 0) continue;
      const idx = Math.floor(rng() * samples.length);
      packEv += samples[idx]!;
    }
    packEvs[t] = packEv;
    totalEv += packEv;
    if (packEv > price) wins++;
  }

  const sorted = Float64Array.from(packEvs);
  sorted.sort();
  const sortedArr = Array.from(sorted);

  const avgPackEv = totalEv / trials;
  const totalRevenue = price * trials;
  const housePnl = totalRevenue - totalEv;
  const avgMarginPct = price > 0 ? (price - avgPackEv) / price : 0;

  // Build margin buckets (per-pack margin distribution).
  const buckets: MarginBucket[] = [];
  for (let i = 0; i < DEFAULT_MARGIN_BUCKET_EDGES.length - 1; i++) {
    buckets.push({
      fromPct: DEFAULT_MARGIN_BUCKET_EDGES[i]!.toFixed(2),
      toPct: DEFAULT_MARGIN_BUCKET_EDGES[i + 1]!.toFixed(2),
      count: 0,
    });
  }
  for (let t = 0; t < trials; t++) {
    const m = price > 0 ? (price - packEvs[t]!) / price : 0;
    for (let b = 0; b < buckets.length; b++) {
      const lo = DEFAULT_MARGIN_BUCKET_EDGES[b]!;
      const hi = DEFAULT_MARGIN_BUCKET_EDGES[b + 1]!;
      if (m >= lo && m < hi) {
        buckets[b]!.count++;
        break;
      }
    }
  }

  // Convert raw rarity hit counts to per-draw rate.
  const totalDraws = trials * N;
  const rarityHitRate: Record<string, number> = {};
  for (const rarity of keys) {
    rarityHitRate[rarity] = totalDraws > 0 ? (rarityHits[rarity] ?? 0) / totalDraws : 0;
  }

  return {
    tierCode: tier.code,
    trials,
    pricePerPackUsd: toMoneyString(price),
    avgPackEvUsd: toMoneyString(avgPackEv),
    closedFormEvUsd: closedForm.evPerPackUsd,
    p10PackEvUsd: toMoneyString(quantile(sortedArr, 0.1)),
    p50PackEvUsd: toMoneyString(quantile(sortedArr, 0.5)),
    p90PackEvUsd: toMoneyString(quantile(sortedArr, 0.9)),
    avgMarginPct: avgMarginPct.toFixed(4),
    winRate: trials > 0 ? wins / trials : 0,
    totalRevenueUsd: toMoneyString(totalRevenue),
    totalPayoutEvUsd: toMoneyString(totalEv),
    projectedHousePnlUsd: toMoneyString(housePnl),
    marginBuckets: buckets,
    rarityHitRate,
  };
}

// ---------------------------------------------------------------------------
// 4) Convenience: deterministic RNG factory (for tests)
// ---------------------------------------------------------------------------

/**
 * Mulberry32 PRNG. Seedable, tiny, good enough for analytical Monte-Carlo
 * (NOT cryptographic; do NOT use for real card draws).
 */
export function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
