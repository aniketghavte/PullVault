import { sql } from 'drizzle-orm';

import { handler } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';

const TARGET_MARGIN = 0.15;
const ALERT_MARGIN_LOW = 0.05;
const ALERT_MARGIN_HIGH = 0.45;

// GET /api/admin/economic-health — B5 rolling margins + platform revenue.

export const GET = handler(async () => {
  await requireUser();

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const actualMargins = (await db.execute(sql`
    SELECT
      pt.code AS tier_code,
      pt.name AS tier_name,
      pt.price_usd::text AS pack_price,
      COUNT(DISTINCT pp.id)::text AS packs_sold,
      AVG(pp.price_paid_usd)::text AS avg_price_paid,
      AVG(card_totals.card_ev)::text AS avg_card_ev,
      AVG((pp.price_paid_usd - card_totals.card_ev) / NULLIF(pp.price_paid_usd, 0))::text AS actual_margin,
      pt.rebalanced_at,
      pt.rebalanced_reason
    FROM ${schema.packPurchases} pp
    JOIN ${schema.packTiers} pt ON pt.id = pp.tier_id
    JOIN (
      SELECT
        ppc.purchase_id,
        SUM(c.market_price_usd)::numeric AS card_ev
      FROM ${schema.packPurchaseCards} ppc
      JOIN ${schema.cards} c ON c.id = ppc.card_id
      GROUP BY ppc.purchase_id
    ) card_totals ON card_totals.purchase_id = pp.id
    WHERE pp.created_at >= ${oneDayAgo}
    GROUP BY pt.code, pt.name, pt.price_usd, pt.rebalanced_at, pt.rebalanced_reason
    ORDER BY pt.price_usd ASC
  `)) as unknown as Array<Record<string, unknown>>;

  const revenueByStream = (await db.execute(sql`
    SELECT
      kind::text AS kind,
      SUM(amount_usd)::text AS total_amount,
      COUNT(*)::text AS transaction_count
    FROM ${schema.ledgerEntries}
    WHERE user_id IS NULL
      AND created_at >= ${thirtyDaysAgo}
      AND amount_usd > 0
    GROUP BY kind
    ORDER BY SUM(amount_usd) DESC
  `)) as unknown as Array<Record<string, unknown>>;

  const dailyRevenue = (await db.execute(sql`
    SELECT
      DATE_TRUNC('day', created_at) AS day,
      SUM(amount_usd)::text AS revenue
    FROM ${schema.ledgerEntries}
    WHERE user_id IS NULL
      AND amount_usd > 0
      AND created_at >= ${sevenDaysAgo}
    GROUP BY DATE_TRUNC('day', created_at)
    ORDER BY day ASC
  `)) as unknown as { revenue: string }[];

  const dailyRows = dailyRevenue;
  const sevenDayTotal = dailyRows.reduce((s, r) => s + Number(r.revenue), 0);
  const projectedMonthlyRevenue = (sevenDayTotal / 7) * 30;

  const marginRows = actualMargins as Array<{ actual_margin: string | null; tier_code: string; tier_name: string }>;
  const alerts = marginRows
    .filter((r) => {
      const m = Number(r.actual_margin);
      return Number.isFinite(m) && (m < ALERT_MARGIN_LOW || m > ALERT_MARGIN_HIGH);
    })
    .map((r) => {
      const m = Number(r.actual_margin);
      const critical = m < ALERT_MARGIN_LOW;
      return {
        tier: r.tier_code,
        margin: m,
        severity: critical ? ('critical' as const) : ('warning' as const),
        message: critical
          ? `${r.tier_name} margin is ${(m * 100).toFixed(1)}% — below minimum threshold. Auto-rebalance should trigger.`
          : `${r.tier_name} margin is ${(m * 100).toFixed(1)}% — unusually high; packs may feel unfair.`,
      };
    });

  return {
    actualMargins,
    revenueByStream,
    dailyRevenue,
    projectedMonthlyRevenue,
    alerts,
    targetMargin: TARGET_MARGIN,
    generatedAt: now.toISOString(),
  };
});
