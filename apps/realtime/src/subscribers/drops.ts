import { SOCKET_ROOMS } from '@pullvault/shared/constants';
import type { AppSocketServer } from '../sockets/index.js';

export function handleDropMessage(io: AppSocketServer, channel: string, env: { event: string; payload: { dropId: string; remaining?: number } }) {
  const dropId = channel.split(':')[2];
  if (!dropId) return;
  const room = SOCKET_ROOMS.drop(dropId);
  switch (env.event) {
    case 'pv.drop.inventory_changed':
      io.to(room).emit('drop:inventory', env.payload);
      return;
    case 'pv.drop.sold_out':
      io.to(room).emit('drop:sold_out', env.payload);
      return;
  }
}
