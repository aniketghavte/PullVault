'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { PLATFORM } from '@pullvault/shared/constants';
import { feeOf, formatUSD, money, toMoneyString } from '@pullvault/shared/money';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonPillOutline } from '@/components/ui/ButtonPillOutline';
import { MonoLabel } from '@/components/ui/MonoLabel';
import { ContactFormCard } from '@/components/ui/ContactFormCard';
import { ResearchTableRow, ResearchTable } from '@/components/ui/ResearchTable';
import { getSocket } from '@/lib/socket-client';

function useLiveClock(intervalMs = 250) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return nowMs;
}

function formatMmSs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

interface BidRow {
  bidId: string;
  bidderId: string;
  bidderHandle: string;
  amountUSD: string;
  placedAt: string;
  causedExtension: boolean;
}

interface AuctionDetail {
  auctionId: string;
  sellerId: string;
  sellerHandle: string;
  startingBidUSD: string;
  currentHighBidId: string | null;
  currentHighBidUSD: string | null;
  currentHighBidderId: string | null;
  endAt: string;
  extensions: number;
  status: string;
  winnerId: string | null;
  finalPriceUSD: string | null;
  card: {
    id: string;
    name: string;
    set: string;
    rarity: string;
    imageUrl: string;
    marketPriceUSD: string;
  };
}

