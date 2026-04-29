import { PACK_TIERS } from '@pullvault/shared/constants';
import { mul, money, toMoneyString } from '@pullvault/shared/money';

import type { CatalogCard } from './catalog';
import { getCatalog } from './catalog';
import type { Auction, Drop, LedgerEntry, Listing, MockState, UserCard } from './types';
import type { UserCardStatus } from './types';

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

function pickCard(cardsByRarity: Record<string, CatalogCard[]>, rarity: string, index: number) {
  const bucket = cardsByRarity[rarity] ?? [];
  const c = bucket[index % Math.max(1, bucket.length)];
  if (!c) throw new Error(`No catalog cards for rarity=${rarity}`);
  return c;
}

function acquiredFromMarket(card: CatalogCard, acquiredPriceSeed: string) {
  const h = hash(acquiredPriceSeed);
  const r1 = rand01(h);
  // 0.75x to 1.25x market (keeps P&L visible without being absurd).
  const factor = 0.75 + r1 * 0.5;
  const acquired = mul(card.marketPriceUSD, factor);
  return toMoneyString(acquired);
}

function makeUserCard(input: {
  userCardId: string;
  ownerId: string;
  ownerHandle: string;
  card: CatalogCard;
  status: UserCardStatus;
  acquiredAt: string;
  acquiredPriceUSD: string;
}) {
  const { card } = input;
  const { id: _cardId, externalId, name, set, rarity, imageUrl, marketPriceUSD } = card;
  const userCard: UserCard = {
    userCardId: input.userCardId,
    ownerId: input.ownerId,
    ownerHandle: input.ownerHandle,
    acquiredAt: input.acquiredAt,
    acquiredPriceUSD: input.acquiredPriceUSD,
    status: input.status,
    externalId,
    name,
    set,
    rarity,
    imageUrl,
    marketPriceUSD,
  };
  return userCard;
}

