import { logger } from '@pullvault/shared/logger';
import { startAuctionCloseWorker } from './auction-close.js';
import { startPriceRefreshWorker } from './price-refresh.js';
import { startPackPurchaseWorker } from './pack-purchase.js';

export async function startQueues() {
  startAuctionCloseWorker();
  startPriceRefreshWorker();
  startPackPurchaseWorker();
  logger.info('bullmq workers started');
}
