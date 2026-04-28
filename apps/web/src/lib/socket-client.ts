'use client';
import { io, type Socket } from 'socket.io-client';
import { clientEnv } from './env';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;
  socket = io(clientEnv.NEXT_PUBLIC_REALTIME_URL, {
    transports: ['websocket'],
    withCredentials: true,
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  });
  return socket;
}
