import { logger } from '@pullvault/shared/logger';

import { runWashTradeDetection } from '../jobs/wash-trade-detector.js';
import { Queue, Worker, bullConnection } from './connections.js';

// =====================================================================
// B3 — Wash-trade / auction-integrity hourly sweep.
// =====================================================================
// Single-concurrency worker so we never have two scans racing to
// insert the same flag. Empty-payload jobs because the detector reads
// its own time windows.

const QUEUE_NAME = 'pv_queue_wash_trade';
const REPEAT_EVERY_MS = 60 * 60 * 1000; // 1 hour
// Fixed jobId so BullMQ upserts the repeat schedule instead of
// accumulating one new schedule per process restart.
const REPEAT_JOB_ID = 'wash-trade:repeat';

export type WashTradeJob = Record<string, never>;

let queue: Queue<WashTradeJob> | null = null;

export function getWashTradeQueue(): Queue<WashTradeJob> {
  if (queue) return queue;
  queue = new Queue<WashTradeJob>(QUEUE_NAME, {
    connection: bullConnection(),
    defaultJobOptions: {
      removeOnComplete: 20,
      removeOnFail: 20,
      // Detector is idempotent (dedup on metadata), so a retry storm
      // can't create duplicate flags — but keep attempts low so a bad
      // query doesn't run 20 times in a row while the alert is silent.
      attempts: 2,
    },
  });
  return queue;
}

export function startWashTradeWorker() {
  const worker = new Worker<WashTradeJob>(
    QUEUE_NAME,
    async () => {
      const res = await runWashTradeDetection();
      return res;
    },
    {
      connection: bullConnection(),
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, '[wash-trade] job failed');
  });
  worker.on('completed', (job, result) => {
    logger.info({ jobId: job.id, result }, '[wash-trade] job completed');
  });

  // Ensure the repeatable schedule exists. Using a fixed jobId makes
  // this a no-op on restart and prevents schedule drift.
  void (async () => {
    const q = getWashTradeQueue();
    await q.add(
      'detect',
      {} as WashTradeJob,
      {
        repeat: { every: REPEAT_EVERY_MS },
        jobId: REPEAT_JOB_ID,
      },
    );
    logger.info(
      { queue: QUEUE_NAME, everyMs: REPEAT_EVERY_MS },
      '[wash-trade] repeatable schedule registered',
    );
  })();

  return worker;
}
