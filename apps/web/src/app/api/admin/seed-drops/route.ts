import { handler, ApiError } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { PACK_TIERS } from '@pullvault/shared/constants';
import { ERROR_CODES } from '@pullvault/shared';
import { logger } from '@pullvault/shared/logger';

// POST /api/admin/seed-drops
//
// Seeds pack tiers and creates test drops for development / QA.
// This is NOT a production endpoint — it exists to bootstrap the system.
//
// Body (optional):
//   {
//     "inventoryPerDrop": 10,      // default 10
//     "minutesFromNow": 1,         // default: 1 minute delay for scheduled drops
//     "liveNow": true              // default: true — create one live drop per tier
//   }

export const POST = handler(async (req: Request) => {
  let body: {
    inventoryPerDrop?: number;
    minutesFromNow?: number;
    liveNow?: boolean;
  } = {};

  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const inventoryPerDrop = body.inventoryPerDrop ?? 10;
  const minutesFromNow = body.minutesFromNow ?? 2;
  const createLive = body.liveNow !== false; // default true

  // 1. Upsert pack tiers from constants
  const upsertedTiers: Array<{ id: string; code: string }> = [];

  for (const t of PACK_TIERS) {
    // Check if tier exists
    const [existing] = await db
      .select({ id: schema.packTiers.id })
      .from(schema.packTiers)
      .where(eq(schema.packTiers.code, t.code))
      .limit(1);

    if (existing) {
      upsertedTiers.push({ id: existing.id, code: t.code });
    } else {
      const [inserted] = await db
        .insert(schema.packTiers)
        .values({
          code: t.code,
          name: t.name,
          priceUsd: t.priceUSD,
          cardsPerPack: t.cardsPerPack,
          rarityWeights: t.rarityWeights,
          active: true,
        })
        .returning({ id: schema.packTiers.id });

      if (inserted) {
        upsertedTiers.push({ id: inserted.id, code: t.code });
      }
    }
  }

  // 2. Create drops
  const createdDrops: Array<{ id: string; tierCode: string; status: string }> = [];

  for (const tier of upsertedTiers) {
    // Create a "live now" drop
    if (createLive) {
      const [drop] = await db
        .insert(schema.packDrops)
        .values({
          tierId: tier.id,
          scheduledAt: new Date(), // now
          totalInventory: inventoryPerDrop,
          remainingInventory: inventoryPerDrop,
          status: 'live',
        })
        .returning({ id: schema.packDrops.id });

      if (drop) {
        createdDrops.push({ id: drop.id, tierCode: tier.code, status: 'live' });
      }
    }

    // Create a future "scheduled" drop
    const scheduledAt = new Date(Date.now() + minutesFromNow * 60_000);
    const [scheduledDrop] = await db
      .insert(schema.packDrops)
      .values({
        tierId: tier.id,
        scheduledAt,
        totalInventory: inventoryPerDrop,
        remainingInventory: inventoryPerDrop,
        status: 'scheduled',
      })
      .returning({ id: schema.packDrops.id });

    if (scheduledDrop) {
      createdDrops.push({ id: scheduledDrop.id, tierCode: tier.code, status: 'scheduled' });
    }
  }

  logger.info(
    { tiersCount: upsertedTiers.length, dropsCount: createdDrops.length },
    'seed-drops complete',
  );

  return {
    tiers: upsertedTiers,
    drops: createdDrops,
  };
});
