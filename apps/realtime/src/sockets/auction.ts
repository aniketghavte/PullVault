import type { Socket } from 'socket.io';
import type { AppSocketServer } from './index.js';
import { SOCKET_ROOMS } from '@pullvault/shared/constants';
import { logger } from '@pullvault/shared/logger';

// Client emits:
//   `auction:join`  { auctionId }
//   `auction:leave` { auctionId }
// Server emits to the room (driven by Redis subscribers):
//   `auction:state`    full snapshot on join + on settlement
//   `auction:bid`      every accepted bid + extension info
//   `auction:settled`  terminal event with winner + final price

export function registerAuctionHandlers(io: AppSocketServer, socket: Socket) {
  socket.on('auction:join', async ({ auctionId }: { auctionId: string }) => {
    if (!auctionId) return;
    const room = SOCKET_ROOMS.auction(auctionId);
    await socket.join(room);
    const watcherCount = io.sockets.adapter.rooms.get(room)?.size ?? 0;
    io.to(room).emit('auction:watchers', { auctionId, watcherCount });

    // Fetch latest auction state from DB and emit to JUST this socket
    try {
      const { getDb, schema } = await import('@pullvault/db');
      const { eq } = await import('drizzle-orm');
      const { toMoneyString } = await import('@pullvault/shared/money');
      const db = getDb();

      const [auction] = await db
        .select({
          currentHighBidUsd: schema.auctions.currentHighBidUsd,
          currentHighBidderId: schema.auctions.currentHighBidderId,
          endAt: schema.auctions.endAt,
          extensions: schema.auctions.extensions,
          status: schema.auctions.status,
        })
        .from(schema.auctions)
        .where(eq(schema.auctions.id, auctionId))
        .limit(1);

      if (auction) {
        socket.emit('auction:state', {
          auctionId,
          currentHighBidUSD: auction.currentHighBidUsd ? toMoneyString(auction.currentHighBidUsd) : null,
          currentHighBidderId: auction.currentHighBidderId,
          newEndAt: auction.endAt.toISOString(),
          extensions: auction.extensions,
          status: auction.status,
          watcherCount,
        });
      }
    } catch (err) {
      logger.warn({ err, auctionId }, 'failed to fetch auction state on join');
    }
  });

  socket.on('auction:leave', async ({ auctionId }: { auctionId: string }) => {
    if (!auctionId) return;
    const room = SOCKET_ROOMS.auction(auctionId);
    await socket.leave(room);
    const watcherCount = io.sockets.adapter.rooms.get(room)?.size ?? 0;
    io.to(room).emit('auction:watchers', { auctionId, watcherCount });
  });
}
