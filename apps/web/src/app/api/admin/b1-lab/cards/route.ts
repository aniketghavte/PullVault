import { desc, ilike } from 'drizzle-orm';

import { handler } from '@/lib/api';
import { requireUserId } from '@/lib/auth';
import { db, schema } from '@/lib/db';

// GET /api/admin/b1-lab/cards?q=...
// Demo helper: search cards by name for spike workflow.
export const GET = handler(async (req: Request) => {
  await requireUserId();

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') ?? '').trim();
  if (q.length < 2) return { cards: [] as Array<Record<string, unknown>> };

  const rows = await db
    .select({
      id: schema.cards.id,
      name: schema.cards.name,
      rarity: schema.cards.rarity,
      marketPriceUsd: schema.cards.marketPriceUsd,
      setName: schema.cards.setName,
    })
    .from(schema.cards)
    .where(ilike(schema.cards.name, `%${q}%`))
    .orderBy(desc(schema.cards.marketPriceUsd))
    .limit(10);

  return { cards: rows };
});
