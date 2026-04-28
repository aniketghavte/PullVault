import type http from 'node:http';
import { Server as IoServer } from 'socket.io';
import { env } from '../env.js';
import { logger } from '@pullvault/shared/logger';
import { authenticateSocket } from './auth.js';
import { registerAuctionHandlers } from './auction.js';
import { registerDropHandlers } from './drops.js';
import { registerPortfolioHandlers } from './portfolio.js';

export type AppSocketServer = IoServer;

export function createIo(server: http.Server): AppSocketServer {
  const io = new IoServer(server, {
    cors: { origin: [env.NEXT_PUBLIC_APP_URL], credentials: true },
    transports: ['websocket'],
    // Generous ping to survive flaky mobile networks.
    pingInterval: 20_000,
    pingTimeout: 25_000,
  });

  io.use(authenticateSocket);

  io.on('connection', (socket) => {
    logger.debug({ id: socket.id, userId: socket.data.userId }, 'socket connected');
    registerAuctionHandlers(io, socket);
    registerDropHandlers(io, socket);
    registerPortfolioHandlers(io, socket);
    socket.on('disconnect', (reason) => {
      logger.debug({ id: socket.id, reason }, 'socket disconnected');
    });
  });

  return io;
}
