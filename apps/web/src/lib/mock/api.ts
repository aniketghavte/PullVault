'use client';

import { PLATFORM, PACK_TIERS } from '@pullvault/shared/constants';
import { Decimal, add, feeOf, gte, money, mul, sub, toMoneyString } from '@pullvault/shared/money';

import type { ApiResponse, ErrorCode } from '@pullvault/shared/types';

import { getCatalog } from './catalog';
import { MOCK_CATALOG } from './catalog';
import { useMockStore } from './store';
import type { Auction, Drop, Listing, PackPurchase, UserCard } from './types';

type Err = { code: ErrorCode; message: string };

function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, data } as const;
}

function fail<T = never>(error: Err): ApiResponse<T> {
  return { ok: false, error } as const;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isoNow() {
  return new Date().toISOString();
}

function packTierByCode(code: string) {
  const tier = PACK_TIERS.find((t) => t.code === code);
  if (!tier) throw new Error(`Unknown pack tier: ${code}`);
  return tier;
}

function rarityRank(r: string) {
  switch (r) {
    case 'common':
      return 0;
    case 'uncommon':
      return 1;
    case 'rare':
      return 2;
    case 'ultra_rare':
      return 3;
    case 'secret_rare':
      return 4;
    default:
      return 9;
  }
}

function weightedRandomRarity(rarityWeights: Record<string, number>, seed: string) {
  // Deterministic weighted roll from a seed, so purchase contents are stable for the UI.
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  let r = (h % 10000) / 10000;

  const entries = Object.entries(rarityWeights);
  let acc = 0;
  for (const [rarity, weight] of entries) {
    acc += weight;
    if (r <= acc) return rarity;
  }
  return entries[entries.length - 1]?.[0] ?? 'common';
}

function pickCardByRarity(catalog: Awaited<ReturnType<typeof getCatalog>>, rarity: string, seed: string) {
  if (catalog.length === 0) throw new Error('Mock catalog is empty');
  const bucket = catalog.filter((c) => c.rarity === rarity);
  if (bucket.length === 0) {
    // Fallback to any card if a bucket is unexpectedly empty.
    const fallback = catalog[hashString(seed) % catalog.length];
    if (!fallback) throw new Error('Mock catalog fallback failed');
    return fallback;
  }
  const idx = hashString(seed) % bucket.length;
  const picked = bucket[idx];
  if (!picked) throw new Error('Mock card pick failed');
  return picked;
}

function hashString(str: string) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 33 + str.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function currentEVPackUSD(tierCode: string, catalog: Awaited<ReturnType<typeof getCatalog>>) {
  const tier = packTierByCode(tierCode);
  const buckets: Record<string, { sum: Decimal; n: number }> = {};
  for (const c of catalog) {
    buckets[c.rarity] = buckets[c.rarity] ?? { sum: money(0), n: 0 };
    buckets[c.rarity]!.sum = buckets[c.rarity]!.sum.plus(money(c.marketPriceUSD));
    buckets[c.rarity]!.n += 1;
  }

  const expectedPerCard = Object.entries(tier.rarityWeights).reduce((acc, [rarity, w]) => {
    const b = buckets[rarity];
    const mean = b && b.n > 0 ? b.sum.dividedBy(b.n) : money(0);
    return acc.plus(mean.times(w));
  }, money(0));

  const evPack = expectedPerCard.times(tier.cardsPerPack);
  return evPack;
}

async function ensureInit() {
  const store = useMockStore.getState();
  if (!store.initialized) {
    await store.initialize();
  }
}

async function jitter() {
  await sleep(120 + Math.floor(Math.random() * 160));
}

export const mockApi = {
  me: {
    get: async (): Promise<ApiResponse<{ id: string; email: string; displayName: string; availableUSD: string; heldUSD: string }>> => {
      await ensureInit();
      await jitter();
      const s = useMockStore.getState();
      return ok({ id: s.me.id, email: s.me.email, displayName: s.me.displayName, availableUSD: s.me.availableUSD, heldUSD: s.me.heldUSD });
    },
  },

  drops: {
    list: async (): Promise<ApiResponse<Drop[]>> => {
      await ensureInit();
      await jitter();
      const now = Date.now();
      useMockStore.getState().refreshNow(now);
      return ok(useMockStore.getState().drops);
    },
    get: async (dropId: string): Promise<ApiResponse<Drop>> => {
      await ensureInit();
      await jitter();
      useMockStore.getState().refreshNow(Date.now());
      const drop = useMockStore.getState().drops.find((d) => d.dropId === dropId);
      if (!drop) return fail({ code: 'NOT_FOUND', message: 'Drop not found' });
      return ok(drop);
    },
    buyPack: async (dropId: string, idempotencyKey: string): Promise<ApiResponse<{ purchaseId: string }>> => {
      await ensureInit();
      await jitter();

      const s = useMockStore.getState();
      const drop = s.drops.find((d) => d.dropId === dropId);
      if (!drop) return fail({ code: 'NOT_FOUND', message: 'Drop not found' });

      const key = `${s.me.id}:${drop.dropId}:${idempotencyKey}`;
      const existing = s.packPurchaseByIdempotencyKey[key];
      if (existing) return ok({ purchaseId: existing });

      if (drop.status !== 'live' || drop.remaining <= 0) {
        return fail({ code: 'SOLD_OUT', message: 'Sold out' });
      }

      if (!gte(s.me.availableUSD, drop.priceUSD)) {
        return fail({ code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds' });
      }

      const catalog = await getCatalog();
      const tier = packTierByCode(drop.tierCode);

      // Weighted rarity rolls and deterministic card selection.
      const drawn: PackPurchase['drawnCards'] = [];
      for (let i = 0; i < tier.cardsPerPack; i++) {
        const rarity = weightedRandomRarity(
          tier.rarityWeights,
          `${drop.dropId}:${idempotencyKey}:pos:${i}`,
        ) as PackPurchase['drawnCards'][number]['rarity'];
        const card = pickCardByRarity(catalog, rarity, `${drop.dropId}:${idempotencyKey}:${i}:card`);
        drawn.push({
          rarity,
          card: {
            externalId: card.externalId,
            name: card.name,
            set: card.set,
            rarity: card.rarity,
            imageUrl: card.imageUrl,
            marketPriceUSD: card.marketPriceUSD,
          },
          drawPriceUSD: card.marketPriceUSD,
        });
      }

      // Reveal tension: commons first.
      drawn.sort((a, b) => rarityRank(a.rarity) - rarityRank(b.rarity));

      const purchaseId = `pur_${crypto.randomUUID()}`;
      useMockStore.setState((prev: any) => {
        const currentDrop = prev.drops.find((d: Drop) => d.dropId === dropId);
        if (!currentDrop) return prev;

        // Double-check sold-out in case two calls race in the UI.
        if (currentDrop.remaining <= 0 || currentDrop.status !== 'live') return prev;
        if (!gte(prev.me.availableUSD, drop.priceUSD)) return prev;

        const nextDrops = prev.drops.map((d: Drop) => {
          if (d.dropId !== dropId) return d;
          return { ...d, remaining: d.remaining - 1, status: d.remaining - 1 <= 0 ? 'sold_out' : d.status };
        });

        // Debits.
        const nextMe = {
          ...prev.me,
          availableUSD: toMoneyString(sub(prev.me.availableUSD, drop.priceUSD)),
        };

        const nextPurchases = [
          ...prev.purchases,
          {
            purchaseId,
            userId: prev.me.id,
            dropId,
            tierCode: drop.tierCode,
            pricePaidUSD: drop.priceUSD,
            purchasedAt: isoNow(),
            drawnCards: drawn,
            revealedCount: 0,
          } satisfies PackPurchase,
        ];

        // Platform margin (mock): price - expected value of pack.
        const evPack = currentEVPackUSD(drop.tierCode, catalog);
        const margin = money(drop.priceUSD).minus(evPack);
        const nextLedger =
          margin.gt(0)
            ? [
                ...prev.ledger,
                {
                  id: `led_pack_margin_${purchaseId}`,
                  createdAt: isoNow(),
                  kind: 'platform_fee',
                  userId: null,
                  amountUSD: toMoneyString(margin),
                  referenceId: dropId,
                },
              ]
            : prev.ledger;

        return {
          ...prev,
          drops: nextDrops,
          me: nextMe,
          purchases: nextPurchases,
          ledger: nextLedger,
          packPurchaseByIdempotencyKey: { ...prev.packPurchaseByIdempotencyKey, [key]: purchaseId },
        } as any;
      });

      return ok({ purchaseId });
    },
  },

  packs: {
    get: async (purchaseId: string): Promise<ApiResponse<PackPurchase>> => {
      await ensureInit();
      await jitter();
      const purchase = useMockStore.getState().purchases.find((p) => p.purchaseId === purchaseId);
      if (!purchase) return fail({ code: 'NOT_FOUND', message: 'Purchase not found' });
      return ok(purchase);
    },
    reveal: async (purchaseId: string, position: number): Promise<ApiResponse<{ revealedCount: number }>> => {
      await ensureInit();
      await jitter();

      const nowISO = isoNow();
      const s = useMockStore.getState();
      const purchase = s.purchases.find((p) => p.purchaseId === purchaseId);
      if (!purchase) return fail({ code: 'NOT_FOUND', message: 'Purchase not found' });

      if (position < purchase.revealedCount) return ok({ revealedCount: purchase.revealedCount });
      if (position !== purchase.revealedCount) {
        return fail({ code: 'CONFLICT', message: 'Reveal must be sequential' });
      }

      const drawn = purchase.drawnCards[position];
      if (!drawn) return fail({ code: 'NOT_FOUND', message: 'No card at position' });

      useMockStore.setState((prev: any) => {
        const p = prev.purchases.find((pp: PackPurchase) => pp.purchaseId === purchaseId);
        if (!p) return prev;
        if (position !== p.revealedCount) return prev;

        const newUserCard: UserCard = {
          userCardId: `uc_${purchaseId}_${position}`,
          ownerId: prev.me.id,
          ownerHandle: 'You',
          status: 'held',
          acquiredAt: nowISO,
          acquiredPriceUSD: drawn.drawPriceUSD,
          externalId: drawn.card.externalId,
          name: drawn.card.name,
          set: drawn.card.set,
          rarity: drawn.card.rarity,
          imageUrl: drawn.card.imageUrl,
          marketPriceUSD: drawn.card.marketPriceUSD,
        };

        const nextPurchases = prev.purchases.map((pp: PackPurchase) => (pp.purchaseId === purchaseId ? { ...pp, revealedCount: pp.revealedCount + 1 } : pp));

        return { ...prev, purchases: nextPurchases, userCards: [...prev.userCards, newUserCard] } as any;
      });

      const nextPurchase = useMockStore.getState().purchases.find((p) => p.purchaseId === purchaseId)!;
      return ok({ revealedCount: nextPurchase.revealedCount });
    },
  },

  portfolio: {
    list: async (): Promise<ApiResponse<UserCard[]>> => {
      await ensureInit();
      await jitter();
      const s = useMockStore.getState();
      return ok(s.userCards.filter((uc) => uc.ownerId === s.me.id && uc.status === 'held'));
    },
    getCard: async (userCardId: string): Promise<ApiResponse<UserCard>> => {
      await ensureInit();
      await jitter();
      const s = useMockStore.getState();
      const card = s.userCards.find((uc) => uc.userCardId === userCardId && uc.ownerId === s.me.id);
      if (!card) return fail({ code: 'NOT_FOUND', message: 'Card not found' });
      return ok(card);
    },
  },

  listings: {
    list: async (): Promise<ApiResponse<Listing[]>> => {
      await ensureInit();
      await jitter();
      const s = useMockStore.getState();
      return ok(s.listings.filter((l) => l.status === 'active'));
    },
    get: async (listingId: string): Promise<ApiResponse<{ listing: Listing; card: UserCard }>> => {
      await ensureInit();
      await jitter();
      const s = useMockStore.getState();
      const listing = s.listings.find((l) => l.listingId === listingId && l.status === 'active');
      if (!listing) return fail({ code: 'NOT_FOUND', message: 'Listing not found' });
      const card = s.userCards.find((uc) => uc.userCardId === listing.userCardId);
      if (!card) return fail({ code: 'NOT_FOUND', message: 'Card not found' });
      return ok({ listing, card });
    },
    create: async (input: { userCardId: string; priceUSD: string }): Promise<ApiResponse<{ listingId: string }>> => {
      await ensureInit();
      await jitter();
      const s = useMockStore.getState();
      const card = s.userCards.find((uc) => uc.userCardId === input.userCardId && uc.ownerId === s.me.id);
      if (!card) return fail({ code: 'NOT_FOUND', message: 'Card not found' });
      if (card.status !== 'held') return fail({ code: 'CONFLICT', message: 'Card is not held' });

      const listingId = `lst_${crypto.randomUUID()}`;
      useMockStore.setState((prev: any) => ({
        ...prev,
        userCards: prev.userCards.map((uc: UserCard) => (uc.userCardId === input.userCardId ? { ...uc, status: 'listed' } : uc)),
        listings: [
          ...prev.listings,
          {
            listingId,
            userCardId: input.userCardId,
            sellerId: prev.me.id,
            sellerHandle: 'You',
            priceUSD: input.priceUSD,
            status: 'active',
            createdAt: isoNow(),
          },
        ],
      }) as any);
      return ok({ listingId });
    },
    buy: async (listingId: string, idempotencyKey?: string): Promise<ApiResponse<{ userCardId: string }>> => {
      await ensureInit();
      await jitter();
      const s = useMockStore.getState();
      const listing = s.listings.find((l) => l.listingId === listingId && l.status === 'active');
      if (!listing) return fail({ code: 'NOT_FOUND', message: 'Listing not found' });
      const card = s.userCards.find((uc) => uc.userCardId === listing.userCardId);
      if (!card) return fail({ code: 'NOT_FOUND', message: 'Card not found' });

      const buyerAvailable = s.me.availableUSD;
      if (!gte(buyerAvailable, listing.priceUSD)) return fail({ code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds' });

      const key = idempotencyKey ? `${s.me.id}:${listingId}:${idempotencyKey}` : undefined;
      // For mock simplicity, ignore idempotency on marketplace buys.

      useMockStore.setState((prev: any) => {
        const latestListing = prev.listings.find((l: Listing) => l.listingId === listingId && l.status === 'active');
        if (!latestListing) return prev;
        if (!gte(prev.me.availableUSD, latestListing.priceUSD)) return prev;

        const platformFee = feeOf(latestListing.priceUSD, PLATFORM.TRADE_FEE_RATE);

        const nextMe = {
          ...prev.me,
          availableUSD: toMoneyString(sub(prev.me.availableUSD, latestListing.priceUSD)),
        };

        const nextUserCards = prev.userCards.map((uc: UserCard) => {
          if (uc.userCardId !== latestListing.userCardId) return uc;
          return {
            ...uc,
            ownerId: prev.me.id,
            ownerHandle: 'You',
            status: 'held',
          };
        });

        const nextListings = prev.listings.map((l: Listing) =>
          l.listingId === listingId ? { ...l, status: 'sold' as const } : l,
        );

        return {
          ...prev,
          me: nextMe,
          userCards: nextUserCards,
          listings: nextListings,
          ledger: [
            ...prev.ledger,
            {
              id: `led_trade_fee_${listingId}_${Date.now()}`,
              createdAt: isoNow(),
              kind: 'platform_fee',
              userId: null,
              amountUSD: toMoneyString(platformFee),
              referenceId: listingId,
            },
          ],
        } as any;
      });

      return ok({ userCardId: listing.userCardId });
    },
  },

  auctions: {
    list: async (): Promise<ApiResponse<Auction[]>> => {
      await ensureInit();
      await jitter();
      const now = Date.now();
      useMockStore.getState().refreshNow(now);
      return ok(useMockStore.getState().auctions);
    },
    get: async (auctionId: string): Promise<ApiResponse<Auction>> => {
      await ensureInit();
      await jitter();
      useMockStore.getState().refreshNow(Date.now());
      const auction = useMockStore.getState().auctions.find((a) => a.auctionId === auctionId);
      if (!auction) return fail({ code: 'NOT_FOUND', message: 'Auction not found' });
      return ok(auction);
    },
    create: async (input: { userCardId: string; startingBidUSD: string; durationMinutes: number }): Promise<ApiResponse<{ auctionId: string }>> => {
      await ensureInit();
      await jitter();
      const s = useMockStore.getState();
      const card = s.userCards.find((uc) => uc.userCardId === input.userCardId && uc.ownerId === s.me.id);
      if (!card) return fail({ code: 'NOT_FOUND', message: 'Card not found' });
      if (card.status !== 'held') return fail({ code: 'CONFLICT', message: 'Card must be held' });

      const auctionId = `auc_${crypto.randomUUID()}`;
      const endAt = new Date(Date.now() + input.durationMinutes * 60_000).toISOString();

      useMockStore.setState((prev: any) => ({
        ...prev,
        userCards: prev.userCards.map((uc: UserCard) => (uc.userCardId === input.userCardId ? { ...uc, status: 'in_auction' } : uc)),
        auctions: [
          ...prev.auctions,
          {
            auctionId,
            userCardId: input.userCardId,
            sellerId: prev.me.id,
            sellerHandle: 'You',
            card: {
              name: card.name,
              set: card.set,
              rarity: card.rarity,
              imageUrl: card.imageUrl,
              marketPriceUSD: card.marketPriceUSD,
              externalId: card.externalId,
            },
            startingBidUSD: input.startingBidUSD,
            currentHighBidUSD: input.startingBidUSD,
            currentHighBidderId: prev.me.id,
            currentHighBidderHandle: 'You',
            endAt,
            extensions: 0,
            watcherCount: 0,
            status: 'live',
            bids: [],
          },
        ],
      }) as any);

      return ok({ auctionId });
    },
    placeBid: async (auctionId: string, amountUSD: string, idempotencyKey?: string): Promise<ApiResponse<{ bidId: string }>> => {
      await ensureInit();
      await jitter();

      const s = useMockStore.getState();
      const auction = s.auctions.find((a) => a.auctionId === auctionId);
      if (!auction) return fail({ code: 'NOT_FOUND', message: 'Auction not found' });
      if (auction.status !== 'live' && auction.status !== 'extended') return fail({ code: 'AUCTION_CLOSED', message: 'Auction closed' });

      const key = idempotencyKey ? `${s.me.id}:${auctionId}:${idempotencyKey}` : null;
      if (key && s.bidsByIdempotencyKey[key]) return ok({ bidId: s.bidsByIdempotencyKey[key] });

      const nowMs = Date.now();
      const endAtMs = new Date(auction.endAt).getTime();
      if (endAtMs <= nowMs) return fail({ code: 'AUCTION_CLOSED', message: 'Auction closed' });

      const minUsd = money(PLATFORM.MIN_BID_INCREMENT_USD);
      const minPct = money(PLATFORM.MIN_BID_INCREMENT_PCT);
      const currentHigh = money(auction.currentHighBidUSD);
      const incFromPct = currentHigh.times(minPct);
      const increment = incFromPct.gt(minUsd) ? incFromPct : minUsd;
      const minRequired = currentHigh.plus(increment);

      if (money(amountUSD).lt(minRequired)) return fail({ code: 'BID_TOO_LOW', message: 'Bid too low' });

      const heldForThisAuction = s.heldAuctionAmounts[auctionId] ?? '0.00';
      const additionalNeeded = money(amountUSD).minus(heldForThisAuction);
      if (additionalNeeded.gt(0) && !gte(s.me.availableUSD, additionalNeeded)) {
        return fail({ code: 'INSUFFICIENT_FUNDS', message: 'Insufficient funds' });
      }

      const bidId = `bid_${crypto.randomUUID()}`;
      const causedExtension = endAtMs - nowMs <= Number(PLATFORM.ANTI_SNIPE_WINDOW_SECONDS) * 1000;

      useMockStore.setState((prev: any) => {
        const a = prev.auctions.find((aa: Auction) => aa.auctionId === auctionId);
        if (!a) return prev;
        if (a.status !== 'live' && a.status !== 'extended') return prev;

        // Re-check timer close.
        if (new Date(a.endAt).getTime() <= Date.now()) return prev;

        const nextAuctionBids = [
          {
            bidId,
            auctionId,
            bidderId: prev.me.id,
            bidderHandle: 'You',
            amountUSD,
            placedAt: isoNow(),
            causedExtension,
          },
          ...a.bids,
        ];

        // Held funds update for the current user only.
        const prevHeld = prev.heldAuctionAmounts[auctionId] ?? '0.00';
        const addlNeeded = money(amountUSD).minus(prevHeld);
        const nextAvailableUSD = addlNeeded.lte(0)
          ? prev.me.availableUSD
          : toMoneyString(sub(prev.me.availableUSD, addlNeeded));

        const nextHeldAuctionAmounts: Record<string, string> = { ...prev.heldAuctionAmounts, [auctionId]: amountUSD };
        const nextHeldUSD = toMoneyString(
          (Object.values(nextHeldAuctionAmounts) as string[]).reduce(
            (acc: Decimal, v) => acc.plus(money(v)),
            money(0),
          ),
        );

        const extensionCap = Number(PLATFORM.AUCTION_MAX_EXTENSIONS);
        let nextEndAt = a.endAt;
        let nextExtensions = a.extensions;
        let nextStatus = a.status;

        if (causedExtension && a.extensions < extensionCap) {
          nextExtensions = a.extensions + 1;
          nextEndAt = new Date(Date.now() + Number(PLATFORM.ANTI_SNIPE_EXTENSION_SECONDS) * 1000).toISOString();
          nextStatus = 'extended';
        }

        const nextAuction: Auction = {
          ...a,
          status: nextStatus,
          endAt: nextEndAt,
          extensions: nextExtensions,
          currentHighBidUSD: amountUSD,
          currentHighBidderId: prev.me.id,
          currentHighBidderHandle: 'You',
          bids: nextAuctionBids,
        };

        return {
          ...prev,
          me: {
            ...prev.me,
            availableUSD: nextAvailableUSD,
            heldUSD: nextHeldUSD,
          },
          heldAuctionAmounts: nextHeldAuctionAmounts,
          bidsByIdempotencyKey: key ? { ...prev.bidsByIdempotencyKey, [key]: bidId } : prev.bidsByIdempotencyKey,
          auctions: prev.auctions.map((aa: Auction) => (aa.auctionId === auctionId ? nextAuction : aa)),
        } as any;
      });

      return ok({ bidId });
    },
  },

  economics: {
    summary: async (): Promise<ApiResponse<{ packEVByTier: Record<string, { evPerPackUSD: string; houseMarginUSD: string }>; tradeFeeRevenueUSD: string; auctionFeeRevenueUSD: string }>> => {
      await ensureInit();
      await jitter();
      const catalog = await getCatalog();
      const packEVByTier: Record<string, { evPerPackUSD: string; houseMarginUSD: string }> = {};
      for (const t of PACK_TIERS) {
        const evPack = currentEVPackUSD(t.code, catalog);
        const margin = money(t.priceUSD).minus(evPack);
        packEVByTier[t.code] = {
          evPerPackUSD: toMoneyString(evPack),
          houseMarginUSD: toMoneyString(margin.gt(0) ? margin : money(0)),
        };
      }

      // Revenue streams: mock based on ledger entries.
      const state = useMockStore.getState();
      const tradeFeeRevenueUSD = state.ledger
        .filter((e) => e.kind === 'platform_fee' && e.referenceId?.startsWith('lst_'))
        .reduce((acc, e) => acc.plus(money(e.amountUSD)), money(0));

      const auctionFeeRevenueUSD = state.ledger
        .filter((e) => e.kind === 'platform_fee' && e.referenceId?.startsWith('auc_'))
        .reduce((acc, e) => acc.plus(money(e.amountUSD)), money(0));

      return ok({
        packEVByTier,
        tradeFeeRevenueUSD: toMoneyString(tradeFeeRevenueUSD),
        auctionFeeRevenueUSD: toMoneyString(auctionFeeRevenueUSD),
      });
    },
  },

  admin: {
    refreshCatalog: async (): Promise<ApiResponse<{ count: number }>> => {
      await ensureInit();
      await jitter();
      await MOCK_CATALOG; // keep to satisfy bundlers
      await (await import('./catalog')).refreshCatalogFromApi();
      const catalog = await getCatalog();
      return ok({ count: catalog.length });
    },
  },
};

