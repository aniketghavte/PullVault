import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// Realtime runs from `apps/realtime`, but env vars live at repo root.
// Load root `.env` first, then optional `.env.local` overrides.
const repoRoot = path.resolve(process.cwd(), '../..');
loadEnv({ path: path.join(repoRoot, '.env') });
loadEnv({ path: path.join(repoRoot, '.env.local'), override: true });

const schema = z.object({
  REALTIME_PORT: z.coerce.number().int().positive().default(4000),
  REDIS_URL: z.string().min(10),
  DATABASE_URL: z.string().min(10),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  REALTIME_INTERNAL_TOKEN: z.string().min(16),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  POKEMON_TCG_API_URL: z.string().url().default('https://api.pokemontcg.io/v2'),
  POKEMON_TCG_API_KEY: z.string().optional(),
  PRICE_REFRESH_HOT_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  PRICE_REFRESH_FULL_INTERVAL_MS: z.coerce.number().int().positive().default(30 * 60_000),
  PRICE_REFRESH_FULL_PAGES: z.coerce.number().int().positive().default(1),
  PRICE_REFRESH_HOT_SAMPLE: z.coerce.number().int().positive().default(32),
  CATALOG_AUTOSEED: z
    .union([z.literal('true'), z.literal('false')])
    .default('true')
    .transform((v) => v === 'true'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
});

// Railway injects `PORT` by default. If REALTIME_PORT is not set,
// use PORT so the service binds to the expected public listener.
const envInput = {
  ...process.env,
  REALTIME_PORT: process.env.REALTIME_PORT ?? process.env.PORT,
};

export const env = schema.parse(envInput);
