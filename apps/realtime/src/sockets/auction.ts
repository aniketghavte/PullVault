import type { Socket } from 'socket.io';
import type { AppSocketServer } from './index.js';
import { SOCKET_ROOMS } from '@pullvault/shared/constants';

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
    // TODO: fetch latest auction snapshot from DB and emit `auction:state`
    // to JUST this socket so reconnects see current state.
  });

  socket.on('auction:leave', async ({ auctionId }: { auctionId: string }) => {
    if (!auctionId) return;
    const room = SOCKET_ROOMS.auction(auctionId);
    await socket.leave(room);
    const watcherCount = io.sockets.adapter.rooms.get(room)?.size ?? 0;
    io.to(room).emit('auction:watchers', { auctionId, watcherCount });
  });
}
