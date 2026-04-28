import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import { getMigrationClient } from '../client';

async function main() {
  const client = getMigrationClient();
  const db = drizzle(client);
  console.log('Running migrations against', process.env.DIRECT_DATABASE_URL ? 'DIRECT' : 'POOLED');
  await migrate(db, { migrationsFolder: 'migrations' });
  await client.end();
  console.log('Migrations complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
