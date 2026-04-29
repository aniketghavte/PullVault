import { sql } from 'drizzle-orm';

import { handler } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { PACK_TIERS } from '@pullvault/shared/constants';
import { money, toMoneyString } from '@pullvault/shared/money';

type TierDef = {
  code: string;
  name: string;
  priceUsd: string;
  cardsPerPack: number;
  rarityWeights: Record<string, number>;
};

type AvgByRarityRow = { rarity: string; avg_price: string | null };
type FeeRow = { trade_fee: string; auction_fee: string };

// GET /api/admin/economics — real EV per tier + real fee revenue from ledger.
export const GET = handler(async () => {
  const avgRows = (await db.execute<AvgByRarityRow>(sql`
    SELECT rarity::text AS rarity, AVG(market_price_usd)::text AS avg_price
    FROM ${schema.cards}
    GROUP BY rarity
  `)) as unknown as AvgByRarityRow[];

  const avgByRarity = new Map<string, string>();
  for (const row of avgRows) {
    avgByRarity.set(row.rarity, row.avg_price ?? '0');
  }

  const feeRows = (await db.execute<FeeRow>(sql`
    SELECT
      COALESCE(SUM(CASE
        WHEN kind = 'platform_fee' AND reference_table = 'listings' THEN amount_usd
        ELSE 0
      END), 0)::text AS trade_fee,
      COALESCE(SUM(CASE
        WHEN kind = 'platform_fee' AND reference_table = 'auctions' THEN amount_usd
        ELSE 0
      END), 0)::text AS auction_fee
    FROM ${schema.ledgerEntries}
  `)) as unknown as FeeRow[];

  const tierRows = await db
    .select({
      code: schema.packTiers.code,
      name: schema.packTiers.name,
      priceUsd: schema.packTiers.priceUsd,
      cardsPerPack: schema.packTiers.cardsPerPack,
      rarityWeights: schema.packTiers.rarityWeights,
    })
    .from(schema.packTiers)
    .where(sql`${schema.packTiers.active} = true`);

  const tiers: TierDef[] =
    tierRows.length > 0
      ? tierRows.map((t) => ({
          code: t.code,
          name: t.name,
          priceUsd: toMoneyString(t.priceUsd),
          cardsPerPack: t.cardsPerPack,
          rarityWeights: (t.rarityWeights ?? {}) as Record<string, number>,
        }))
      : PACK_TIERS.map((t) => ({
          code: t.code,
          name: t.name,
          priceUsd: t.priceUSD,
          cardsPerPack: t.cardsPerPack,
          rarityWeights: t.rarityWeights as Record<string, number>,
        }));

  const packEVByTier = Object.fromEntries(
    tiers.map((tier) => {
      let evPerCard = money(0);
      for (const [rarity, weight] of Object.entries(tier.rarityWeights)) {
        const avg = money(avgByRarity.get(rarity) ?? '0');
        evPerCard = evPerCard.plus(avg.times(weight));
      }
      const evPerPack = evPerCard.times(tier.cardsPerPack);
      const margin = money(tier.priceUsd).minus(evPerPack);
      return [
        tier.code,
        {
          tierName: tier.name,
          evPerPackUSD: toMoneyString(evPerPack),
          evPerCardUSD: toMoneyString(evPerCard),
          houseMarginUSD: toMoneyString(margin),
        },
      ];
    }),
  );

  const fees = feeRows[0] ?? { trade_fee: '0', auction_fee: '0' };
  return {
    packEVByTier,
    tradeFeeRevenueUSD: toMoneyString(fees.trade_fee),
    auctionFeeRevenueUSD: toMoneyString(fees.auction_fee),
  };
});
