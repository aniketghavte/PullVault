import { NextResponse } from 'next/server';
import { db, schema } from '@/lib/db';
import { eq, inArray, notExists, sql } from 'drizzle-orm';

// POST /api/admin/refresh-drops
// Protected by the ADMIN_SECRET header. Deletes all scheduled/live drops and
// inserts 4 fresh ones with timestamps relative to NOW().
// Call this once before a review session to guarantee fresh drop data.
//
// Usage:
//   curl -X POST http://localhost:3000/api/admin/refresh-drops \
//        -H "x-admin-secret: <ADMIN_SECRET>"
export async function POST(req: Request) {
  const secret = req.headers.get('x-admin-secret');
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── 1. Delete all non-settled drops that have no purchase references ─────────
  // Drops with existing purchases are skipped to avoid FK constraint violations.
  await db
    .delete(schema.packDrops)
    .where(
      sql`${inArray(schema.packDrops.status, ['scheduled', 'live', 'sold_out'])}
          AND ${notExists(
            db
              .select({ one: sql`1` })
              .from(schema.packPurchases)
              .where(eq(schema.packPurchases.dropId, schema.packDrops.id)),
          )}`,
    );

  // ── 2. Look up tier IDs by code ──────────────────────────────────────────────
  const tiers = await db
    .select({ id: schema.packTiers.id, code: schema.packTiers.code })
    .from(schema.packTiers);

  if (tiers.length === 0) {
    return NextResponse.json(
      { error: 'No pack_tiers found. Run the seed script first.' },
      { status: 500 },
    );
  }

  const tierByCode = Object.fromEntries(tiers.map((t) => [t.code, t.id]));
  const now = new Date();

  // ── 3. Insert fresh drops relative to NOW() ──────────────────────────────────
  const inserted = await db
    .insert(schema.packDrops)
    .values([
      // Drop 1: live right now (started 2 minutes ago)
      {
        tierId: tierByCode['standard']!,
        scheduledAt: new Date(now.getTime() - 2 * 60 * 1000),
        totalInventory: 30,
        remainingInventory: 30,
        status: 'live' as const,
      },
      // Drop 2: live right now (started 5 minutes ago)
      {
        tierId: tierByCode['premium']!,
        scheduledAt: new Date(now.getTime() - 5 * 60 * 1000),
        totalInventory: 20,
        remainingInventory: 20,
        status: 'live' as const,
      },
      // Drop 3: upcoming in 15 minutes (shows countdown)
      {
        tierId: tierByCode['elite']!,
        scheduledAt: new Date(now.getTime() + 15 * 60 * 1000),
        totalInventory: 10,
        remainingInventory: 10,
        status: 'scheduled' as const,
      },
      // Drop 4: upcoming in 45 minutes
      {
        tierId: tierByCode['whale']!,
        scheduledAt: new Date(now.getTime() + 45 * 60 * 1000),
        totalInventory: 5,
        remainingInventory: 5,
        status: 'scheduled' as const,
      },
    ])
    .returning({ id: schema.packDrops.id, status: schema.packDrops.status });

  return NextResponse.json({ ok: true, refreshed: inserted.length, drops: inserted });
}