export async function createSeedState(nowMs: number): Promise<MockState> {
  const catalog = await getCatalog();
  const cardsByRarity: Record<string, CatalogCard[]> = {};
  for (const c of catalog) {
    cardsByRarity[c.rarity] = cardsByRarity[c.rarity] ?? [];
    cardsByRarity[c.rarity]!.push(c);
  }

  const meId = 'me';
  const nowISO = new Date(nowMs).toISOString();

  const me: MockState['me'] = {
    id: meId,
    email: 'you@example.com',
    displayName: 'You',
    availableUSD: '500.00',
    heldUSD: '0.00',
  };

  // ---- User cards (portfolio + marketplace/auction inventory) ----
  const daysAgo = (d: number) => new Date(nowMs - d * 86400000).toISOString();

  // Your portfolio: 6 cards across rarities.
  const myCards: UserCard[] = [
    makeUserCard({
      userCardId: 'uc_me_1',
      ownerId: meId,
      ownerHandle: 'You',
      card: pickCard(cardsByRarity, 'common', 0),
      status: 'held',
      acquiredAt: daysAgo(10),
      acquiredPriceUSD: acquiredFromMarket(pickCard(cardsByRarity, 'common', 0), 'acq_me_1'),
    }),
    makeUserCard({
      userCardId: 'uc_me_2',
      ownerId: meId,
      ownerHandle: 'You',
      card: pickCard(cardsByRarity, 'common', 1),
      status: 'held',
      acquiredAt: daysAgo(25),
      acquiredPriceUSD: acquiredFromMarket(pickCard(cardsByRarity, 'common', 1), 'acq_me_2'),
    }),
    makeUserCard({
      userCardId: 'uc_me_3',
      ownerId: meId,
      ownerHandle: 'You',
      card: pickCard(cardsByRarity, 'uncommon', 0),
      status: 'held',
      acquiredAt: daysAgo(18),
      acquiredPriceUSD: acquiredFromMarket(pickCard(cardsByRarity, 'uncommon', 0), 'acq_me_3'),
    }),
    makeUserCard({
      userCardId: 'uc_me_4',
      ownerId: meId,
      ownerHandle: 'You',
      card: pickCard(cardsByRarity, 'uncommon', 1),
      status: 'held',
      acquiredAt: daysAgo(35),
      acquiredPriceUSD: acquiredFromMarket(pickCard(cardsByRarity, 'uncommon', 1), 'acq_me_4'),
    }),
    makeUserCard({
      userCardId: 'uc_me_5',
      ownerId: meId,
      ownerHandle: 'You',
      card: pickCard(cardsByRarity, 'rare', 0),
      status: 'held',
      acquiredAt: daysAgo(50),
      acquiredPriceUSD: acquiredFromMarket(pickCard(cardsByRarity, 'rare', 0), 'acq_me_5'),
    }),
    makeUserCard({
      userCardId: 'uc_me_6',
      ownerId: meId,
      ownerHandle: 'You',
      card: pickCard(cardsByRarity, 'ultra_rare', 0),
      status: 'held',
      acquiredAt: daysAgo(8),
      acquiredPriceUSD: acquiredFromMarket(pickCard(cardsByRarity, 'ultra_rare', 0), 'acq_me_6'),
    }),
  ];

  const otherA = { id: 'u_avery', handle: 'Avery' };
  const otherB = { id: 'u_sasha', handle: 'Sasha' };

  const aCards: UserCard[] = [
    makeUserCard({
      userCardId: 'uc_avery_1',
      ownerId: otherA.id,
      ownerHandle: otherA.handle,
      card: pickCard(cardsByRarity, 'uncommon', 2),
      status: 'listed',
      acquiredAt: daysAgo(60),
      acquiredPriceUSD: acquiredFromMarket(pickCard(cardsByRarity, 'uncommon', 2), 'acq_a1'),
    }),
    makeUserCard({
      userCardId: 'uc_avery_2',
      ownerId: otherA.id,
      ownerHandle: otherA.handle,
      card: pickCard(cardsByRarity, 'rare', 1),
      status: 'in_auction',
      acquiredAt: daysAgo(70),
      acquiredPriceUSD: acquiredFromMarket(pickCard(cardsByRarity, 'rare', 1), 'acq_a2'),
    }),
    makeUserCard({
      userCardId: 'uc_avery_3',
      ownerId: otherA.id,
      ownerHandle: otherA.handle,
      card: pickCard(cardsByRarity, 'common', 5),
      status: 'listed',
      acquiredAt: daysAgo(40),
      acquiredPriceUSD: acquiredFromMarket(pickCard(cardsByRarity, 'common', 5), 'acq_a3'),
    }),
  ];

  const bCards: UserCard[] = [
    makeUserCard({
      userCardId: 'uc_sasha_1',
      ownerId: otherB.id,
      ownerHandle: otherB.handle,
      card: pickCard(cardsByRarity, 'common', 8),
      status: 'listed',
      acquiredAt: daysAgo(22),
      acquiredPriceUSD: acquiredFromMarket(pickCard(cardsByRarity, 'common', 8), 'acq_b1'),
    }),
    makeUserCard({
      userCardId: 'uc_sasha_2',
      ownerId: otherB.id,
      ownerHandle: otherB.handle,
      card: pickCard(cardsByRarity, 'ultra_rare', 1),
      status: 'in_auction',
      acquiredAt: daysAgo(90),
      acquiredPriceUSD: acquiredFromMarket(pickCard(cardsByRarity, 'ultra_rare', 1), 'acq_b2'),
    }),
    makeUserCard({
      userCardId: 'uc_sasha_3',
      ownerId: otherB.id,
      ownerHandle: otherB.handle,
      card: pickCard(cardsByRarity, 'uncommon', 3),
      status: 'listed',
      acquiredAt: daysAgo(55),
      acquiredPriceUSD: acquiredFromMarket(pickCard(cardsByRarity, 'uncommon', 3), 'acq_b3'),
    }),
  ];

  const userCards = [...myCards, ...aCards, ...bCards];

  // ---- Drops ----
  const tierByCode = Object.fromEntries(PACK_TIERS.map((t) => [t.code, t]));
  const tierStandard = tierByCode.standard as (typeof PACK_TIERS)[number];
  const tierPremium = tierByCode.premium as (typeof PACK_TIERS)[number];
  const tierElite = tierByCode.elite as (typeof PACK_TIERS)[number];

  const drop1: Drop = {
    dropId: 'drop_standard_live',
    tierCode: tierStandard.code,
    tierName: tierStandard.name,
    priceUSD: tierStandard.priceUSD,
    totalInventory: 10,
    remaining: 6,
    scheduledAt: new Date(nowMs - 60_000).toISOString(),
    status: 'live',
  };

  const drop2: Drop = {
    dropId: 'drop_premium_scheduled',
    tierCode: tierPremium.code,
    tierName: tierPremium.name,
    priceUSD: tierPremium.priceUSD,
    totalInventory: 8,
    remaining: 8,
    scheduledAt: new Date(nowMs + 4 * 60_000).toISOString(),
    status: 'scheduled',
  };

  const drop3: Drop = {
    dropId: 'drop_elite_sold_out',
    tierCode: tierElite.code,
    tierName: tierElite.name,
    priceUSD: tierElite.priceUSD,
    totalInventory: 4,
    remaining: 0,
    scheduledAt: new Date(nowMs - 20 * 60_000).toISOString(),
    status: 'sold_out',
  };

  const drops: Drop[] = [drop1, drop2, drop3];

  // ---- Listings ----
  const findCard = (userCardId: string) => userCards.find((uc) => uc.userCardId === userCardId)!;

  const listings: Listing[] = [
    {
      listingId: 'lst_1',
      userCardId: 'uc_avery_1',
      sellerId: otherA.id,
      sellerHandle: otherA.handle,
      priceUSD: toMoneyString(mul(findCard('uc_avery_1').marketPriceUSD, 1.12)),
      status: 'active',
      createdAt: nowISO,
    },
    {
      listingId: 'lst_2',
      userCardId: 'uc_avery_3',
      sellerId: otherA.id,
      sellerHandle: otherA.handle,
      priceUSD: toMoneyString(mul(findCard('uc_avery_3').marketPriceUSD, 0.98)),
      status: 'active',
      createdAt: nowISO,
    },
    {
      listingId: 'lst_3',
      userCardId: 'uc_sasha_1',
      sellerId: otherB.id,
      sellerHandle: otherB.handle,
      priceUSD: toMoneyString(mul(findCard('uc_sasha_1').marketPriceUSD, 1.04)),
      status: 'active',
      createdAt: nowISO,
    },
    {
      listingId: 'lst_4',
      userCardId: 'uc_sasha_3',
      sellerId: otherB.id,
      sellerHandle: otherB.handle,
      priceUSD: toMoneyString(mul(findCard('uc_sasha_3').marketPriceUSD, 1.09)),
      status: 'active',
      createdAt: nowISO,
    },
    {
      listingId: 'lst_5',
      userCardId: 'uc_me_5',
      sellerId: meId,
      sellerHandle: 'You',
      priceUSD: toMoneyString(mul(findCard('uc_me_5').marketPriceUSD, 1.06)),
      status: 'active',
      createdAt: nowISO,
    },
  ];

  // Mark uc_me_5 as listed for realism (so listing page has something immediate).
  const userCardsWithListing = userCards.map((uc) =>
    uc.userCardId === 'uc_me_5' ? { ...uc, status: 'listed' as const, ownerId: meId, ownerHandle: 'You' } : uc,
  );

  // ---- Auctions ----
  const aCardForAuction1 = findCard('uc_avery_2');
  const bCardForAuction2 = findCard('uc_sasha_2');

  const auction1: Auction = {
    auctionId: 'auc_1',
    userCardId: aCardForAuction1.userCardId,
    sellerId: otherA.id,
    sellerHandle: otherA.handle,
    card: {
      name: aCardForAuction1.name,
      set: aCardForAuction1.set,
      rarity: aCardForAuction1.rarity,
      imageUrl: aCardForAuction1.imageUrl,
      marketPriceUSD: aCardForAuction1.marketPriceUSD,
      externalId: aCardForAuction1.externalId,
    },
    startingBidUSD: '8.00',
    currentHighBidUSD: '10.00',
    currentHighBidderId: 'u_bidder_1',
    currentHighBidderHandle: 'Mina',
    endAt: new Date(nowMs + 12 * 60_000).toISOString(),
    extensions: 0,
    watcherCount: 73,
    status: 'live',
    bids: [
      {
        bidId: 'bid_1',
        auctionId: 'auc_1',
        bidderId: 'u_bidder_1',
        bidderHandle: 'Mina',
        amountUSD: '10.00',
        placedAt: new Date(nowMs - 3 * 60_000).toISOString(),
        causedExtension: false,
      },
      {
        bidId: 'bid_0',
        auctionId: 'auc_1',
        bidderId: 'u_bidder_0',
        bidderHandle: 'Theo',
        amountUSD: '8.00',
        placedAt: new Date(nowMs - 9 * 60_000).toISOString(),
        causedExtension: false,
      },
    ],
  };

  const auction2: Auction = {
    auctionId: 'auc_2',
    userCardId: bCardForAuction2.userCardId,
    sellerId: otherB.id,
    sellerHandle: otherB.handle,
    card: {
      name: bCardForAuction2.name,
      set: bCardForAuction2.set,
      rarity: bCardForAuction2.rarity,
      imageUrl: bCardForAuction2.imageUrl,
      marketPriceUSD: bCardForAuction2.marketPriceUSD,
      externalId: bCardForAuction2.externalId,
    },
    startingBidUSD: '40.00',
    currentHighBidUSD: '52.00',
    currentHighBidderId: 'u_bidder_2',
    currentHighBidderHandle: 'Rafi',
    endAt: new Date(nowMs + 18 * 1000).toISOString(),
    extensions: 1,
    watcherCount: 128,
    status: 'live',
    bids: [
      {
        bidId: 'bid_3',
        auctionId: 'auc_2',
        bidderId: 'u_bidder_2',
        bidderHandle: 'Rafi',
        amountUSD: '52.00',
        placedAt: new Date(nowMs - 2 * 1000).toISOString(),
        causedExtension: true,
      },
      {
        bidId: 'bid_2',
        auctionId: 'auc_2',
        bidderId: 'u_bidder_3',
        bidderHandle: 'Jules',
        amountUSD: '40.00',
        placedAt: new Date(nowMs - 30 * 1000).toISOString(),
        causedExtension: false,
      },
    ],
  };

  const auction3: Auction = {
    auctionId: 'auc_3',
    userCardId: 'uc_me_6',
    sellerId: meId,
    sellerHandle: 'You',
    card: {
      name: findCard('uc_me_6').name,
      set: findCard('uc_me_6').set,
      rarity: findCard('uc_me_6').rarity,
      imageUrl: findCard('uc_me_6').imageUrl,
      marketPriceUSD: findCard('uc_me_6').marketPriceUSD,
      externalId: findCard('uc_me_6').externalId,
    },
    startingBidUSD: '60.00',
    currentHighBidUSD: '85.00',
    currentHighBidderId: 'u_winner_1',
    currentHighBidderHandle: 'Poppy',
    endAt: new Date(nowMs - 15 * 60_000).toISOString(),
    extensions: 0,
    watcherCount: 54,
    status: 'settled',
    bids: [
      {
        bidId: 'bid_4',
        auctionId: 'auc_3',
        bidderId: 'u_winner_1',
        bidderHandle: 'Poppy',
        amountUSD: '85.00',
        placedAt: new Date(nowMs - 14 * 60_000).toISOString(),
        causedExtension: false,
      },
    ],
  };

  const auctions = [auction1, auction2, auction3];

  const ledger: LedgerEntry[] = [];

  return {
    initialized: true,
    me,
    heldAuctionAmounts: {},
    catalogGeneratedAt: nowISO,
    drops,
    purchases: [],
    userCards: userCardsWithListing.map((uc) =>
      // Auctions already own their cards.
      auctions.some((a) => a.userCardId === uc.userCardId)
        ? { ...uc, status: uc.userCardId === 'uc_me_6' ? 'in_auction' : uc.status }
        : uc,
    ),
    listings,
    auctions,
    ledger,
    packPurchaseByIdempotencyKey: {},
    bidsByIdempotencyKey: {},
  };
}

