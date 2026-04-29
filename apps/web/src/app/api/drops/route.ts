import { handler } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { eq, inArray, desc } from 'drizzle-orm';
import { toMoneyString } from '@pullvault/shared/money';
import type { DropState } from '@pullvault/shared';

// GET /api/drops — list scheduled, live, and sold-out drops with tier info.
// Public endpoint (no auth required — anyone can see the drop schedule).
export const GET = handler(async () => {
  const rows = await db
    .select({
      dropId: schema.packDrops.id,
      tierId: schema.packDrops.tierId,
      scheduledAt: schema.packDrops.scheduledAt,
      totalInventory: schema.packDrops.totalInventory,
      remaining: schema.packDrops.remainingInventory,
      status: schema.packDrops.status,
      tierCode: schema.packTiers.code,
      tierName: schema.packTiers.name,
      priceUsd: schema.packTiers.priceUsd,
    })
    .from(schema.packDrops)
    .innerJoin(schema.packTiers, eq(schema.packDrops.tierId, schema.packTiers.id))
    .where(inArray(schema.packDrops.status, ['scheduled', 'live', 'sold_out']))
    .orderBy(desc(schema.packDrops.scheduledAt));

  const drops: DropState[] = rows.map((r) => ({
    dropId: r.dropId,
    tierCode: r.tierCode,
    tierName: r.tierName,
    priceUSD: toMoneyString(r.priceUsd),
    totalInventory: r.totalInventory,
    remaining: r.remaining,
    scheduledAt: r.scheduledAt.toISOString(),
    status: r.status,
  }));

  return { drops };
});
