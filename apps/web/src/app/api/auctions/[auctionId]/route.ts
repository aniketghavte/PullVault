import { handler, ApiError } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { eq, desc } from 'drizzle-orm';
import { toMoneyString } from '@pullvault/shared/money';
import { ERROR_CODES } from '@pullvault/shared';

// GET /api/auctions/:auctionId — single auction detail with card info + recent bids.
export const GET = handler(async (_req: Request, ctx: { params: Promise<{ auctionId: string }> }) => {
  const { auctionId } = await ctx.params;

  const [row] = await db
    .select({
      auctionId: schema.auctions.id,
      userCardId: schema.auctions.userCardId,
      sellerId: schema.auctions.sellerId,
      startingBidUsd: schema.auctions.startingBidUsd,
      currentHighBidId: schema.auctions.currentHighBidId,
      currentHighBidUsd: schema.auctions.currentHighBidUsd,
      currentHighBidderId: schema.auctions.currentHighBidderId,
      startAt: schema.auctions.startAt,
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
    .where(eq(schema.auctions.id, auctionId))
    .limit(1);

  if (!row) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, 'Auction not found');
  }

  // Fetch recent bids (last 20)
  const bidsRows = await db
    .select({
      bidId: schema.bids.id,
      bidderId: schema.bids.bidderId,
      amountUsd: schema.bids.amountUsd,
      placedAt: schema.bids.placedAt,
      causedExtension: schema.bids.causedExtension,
      bidderHandle: schema.profiles.handle,
    })
    .from(schema.bids)
    .innerJoin(schema.profiles, eq(schema.profiles.id, schema.bids.bidderId))
    .where(eq(schema.bids.auctionId, auctionId))
    .orderBy(desc(schema.bids.placedAt))
    .limit(20);

  return {
    auction: {
      auctionId: row.auctionId,
      userCardId: row.userCardId,
      sellerId: row.sellerId,
      sellerHandle: row.sellerHandle,
      startingBidUSD: toMoneyString(row.startingBidUsd),
      currentHighBidId: row.currentHighBidId,
      currentHighBidUSD: row.currentHighBidUsd ? toMoneyString(row.currentHighBidUsd) : null,
      currentHighBidderId: row.currentHighBidderId,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt.toISOString(),
      extensions: row.extensions,
      status: row.status,
      winnerId: row.winnerId,
      finalPriceUSD: row.finalPriceUsd ? toMoneyString(row.finalPriceUsd) : null,
      card: {
        ...row.card,
        marketPriceUSD: toMoneyString(row.card.marketPriceUsd),
      },
    },
    recentBids: bidsRows.map((b) => ({
      bidId: b.bidId,
      auctionId,
      bidderId: b.bidderId,
      bidderHandle: b.bidderHandle,
      amountUSD: toMoneyString(b.amountUsd),
      placedAt: b.placedAt.toISOString(),
      causedExtension: b.causedExtension,
    })),
  };
});
