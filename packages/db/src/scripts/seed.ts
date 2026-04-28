import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { getDb } from '../client';
import { packTiers } from '../schema';
import { PACK_TIERS } from '@pullvault/shared/constants';

// Seeds the pack tier catalog. Real card data is loaded by an ETL step
// from the Pokemon TCG API on first server boot (see apps/realtime/src/jobs).
async function main() {
  const db = getDb();

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

  console.log('Seed complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
