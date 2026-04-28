import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  REALTIME_PORT: z.coerce.number().int().positive().default(4000),
  REDIS_URL: z.string().min(10),
  DATABASE_URL: z.string().min(10),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  REALTIME_INTERNAL_TOKEN: z.string().min(16),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.string().default('info'),
});

export const env = schema.parse(process.env);
