// =====================================================================
// B2 Layer 2 — Purchase fairness queue: shared types + jitter helper.
// =====================================================================
// Both the web app (producer + poller) and the realtime worker import
// from here so the BullMQ job payload shape stays in sync. The Queue
// instance itself lives wherever it's used — BullMQ's Queue + Worker
// can point at the same Redis queue name from different processes.

import { REDIS_KEYS } from './constants';

export const PURCHASE_QUEUE_NAME = REDIS_KEYS.queue.packPurchase;

/** Input the web route hands to the worker. */
export interface PurchaseJobData {
  userId: string;
  dropId: string;
  idempotencyKey: string;
  /** Unix-ms when the web route enqueued this job (used for metrics). */
  requestedAt: number;
  /** Captured IP — surfaced back to bot-detection if we record a sold-out signal. */
  ip?: string;
}

/** Output the worker returns for the polling endpoint. */
export interface PurchaseJobResult {
  success: boolean;
  purchaseId?: string;
  /** ISO timestamp of commit (when success = true). */
  completedAt?: string;
  /** When success = false: a stable machine-readable code (matches ERROR_CODES). */
  errorCode?: string;
  errorMessage?: string;
}

/** Maximum jitter the worker can be held for. Exported so UI timeout can match. */
export const PURCHASE_MAX_JITTER_MS = 2_000;

/**
 * Random jitter 0..PURCHASE_MAX_JITTER_MS (exclusive). The whole point is
 * that a bot firing at T+0ms and a human clicking at T+400ms both receive
 * a randomized server-side delay, so the fastest HTTP client has no
 * deterministic advantage.
 */
export function getPurchaseJitterMs(): number {
  return Math.floor(Math.random() * PURCHASE_MAX_JITTER_MS);
}

/** Jobs expire from the queue after this many ms if the worker is offline. */
export const PURCHASE_JOB_TTL_MS = 30_000;
