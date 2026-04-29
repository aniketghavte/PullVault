'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { AUCTION_DURATIONS_MINUTES, PLATFORM } from '@pullvault/shared/constants';
import { feeOf, formatUSD, money, toMoneyString } from '@pullvault/shared/money';

import { mockApi } from '@/lib/mock/api';
import { useMockStore } from '@/lib/mock/store';
import { useServerClock } from '@/lib/mock/clock';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonPillOutline } from '@/components/ui/ButtonPillOutline';
import { MonoLabel } from '@/components/ui/MonoLabel';
import { ContactFormCard } from '@/components/ui/ContactFormCard';
import { ResearchTableRow, ResearchTable } from '@/components/ui/ResearchTable';

function formatMmSs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export default function AuctionRoomPage({ params }: { params: { auctionId: string } }) {
  const router = useRouter();
  const nowMs = useServerClock({ syncMockEngine: true });

  const auction = useMockStore((s) => s.auctions.find((a) => a.auctionId === params.auctionId));
  const bids = auction?.bids ?? [];
  const [amountUSD, setAmountUSD] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const suggestedMinBid = useMemo(() => {
    if (!auction) return '0.00';
    const currentHigh = money(auction.currentHighBidUSD);
    const minUsd = money(PLATFORM.MIN_BID_INCREMENT_USD);
    const minPct = money(PLATFORM.MIN_BID_INCREMENT_PCT);
    const incFromPct = currentHigh.times(minPct);
    const increment = incFromPct.gt(minUsd) ? incFromPct : minUsd;
    const minRequired = currentHigh.plus(increment);
    return toMoneyString(minRequired);
  }, [auction]);

  useEffect(() => {
    if (!auction) return;
    setAmountUSD(suggestedMinBid);
  }, [auction?.auctionId]);

  const endMs = auction ? new Date(auction.endAt).getTime() : 0;
  const leftMs = auction ? endMs - nowMs : 0;
  const antiSnipe = !!auction && leftMs <= PLATFORM.ANTI_SNIPE_WINDOW_SECONDS * 1000 && auction.status !== 'settled';

  const placeBid = async () => {
    if (!auction) return;
    if (busy) return;
    setBusy(true);
    try {
      const res = await mockApi.auctions.placeBid(auction.auctionId, amountUSD, crypto.randomUUID());
      if (!res.ok) return alert(res.error.message);
    } finally {
      setBusy(false);
    }
  };

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

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-10">
        <div className="space-y-3">
          <MonoLabel>Auction room</MonoLabel>
          <h1 className="font-display text-sectionDisplay tracking-tight leading-none">{auction.card.name}</h1>
          <p className="text-bodyLarge text-ink/70">
            Current high bid updates instantly in the mock engine; anti-snipe extends end time.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-lg border border-cardBorder bg-canvas overflow-hidden">
              <div className="relative h-72 w-full bg-stone">
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
                      {auction.status === 'settled' ? 'Settled' : formatMmSs(leftMs)}
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

                <div className="mt-2 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-micro text-mutedSlate">Current high</div>
                    <div className="mt-1 text-bodyLarge font-semibold">
                      {formatUSD(auction.currentHighBidUSD)} by {auction.currentHighBidderHandle}
                    </div>
                  </div>
                  <div>
                    <div className="text-micro text-mutedSlate">Watchers</div>
                    <div className="mt-1 text-bodyLarge font-semibold">{auction.watcherCount}</div>
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
                    center={<span className="text-micro text-mutedSlate">{new Date(b.placedAt).toLocaleTimeString()}</span>}
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
                    disabled={auction.status === 'settled'}
                  />
                  <div className="text-micro text-mutedSlate">
                    Suggested min: <span className="font-semibold text-ink">{formatUSD(suggestedMinBid)}</span>
                  </div>
                </div>

                <ButtonPrimary onClick={placeBid} disabled={busy || auction.status === 'settled'} className="w-full justify-center">
                  {busy ? 'Placing…' : 'Place Bid'}
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

