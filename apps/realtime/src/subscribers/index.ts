import { getSubscriber } from '@pullvault/shared';
import { logger } from '@pullvault/shared/logger';
import type { AppSocketServer } from '../sockets/index.js';
import { handleAuctionMessage } from './auctions.js';
import { handleDropMessage } from './drops.js';
import { handlePortfolioMessage, handlePriceTick } from './portfolio.js';

// Channel patterns we PSUBSCRIBE to:
//   pv:auction:*:events    -> per-auction events
//   pv:drop:*:events       -> per-drop events
//   pv:portfolio:*         -> per-user portfolio invalidations
//   pv:prices:ticks        -> global price-tick channel

export async function startSubscribers(io: AppSocketServer) {
  const sub = getSubscriber();

  await sub.psubscribe('pv:auction:*:events');
  await sub.psubscribe('pv:drop:*:events');
  await sub.psubscribe('pv:portfolio:*');
  await sub.subscribe('pv:prices:ticks');

  sub.on('pmessage', (_pattern, channel, message) => {
    try {
      const parsed = JSON.parse(message);
      if (channel.startsWith('pv:auction:')) return handleAuctionMessage(io, channel, parsed);
      if (channel.startsWith('pv:drop:')) return handleDropMessage(io, channel, parsed);
      if (channel.startsWith('pv:portfolio:')) return handlePortfolioMessage(io, channel, parsed);
    } catch (err) {
      logger.warn({ err, channel }, 'failed to handle pmessage');
    }
  });

  sub.on('message', (channel, message) => {
    if (channel === 'pv:prices:ticks') {
      try {
        handlePriceTick(io, JSON.parse(message));
      } catch (err) {
        logger.warn({ err }, 'bad price tick payload');
      }
    }
  });

  logger.info('redis subscribers attached');
}
