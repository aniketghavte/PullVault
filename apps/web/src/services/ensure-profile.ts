import 'server-only';

import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { PLATFORM } from '@pullvault/shared/constants';
import { toMoneyString } from '@pullvault/shared/money';
import { logger } from '@pullvault/shared/logger';

/**
 * Ensures a profiles row exists for the given Supabase auth user.
 *
 * The Postgres trigger `handle_new_user()` in `post-migration.sql` should
 * create the row automatically on signup. This helper is a **safety net**
 * for cases where:
 *   - The trigger hasn't been applied yet (dev setup)
 *   - The user signed up before the trigger was created
 *   - Supabase edge cases (email link confirmation, OAuth, etc.)
 *
 * Uses ON CONFLICT DO NOTHING so it's idempotent — safe to call on every
 * authenticated request without performance concerns (single-row upsert).
 *
 * Returns the profile row (existing or newly created).
 */
export async function ensureProfile(userId: string, email: string, handle?: string) {
  // Try to read the profile first (fast path — avoids write on every request)
  const [existing] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, userId))
    .limit(1);

  if (existing) return existing;

  // Profile doesn't exist — create one with the default starting balance
  const derivedHandle = handle ?? email.split('@')[0] ?? 'user';
  const startingBalance = toMoneyString(PLATFORM.DEFAULT_STARTING_BALANCE_USD);

  const [created] = await db
    .insert(schema.profiles)
    .values({
      id: userId,
      email,
      handle: derivedHandle,
      availableBalanceUsd: startingBalance,
      heldBalanceUsd: '0.00',
    })
    .onConflictDoNothing({ target: schema.profiles.id })
    .returning();

  if (created) {
    logger.info(
      { userId, handle: derivedHandle, balance: startingBalance },
      'profile created with starting balance',
    );

    // Also write the initial deposit ledger entry
    await db.insert(schema.ledgerEntries).values({
      kind: 'deposit',
      userId,
      amountUsd: startingBalance,
      referenceTable: 'profiles',
      referenceId: userId,
      metadata: { reason: 'initial_signup_credit' },
    });

    return created;
  }

  // ON CONFLICT fired — another request created the profile concurrently.
  // Re-read and return it.
  const [raceWinner] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, userId))
    .limit(1);

  return raceWinner ?? null;
}
