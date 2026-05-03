import { NextResponse } from 'next/server';
import { eq, inArray, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';

type Rarity = 'common' | 'uncommon' | 'rare' | 'ultra_rare' | 'secret_rare';
const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'ultra_rare', 'secret_rare'];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tierCode = searchParams.get('tier');

  const recentPurchases = await db
    .select({
      id: schema.packPurchases.id,
      rarityWeights: schema.packTiers.rarityWeights,
    })
    .from(schema.packPurchases)
    .innerJoin(schema.packTiers, eq(schema.packTiers.id, schema.packPurchases.tierId))
    .where(
      tierCode
        ? sql`${schema.packPurchases.sealed} = false AND ${schema.packTiers.code} = ${tierCode}`
        : sql`${schema.packPurchases.sealed} = false`,
    )
    .orderBy(sql`${schema.packPurchases.createdAt} DESC`)
    .limit(1000);

  if (recentPurchases.length === 0) {
    return NextResponse.json({
      data: {
        totalCardsAnalyzed: 0,
        actualDistribution: [],
        chiSquared: 0,
        degreesOfFreedom: 0,
        pValue: 1,
        fair: true,
        interpretation: 'No opened packs found in the selected scope yet.',
        verificationPageUses: 0,
      },
    });
  }

  const purchaseIds = recentPurchases.map((p) => p.id);
  const cardRows = await db
    .select({
      purchaseId: schema.packPurchaseCards.purchaseId,
      rarity: schema.cards.rarity,
    })
    .from(schema.packPurchaseCards)
    .innerJoin(schema.cards, eq(schema.cards.id, schema.packPurchaseCards.cardId))
    .where(inArray(schema.packPurchaseCards.purchaseId, purchaseIds));

  const weightsByPurchase = new Map<string, Record<string, number>>();
  for (const p of recentPurchases) {
    weightsByPurchase.set(p.id, (p.rarityWeights as Record<string, number>) ?? {});
  }

  const observed = new Map<string, number>();
  const expected = new Map<string, number>();

  for (const rarity of RARITIES) {
    observed.set(rarity, 0);
    expected.set(rarity, 0);
  }

  for (const row of cardRows) {
    observed.set(row.rarity, (observed.get(row.rarity) ?? 0) + 1);
    const weights = weightsByPurchase.get(row.purchaseId) ?? {};
    for (const rarity of RARITIES) {
      expected.set(rarity, (expected.get(rarity) ?? 0) + (weights[rarity] ?? 0));
    }
  }

  const distribution = RARITIES.map((rarity) => ({
    rarity,
    actualCount: observed.get(rarity) ?? 0,
    expectedCount: expected.get(rarity) ?? 0,
  }));

  const chiSquaredResult = computeChiSquared(distribution);
  const verifiedCountRows = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(schema.packPurchases)
    .where(sql`${schema.packPurchases.verifiedAt} IS NOT NULL`);

  const critical = 9.488; // df=4, alpha=0.05
  const fair = chiSquaredResult.df === 4 ? chiSquaredResult.statistic < critical : chiSquaredResult.pValue > 0.05;

  return NextResponse.json({
    data: {
      totalCardsAnalyzed: cardRows.length,
      actualDistribution: distribution,
      chiSquared: chiSquaredResult.statistic,
      degreesOfFreedom: chiSquaredResult.df,
      pValue: chiSquaredResult.pValue,
      fair,
      interpretation: fair
        ? 'Distribution is consistent with advertised weights (p > 0.05).'
        : 'Distribution deviates significantly from advertised weights (p < 0.05).',
      verificationPageUses: Number(verifiedCountRows[0]?.count ?? 0),
    },
  });
}

function computeChiSquared(rows: Array<{ rarity: string; actualCount: number; expectedCount: number }>) {
  let chi2 = 0;
  let usedBuckets = 0;

  for (const row of rows) {
    if (row.expectedCount <= 0) continue;
    chi2 += ((row.actualCount - row.expectedCount) ** 2) / row.expectedCount;
    usedBuckets += 1;
  }

  const df = Math.max(usedBuckets - 1, 0);
  return {
    statistic: chi2,
    df,
    pValue: approximatePValue(chi2, df),
  };
}

function approximatePValue(chi2: number, df: number): number {
  if (df <= 0) return 1;
  const k = df;
  const z = (Math.pow(chi2 / k, 1 / 3) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
  return 1 - standardNormalCDF(z);
}

function standardNormalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-(z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.3302744))));
  return z > 0 ? 1 - p : p;
}
