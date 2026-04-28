import { logger } from '@pullvault/shared/logger';
import { startAuctionCloseWorker } from './auction-close.js';
import { startPriceRefreshWorker } from './price-refresh.js';

export async function startQueues() {
  startAuctionCloseWorker();
  startPriceRefreshWorker();
  logger.info('bullmq workers started');
}
