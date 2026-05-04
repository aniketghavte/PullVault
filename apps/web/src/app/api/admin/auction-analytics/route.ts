import { count, eq, sql } from 'drizzle-orm';

import { handler } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { db, schema } from '@/lib/db';
import { PLATFORM } from '@pullvault/shared/constants';

// =====================================================================
// GET /api/admin/auction-analytics
// =====================================================================
// B3 Part 4 — metrics panel for the admin dashboard. Everything is
// computed over the LAST 30 DAYS of settled auctions, so the numbers
// reflect recent platform health rather than the all-time lifetime.
//
// Returned metrics:
//   avgPriceToMarketRatio  — avg(final_price / market_price). Healthy ~1.0.
//   snipeRate              — fraction of settled auctions with >0 extensions.
//   flagRate               — fraction of settled auctions with at least one
//                            flagged_activity row linking back to them.
//   avgParticipation       — avg unique bidders per settled auction.
//   totalAuctions          — settled auctions in the window.
//   sealedAuctionsCount    — auctions that reached the SEAL threshold.
//   pendingFlagsCount      — current open flags across all types (any age).

type MetricsRow = {
  avg_price_to_market_ratio: string | null;
  snipe_rate: string | null;
  flag_rate: string | null;
  avg_participation: string | null;
  total_auctions: string | null;
  sealed_auctions_count: string | null;
};

export const GET = handler(async () => {
  await requireUser();

  const thirtyDaysAgoMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
  // postgres.js cannot bind JS Date in raw sql fragments — use ISO string for timestamptz.
  const thirtyDaysAgoIso = new Date(thirtyDaysAgoMs).toISOString();
  const sealThreshold = PLATFORM.SEAL_EXTENSIONS_THRESHOLD;

  const metricsRows = (await db.execute<MetricsRow>(sql`
    WITH bidder_counts AS (
      SELECT auction_id, COUNT(DISTINCT bidder_id) AS unique_bidders
      FROM ${schema.bids}
      GROUP BY auction_id
    ),
    flagged_auctions AS (
      SELECT DISTINCT reference_id
      FROM ${schema.flaggedActivity}
      WHERE reference_id IS NOT NULL
        AND type IN ('low_price_auction', 'wash_trade')
    )
    SELECT
      AVG(
        CASE
          WHEN a.final_price_usd IS NOT NULL
           AND c.market_price_usd > 0
          THEN a.final_price_usd / c.market_price_usd
          ELSE NULL
        END
      )::text AS avg_price_to_market_ratio,
      AVG(CASE WHEN a.extensions > 0 THEN 1.0 ELSE 0.0 END)::text AS snipe_rate,
      AVG(CASE WHEN fa.reference_id IS NOT NULL THEN 1.0 ELSE 0.0 END)::text AS flag_rate,
      COALESCE(AVG(bc.unique_bidders), 0)::text AS avg_participation,
      COUNT(a.id)::text AS total_auctions,
      SUM(CASE WHEN a.extensions >= ${sealThreshold} THEN 1 ELSE 0 END)::text AS sealed_auctions_count
    FROM ${schema.auctions} a
    JOIN ${schema.userCards} uc ON uc.id = a.user_card_id
    JOIN ${schema.cards} c      ON c.id = uc.card_id
    LEFT JOIN bidder_counts bc  ON bc.auction_id = a.id
    LEFT JOIN flagged_auctions fa ON fa.reference_id = a.id
    WHERE a.status = 'settled'
      AND a.settled_at >= ${thirtyDaysAgoIso}
  `)) as unknown as MetricsRow[];

  const m = metricsRows[0];

  const [pending] = await db
    .select({ c: count() })
    .from(schema.flaggedActivity)
    .where(eq(schema.flaggedActivity.reviewed, false));

  return {
    windowDays: 30,
    avgPriceToMarketRatio: m?.avg_price_to_market_ratio
      ? Number(m.avg_price_to_market_ratio)
      : 0,
    snipeRate: m?.snipe_rate ? Number(m.snipe_rate) : 0,
    flagRate: m?.flag_rate ? Number(m.flag_rate) : 0,
    avgParticipation: m?.avg_participation ? Number(m.avg_participation) : 0,
    totalAuctions: m?.total_auctions ? Number(m.total_auctions) : 0,
    sealedAuctionsCount: m?.sealed_auctions_count ? Number(m.sealed_auctions_count) : 0,
    pendingFlagsCount: pending?.c ?? 0,
  };
});
