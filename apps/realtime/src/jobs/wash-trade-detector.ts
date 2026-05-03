import { and, eq, sql } from 'drizzle-orm';

import { getDb, schema } from '@pullvault/db';
import { logger } from '@pullvault/shared/logger';

// =====================================================================
// B3 — Wash-trade / low-price / circular-trade detector.
// =====================================================================
// Runs hourly from a BullMQ repeatable job. Three independent heuristics,
// each idempotent (we look up an existing `flagged_activity` row before
// inserting a new one keyed to the same underlying evidence):
//
//   1. wash_trade        - the same card changed hands between the SAME
//                          two users > once inside 7d. Red flag.
//   2. low_price_auction - an auction settled at < 50% of market value
//                          with <= 1 unique bidder. Probable collusion.
//   3. circular_trade    - user A sold to B, then bought back from B
//                          within 30d. The canonical money-laundering
//                          / wash pattern.
//
// The detector reads completed P2P trades from the `listings` table
// (status='sold'), which is how sale-based trades are recorded in this
// codebase — there is no separate `trades` table. Auctions are read
// from `auctions` joined to `user_cards` + `cards` for market price.

type RepeatedTradeRow = {
  user_card_id: string;
  seller_id: string;
  buyer_id: string;
  trade_count: string; // bigint -> text in pg
  trade_ids: string[];
};

type LowPriceAuctionRow = {
  id: string;
  seller_id: string;
  winner_id: string | null;
  final_price_usd: string;
  market_price_usd: string;
  unique_bidders: string;
};

type CircularTradeRow = {
  user_a: string;
  user_b: string;
  sale_id: string;
  buyback_id: string;
  sold_at: string;
  bought_back_at: string;
};

export interface WashTradeDetectorResult {
  checked: number;
  flagged: number;
  byType: { wash_trade: number; low_price_auction: number; circular_trade: number };
}

