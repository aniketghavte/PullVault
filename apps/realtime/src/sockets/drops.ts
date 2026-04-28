import type { Socket } from 'socket.io';
import type { AppSocketServer } from './index.js';
import { SOCKET_ROOMS } from '@pullvault/shared/constants';

export function registerDropHandlers(_io: AppSocketServer, socket: Socket) {
  socket.on('drop:join', async ({ dropId }: { dropId: string }) => {
    if (!dropId) return;
    await socket.join(SOCKET_ROOMS.drop(dropId));
  });
  socket.on('drop:leave', async ({ dropId }: { dropId: string }) => {
    if (!dropId) return;
    await socket.leave(SOCKET_ROOMS.drop(dropId));
  });
}
