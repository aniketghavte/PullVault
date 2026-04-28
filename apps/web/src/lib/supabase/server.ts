import 'server-only';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { clientEnv, serverEnv } from '../env';

// User-scoped client: respects the user's session via cookies. RLS enforced.
export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Called from a Server Component — middleware handles refresh.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: '', ...options });
        } catch {
          // Same caveat as above.
        }
      },
    },
  });
}

// Service-role client: BYPASSES RLS. Only used by trusted server code
// (API routes, server actions). NEVER export to the client.
import { createClient } from '@supabase/supabase-js';
let serviceClient: ReturnType<typeof createClient> | null = null;
export function getServiceSupabase() {
  if (serviceClient) return serviceClient;
  const env = serverEnv();
  serviceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return serviceClient;
}
