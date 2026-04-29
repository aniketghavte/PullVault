import { feeOf, money, add, toMoneyString } from '@pullvault/shared/money';

import { PLATFORM } from '@pullvault/shared/constants';

import type { Auction, DropStatus, MockState } from './types';

function isoToMs(iso: string) {
  return new Date(iso).getTime();
}

function pickBestBid(auction: Auction) {
  if (auction.bids.length === 0) return null;
  // bids are newest-first; pick the max amount.
  let best = auction.bids[0]!;
  for (const b of auction.bids) {
    if (money(b.amountUSD).gt(best.amountUSD)) best = b;
  }
  return best;
}

function sumHeld(heldAuctionAmounts: MockState['heldAuctionAmounts']) {
  let total = money(0);
  for (const v of Object.values(heldAuctionAmounts)) {
    total = add(total, v);
  }
  return toMoneyString(total);
}

export function refreshMockState(prev: MockState, nowMs: number): MockState {
  // ---- Drops ----
  const nextDrops: MockState['drops'] = prev.drops.map((d) => {
    if (d.status === 'scheduled' && isoToMs(d.scheduledAt) <= nowMs) {
      const nextStatus: DropStatus = d.remaining > 0 ? 'live' : 'sold_out';
      return { ...d, status: nextStatus };
    }
    if (d.status === 'live' && d.remaining <= 0) {
      const nextStatus: DropStatus = 'sold_out';
      return { ...d, remaining: 0, status: nextStatus };
    }
    return d;
  }) as MockState['drops'];

  // ---- Auctions ----
  let nextHeldAuctionAmounts = { ...prev.heldAuctionAmounts };
  let nextMeAvailableUSD = prev.me.availableUSD;
  let nextMeHeldUSD = prev.me.heldUSD;
  let nextUserCards = [...prev.userCards];
  let nextAuctions: Auction[] = prev.auctions.map((a) => ({ ...a, bids: [...a.bids] }));
  let nextLedger = [...prev.ledger];

  const meId = prev.me.id;

  for (let i = 0; i < nextAuctions.length; i++) {
    const auction = nextAuctions[i]!;
    if (auction.status !== 'live' && auction.status !== 'extended') continue;
    if (isoToMs(auction.endAt) > nowMs) continue;

    const best = pickBestBid(auction);
    const winnerId = best?.bidderId ?? auction.sellerId;
    const winnerHandle = best?.bidderHandle ?? auction.sellerHandle;

    const finalPriceUSD = best?.amountUSD ?? '0.00';
    auction.status = 'settled';
    auction.currentHighBidUSD = finalPriceUSD;
    auction.currentHighBidderId = winnerId;
    auction.currentHighBidderHandle = winnerHandle;

    // Money logic (mock): only track the current user's balances + held auction amounts.
    const heldForThisAuction = nextHeldAuctionAmounts[auction.auctionId];
    if (winnerId === meId) {
      // Consume held funds if we had a bid.
      if (heldForThisAuction) {
        delete nextHeldAuctionAmounts[auction.auctionId];
      }
    } else {
      // Release any held funds if we were outbid at settlement time.
      if (heldForThisAuction) {
        nextMeAvailableUSD = toMoneyString(add(nextMeAvailableUSD, heldForThisAuction));
        delete nextHeldAuctionAmounts[auction.auctionId];
      }
    }

    // Card ownership transfer.
    nextUserCards = nextUserCards.map((uc) => {
      if (uc.userCardId !== auction.userCardId) return uc;
      return {
        ...uc,
        ownerId: winnerId,
        ownerHandle: winnerHandle,
        status: 'held',
      };
    });

    // Platform fee ledger entry.
    if (best) {
      const platformFee = feeOf(finalPriceUSD, PLATFORM.AUCTION_FEE_RATE);
      nextLedger.push({
        id: `led_auction_fee_${auction.auctionId}`,
        createdAt: new Date(nowMs).toISOString(),
        kind: 'platform_fee',
        userId: null,
        amountUSD: toMoneyString(platformFee),
        referenceId: auction.auctionId,
      });
    }
  }

  nextMeHeldUSD = sumHeld(nextHeldAuctionAmounts);

  return {
    ...prev,
    me: { ...prev.me, availableUSD: nextMeAvailableUSD, heldUSD: nextMeHeldUSD },
    drops: nextDrops,
    auctions: nextAuctions,
    userCards: nextUserCards,
    heldAuctionAmounts: nextHeldAuctionAmounts,
    ledger: nextLedger,
  };
}

