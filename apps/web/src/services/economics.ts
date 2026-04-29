import 'server-only';
import { Decimal, money, mul, add } from '@pullvault/shared/money';
import type { Rarity } from '@pullvault/shared/constants';

// Pure functions: testable without a DB.

export interface RarityWeights {
  common: number;
  uncommon: number;
  rare: number;
  ultra_rare: number;
  secret_rare: number;
}

export interface ExpectedValueByRarity {
  common: string;
  uncommon: string;
  rare: string;
  ultra_rare: string;
  secret_rare: string;
}

/**
 * Expected value of a single card draw given:
 *   - rarity weights (must sum to ~1.0)
 *   - expected $ value per rarity (caller provides; usually mean of all
 *     cards in that rarity bucket).
 */
export function expectedValuePerCard(
  weights: RarityWeights,
  evByRarity: ExpectedValueByRarity,
): Decimal {
  const rarities: Rarity[] = ['common', 'uncommon', 'rare', 'ultra_rare', 'secret_rare'];
  let total = money(0);
  for (const r of rarities) {
    total = add(total, mul(weights[r], evByRarity[r]));
  }
  return total;
}

/**
 * EV of a whole pack = cardsPerPack * expectedValuePerCard.
 * Margin = (price - EV) / price, expressed as fraction.
 */
export function packEconomics(input: {
  priceUSD: string;
  cardsPerPack: number;
  weights: RarityWeights;
  evByRarity: ExpectedValueByRarity;
}) {
  const evPerCard = expectedValuePerCard(input.weights, input.evByRarity);
  const evPerPack = evPerCard.times(input.cardsPerPack);
  const price = money(input.priceUSD);
  const margin = price.minus(evPerPack);
  const marginPct = price.isZero() ? money(0) : margin.dividedBy(price);
  return {
    evPerCardUSD: evPerCard.toFixed(2),
    evPerPackUSD: evPerPack.toFixed(2),
    priceUSD: price.toFixed(2),
    marginUSD: margin.toFixed(2),
    marginPct: marginPct.toFixed(4),
  };
}
