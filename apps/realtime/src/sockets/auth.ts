import type { Socket } from 'socket.io';
import { createClient } from '@supabase/supabase-js';
import { env } from '../env.js';

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Client must connect with `auth: { token: <supabase access token> }`.
// We validate it via Supabase Auth; if it's invalid we still allow
// anonymous read-only connections (so unauthenticated visitors can watch
// drops + auctions live), but socket.data.userId remains null.
export async function authenticateSocket(socket: Socket, next: (err?: Error) => void) {
  try {
    const token = (socket.handshake.auth?.token as string | undefined) ?? null;
    if (!token) {
      socket.data.userId = null;
      return next();
    }
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      socket.data.userId = null;
    } else {
      socket.data.userId = data.user.id;
    }
    next();
  } catch (err) {
    // Don't drop the connection — degrade to anon.
    socket.data.userId = null;
    next();
  }
}
