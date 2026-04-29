import { sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { handler } from '@/lib/api';

type StatsRow = {
  total: string;
  by_rarity: { rarity: string; count: string }[] | null;
  last_priced_at: string | null;
  last_history_at: string | null;
};

/**
 * GET /api/admin/catalog/stats — current state of the catalog.
 * Public read by design (it's metadata about the platform, not user-scoped).
 */
export const GET = handler(async () => {
  const [row] = (await db.execute<StatsRow>(sql`
    SELECT
      (SELECT count(*) FROM ${schema.cards})::text AS total,
      (
        SELECT coalesce(json_agg(json_build_object('rarity', rarity, 'count', cnt::text) ORDER BY rarity), '[]'::json)
        FROM (
          SELECT rarity::text AS rarity, count(*) AS cnt
          FROM ${schema.cards}
          GROUP BY rarity
        ) g
      ) AS by_rarity,
      (SELECT max(price_updated_at) FROM ${schema.cards})::text AS last_priced_at,
      (SELECT max(fetched_at) FROM ${schema.cardPrices})::text AS last_history_at
  `)) as unknown as StatsRow[];

  const total = Number(row?.total ?? '0');
  const byRarity = (row?.by_rarity ?? []).reduce<Record<string, number>>((acc, r) => {
    acc[r.rarity] = Number(r.count);
    return acc;
  }, {});

  return {
    total,
    byRarity,
    lastPricedAt: row?.last_priced_at ?? null,
    lastHistoryAt: row?.last_history_at ?? null,
  };
});
