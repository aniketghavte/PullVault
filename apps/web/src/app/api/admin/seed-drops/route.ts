import { handler } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { PACK_TIERS } from '@pullvault/shared/constants';
import { eq } from 'drizzle-orm';

// POST /api/admin/seed-drops — seeds pack_tiers + pack_drops for testing.
// Creates one drop per tier, all going live in 30 seconds from now.
export const POST = handler(async () => {
  // 1. Upsert pack_tiers
  for (const tier of PACK_TIERS) {
    const [existing] = await db
      .select({ id: schema.packTiers.id })
      .from(schema.packTiers)
      .where(eq(schema.packTiers.code, tier.code))
      .limit(1);

    if (!existing) {
      await db.insert(schema.packTiers).values({
        code: tier.code,
        name: tier.name,
        priceUsd: tier.priceUSD,
        cardsPerPack: tier.cardsPerPack,
        rarityWeights: tier.rarityWeights,
        active: true,
      });
    }
  }

  // 2. Create one drop per tier, going live in 30 seconds
  const goLiveAt = new Date(Date.now() + 30_000);
  const tiers = await db.select().from(schema.packTiers);

  const created: Array<{ tierCode: string; dropId: string }> = [];

  for (const tier of tiers) {
    const inventory = tier.code === 'whale' ? 5 : tier.code === 'elite' ? 10 : 20;

    const [drop] = await db
      .insert(schema.packDrops)
      .values({
        tierId: tier.id,
        scheduledAt: goLiveAt,
        totalInventory: inventory,
        remainingInventory: inventory,
        status: 'live',
      })
      .returning({ id: schema.packDrops.id });

    if (drop) {
      created.push({ tierCode: tier.code, dropId: drop.id });
    }
  }

  return { seeded: created.length, drops: created };
});
