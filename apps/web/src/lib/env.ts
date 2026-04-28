import { z } from 'zod';

// Centralized env validation. Imported from any server-only module.
// We split client and server schemas because Next will inline only NEXT_PUBLIC_*.

const serverSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  DATABASE_URL: z.string().min(10),
  REDIS_URL: z.string().min(10),
  REALTIME_INTERNAL_TOKEN: z.string().min(16),
  POKEMON_TCG_API_URL: z.string().url().default('https://api.pokemontcg.io/v2'),
  POKEMON_TCG_API_KEY: z.string().optional(),
  DEFAULT_STARTING_BALANCE_USD: z.string().default('500.00'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_REALTIME_URL: z.string().url(),
  NEXT_PUBLIC_APP_URL: z.string().url(),
});

let cachedServer: z.infer<typeof serverSchema> | null = null;
export function serverEnv() {
  if (typeof window !== 'undefined') {
    throw new Error('serverEnv() called from the browser');
  }
  if (cachedServer) return cachedServer;
  cachedServer = serverSchema.parse(process.env);
  return cachedServer;
}

export const clientEnv = clientSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});
