import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';

import { db, schema } from '@/lib/db';
import { handler } from '@/lib/api';
import type { CardSummary } from '@pullvault/shared';

const RARITIES = ['common', 'uncommon', 'rare', 'ultra_rare', 'secret_rare'] as const;
type Rarity = (typeof RARITIES)[number];

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * GET /api/cards?rarity=&q=&limit=&offset=
 * Public read of the card catalog backed by `cards` table. The denormalized
 * `market_price_usd` is the live valuation surface used by portfolio + reveal.
 */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const rarityParam = url.searchParams.get('rarity');
  const q = (url.searchParams.get('q') ?? '').trim();
  const limit = clamp(Number(url.searchParams.get('limit') ?? 60), 1, 200);
  const offset = clamp(Number(url.searchParams.get('offset') ?? 0), 0, 10_000);

  const filters = [] as ReturnType<typeof eq>[];
  if (rarityParam && (RARITIES as readonly string[]).includes(rarityParam)) {
    filters.push(eq(schema.cards.rarity, rarityParam as Rarity));
  }
  if (q.length > 0) {
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`;
    filters.push(
      or(ilike(schema.cards.name, like), ilike(schema.cards.setName, like)) as ReturnType<typeof eq>,
    );
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  const rows = await db
    .select({
      id: schema.cards.id,
      externalId: schema.cards.externalId,
      name: schema.cards.name,
      setName: schema.cards.setName,
      rarity: schema.cards.rarity,
      imageUrl: schema.cards.imageUrl,
      marketPriceUsd: schema.cards.marketPriceUsd,
      priceUpdatedAt: schema.cards.priceUpdatedAt,
    })
    .from(schema.cards)
    .where(where)
    .orderBy(desc(schema.cards.priceUpdatedAt))
    .limit(limit)
    .offset(offset);

  const totalRows = (await db.execute<{ total: string }>(sql`
    SELECT count(*)::text AS total FROM ${schema.cards} ${where ? sql`WHERE ${where}` : sql``}
  `)) as unknown as { total: string }[];
  const total = Number(totalRows[0]?.total ?? '0');

  const cards: CardSummary[] = rows.map((r) => ({
    id: r.id,
    externalId: r.externalId,
    name: r.name,
    set: r.setName,
    rarity: r.rarity as CardSummary['rarity'],
    imageUrl: r.imageUrl,
    marketPriceUSD: r.marketPriceUsd,
    priceUpdatedAt: r.priceUpdatedAt.toISOString(),
  }));

  return { cards, total, limit, offset };
});
