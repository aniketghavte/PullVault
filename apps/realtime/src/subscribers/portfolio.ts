import { SOCKET_ROOMS } from '@pullvault/shared/constants';
import type { AppSocketServer } from '../sockets/index.js';

export function handlePortfolioMessage(io: AppSocketServer, channel: string, env: { event: string; payload: { userId: string } & Record<string, unknown> }) {
  const userId = channel.split(':')[2];
  if (!userId) return;
  io.to(SOCKET_ROOMS.portfolio(userId)).emit('portfolio:invalidate', env.payload);
}

// Price tick payload shape: { cardId, priceUSD, ts }
// We broadcast to all sockets; clients filter to cards they own.
// At scale we'd batch (1Hz) and shard rooms by cardId — see architecture.md.
export function handlePriceTick(io: AppSocketServer, payload: unknown) {
  io.emit('price:tick', payload);
}
