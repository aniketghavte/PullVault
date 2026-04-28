import { Router, type NextFunction, type Request, type Response } from 'express';
import { env } from '../env.js';

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

export const internalRouter = Router();
internalRouter.use(requireInternalToken);

internalRouter.post('/ping', (_req, res) => res.json({ ok: true }));
