import type { Socket } from 'socket.io';
import type { AppSocketServer } from './index.js';
import { SOCKET_ROOMS } from '@pullvault/shared/constants';

// Each user joins their own portfolio room on connect (if authenticated).
// Price ticks fan out by joining a global "prices" pseudo-room and the
// server filters per-user holdings.
export function registerPortfolioHandlers(_io: AppSocketServer, socket: Socket) {
  const userId = socket.data.userId as string | null;
  if (!userId) return;
  void socket.join(SOCKET_ROOMS.portfolio(userId));
}
