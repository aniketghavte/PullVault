import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getMigrationClient } from '../client';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
// packages/db/src/scripts -> repo root (parent of `packages/`)
const repoRoot = path.resolve(scriptDir, '../../../..');
const migrationsFolder = path.resolve(scriptDir, '../../migrations');

loadEnv({ path: path.join(repoRoot, '.env') });
loadEnv({ path: path.join(repoRoot, '.env.local'), override: true });

async function main() {
  const client = getMigrationClient();
  const db = drizzle(client);
  console.log('Running migrations against', process.env.DIRECT_DATABASE_URL ? 'DIRECT' : 'POOLED');
  console.log('Migrations folder:', migrationsFolder);
  await migrate(db, { migrationsFolder });
  await client.end();
  console.log('Migrations complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
