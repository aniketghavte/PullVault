import {
  Router,
  type NextFunction,
  type Request,
  type Response,
  type Router as ExpressRouter,
} from 'express';
import { z } from 'zod';

import { logger } from '@pullvault/shared/logger';

import { env } from '../env.js';
import { enqueuePriceRefresh } from '../queues/price-refresh.js';
import { scheduleAuctionClose } from '../queues/auction-close.js';

// Web app -> realtime trust boundary. Web sometimes wants to broadcast
// directly (e.g. forced room reload), without going through Redis.
// Most events still flow over Redis pub/sub.

function requireInternalToken(req: Request, res: Response, next: NextFunction) {
  const token = req.header('x-realtime-token');
  if (!token || token !== env.REALTIME_INTERNAL_TOKEN) {
    return res.status(401).json({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  }
  next();
}

const priceRefreshSchema = z.object({
  mode: z.enum(['full', 'hot', 'seed']).default('full'),
  pages: z.number().int().positive().max(8).optional(),
  sample: z.number().int().positive().max(500).optional(),
});

export const internalRouter: ExpressRouter = Router();
internalRouter.use(requireInternalToken);

internalRouter.post('/ping', (_req, res) => res.json({ ok: true }));

internalRouter.post('/jobs/price-refresh', async (req, res) => {
  const parsed = priceRefreshSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ ok: false, error: { code: 'VALIDATION', message: 'Bad payload', details: parsed.error.flatten() } });
  }
  try {
    const { jobId } = await enqueuePriceRefresh(parsed.data);
    return res.status(202).json({ ok: true, data: { jobId, mode: parsed.data.mode } });
  } catch (err) {
    logger.error({ err }, 'failed to enqueue price refresh');
    return res
      .status(500)
      .json({ ok: false, error: { code: 'INTERNAL', message: 'enqueue failed' } });
  }
});

const auctionCloseSchema = z.object({
  auctionId: z.string().uuid(),
  endAt: z.string(), // ISO date string
});

internalRouter.post('/jobs/auction-close', async (req, res) => {
  const parsed = auctionCloseSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ ok: false, error: { code: 'VALIDATION', message: 'Bad payload', details: parsed.error.flatten() } });
  }
  try {
    await scheduleAuctionClose(parsed.data.auctionId, new Date(parsed.data.endAt));
    return res.status(202).json({ ok: true, data: { auctionId: parsed.data.auctionId } });
  } catch (err) {
    logger.error({ err }, 'failed to schedule auction close');
    return res
      .status(500)
      .json({ ok: false, error: { code: 'INTERNAL', message: 'schedule failed' } });
  }
});
