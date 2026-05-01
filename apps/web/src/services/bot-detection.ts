import 'server-only';

import { and, count, eq, gte, sql } from 'drizzle-orm';

import { logger } from '@pullvault/shared/logger';

import { db, schema } from '@/lib/db';

// =====================================================================
// B2 Layer 3 — Behavioural bot signals.
// =====================================================================
// These helpers are ALWAYS called fire-and-forget from the hot paths.
// They must never throw in a way that affects the caller — every public
// function internally swallows errors and logs at warn-level.
//
// Scoring model:
//   recordBotSignal() inserts a row into bot_signals AND upserts the
//   user's cumulative score in suspicious_accounts. When the new score
//   crosses BOT_FLAG_THRESHOLD we stamp flagged_at so the admin review
//   queue in B5 can surface the account. We NEVER auto-block — the
//   assignment explicitly says flag-for-review only.

const SCORE_WEIGHTS = {
  fast_click: 15, // purchase submitted < 500ms after page render
  sold_out_attempt: 10, // buy attempt against a sold-out drop
  velocity: 25, // 3+ purchases in 60s window
  no_reveals: 20, // bought 5+ packs and revealed zero (computed offline in B5)
} as const;

const BOT_FLAG_THRESHOLD = 60;

const FAST_CLICK_THRESHOLD_MS = 500;
const VELOCITY_WINDOW_MS = 60_000;
const VELOCITY_THRESHOLD = 3;

type SignalType = keyof typeof SCORE_WEIGHTS;

async function recordBotSignal(
  userId: string,
  ip: string | null,
  signalType: SignalType,
  value: string,
): Promise<void> {
  try {
    await db.insert(schema.botSignals).values({
      userId,
      ip: ip === 'unknown' ? null : ip,
      signalType,
      value,
    });

    const weight = SCORE_WEIGHTS[signalType];

    // Atomic upsert: either create the row at `weight`, or bump the existing
    // score by `weight`. The `flaggedAt` CASE stamps the column the FIRST
    // time the post-increment total crosses BOT_FLAG_THRESHOLD, so later
    // increments don't refresh the timestamp (we want "first flagged at").
    await db
      .insert(schema.suspiciousAccounts)
      .values({
        userId,
        botScore: weight,
        flaggedAt: weight >= BOT_FLAG_THRESHOLD ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: schema.suspiciousAccounts.userId,
        set: {
          botScore: sql`${schema.suspiciousAccounts.botScore} + ${weight}`,
          flaggedAt: sql`CASE
            WHEN ${schema.suspiciousAccounts.flaggedAt} IS NOT NULL THEN ${schema.suspiciousAccounts.flaggedAt}
            WHEN ${schema.suspiciousAccounts.botScore} + ${weight} >= ${BOT_FLAG_THRESHOLD} THEN NOW()
            ELSE NULL
          END`,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    logger.warn({ err, userId, signalType }, 'recordBotSignal failed (non-fatal)');
  }
}

/**
 * Fire when a purchase lands suspiciously close to page-load time.
 * `pageLoadTimestamp` is a client-provided unix-ms; the bot check just
 * compares to now. Missing timestamps are treated as "no signal".
 */
export async function checkFastClick(
  userId: string,
  ip: string,
  pageLoadTimestamp: number | undefined,
): Promise<void> {
  if (!pageLoadTimestamp) return;
  const elapsed = Date.now() - pageLoadTimestamp;
  // Negative `elapsed` means client clock skew — ignore rather than false-positive.
  if (elapsed < 0 || elapsed >= FAST_CLICK_THRESHOLD_MS) return;
  await recordBotSignal(userId, ip, 'fast_click', `${elapsed}ms`);
}

/** Fire when the user tried to buy a drop that was already sold out. */
export async function checkSoldOutAttempt(userId: string, ip: string): Promise<void> {
  await recordBotSignal(userId, ip, 'sold_out_attempt', '1');
}

/**
 * Fire when the user has made 3+ pack purchases inside VELOCITY_WINDOW_MS.
 * This reads the already-committed `pack_purchases` table so it counts the
 * current purchase too (assuming it's called AFTER the transaction commits)
 * OR counts the current purchase attempt-wise (when called before commit).
 * We call it pre-queue so the current in-flight attempt is part of the run.
 */
export async function checkPurchaseVelocity(userId: string, ip: string): Promise<void> {
  try {
    const windowStart = new Date(Date.now() - VELOCITY_WINDOW_MS);
    const [row] = await db
      .select({ c: count() })
      .from(schema.packPurchases)
      .where(
        and(
          eq(schema.packPurchases.userId, userId),
          gte(schema.packPurchases.createdAt, windowStart),
        ),
      );
    const recent = row?.c ?? 0;
    // Use `>= VELOCITY_THRESHOLD - 1` so we fire on the request that would
    // make the user's 3rd purchase-in-60s — see comment above re timing.
    if (recent >= VELOCITY_THRESHOLD - 1) {
      await recordBotSignal(userId, ip, 'velocity', `${recent + 1} purchases/min`);
    }
  } catch (err) {
    logger.warn({ err, userId }, 'checkPurchaseVelocity failed (non-fatal)');
  }
}

/**
 * Convenience wrapper for the purchase route: runs all "at request time"
 * signal checks in parallel and swallows any error. Never throws.
 */
export function runPurchaseBotChecks(
  userId: string,
  ip: string,
  pageLoadTimestamp: number | undefined,
): void {
  void Promise.allSettled([
    checkFastClick(userId, ip, pageLoadTimestamp),
    checkPurchaseVelocity(userId, ip),
  ]).catch((err) => {
    logger.warn({ err }, 'runPurchaseBotChecks top-level error (non-fatal)');
  });
}
