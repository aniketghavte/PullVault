import http from 'node:http';
import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './env.js';
import { internalRouter } from './routes/internal.js';
import { healthRouter } from './routes/health.js';

export function createApp(): { app: Express; server: http.Server } {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '64kb' }));
  app.use(
    cors({
      origin: [env.NEXT_PUBLIC_APP_URL],
      credentials: true,
    }),
  );

  app.use('/health', healthRouter);
  // Trusted server-to-server endpoints (web -> realtime). Auth via the
  // shared secret REALTIME_INTERNAL_TOKEN.
  app.use('/internal', internalRouter);

  const server = http.createServer(app);
  return { app, server };
}
