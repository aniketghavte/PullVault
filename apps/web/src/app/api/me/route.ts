import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { handler } from '@/lib/api';
import { requireUserId } from '@/lib/auth';
import type { BalanceSummary } from '@pullvault/shared';
import { add } from '@pullvault/shared/money';

// GET /api/me — returns the current user's profile + balance summary.
export const GET = handler(async (): Promise<{ user: BalanceSummary & { handle: string } }> => {
  const userId = await requireUserId();
  const [profile] = await db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.id, userId))
    .limit(1);

  if (!profile) {
    return {
      user: {
        userId,
        handle: '',
        availableUSD: '0.00',
        heldUSD: '0.00',
        totalUSD: '0.00',
      },
    };
  }

  return {
    user: {
      userId: profile.id,
      handle: profile.handle,
      availableUSD: profile.availableBalanceUsd,
      heldUSD: profile.heldBalanceUsd,
      totalUSD: add(profile.availableBalanceUsd, profile.heldBalanceUsd).toFixed(2),
    },
  };
});
