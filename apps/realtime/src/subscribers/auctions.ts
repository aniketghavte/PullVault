import { SOCKET_ROOMS } from '@pullvault/shared/constants';
import type { AppSocketServer } from '../sockets/index.js';

// Channel: pv:auction:<id>:events
// Payload (envelope): { event, emittedAt, payload }
export function handleAuctionMessage(io: AppSocketServer, channel: string, env: { event: string; payload: { auctionId: string } & Record<string, unknown> }) {
  const auctionId = channel.split(':')[2];
  if (!auctionId) return;
  const room = SOCKET_ROOMS.auction(auctionId);
  switch (env.event) {
    case 'pv.bid.accepted':
      io.to(room).emit('auction:bid', env.payload);
      return;
    case 'pv.auction.extended':
      io.to(room).emit('auction:state', env.payload);
      return;
    case 'pv.auction.settled':
      io.to(room).emit('auction:settled', env.payload);
      return;
  }
}
