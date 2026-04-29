import { handler, ApiError } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { toMoneyString } from '@pullvault/shared/money';
import { ERROR_CODES } from '@pullvault/shared';
import type { DropState } from '@pullvault/shared';

// GET /api/drops/:dropId — single drop detail with tier info.
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ dropId: string }> }) => {
  const { dropId } = await ctx.params;

  const [row] = await db
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
    .where(eq(schema.packDrops.id, dropId))
    .limit(1);

  if (!row) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, 'Drop not found.');
  }

  const drop: DropState = {
    dropId: row.dropId,
    tierCode: row.tierCode,
    tierName: row.tierName,
    priceUSD: toMoneyString(row.priceUsd),
    totalInventory: row.totalInventory,
    remaining: row.remaining,
    scheduledAt: row.scheduledAt.toISOString(),
    status: row.status,
  };

  return { drop };
});
