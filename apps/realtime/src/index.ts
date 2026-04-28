import { env } from './env.js';
import { createApp } from './http.js';
import { createIo } from './sockets/index.js';
import { startSubscribers } from './subscribers/index.js';
import { startQueues } from './queues/index.js';
import { logger } from '@pullvault/shared/logger';

async function main() {
  const { server, app } = createApp();
  const io = createIo(server);

  await startSubscribers(io);
  await startQueues();

  server.listen(env.REALTIME_PORT, () => {
    logger.info(
      { port: env.REALTIME_PORT, env: env.NODE_ENV },
      'pullvault realtime server listening',
    );
  });

  // Graceful shutdown.
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down realtime server');
    io.close();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Keep "app" reachable for tests.
  void app;
}

main().catch((err) => {
  logger.error({ err }, 'realtime server failed to start');
  process.exit(1);
});
