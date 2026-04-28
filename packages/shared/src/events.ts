// Internal event names used over Redis pub/sub between web (publisher) and
// realtime (subscriber+broadcaster). Keep names string-typed and centralized.

export const INTERNAL_EVENTS = {
  // Web publishes after a successful state mutation; realtime fans out to sockets.
  bidAccepted: 'pv.bid.accepted',
  auctionExtended: 'pv.auction.extended',
  auctionSettled: 'pv.auction.settled',
  dropInventoryChanged: 'pv.drop.inventory_changed',
  dropSoldOut: 'pv.drop.sold_out',
  cardPriceUpdated: 'pv.card.price_updated',
  portfolioInvalidated: 'pv.portfolio.invalidated',
} as const;

export type InternalEventName = (typeof INTERNAL_EVENTS)[keyof typeof INTERNAL_EVENTS];

export interface InternalEnvelope<T = unknown> {
  event: InternalEventName;
  emittedAt: string; // ISO
  payload: T;
}