export async function runWashTradeDetection(): Promise<WashTradeDetectorResult> {
  const db = getDb();
  const result: WashTradeDetectorResult = {
    checked: 0,
    flagged: 0,
    byType: { wash_trade: 0, low_price_auction: 0, circular_trade: 0 },
  };

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // -------------------------------------------------------------------
  // 1) wash_trade — same card traded between same two users >1x in 7d.
  // -------------------------------------------------------------------
  try {
    const repeated = (await db.execute<RepeatedTradeRow>(sql`
      SELECT
        l.user_card_id,
        l.seller_id,
        l.buyer_id,
        COUNT(*)::text AS trade_count,
        array_agg(l.id::text) AS trade_ids
      FROM ${schema.listings} l
      WHERE l.status = 'sold'
        AND l.buyer_id IS NOT NULL
        AND l.sold_at >= ${sevenDaysAgo}
      GROUP BY l.user_card_id, l.seller_id, l.buyer_id
      HAVING COUNT(*) > 1
    `)) as unknown as RepeatedTradeRow[];

    for (const row of repeated) {
      result.checked += 1;
      // Dedup: skip if we've already flagged this exact (seller, buyer,
      // userCard) combination inside the detection window.
      const [existing] = await db
        .select({ id: schema.flaggedActivity.id })
        .from(schema.flaggedActivity)
        .where(
          and(
            eq(schema.flaggedActivity.type, 'wash_trade'),
            sql`${schema.flaggedActivity.metadata} ->> 'sellerId' = ${row.seller_id}`,
            sql`${schema.flaggedActivity.metadata} ->> 'buyerId' = ${row.buyer_id}`,
            sql`${schema.flaggedActivity.metadata} ->> 'userCardId' = ${row.user_card_id}`,
            sql`${schema.flaggedActivity.createdAt} >= ${sevenDaysAgo}`,
          ),
        )
        .limit(1);
      if (existing) continue;

      await db.insert(schema.flaggedActivity).values({
        type: 'wash_trade',
        referenceId: row.trade_ids?.[0] ?? null,
        reason: `Same card traded ${row.trade_count} times between the same two users within 7 days`,
        severity: 'high',
        metadata: {
          sellerId: row.seller_id,
          buyerId: row.buyer_id,
          userCardId: row.user_card_id,
          tradeCount: Number(row.trade_count),
          tradeIds: row.trade_ids,
        },
      });
      result.flagged += 1;
      result.byType.wash_trade += 1;
    }
  } catch (err) {
    logger.error({ err }, '[wash-trade-detector] wash_trade check failed');
  }

  // -------------------------------------------------------------------
  // 2) low_price_auction — settled at < 50% market with <= 1 bidder.
  // -------------------------------------------------------------------
  try {
    const suspicious = (await db.execute<LowPriceAuctionRow>(sql`
      SELECT
        a.id,
        a.seller_id,
        a.winner_id,
        a.final_price_usd::text AS final_price_usd,
        c.market_price_usd::text AS market_price_usd,
        COUNT(DISTINCT b.bidder_id)::text AS unique_bidders
      FROM ${schema.auctions} a
      JOIN ${schema.userCards} uc ON uc.id = a.user_card_id
      JOIN ${schema.cards} c ON c.id = uc.card_id
      LEFT JOIN ${schema.bids} b ON b.auction_id = a.id
      WHERE a.status = 'settled'
        AND a.settled_at >= ${sevenDaysAgo}
        AND a.final_price_usd IS NOT NULL
        AND c.market_price_usd > 0
        AND a.final_price_usd < (c.market_price_usd * 0.5)
      GROUP BY a.id, a.seller_id, a.winner_id, a.final_price_usd, c.market_price_usd
      HAVING COUNT(DISTINCT b.bidder_id) <= 1
    `)) as unknown as LowPriceAuctionRow[];

    for (const row of suspicious) {
      result.checked += 1;
      // Dedup by auction id — the same auction will keep appearing until
      // it's reviewed, but we only want ONE flag per auction.
      const [existing] = await db
        .select({ id: schema.flaggedActivity.id })
        .from(schema.flaggedActivity)
        .where(
          and(
            eq(schema.flaggedActivity.type, 'low_price_auction'),
            eq(schema.flaggedActivity.referenceId, row.id),
          ),
        )
        .limit(1);
      if (existing) continue;

      const finalPrice = Number(row.final_price_usd);
      const marketPrice = Number(row.market_price_usd);
      const pct = marketPrice > 0 ? (finalPrice / marketPrice) * 100 : 0;
      // Below 25% of market is a strong collusion signal — mark high.
      const severity = finalPrice < marketPrice * 0.25 ? 'high' : 'medium';
      const bidders = Number(row.unique_bidders);

      await db.insert(schema.flaggedActivity).values({
        type: 'low_price_auction',
        referenceId: row.id,
        reason: `Auction settled at ${pct.toFixed(1)}% of market value with only ${bidders} unique bidder(s)`,
        severity,
        metadata: {
          auctionId: row.id,
          sellerId: row.seller_id,
          winnerId: row.winner_id,
          finalPriceUsd: row.final_price_usd,
          marketPriceUsd: row.market_price_usd,
          uniqueBidders: bidders,
          percentOfMarket: Number(pct.toFixed(2)),
        },
      });
      result.flagged += 1;
      result.byType.low_price_auction += 1;
    }
  } catch (err) {
    logger.error({ err }, '[wash-trade-detector] low_price_auction check failed');
  }

  // -------------------------------------------------------------------
  // 3) circular_trade — A sold to B, then B sold back to A within 30d.
  // -------------------------------------------------------------------
  try {
    const circular = (await db.execute<CircularTradeRow>(sql`
      SELECT
        l1.seller_id AS user_a,
        l1.buyer_id  AS user_b,
        l1.id::text  AS sale_id,
        l2.id::text  AS buyback_id,
        l1.sold_at::text AS sold_at,
        l2.sold_at::text AS bought_back_at
      FROM ${schema.listings} l1
      JOIN ${schema.listings} l2
        ON l2.seller_id = l1.buyer_id
       AND l2.buyer_id  = l1.seller_id
       AND l2.status    = 'sold'
       AND l2.sold_at   > l1.sold_at
       AND l2.sold_at  <= l1.sold_at + interval '30 days'
      WHERE l1.status = 'sold'
        AND l1.buyer_id IS NOT NULL
        AND l1.sold_at >= ${thirtyDaysAgo}
    `)) as unknown as CircularTradeRow[];

    for (const row of circular) {
      result.checked += 1;
      // Dedup on the (sale_id, buyback_id) tuple stored in metadata.
      const [existing] = await db
        .select({ id: schema.flaggedActivity.id })
        .from(schema.flaggedActivity)
        .where(
          and(
            eq(schema.flaggedActivity.type, 'circular_trade'),
            sql`${schema.flaggedActivity.metadata} ->> 'saleId' = ${row.sale_id}`,
            sql`${schema.flaggedActivity.metadata} ->> 'buybackId' = ${row.buyback_id}`,
          ),
        )
        .limit(1);
      if (existing) continue;

      await db.insert(schema.flaggedActivity).values({
        type: 'circular_trade',
        referenceId: row.sale_id,
        reason: `User ${row.user_a} sold to ${row.user_b}, then bought back within 30 days`,
        severity: 'medium',
        metadata: {
          userA: row.user_a,
          userB: row.user_b,
          saleId: row.sale_id,
          buybackId: row.buyback_id,
          soldAt: row.sold_at,
          boughtBackAt: row.bought_back_at,
        },
      });
      result.flagged += 1;
      result.byType.circular_trade += 1;
    }
  } catch (err) {
    logger.error({ err }, '[wash-trade-detector] circular_trade check failed');
  }

  logger.info(
    {
      checked: result.checked,
      flagged: result.flagged,
      byType: result.byType,
    },
    '[wash-trade-detector] run complete',
  );

  return result;
}