export default function AuctionRoomPage({ params }: { params: { auctionId: string } }) {
  const { auctionId } = params;
  const router = useRouter();
  const nowMs = useLiveClock();

  const [auction, setAuction] = useState<AuctionDetail | null>(null);
  const [bids, setBids] = useState<BidRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [amountUSD, setAmountUSD] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [watcherCount, setWatcherCount] = useState(0);
  const [meId, setMeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch user
  useEffect(() => {
    fetch('/api/me')
      .then((res) => res.json())
      .then((json) => {
        if (json.ok && json.data.user) {
          setMeId(json.data.user.userId);
        }
      });
  }, []);

  // Fetch auction detail
  const fetchAuction = useCallback(() => {
    fetch(`/api/auctions/${auctionId}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.ok) {
          setAuction(json.data.auction);
          setBids(json.data.recentBids ?? []);
        }
      })
      .finally(() => setLoading(false));
  }, [auctionId]);

  useEffect(() => {
    fetchAuction();
  }, [fetchAuction]);

  // Socket: join auction room + listen for events
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    socket.emit('auction:join', { auctionId });

    const handleBid = (data: {
      auctionId: string;
      bidId: string;
      bidderId: string;
      bidderHandle: string;
      amountUSD: string;
      placedAt: string;
      causedExtension: boolean;
      newEndAt: string;
    }) => {
      if (data.auctionId !== auctionId) return;
      // Update auction state
      setAuction((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          currentHighBidId: data.bidId,
          currentHighBidUSD: data.amountUSD,
          currentHighBidderId: data.bidderId,
          endAt: data.newEndAt,
          status: data.causedExtension ? 'extended' : prev.status,
        };
      });
      // Prepend to bid list
      setBids((prev) => [
        {
          bidId: data.bidId,
          bidderId: data.bidderId,
          bidderHandle: data.bidderHandle,
          amountUSD: data.amountUSD,
          placedAt: data.placedAt,
          causedExtension: data.causedExtension,
        },
        ...prev,
      ].slice(0, 20));
    };

    const handleState = (data: {
      auctionId: string;
      newEndAt: string;
      extensions: number;
      currentHighBidUSD: string;
      currentHighBidderId: string;
    }) => {
      if (data.auctionId !== auctionId) return;
      setAuction((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          endAt: data.newEndAt,
          extensions: data.extensions,
          currentHighBidUSD: data.currentHighBidUSD,
          currentHighBidderId: data.currentHighBidderId,
          status: 'extended',
        };
      });
    };

    const handleSettled = (data: {
      auctionId: string;
      winnerId: string | null;
      finalPriceUSD: string | null;
    }) => {
      if (data.auctionId !== auctionId) return;
      setAuction((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: 'settled',
          winnerId: data.winnerId,
          finalPriceUSD: data.finalPriceUSD,
        };
      });
    };

    const handleWatchers = (data: { auctionId: string; watcherCount: number }) => {
      if (data.auctionId !== auctionId) return;
      setWatcherCount(data.watcherCount);
    };

    socket.on('auction:bid', handleBid);
    socket.on('auction:state', handleState);
    socket.on('auction:settled', handleSettled);
    socket.on('auction:watchers', handleWatchers);

    return () => {
      socket.emit('auction:leave', { auctionId });
      socket.off('auction:bid', handleBid);
      socket.off('auction:state', handleState);
      socket.off('auction:settled', handleSettled);
      socket.off('auction:watchers', handleWatchers);
    };
  }, [auctionId]);

  // Compute suggested minimum bid
  const suggestedMinBid = useMemo(() => {
    if (!auction) return '0.00';
    const currentHigh = auction.currentHighBidUSD
      ? money(auction.currentHighBidUSD)
      : money(auction.startingBidUSD);
    const hasExistingBid = !!auction.currentHighBidId;

    if (!hasExistingBid) return auction.startingBidUSD;

    const minUsd = money(PLATFORM.MIN_BID_INCREMENT_USD);
    const minPct = money(PLATFORM.MIN_BID_INCREMENT_PCT);
    const incFromPct = currentHigh.times(minPct);
    const increment = incFromPct.gt(minUsd) ? incFromPct : minUsd;
    const minRequired = currentHigh.plus(increment);
    return toMoneyString(minRequired);
  }, [auction]);

  // Auto-fill amount when auction loads or high bid changes
  useEffect(() => {
    if (!auction) return;
    setAmountUSD(suggestedMinBid);
  }, [auction?.auctionId, suggestedMinBid]);

  const endMs = auction ? new Date(auction.endAt).getTime() : 0;
  const leftMs = auction ? endMs - nowMs : 0;
  const antiSnipe = !!auction && leftMs <= PLATFORM.ANTI_SNIPE_WINDOW_SECONDS * 1000 && auction.status !== 'settled';
  const isSettled = auction?.status === 'settled';
  const isSeller = auction?.sellerId === meId;

  const placeBid = async () => {
    if (!auction || busy || isSettled || isSeller) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/auctions/${auctionId}/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountUSD,
          expectedCurrentHighBidId: auction.currentHighBidId,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? 'Failed to place bid');
      }
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <section className="px-4 pt-10 pb-16">
        <div className="mx-auto w-full max-w-4xl space-y-3">
          <MonoLabel>Loading auction...</MonoLabel>
        </div>
      </section>
    );
  }

  if (!auction) {
    return (
      <section className="px-4 pt-10 pb-16">
        <div className="mx-auto w-full max-w-4xl space-y-3">
          <MonoLabel>Auction not found</MonoLabel>
          <ButtonPillOutline onClick={() => router.push('/auctions')}>Back to auctions</ButtonPillOutline>
        </div>
      </section>
    );
  }

  const displayHighBid = auction.currentHighBidUSD ?? auction.startingBidUSD;

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-10">
        <div className="space-y-3">
          <MonoLabel>Auction room</MonoLabel>
          <h1 className="font-display text-sectionDisplay tracking-tight leading-none">{auction.card.name}</h1>
          <p className="text-bodyLarge text-ink/70">
            Current high bid updates instantly via WebSocket; anti-snipe extends end time.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-lg border border-cardBorder bg-canvas overflow-hidden">
              <div className="relative h-72 w-full bg-stone">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={auction.card.imageUrl} alt={auction.card.name} className="object-cover w-full h-full" />
              </div>
              <div className="p-6 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-micro text-mutedSlate">Market reference</div>
                    <div className="text-featureHeading font-semibold">{formatUSD(auction.card.marketPriceUSD)}</div>
                  </div>
                  <div className="space-y-1 text-right">
                    <div className="text-micro text-mutedSlate">Ends in</div>
                    <MonoLabel>
                      {isSettled ? 'Settled' : formatMmSs(leftMs)}
                    </MonoLabel>
                  </div>
                </div>

                {antiSnipe ? (
                  <div className="rounded-lg border border-coral/30 bg-softCoral/20 p-4">
                    <div className="text-micro font-semibold text-coral uppercase tracking-[0.28px]">
                      Anti-snipe active
                    </div>
                    <div className="mt-1 text-bodyLarge text-ink/70">
                      Bids arriving in the final seconds extend the auction by 30 seconds.
                    </div>
                  </div>
                ) : null}

                {isSettled ? (
                  <div className="rounded-lg border border-deepEnterpriseGreen/30 bg-paleGreenWash p-4">
                    <div className="text-micro font-semibold text-deepEnterpriseGreen uppercase tracking-[0.28px]">
                      Auction settled
                    </div>
                    <div className="mt-1 text-bodyLarge text-ink/70">
                      {auction.winnerId
                        ? `Winner pays ${auction.finalPriceUSD ? formatUSD(auction.finalPriceUSD) : formatUSD(displayHighBid)}`
                        : 'No bids — card returned to seller.'}
                    </div>
                  </div>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-micro text-mutedSlate">Current high</div>
                    <div className="mt-1 text-bodyLarge font-semibold">
                      {formatUSD(displayHighBid)}
                    </div>
                  </div>
                  <div>
                    <div className="text-micro text-mutedSlate">Watchers</div>
                    <div className="mt-1 text-bodyLarge font-semibold">{watcherCount}</div>
                  </div>
                </div>
              </div>
            </div>

            <ResearchTable>
              <div className="px-4 pb-2">
                <MonoLabel>Bid history</MonoLabel>
              </div>
              {bids.length === 0 ? (
                <div className="py-5 px-4 text-bodyLarge text-ink/70">No bids yet.</div>
              ) : (
                bids.slice(0, 10).map((b) => (
                  <ResearchTableRow
                    key={b.bidId}
                    left={<span className="text-body font-semibold text-ink">{b.bidderHandle}</span>}
                    center={
                      <span className="text-micro text-mutedSlate">
                        {new Date(b.placedAt).toLocaleTimeString()}
                        {b.causedExtension ? ' ⏱' : ''}
                      </span>
                    }
                    right={<span className="text-body font-semibold text-ink">{formatUSD(b.amountUSD)}</span>}
                  />
                ))
              )}
            </ResearchTable>
          </div>

          <div className="space-y-6">
            <ContactFormCard className="max-w-none">
              <div className="space-y-3">
                <MonoLabel>Place bid</MonoLabel>
                <div className="text-bodyLarge text-ink/70">
                  Minimum valid bid updates as the high bid changes.
                </div>

                <div className="space-y-2">
                  <div className="text-micro text-mutedSlate">Bid amount (USD)</div>
                  <input
                    value={amountUSD}
                    onChange={(e) => setAmountUSD(e.target.value)}
                    className="w-full rounded-sm border border-cardBorder bg-canvas px-4 py-3 text-body outline-none focus:outline-none focus:border-formFocusViolet"
                    type="text"
                    inputMode="decimal"
                    disabled={isSettled || isSeller}
                  />
                  <div className="text-micro text-mutedSlate">
                    Suggested min: <span className="font-semibold text-ink">{formatUSD(suggestedMinBid)}</span>
                  </div>
                </div>

                {error ? (
                  <div className="rounded-lg border border-errorRed/30 bg-errorRed/10 px-4 py-2 text-micro text-errorRed">
                    {error}
                  </div>
                ) : null}

                <ButtonPrimary
                  onClick={placeBid}
                  disabled={busy || isSettled || isSeller}
                  className="w-full justify-center"
                >
                  {isSeller ? 'Your auction' : busy ? 'Placing…' : 'Place Bid'}
                </ButtonPrimary>

                <ButtonPillOutline onClick={() => router.push('/auctions')} className="w-full justify-center">
                  Back to auctions
                </ButtonPillOutline>
              </div>
            </ContactFormCard>
          </div>
        </div>
      </div>
    </section>
  );
}
