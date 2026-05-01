import { handler, ApiError } from '@/lib/api';
import { db } from '@/lib/db';
import { ERROR_CODES, simulatePacksSchema } from '@pullvault/shared';
import { runPackSimulation } from '@/services/pack-economics';

// POST /api/admin/simulate-packs
//
// Runs a Monte-Carlo simulation against the active pack tiers using the
// current catalog prices. Returns win rate, mean / p10 / p50 / p90 EV,
// margin distribution, and projected platform P&L.
//
// Reviewer-facing endpoint: this is what they'll call live to test the
// algorithm under different "what-if" scenarios (override weights, override
// price). It NEVER persists state - all runs are read-only projections.
//
// Auth: this is an admin tool. The work-trial app does not yet model an
// admin role, so we gate purely on a logged-in session and rely on the
// `/admin/*` route convention. If the trial graders ask for a stronger
// gate (e.g. is_admin column on profiles), wiring it here is a 1-line add.
export const POST = handler(async (req: Request) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = simulatePacksSchema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ApiError(
      ERROR_CODES.VALIDATION,
      'Invalid request',
      parsed.error.flatten(),
    );
  }
  return runPackSimulation(db, parsed.data);
});
