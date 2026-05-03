import { sql } from 'drizzle-orm';

import { handler } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { requireUser } from '@/lib/auth';

// GET /api/admin/fraud-metrics — B5 fraud & bot signals dashboard data.

export const GET = handler(async () => {
  await requireUser();

  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const rateLimitHits = (await db.execute(sql`
    SELECT
      endpoint,
      limit_type,
      COUNT(*)::text AS hit_count
    FROM ${schema.rateLimitEvents}
    WHERE created_at >= ${oneDayAgo}
    GROUP BY endpoint, limit_type
    ORDER BY COUNT(*) DESC
  `)) as unknown as Record<string, unknown>[];

  const rateLimitTimeline = (await db.execute(sql`
    SELECT
      DATE_TRUNC('hour', created_at) AS hour,
      COUNT(*)::text AS hit_count
    FROM ${schema.rateLimitEvents}
    WHERE created_at >= ${oneDayAgo}
    GROUP BY DATE_TRUNC('hour', created_at)
    ORDER BY hour ASC
  `)) as unknown as Record<string, unknown>[];

  const botSignalBreakdown = (await db.execute(sql`
    SELECT
      signal_type,
      COUNT(*)::text AS signal_count,
      COUNT(DISTINCT user_id)::text AS unique_users
    FROM ${schema.botSignals}
    WHERE created_at >= ${sevenDaysAgo}
    GROUP BY signal_type
    ORDER BY COUNT(*) DESC
  `)) as unknown as Record<string, unknown>[];

  const suspiciousAccountsSummary = (await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE bot_score BETWEEN 31 AND 60)::text AS watch_list_count,
      COUNT(*) FILTER (WHERE bot_score > 60)::text AS flagged_count,
      COUNT(*) FILTER (WHERE bot_score > 60 AND reviewed_at IS NULL)::text AS pending_review_count,
      COALESCE(AVG(bot_score), 0)::text AS avg_bot_score
    FROM ${schema.suspiciousAccounts}
  `)) as unknown as Record<string, unknown>[];

  const topSuspiciousAccounts = (await db.execute(sql`
    SELECT
      sa.user_id,
      sa.bot_score::text AS bot_score,
      sa.flagged_at,
      sa.reviewed_at,
      p.handle AS username,
      COUNT(bs.id)::text AS signal_count
    FROM ${schema.suspiciousAccounts} sa
    JOIN ${schema.profiles} p ON p.id = sa.user_id
    LEFT JOIN ${schema.botSignals} bs ON bs.user_id = sa.user_id
    WHERE sa.bot_score > 30
    GROUP BY sa.user_id, sa.bot_score, sa.flagged_at, sa.reviewed_at, p.handle
    ORDER BY sa.bot_score DESC
    LIMIT 20
  `)) as unknown as Record<string, unknown>[];

  const summaryRow = suspiciousAccountsSummary[0] as Record<string, unknown> | undefined;

  return {
    rateLimitHits,
    rateLimitTimeline,
    botSignalBreakdown,
    suspiciousAccounts: summaryRow ?? {},
    topSuspiciousAccounts,
    generatedAt: now.toISOString(),
  };
});
