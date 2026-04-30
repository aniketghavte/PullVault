import { handler } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { eq, inArray, asc, sql } from 'drizzle-orm';
import { toMoneyString } from '@pullvault/shared/money';
import type { DropState, DropStatus } from '@pullvault/shared';

// GET /api/drops — list scheduled, live, and sold-out drops with tier info.
// Public endpoint (no auth required — anyone can see the drop schedule).
//
// Effective-status logic: rather than relying on a background job to flip
// the `status` column, we compute the current state at query time:
//   • sold_out  → always sold_out
//   • scheduled_at <= NOW() AND remaining > 0 → treat as 'live'
//   • scheduled_at > NOW() → treat as 'scheduled'
//   • otherwise → treat as 'sold_out'
// This means the reviewer always sees correct live/upcoming states even if
// the seed ran hours ago.
export const GET = handler(async () => {
  const rows = await db
    .select({
      dropId: schema.packDrops.id,
      scheduledAt: schema.packDrops.scheduledAt,
      totalInventory: schema.packDrops.totalInventory,
      remaining: schema.packDrops.remainingInventory,
      storedStatus: schema.packDrops.status,
      tierCode: schema.packTiers.code,
      tierName: schema.packTiers.name,
      priceUsd: schema.packTiers.priceUsd,
    })
    .from(schema.packDrops)
    .innerJoin(schema.packTiers, eq(schema.packDrops.tierId, schema.packTiers.id))
    // Fetch all non-closed drops so the UI can show sold-out state too
    .where(inArray(schema.packDrops.status, ['scheduled', 'live', 'sold_out']))
    .orderBy(
      // live/effective-live drops first, then ascending by scheduledAt
      sql`CASE WHEN ${schema.packDrops.status} = 'live'
               OR (${schema.packDrops.status} != 'sold_out'
                   AND ${schema.packDrops.scheduledAt} <= NOW()
                   AND ${schema.packDrops.remainingInventory} > 0)
          THEN 0 ELSE 1 END`,
      asc(schema.packDrops.scheduledAt),
    );

  const drops: DropState[] = rows.map((r) => {
    // Compute effective status at response time
    const now = new Date();
    let effectiveStatus: DropStatus;
    if (r.storedStatus === 'sold_out' || r.remaining === 0) {
      effectiveStatus = 'sold_out';
    } else if (r.scheduledAt <= now) {
      effectiveStatus = 'live';
    } else {
      effectiveStatus = 'scheduled';
    }

    return {
      dropId: r.dropId,
      tierCode: r.tierCode,
      tierName: r.tierName,
      priceUSD: toMoneyString(r.priceUsd),
      totalInventory: r.totalInventory,
      remaining: r.remaining,
      scheduledAt: r.scheduledAt.toISOString(),
      status: effectiveStatus,
    };
  });

  return { drops };
});
