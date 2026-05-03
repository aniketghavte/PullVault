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

  // B3 — In sealed phase we do NOT reveal the current high bid or who
  // placed it. The bid *count* + timestamps are still public because
  // they're discoverable from socket room size and do not give snipers
  // the number to beat. We also redact the most recent bid amounts in
  // `recentBids` for the same reason.
  const isSealed = row.status === 'sealed';

  return {
    auction: {
      auctionId: row.auctionId,
      userCardId: row.userCardId,
      sellerId: row.sellerId,
      sellerHandle: row.sellerHandle,
      startingBidUSD: toMoneyString(row.startingBidUsd),
      currentHighBidId: isSealed ? null : row.currentHighBidId,
      currentHighBidUSD: isSealed
        ? null
        : row.currentHighBidUsd
          ? toMoneyString(row.currentHighBidUsd)
          : null,
      currentHighBidderId: isSealed ? null : row.currentHighBidderId,
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
      bidderId: isSealed ? null : b.bidderId,
      bidderHandle: isSealed ? null : b.bidderHandle,
      amountUSD: isSealed ? null : toMoneyString(b.amountUsd),
      placedAt: b.placedAt.toISOString(),
      causedExtension: b.causedExtension,
    })),
  };
});
