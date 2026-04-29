import { sql } from 'drizzle-orm';
import { getDb, schema } from '@pullvault/db';
import { REDIS_KEYS } from '@pullvault/shared/constants';
import { getPublisher } from '@pullvault/shared/redis';
import { logger } from '@pullvault/shared/logger';
import { money, toMoneyString } from '@pullvault/shared/money';

import { env } from '../env.js';

type Rarity = 'common' | 'uncommon' | 'rare' | 'ultra_rare' | 'secret_rare';

type ApiCard = {
  id: string;
  name?: string;
  number?: string;
  rarity?: string;
  set?: { id?: string; name?: string };
  images?: { small?: string; large?: string };
  tcgplayer?: {
    prices?: Record<
      string,
      { low?: number; mid?: number; high?: number; market?: number; directLow?: number } | undefined
    >;
  };
  cardmarket?: {
    prices?: { averageSellPrice?: number; trendPrice?: number; lowPrice?: number };
  };
};

const SIM_BASE: Record<Rarity, number> = {
  common: 0.05,
  uncommon: 0.2,
  rare: 1.5,
  ultra_rare: 20,
  secret_rare: 120,
};

function fnv1a(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h >>> 0;
}

function rand01(seed: number): number {
  let x = seed >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 4294967295;
}

export function mapApiRarity(raw: unknown): Rarity {
  const s = String(raw ?? '').toLowerCase();
  if (s.includes('secret')) return 'secret_rare';
  if (s.includes('ultra') || s.includes('vmax') || s.includes(' v ') || s.endsWith(' v')) {
    return 'ultra_rare';
  }
  if (s.includes('uncommon')) return 'uncommon';
  if (s.includes('common')) return 'common';
  if (s.includes('holo') || s.includes('rare')) return 'rare';
  return 'common';
}

/**
 * Best price extraction. Pokemon TCG API ships variant pricing under
 * `tcgplayer.prices` and a euro-ish reference under `cardmarket.prices`.
 * We prefer USD market price; fall back to mid; finally cardmarket; finally
 * a deterministic simulated price keyed off the externalId + rarity.
 */
export function extractApiPrice(card: ApiCard, rarity: Rarity): { price: string; source: 'tcgplayer' | 'pokemontcg' | 'simulated' } {
  const variants = Object.values(card.tcgplayer?.prices ?? {}).filter(
    (v): v is { market?: number; mid?: number; low?: number; high?: number } => Boolean(v),
  );
  for (const v of variants) {
    if (typeof v.market === 'number' && Number.isFinite(v.market) && v.market > 0) {
      return { price: toMoneyString(v.market), source: 'tcgplayer' };
    }
  }
  for (const v of variants) {
    if (typeof v.mid === 'number' && Number.isFinite(v.mid) && v.mid > 0) {
      return { price: toMoneyString(v.mid), source: 'tcgplayer' };
    }
  }
  const cm = card.cardmarket?.prices;
  if (cm) {
    const candidate = cm.averageSellPrice ?? cm.trendPrice ?? cm.lowPrice;
    if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
      return { price: toMoneyString(candidate), source: 'pokemontcg' };
    }
  }
  return { price: simulatedPrice(card.id, rarity), source: 'simulated' };
}

export function simulatedPrice(externalId: string, rarity: Rarity): string {
  const base = SIM_BASE[rarity];
  const h = fnv1a(externalId);
  const factor = (0.65 + rand01(h) * 1.3) * (0.85 + rand01(h ^ 0x9e3779b9) * 0.3);
  return toMoneyString(base * factor);
}

/** Small deterministic walk for the "hot" mode to keep prices visibly alive. */
export function walkPrice(prevPrice: string, externalId: string, ts: number, rarity: Rarity): string {
  const seed = fnv1a(`${externalId}:${ts >> 14}`);
  const drift = (rand01(seed) - 0.5) * 0.06; // ±3%
  const next = money(prevPrice).times(1 + drift);
  if (next.lte(0)) return simulatedPrice(externalId, rarity);
  return toMoneyString(next);
}

