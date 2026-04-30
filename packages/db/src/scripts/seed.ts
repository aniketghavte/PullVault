import 'dotenv/config';
import { eq, inArray, notExists, sql } from 'drizzle-orm';
import { getDb } from '../client';
import { packTiers, packDrops, packPurchases } from '../schema';
import { PACK_TIERS } from '@pullvault/shared/constants';

// Seeds the pack tier catalog. Real card data is loaded by an ETL step
// from the Pokemon TCG API on first server boot (see apps/realtime/src/jobs).
async function main() {
  const db = getDb();

  // ── 1. Upsert pack tiers ───────────────────────────────────────────────────
  for (const tier of PACK_TIERS) {
    const existing = await db
      .select({ id: packTiers.id })
      .from(packTiers)
      .where(eq(packTiers.code, tier.code))
      .limit(1);

    if (existing.length) {
      console.log(`tier ${tier.code} already exists`);
      continue;
    }

    await db.insert(packTiers).values({
      code: tier.code,
      name: tier.name,
      priceUsd: tier.priceUSD,
      cardsPerPack: tier.cardsPerPack,
      rarityWeights: tier.rarityWeights,
      active: true,
    });
    console.log(`seeded tier ${tier.code}`);
  }

  // ── 2. Insert fresh pack_drops relative to NOW() ───────────────────────────
  // Delete existing non-settled drops that have no purchase references.
  // Drops that are already purchased are left alone to avoid FK violations.
  await db
    .delete(packDrops)
    .where(
      sql`${inArray(packDrops.status, ['scheduled', 'live', 'sold_out'])}
          AND ${notExists(
            db
              .select({ one: sql`1` })
              .from(packPurchases)
              .where(eq(packPurchases.dropId, packDrops.id)),
          )}`,
    );
  console.log('cleared unreferenced pack_drops');

  // Look up tier IDs by code (UUIDs are generated at seed time).
  const tiers = await db.select({ id: packTiers.id, code: packTiers.code }).from(packTiers);
  const tierByCode = Object.fromEntries(tiers.map((t) => [t.code, t.id]));

  const now = new Date();

  await db.insert(packDrops).values([
    // Drop 1: live right now (started 2 minutes ago, still has inventory)
    {
      tierId: tierByCode['standard']!,
      scheduledAt: new Date(now.getTime() - 2 * 60 * 1000),
      totalInventory: 30,
      remainingInventory: 30,
      status: 'live',
    },
    // Drop 2: live right now (started 5 minutes ago)
    {
      tierId: tierByCode['premium']!,
      scheduledAt: new Date(now.getTime() - 5 * 60 * 1000),
      totalInventory: 20,
      remainingInventory: 20,
      status: 'live',
    },
    // Drop 3: upcoming in 15 minutes (shows countdown)
    {
      tierId: tierByCode['elite']!,
      scheduledAt: new Date(now.getTime() + 15 * 60 * 1000),
      totalInventory: 10,
      remainingInventory: 10,
      status: 'scheduled',
    },
    // Drop 4: upcoming in 45 minutes
    {
      tierId: tierByCode['whale']!,
      scheduledAt: new Date(now.getTime() + 45 * 60 * 1000),
      totalInventory: 5,
      remainingInventory: 5,
      status: 'scheduled',
    },
    // Drop 5: already sold out (shows sold-out state in UI)
    {
      tierId: tierByCode['standard']!,
      scheduledAt: new Date(now.getTime() - 30 * 60 * 1000),
      totalInventory: 30,
      remainingInventory: 0,
      status: 'sold_out',
    },
  ]);
  console.log('seeded 5 pack_drops (2 live, 2 scheduled, 1 sold_out)');

  console.log('Seed complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
