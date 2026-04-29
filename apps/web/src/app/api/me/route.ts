import { handler } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import type { BalanceSummary } from '@pullvault/shared';
import { add } from '@pullvault/shared/money';
import { ensureProfile } from '@/services/ensure-profile';

// GET /api/me — returns the current user's profile + balance summary.
export const GET = handler(async (): Promise<{ user: BalanceSummary & { handle: string } }> => {
  const authUser = await requireUser();
  const profile = await ensureProfile(
    authUser.id,
    authUser.email ?? '',
    authUser.user_metadata?.handle,
  );

  if (!profile) {
    return {
      user: {
        userId: authUser.id,
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
