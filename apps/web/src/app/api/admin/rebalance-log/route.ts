import { desc, isNotNull, sql } from 'drizzle-orm';

import { handler } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { toMoneyString } from '@pullvault/shared/money';

// GET /api/admin/rebalance-log
//
// Audit trail for the auto-rebalancer (B1 Fix 2). Returns one row per
// tier that has ever been auto-rebalanced, most recent first. The
// `previous_weights` jsonb is unpacked into `previousMarginPct` and
// `newMarginPct` so the admin UI can render a clean before/after table.
//
// This endpoint is read-only. The actual rebalance write happens inside
// the BullMQ weight-rebalancer worker (apps/realtime/src/jobs/rebalance.ts).

type RebalanceRow = {
  code: string;
  name: string;
  priceUsd: string;
  cardsPerPack: number;
  currentWeights: unknown;
  rebalancedAt: string | null;
  rebalancedReason: string | null;
  previousWeights: unknown;
  [k: string]: unknown;
};

export const GET = handler(async () => {
  const rows = (await db
    .select({
      code: schema.packTiers.code,
      name: schema.packTiers.name,
      priceUsd: schema.packTiers.priceUsd,
      cardsPerPack: schema.packTiers.cardsPerPack,
      currentWeights: schema.packTiers.rarityWeights,
      rebalancedAt: sql<string>`${schema.packTiers.rebalancedAt}::text`,
      rebalancedReason: schema.packTiers.rebalancedReason,
      previousWeights: schema.packTiers.previousWeights,
    })
    .from(schema.packTiers)
    .where(isNotNull(schema.packTiers.rebalancedAt))
    .orderBy(desc(schema.packTiers.rebalancedAt))) as unknown as RebalanceRow[];

  const entries = rows.map((row) => {
    const snapshot = (row.previousWeights ?? {}) as {
      weights?: Record<string, number>;
      marginPct?: string;
      newMarginPct?: string;
    };
    return {
      tierCode: row.code,
      tierName: row.name,
      pricePerPackUsd: toMoneyString(row.priceUsd),
      cardsPerPack: row.cardsPerPack,
      rebalancedAt: row.rebalancedAt,
      reason: row.rebalancedReason,
      previousWeights: snapshot.weights ?? {},
      previousMarginPct: snapshot.marginPct ?? null,
      newMarginPct: snapshot.newMarginPct ?? null,
      currentWeights: (row.currentWeights ?? {}) as Record<string, number>,
    };
  });

  return { entries };
});
