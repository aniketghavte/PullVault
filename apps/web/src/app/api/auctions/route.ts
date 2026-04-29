import { handler, ApiError } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { requireUserId } from '@/lib/auth';
import { ERROR_CODES } from '@pullvault/shared';
import { createAuctionSchema } from '@pullvault/shared';
import { toMoneyString } from '@pullvault/shared/money';
import { createAuction } from '@/services/auction-service';
import { publishInternal, INTERNAL_EVENTS } from '@/lib/realtime/publisher';
import { REDIS_KEYS } from '@pullvault/shared/constants';
import { scheduleAuctionCloseJob } from '@/lib/realtime/internal';

// GET /api/auctions — list live/extended/recently settled auctions with card info.
export const GET = handler(async () => {
  const rows = await db
    .select({
      auctionId: schema.auctions.id,
      userCardId: schema.auctions.userCardId,
      sellerId: schema.auctions.sellerId,
      startingBidUsd: schema.auctions.startingBidUsd,
      currentHighBidUsd: schema.auctions.currentHighBidUsd,
      currentHighBidderId: schema.auctions.currentHighBidderId,
      endAt: schema.auctions.endAt,
      extensions: schema.auctions.extensions,
      status: schema.auctions.status,
      winnerId: schema.auctions.winnerId,
      finalPriceUsd: schema.auctions.finalPriceUsd,
      sellerHandle: schema.profiles.handle,
      card: {
        id: schema.cards.id,
        name: schema.cards.name,
        set: schema.cards.setCode,
        rarity: schema.cards.rarity,
        imageUrl: schema.cards.imageUrl,
        marketPriceUsd: schema.cards.marketPriceUsd,
      },
    })
    .from(schema.auctions)
    .innerJoin(schema.userCards, eq(schema.userCards.id, schema.auctions.userCardId))
    .innerJoin(schema.cards, eq(schema.cards.id, schema.userCards.cardId))
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.auctions.sellerId))
    .where(inArray(schema.auctions.status, ['live', 'extended', 'settled']))
    .orderBy(desc(schema.auctions.endAt))
    .limit(50);

  const auctions = rows.map((r) => ({
    auctionId: r.auctionId,
    userCardId: r.userCardId,
    sellerId: r.sellerId,
    sellerHandle: r.sellerHandle,
    startingBidUSD: toMoneyString(r.startingBidUsd),
    currentHighBidUSD: r.currentHighBidUsd ? toMoneyString(r.currentHighBidUsd) : null,
    currentHighBidderId: r.currentHighBidderId,
    endAt: r.endAt.toISOString(),
    extensions: r.extensions,
    status: r.status,
    winnerId: r.winnerId,
    finalPriceUSD: r.finalPriceUsd ? toMoneyString(r.finalPriceUsd) : null,
    card: {
      ...r.card,
      marketPriceUSD: toMoneyString(r.card.marketPriceUsd),
    },
  }));

  return { auctions };
});

// POST /api/auctions — create a new auction.
export const POST = handler(async (req: Request) => {
  const userId = await requireUserId();
  const parsed = createAuctionSchema.safeParse(await req.json());
  if (!parsed.success) {
    throw new ApiError(ERROR_CODES.VALIDATION, 'Invalid request', parsed.error.flatten());
  }

  const result = await createAuction(db, userId, {
    userCardId: parsed.data.userCardId,
    startingBidUSD: parsed.data.startingBidUSD,
    durationMinutes: parsed.data.durationMinutes,
  });

  // Schedule BullMQ delayed job for auction close
  await scheduleAuctionCloseJob({
    auctionId: result.auctionId,
    endAt: result.endAt.toISOString(),
  });

  return { auctionId: result.auctionId, endAt: result.endAt.toISOString() };
});
