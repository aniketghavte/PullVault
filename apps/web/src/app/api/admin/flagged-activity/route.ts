import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { handler, ApiError } from '@/lib/api';
import { db, schema } from '@/lib/db';
import { ERROR_CODES } from '@pullvault/shared';
import { requireUser } from '@/lib/auth';

// =====================================================================
// /api/admin/flagged-activity
// =====================================================================
// GET   — returns the N most-recent flags, optionally filtered by
//         reviewed=true|false (defaults to the open/pending queue).
// PATCH — marks a flag as reviewed. Body: { id, notes? }.
//
// Both handlers require an authenticated session. There is no admin
// role on `profiles` yet; access control will be layered on when the
// admin RBAC lands. Until then we keep the routes behind auth so the
// data isn't public.

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const GET = handler(async (req: Request) => {
  await requireUser();

  const url = new URL(req.url);
  // `reviewed` filter: absent or 'false' → pending; 'true' → already
  // reviewed; 'all' → no filter.
  const reviewedParam = url.searchParams.get('reviewed');
  const limitParam = url.searchParams.get('limit');
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number.parseInt(limitParam ?? `${DEFAULT_LIMIT}`, 10) || DEFAULT_LIMIT),
  );

  const baseQuery = db
    .select({
      id: schema.flaggedActivity.id,
      type: schema.flaggedActivity.type,
      referenceId: schema.flaggedActivity.referenceId,
      reason: schema.flaggedActivity.reason,
      severity: schema.flaggedActivity.severity,
      metadata: schema.flaggedActivity.metadata,
      reviewed: schema.flaggedActivity.reviewed,
      reviewedAt: schema.flaggedActivity.reviewedAt,
      reviewedBy: schema.flaggedActivity.reviewedBy,
      reviewNotes: schema.flaggedActivity.reviewNotes,
      createdAt: schema.flaggedActivity.createdAt,
    })
    .from(schema.flaggedActivity);

  const rows =
    reviewedParam === 'all'
      ? await baseQuery.orderBy(desc(schema.flaggedActivity.createdAt)).limit(limit)
      : await baseQuery
          .where(eq(schema.flaggedActivity.reviewed, reviewedParam === 'true'))
          .orderBy(desc(schema.flaggedActivity.createdAt))
          .limit(limit);

  return {
    flags: rows.map((r) => ({
      id: r.id,
      type: r.type,
      referenceId: r.referenceId,
      reason: r.reason,
      severity: r.severity,
      metadata: r.metadata,
      reviewed: r.reviewed,
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
      reviewedBy: r.reviewedBy,
      reviewNotes: r.reviewNotes,
      createdAt: r.createdAt.toISOString(),
    })),
  };
});

const patchSchema = z.object({
  id: z.string().uuid(),
  notes: z.string().max(1024).optional(),
});

export const PATCH = handler(async (req: Request) => {
  const user = await requireUser();
  const json = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      ERROR_CODES.VALIDATION,
      'Invalid review payload',
      parsed.error.flatten(),
    );
  }

  const [updated] = await db
    .update(schema.flaggedActivity)
    .set({
      reviewed: true,
      reviewedAt: new Date(),
      reviewedBy: user.email ?? user.id,
      reviewNotes: parsed.data.notes ?? null,
    })
    .where(eq(schema.flaggedActivity.id, parsed.data.id))
    .returning({ id: schema.flaggedActivity.id });

  if (!updated) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, 'Flag not found');
  }

  return { id: updated.id };
});
