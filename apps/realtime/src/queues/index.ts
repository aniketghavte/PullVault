import { logger } from '@pullvault/shared/logger';
import { startAuctionCloseWorker } from './auction-close.js';
import { startPriceRefreshWorker } from './price-refresh.js';
import { startPackPurchaseWorker } from './pack-purchase.js';
import { startWashTradeWorker } from './wash-trade.js';

export async function startQueues() {
  startAuctionCloseWorker();
  startPriceRefreshWorker();
  startPackPurchaseWorker();
  startWashTradeWorker();
  logger.info('bullmq workers started');
}
