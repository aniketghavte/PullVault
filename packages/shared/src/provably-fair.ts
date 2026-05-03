const DRAW_ORDER = ['common', 'uncommon', 'rare', 'ultra_rare', 'secret_rare'] as const;
const FALLBACK_RARITY = 'secret_rare';

export interface SeedPair {
  serverSeed: string;
  serverSeedHash: string;
}

export interface VerifiedCard {
  drawIndex: number;
  float: number;
  rarity: string;
  cardId: string;
  matched: boolean;
}

export interface VerificationResult {
  hashValid: boolean;
  allMatched: boolean;
  cards: VerifiedCard[];
}

function getCrypto() {
  const c = globalThis.crypto;
  if (!c) {
    throw new Error('Web Crypto API is unavailable in this runtime.');
  }
  return c as any;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(input: string): Promise<string> {
  const crypto = getCrypto();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256Hex(keyHex: string, message: string): Promise<string> {
  const crypto = getCrypto();
  const keyBytes = new Uint8Array((keyHex.match(/.{1,2}/g) ?? []).map((x) => Number.parseInt(x, 16)));
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToHex(new Uint8Array(signature));
}

export async function hashSeed(seed: string): Promise<string> {
  return sha256Hex(seed);
}

export async function generateSeedPair(): Promise<SeedPair> {
  const crypto = getCrypto();
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const serverSeed = bytesToHex(bytes);
  const serverSeedHash = await hashSeed(serverSeed);
  return { serverSeed, serverSeedHash };
}

export async function generateDrawFloat(
  serverSeed: string,
  clientSeed: string,
  purchaseId: string,
  drawIndex: number,
): Promise<number> {
  const message = `${clientSeed}:${purchaseId}:${drawIndex}`;
  const hmac = await hmacSha256Hex(serverSeed, message);
  const value = Number.parseInt(hmac.slice(0, 8), 16);
  return value / 0x100000000;
}

export function floatToRarity(float: number, weights: Record<string, number>): string {
  let cumulative = 0;
  for (const rarity of DRAW_ORDER) {
    cumulative += weights[rarity] ?? 0;
    if (float < cumulative) return rarity;
  }

  if (weights.ultra && !weights.ultra_rare) {
    cumulative = 0;
    const legacyOrder = ['common', 'uncommon', 'rare', 'ultra', 'secret'];
    for (const rarity of legacyOrder) {
      cumulative += weights[rarity] ?? 0;
      if (float < cumulative) return rarity;
    }
    return legacyOrder[legacyOrder.length - 1]!;
  }

  return DRAW_ORDER.at(-1) ?? FALLBACK_RARITY;
}

export async function verifyPurchase(params: {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  purchaseId: string;
  rarityWeights: Record<string, number>;
  drawnCards: Array<{ drawIndex: number; rarity: string; cardId: string }>;
}): Promise<VerificationResult> {
  const { serverSeed, serverSeedHash, clientSeed, purchaseId, rarityWeights, drawnCards } = params;
  const hashValid = (await hashSeed(serverSeed)) === serverSeedHash;

  const cards = await Promise.all(
    drawnCards.map(async ({ drawIndex, rarity, cardId }) => {
      const float = await generateDrawFloat(serverSeed, clientSeed, purchaseId, drawIndex);
      const recomputedRarity = floatToRarity(float, rarityWeights);
      return {
        drawIndex,
        float,
        rarity: recomputedRarity,
        cardId,
        matched: recomputedRarity === rarity,
      } satisfies VerifiedCard;
    }),
  );

  return {
    hashValid,
    allMatched: cards.every((c) => c.matched),
    cards,
  };
}
