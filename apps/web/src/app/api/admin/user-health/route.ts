import { sql } from 'drizzle-orm';

import { handler } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';

// GET /api/admin/user-health — B5 engagement & retention proxies.

export const GET = handler(async () => {
  await requireUser();

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  const dropEngagement = (await db.execute(sql`
    SELECT
      pd.id,
      pt.name AS tier_name,
      pd.scheduled_at,
      pd.total_inventory::text AS total_inventory,
      (pd.total_inventory - pd.remaining_inventory)::text AS units_sold,
      ROUND(
        (pd.total_inventory - pd.remaining_inventory)::numeric
        / NULLIF(pd.total_inventory, 0) * 100,
        1
      )::text AS sell_through_pct,
      COUNT(DISTINCT pp.user_id)::text AS unique_buyers
    FROM ${schema.packDrops} pd
    JOIN ${schema.packTiers} pt ON pt.id = pd.tier_id
    LEFT JOIN ${schema.packPurchases} pp ON pp.drop_id = pd.id
    WHERE pd.scheduled_at >= ${sevenDaysAgo}
    GROUP BY pd.id, pt.name, pd.scheduled_at, pd.total_inventory, pd.remaining_inventory
    ORDER BY pd.scheduled_at DESC
    LIMIT 20
  `)) as unknown as Record<string, unknown>[];

  const auctionParticipation = (await db.execute(sql`
    SELECT
      COUNT(DISTINCT a.id)::text AS total_auctions,
      COALESCE(AVG(bid_counts.unique_bidders), 0)::text AS avg_bidders_per_auction,
      COUNT(DISTINCT a.id) FILTER (WHERE COALESCE(bid_counts.unique_bidders, 0) = 0)::text AS no_bid_auctions,
      COUNT(DISTINCT a.id) FILTER (WHERE COALESCE(bid_counts.unique_bidders, 0) >= 3)::text AS competitive_auctions
    FROM ${schema.auctions} a
    LEFT JOIN (
      SELECT auction_id, COUNT(DISTINCT bidder_id)::numeric AS unique_bidders
      FROM ${schema.bids}
      GROUP BY auction_id
    ) bid_counts ON bid_counts.auction_id = a.id
    WHERE a.created_at >= ${thirtyDaysAgo}
      AND a.status = 'settled'
  `)) as unknown as Record<string, unknown>[];

  const retentionData = (await db.execute(sql`
    SELECT
      COUNT(DISTINCT cohort.user_id)::text AS cohort_size,
      COUNT(DISTINCT returned.user_id)::text AS returned_count,
      ROUND(
        COUNT(DISTINCT returned.user_id)::numeric
        / NULLIF(COUNT(DISTINCT cohort.user_id), 0) * 100,
        1
      )::text AS d7_retention_pct
    FROM (
      SELECT DISTINCT user_id
      FROM ${schema.packPurchases}
      WHERE created_at >= ${fourteenDaysAgo}
        AND created_at < ${sevenDaysAgo}
    ) cohort
    LEFT JOIN (
      SELECT DISTINCT user_id
      FROM ${schema.packPurchases}
      WHERE created_at >= ${sevenDaysAgo}
    ) returned ON returned.user_id = cohort.user_id
  `)) as unknown as Record<string, unknown>[];

  const userActivity = (await db.execute(sql`
    SELECT
      COUNT(DISTINCT pp.user_id)::text AS active_buyers,
      COUNT(DISTINCT pp.user_id) FILTER (
        WHERE pp.user_id NOT IN (
          SELECT DISTINCT user_id FROM ${schema.packPurchases}
          WHERE created_at < ${sevenDaysAgo}
        )
      )::text AS new_buyers,
      COUNT(DISTINCT pp.user_id) FILTER (
        WHERE pp.user_id IN (
          SELECT DISTINCT user_id FROM ${schema.packPurchases}
          WHERE created_at < ${sevenDaysAgo}
        )
      )::text AS returning_buyers
    FROM ${schema.packPurchases} pp
    WHERE pp.created_at >= ${sevenDaysAgo}
  `)) as unknown as Record<string, unknown>[];

  const portfolioStats = (await db.execute(sql`
    SELECT
      COUNT(*)::text AS users_with_cards,
      COALESCE(AVG(user_totals.portfolio_value), 0)::text AS avg_portfolio_value,
      COALESCE(MAX(user_totals.portfolio_value), 0)::text AS max_portfolio_value
    FROM (
      SELECT
        uc.owner_id AS user_id,
        SUM(c.market_price_usd)::numeric AS portfolio_value
      FROM ${schema.userCards} uc
      JOIN ${schema.cards} c ON c.id = uc.card_id
      WHERE uc.status = 'held'
      GROUP BY uc.owner_id
    ) user_totals
  `)) as unknown as Record<string, unknown>[];

  const auctionRow = auctionParticipation[0] as Record<string, unknown> | undefined;
  const retentionRow = retentionData[0] as Record<string, unknown> | undefined;
  const activityRow = userActivity[0] as Record<string, unknown> | undefined;
  const portfolioRow = portfolioStats[0] as Record<string, unknown> | undefined;

  return {
    dropEngagement,
    auctionParticipation: auctionRow ?? {},
    retention: retentionRow ?? {},
    userActivity: activityRow ?? {},
    portfolioStats: portfolioRow ?? {},
    generatedAt: now.toISOString(),
  };
});