function safeImage(card: ApiCard): string | null {
  return card.images?.small ?? card.images?.large ?? null;
}

async function fetchPokemonPage(page: number, pageSize: number, signal?: AbortSignal): Promise<ApiCard[]> {
  const url = new URL(`${env.POKEMON_TCG_API_URL}/cards`);
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('page', String(page));
  url.searchParams.set('orderBy', '-set.releaseDate');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (env.POKEMON_TCG_API_KEY) headers['X-Api-Key'] = env.POKEMON_TCG_API_KEY;
  const res = await fetch(url, { headers, signal });
  if (!res.ok) {
    throw new Error(`pokemon tcg api ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const json = (await res.json()) as { data?: ApiCard[] };
  return json.data ?? [];
}

type UpsertResult = {
  upserts: number;
  ticks: { cardId: string; externalId: string; priceUSD: string; source: string }[];
};

/**
 * Single-statement upsert into `cards` keyed by `external_id` + history
 * INSERT into `card_prices`, all in one DB transaction so the denormalized
 * `cards.market_price_usd` and the price-history row never disagree.
 */
async function upsertCardsBatch(rows: Array<{
  externalId: string;
  name: string;
  setCode: string;
  setName: string;
  number: string;
  rarity: Rarity;
  imageUrl: string;
  priceUSD: string;
  source: string;
}>): Promise<UpsertResult> {
  if (rows.length === 0) return { upserts: 0, ticks: [] };
  const db = getDb();
  const ticks: UpsertResult['ticks'] = [];

  await db.transaction(async (tx) => {
    for (const r of rows) {
      const [card] = await tx
        .insert(schema.cards)
        .values({
          externalId: r.externalId,
          name: r.name,
          setCode: r.setCode,
          setName: r.setName,
          number: r.number,
          rarity: r.rarity,
          imageUrl: r.imageUrl,
          marketPriceUsd: r.priceUSD,
        })
        .onConflictDoUpdate({
          target: schema.cards.externalId,
          set: {
            name: r.name,
            setCode: r.setCode,
            setName: r.setName,
            number: r.number,
            rarity: r.rarity,
            imageUrl: r.imageUrl,
            marketPriceUsd: r.priceUSD,
            priceUpdatedAt: sql`now()`,
          },
        })
        .returning({ id: schema.cards.id, externalId: schema.cards.externalId });

      if (!card) continue;

      await tx.insert(schema.cardPrices).values({
        cardId: card.id,
        priceUsd: r.priceUSD,
        source: r.source,
      });

      ticks.push({
        cardId: card.id,
        externalId: card.externalId,
        priceUSD: r.priceUSD,
        source: r.source,
      });
    }
  });

  return { upserts: ticks.length, ticks };
}

async function publishTicks(ticks: UpsertResult['ticks']): Promise<void> {
  if (ticks.length === 0) return;
  const payload = { ts: new Date().toISOString(), cards: ticks };
  try {
    await getPublisher().publish(REDIS_KEYS.channel.priceTicks, JSON.stringify(payload));
  } catch (err) {
    logger.warn({ err, count: ticks.length }, 'failed to publish price ticks');
  }
}

export async function runFullRefresh(opts: { pages?: number } = {}): Promise<{ upserts: number }> {
  const pages = Math.max(1, Math.min(opts.pages ?? 1, 8));
  const pageSize = 250;
  let total = 0;
  let allTicks: UpsertResult['ticks'] = [];

  for (let p = 1; p <= pages; p++) {
    const apiCards = await fetchPokemonPage(p, pageSize);
    if (apiCards.length === 0) break;
    const rows = apiCards
      .map((c) => {
        const img = safeImage(c);
        if (!img || !c.id || !c.name) return null;
        const rarity = mapApiRarity(c.rarity);
        const { price, source } = extractApiPrice(c, rarity);
        return {
          externalId: String(c.id).slice(0, 64),
          name: String(c.name).slice(0, 200),
          setCode: String(c.set?.id ?? 'unknown').slice(0, 32),
          setName: String(c.set?.name ?? 'Unknown').slice(0, 200),
          number: String(c.number ?? '').slice(0, 16),
          rarity,
          imageUrl: img,
          priceUSD: price,
          source,
        };
      })
      .filter((r): r is NonNullable<typeof r> => Boolean(r));

    const { upserts, ticks } = await upsertCardsBatch(rows);
    total += upserts;
    allTicks = allTicks.concat(ticks);
    logger.info({ page: p, upserts, totalSoFar: total }, 'price-refresh full page complete');
  }

  await publishTicks(allTicks);
  return { upserts: total };
}

export async function runHotRefresh(opts: { sample?: number } = {}): Promise<{ updated: number }> {
  const sample = Math.max(1, Math.min(opts.sample ?? 32, 200));
  const db = getDb();

  // Cards referenced by anything financially live take priority.
  const liveRows = await db.execute<{
    id: string;
    external_id: string;
    rarity: Rarity;
    market_price_usd: string;
  }>(sql`
    SELECT c.id, c.external_id, c.rarity, c.market_price_usd::text AS market_price_usd
    FROM cards c
    WHERE c.id IN (
      SELECT uc.card_id FROM listings l
      JOIN user_cards uc ON uc.id = l.user_card_id
      WHERE l.status = 'active'
      UNION
      SELECT uc.card_id FROM auctions a
      JOIN user_cards uc ON uc.id = a.user_card_id
      WHERE a.status IN ('scheduled','live','extended','settling')
      UNION
      SELECT card_id FROM pack_purchase_cards
      WHERE purchase_id IN (
        SELECT id FROM pack_purchases ORDER BY created_at DESC LIMIT 100
      )
    )
    LIMIT ${sample}
  `);

  let cardRows = (liveRows as unknown as { id: string; external_id: string; rarity: Rarity; market_price_usd: string }[]) ?? [];

  // If nothing is live, sample some random catalog rows so the channel never goes silent.
  if (cardRows.length === 0) {
    const fallback = await db.execute<{
      id: string;
      external_id: string;
      rarity: Rarity;
      market_price_usd: string;
    }>(sql`
      SELECT id, external_id, rarity, market_price_usd::text AS market_price_usd
      FROM cards
      ORDER BY random()
      LIMIT ${sample}
    `);
    cardRows = (fallback as unknown as { id: string; external_id: string; rarity: Rarity; market_price_usd: string }[]) ?? [];
  }

  if (cardRows.length === 0) {
    return { updated: 0 };
  }

  const ts = Date.now();
  const ticks: UpsertResult['ticks'] = [];

  await db.transaction(async (tx) => {
    for (const c of cardRows) {
      const next = walkPrice(c.market_price_usd, c.external_id, ts, c.rarity);
      await tx.execute(sql`
        UPDATE cards
        SET market_price_usd = ${next}::numeric, price_updated_at = now()
        WHERE id = ${c.id}::uuid
      `);
      await tx.insert(schema.cardPrices).values({
        cardId: c.id,
        priceUsd: next,
        source: 'simulated',
      });
      ticks.push({ cardId: c.id, externalId: c.external_id, priceUSD: next, source: 'simulated' });
    }
  });

  await publishTicks(ticks);
  return { updated: ticks.length };
}

export async function runSeedIfEmpty(opts: { pages?: number } = {}): Promise<{ upserts: number; skipped: boolean }> {
  const db = getDb();
  const rows = (await db.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM cards`,
  )) as unknown as Array<{ count: string }>;
  const current = Number(rows[0]?.count ?? '0');
  if (current > 0) return { upserts: 0, skipped: true };
  const { upserts } = await runFullRefresh({ pages: opts.pages ?? 1 });
  return { upserts, skipped: false };
}
