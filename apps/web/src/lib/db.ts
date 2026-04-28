import 'server-only';
import { getDb, schema } from '@pullvault/db';

// Re-export so app code does `import { db } from '@/lib/db'`.
export const db = getDb();
export { schema };
