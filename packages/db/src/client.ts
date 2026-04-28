import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';

// Two clients:
// - `db`: pooled (Supabase Transaction Pooler, port 6543). Used by app code.
//   PgBouncer in transaction mode disallows prepared statements -> `prepare:false`.
// - `migrationDb`: direct connection (port 5432) for migrations only.

let appClient: Sql | null = null;
let appDb: PostgresJsDatabase<typeof schema> | null = null;

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (appDb) return appDb;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  appClient = postgres(url, {
    prepare: false, // required when going through pgbouncer transaction pooling
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
  });
  appDb = drizzle(appClient, { schema, logger: process.env.DB_LOG === '1' });
  return appDb;
}

export function getMigrationClient(): Sql {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DIRECT_DATABASE_URL or DATABASE_URL must be set');
  return postgres(url, { prepare: true, max: 1 });
}

export type DB = PostgresJsDatabase<typeof schema>;
export { schema };
