import { handler, ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { ERROR_CODES, solveWeightsSchema } from '@pullvault/shared';
import { runWeightSolver } from '@/services/pack-economics';

// POST /api/admin/solve-weights
//
// Given a tier code and an optional `targetMarginPct`, returns the rarity
// weights that drive the pack's EV to that margin (commons used as the
// lever; see `pack-economics.solveRarityWeights`). The response includes
// a Monte-Carlo verification run so the operator can sanity-check the
// recommendation before promoting it.
//
// This endpoint does NOT mutate `pack_tiers`. Promoting recommended
// weights is a deliberate two-step (admin review then save) so a bad
// price feed cannot silently rewrite the economy.
export const POST = handler(async (req: Request) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = solveWeightsSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ApiError(
      ERROR_CODES.VALIDATION,
      'Invalid request',
      parsed.error.flatten(),
    );
  }
  return runWeightSolver(db, parsed.data);
});
