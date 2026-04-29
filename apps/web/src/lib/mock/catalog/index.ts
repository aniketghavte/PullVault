export type CatalogRarity = 'common' | 'uncommon' | 'rare' | 'ultra_rare' | 'secret_rare';

export type CatalogCard = {
  id: string;
  externalId: string;
  name: string;
  set: string;
  rarity: CatalogRarity;
  imageUrl: string;
  marketPriceUSD: string; // 2dp
};

type SnapshotPayload = {
  generatedAt: string;
  count: number;
  cards: CatalogCard[];
};

import baseSnapshot from './snapshot.json';

const STORAGE_KEY = 'pv:mock:catalog';

let memCache: CatalogCard[] | null = null;

function mapApiRarity(rarity: unknown): CatalogRarity {
  const s = String(rarity ?? '').toLowerCase();
  if (s.includes('secret')) return 'secret_rare';
  if (s.includes('ultra')) return 'ultra_rare';
  if (s.includes('common')) return 'common';
  if (s.includes('uncommon')) return 'uncommon';
  if (s.includes('holo') || s.includes('rare')) return 'rare';
  return 'common';
}

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h >>> 0;
}

function rand01(seed: number) {
  let x = seed >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return (x >>> 0) / 4294967295;
}

function simulateMarketPriceUSD(id: string, rarity: CatalogRarity) {
  const baseByRarity: Record<CatalogRarity, number> = {
    common: 0.05,
    uncommon: 0.2,
    rare: 1.5,
    ultra_rare: 20.0,
    secret_rare: 120.0,
  };
  const base = baseByRarity[rarity] ?? 0.05;
  const h = hash(id);
  const r1 = rand01(h);
  const r2 = rand01(h + 1337);
  const factor = (0.65 + r1 * 1.3) * (0.85 + r2 * 0.3);
  const price = base * factor;
  return price.toFixed(2);
}

function cardImageUrl(c: any): string | null {
  return c?.images?.small ?? c?.images?.large ?? c?.images?.medium ?? null;
}

export async function getCatalog(): Promise<CatalogCard[]> {
  if (memCache) return memCache;

  try {
    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as CatalogCard[];
        memCache = parsed;
        return memCache;
      }
    }
  } catch {
    // ignore
  }

  const snapshot = baseSnapshot as unknown as SnapshotPayload;
  memCache = snapshot.cards;
  return memCache;
}

export async function refreshCatalogFromApi(): Promise<void> {
  const res = await fetch('https://api.pokemontcg.io/v2/cards?pageSize=250');
  if (!res.ok) throw new Error(`Pokemon TCG API failed: ${res.status}`);
  const json = (await res.json()) as { data: any[] };

  const cards: CatalogCard[] = [];
  for (const c of json.data ?? []) {
    const rarity = mapApiRarity(c.rarity);
    const img = cardImageUrl(c);
    if (!img) continue;

    cards.push({
      id: String(c.id),
      externalId: String(c.tcgplayer?.productId ?? c.id),
      name: String(c.name ?? ''),
      set: String(c.set?.name ?? c.set?.series ?? 'Unknown'),
      rarity,
      imageUrl: img,
      marketPriceUSD: simulateMarketPriceUSD(String(c.id), rarity),
    });
  }

  cards.sort((a, b) => a.rarity.localeCompare(b.rarity));
  const pick = cards.slice(0, 220);
  memCache = pick;

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pick));
  }
}

export const MOCK_CATALOG = {
  mapApiRarity,
  simulateMarketPriceUSD,
};

