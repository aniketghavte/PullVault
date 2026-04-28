import 'dotenv/config';
import type { Config } from 'drizzle-kit';

const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error('DIRECT_DATABASE_URL or DATABASE_URL must be set for drizzle-kit');
}

export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  // We co-locate everything in the `public` schema; Supabase has its own
  // schemas (auth, storage) that we do not touch.
  schemaFilter: ['public'],
  strict: true,
  verbose: true,
} satisfies Config;
