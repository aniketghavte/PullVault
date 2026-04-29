'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { AUCTION_DURATIONS_MINUTES, PLATFORM } from '@pullvault/shared/constants';
import { formatUSD, money, toMoneyString } from '@pullvault/shared/money';

import { mockApi } from '@/lib/mock/api';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonPillOutline } from '@/components/ui/ButtonPillOutline';
import { MonoLabel } from '@/components/ui/MonoLabel';

function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeSparklinePoints(cardId: string, baseUSD: string) {
  const base = money(baseUSD);
  const points: number[] = [];
  const seed = hash(cardId);
  for (let i = 0; i < 24; i++) {
    const r = ((seed + i * 97) % 1000) / 1000; // 0..1
    const drift = (r - 0.5) * 0.35; // +/-17.5%
    const v = base.times(1 + drift);
    points.push(Number(toMoneyString(v))); // used only for SVG scaling
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  return points.map((p, i) => {
    const x = (i / (points.length - 1)) * 220;
    const y = 80 - ((p - min) / range) * 60;
    return { x, y };
  });
}

interface DetailData {
  card: {
    userCardId: string;
    status: string;
    acquiredPriceUSD: string;
    acquiredAt: string;
    cardId: string;
    name: string;
    set: string;
    rarity: string;
    imageUrl: string;
    marketPriceUSD: string;
  };
  activeListing: { listingId: string } | null;
  activeAuction: { auctionId: string } | null;
}

export default function PortfolioCardDetailPage({ params }: { params: { userCardId: string } }) {
  const router = useRouter();
  const { userCardId } = params;

  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/portfolio/${userCardId}`)
      .then(res => res.json())
      .then(json => {
        if (json.ok) setData(json.data);
      })
      .finally(() => setLoading(false));
  }, [userCardId]);

  const card = data?.card;
  const activeListing = data?.activeListing;
  const activeAuction = data?.activeAuction;

  const [listPriceUSD, setListPriceUSD] = useState<string>('');
  const [auctionDurationMinutes, setAuctionDurationMinutes] = useState<number>(AUCTION_DURATIONS_MINUTES[1]);
  const [auctionStartBidUSD, setAuctionStartBidUSD] = useState<string>('');

  // Set defaults once loaded
  useEffect(() => {
    if (card && !listPriceUSD) setListPriceUSD(card.marketPriceUSD);
    if (card && !auctionStartBidUSD) setAuctionStartBidUSD(card.marketPriceUSD);
  }, [card, listPriceUSD, auctionStartBidUSD]);

  const safeDefaultList = card?.marketPriceUSD ?? '0.00';
  const safeDefaultBid = card?.marketPriceUSD ?? '0.00';
  const listPrice = listPriceUSD || safeDefaultList;
  const startBid = auctionStartBidUSD || safeDefaultBid;

  const sparkPoints = useMemo(() => {
    if (!card) return [];
    return makeSparklinePoints(card.userCardId, card.marketPriceUSD);
  }, [card]);

  if (loading) {
    return (
      <section className="px-4 pt-10 pb-16">
        <div className="mx-auto w-full max-w-3xl">
          <MonoLabel>Loading card...</MonoLabel>
        </div>
      </section>
    );
  }

  if (!card) {
    return (
      <section className="px-4 pt-10 pb-16">
        <div className="mx-auto w-full max-w-3xl">
          <MonoLabel>Card not found</MonoLabel>
        </div>
      </section>
    );
  }

  const pnl = money(card.marketPriceUSD).minus(card.acquiredPriceUSD);
  const pnlTone = pnl.gt(0) ? 'text-deepEnterpriseGreen' : pnl.lt(0) ? 'text-errorRed' : 'text-mutedSlate';

  const canList = card.status === 'held';
  const canAuction = card.status === 'held';

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-10">
        <div className="grid gap-10 lg:grid-cols-3 lg:items-start">
          <div className="lg:col-span-2 space-y-6">
            <div className="flex gap-6 items-start">
              <div className="relative h-56 w-56 rounded-sm overflow-hidden bg-stone border border-cardBorder">
                <Image src={card.imageUrl} alt={card.name} fill className="object-cover" />
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <MonoLabel>{card.rarity.replace('_', ' ')}</MonoLabel>
                  <h1 className="font-display text-sectionDisplay tracking-tight leading-none">{card.name}</h1>
                  <div className="text-bodyLarge text-ink/70">
                    {card.set}
                  </div>
                </div>

                <div className="rounded-lg border border-cardBorder bg-canvas p-5 space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-micro text-mutedSlate">Market</div>
                    <div className="text-micro font-semibold text-ink">{formatUSD(card.marketPriceUSD)}</div>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-micro text-mutedSlate">P&amp;L since acquisition</div>
                    <div className={`text-bodyLarge font-semibold ${pnlTone}`}>
                      {pnl.gt(0) ? '+' : ''}
                      {formatUSD(toMoneyString(pnl))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-cardBorder bg-canvas p-6 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="text-featureHeading font-semibold">30-day price sparkline (mock)</div>
                <div className="text-micro text-mutedSlate">Not historical, simulated for UI</div>
              </div>
              <svg viewBox="0 0 220 80" className="w-full h-20">
                {sparkPoints.length > 0 ? (
                  <>
                    <polyline
                      fill="none"
                      stroke="#4c6ee6"
                      strokeWidth="2"
                      points={sparkPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                    />
                  </>
                ) : null}
              </svg>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-lg border border-cardBorder bg-stone p-6 space-y-4">
              <div>
                <MonoLabel>Actions</MonoLabel>
                <div className="mt-2 text-bodyLarge text-ink/70">
                  Card status: <span className="font-semibold text-ink">{card.status.replace('_', ' ')}</span>
                </div>
              </div>

              {activeListing ? (
                <div className="rounded-lg border border-cardBorder bg-canvas p-4">
                  <div className="text-micro text-mutedSlate">Already listed</div>
                  <Link href={`/marketplace/${activeListing.listingId}`} className="text-actionBlue underline underline-offset-4 decoration-actionBlue/30 hover:decoration-actionBlue/60">
                    View listing
                  </Link>
                </div>
              ) : null}

              {activeAuction ? (
                <div className="rounded-lg border border-cardBorder bg-canvas p-4">
                  <div className="text-micro text-mutedSlate">In live auction</div>
                  <Link href={`/auctions/${activeAuction.auctionId}`} className="text-actionBlue underline underline-offset-4 decoration-actionBlue/30 hover:decoration-actionBlue/60">
                    Enter auction room
                  </Link>
                </div>
              ) : null}

              <div className="space-y-4 pt-2">
                <div className="space-y-2">
                  <div className="text-micro text-mutedSlate">List for sale (USD)</div>
                  <input
                    disabled={!canList}
                    value={listPriceUSD}
                    onChange={(e) => setListPriceUSD(e.target.value)}
                    type="text"
                    className="w-full rounded-sm border border-cardBorder bg-canvas px-4 py-3 text-body outline-none disabled:opacity-50"
                    placeholder={safeDefaultList}
                  />
                  <ButtonPrimary
                    disabled={!canList}
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/listings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ userCardId: card.userCardId, priceUSD: listPrice }),
                        });
                        const json = await res.json();
                        if (!json.ok) return alert(json.error?.message || 'Failed to list card');
                        router.push(`/marketplace/${json.data.listingId}`);
                      } catch (err) {
                        alert('Network error');
                      }
                    }}
                    className="w-full justify-center"
                  >
                    List for sale
                  </ButtonPrimary>
                </div>

                <div className="space-y-2">
                  <div className="text-micro text-mutedSlate">Start auction</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <div className="text-micro text-mutedSlate">Starting bid</div>
                      <input
                        disabled={!canAuction}
                        value={auctionStartBidUSD}
                        onChange={(e) => setAuctionStartBidUSD(e.target.value)}
                        type="text"
                        className="w-full rounded-sm border border-cardBorder bg-canvas px-4 py-3 text-body outline-none disabled:opacity-50"
                        placeholder={safeDefaultBid}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="text-micro text-mutedSlate">Duration (min)</div>
                      <select
                        disabled={!canAuction}
                        value={auctionDurationMinutes}
                        onChange={(e) => setAuctionDurationMinutes(Number(e.target.value))}
                        className="w-full rounded-sm border border-cardBorder bg-canvas px-4 py-3 text-body outline-none disabled:opacity-50"
                      >
                        {AUCTION_DURATIONS_MINUTES.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <ButtonPrimary
                    disabled={!canAuction}
                    onClick={async () => {
                      const res = await mockApi.auctions.create({
                        userCardId: card.userCardId,
                        startingBidUSD: startBid,
                        durationMinutes: auctionDurationMinutes,
                      });
                      if (!res.ok) return alert(res.error.message);
                      router.push(`/auctions/${res.data.auctionId}`);
                    }}
                    className="w-full justify-center"
                  >
                    Start auction
                  </ButtonPrimary>
                </div>

                <div className="text-micro text-mutedSlate pt-1">
                  Fees: trade {Math.round(Number(PLATFORM.TRADE_FEE_RATE) * 100)}% • auction {Math.round(Number(PLATFORM.AUCTION_FEE_RATE) * 100)}%
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-cardBorder bg-canvas p-6 space-y-3">
              <div className="text-featureHeading font-semibold">Details</div>
              <div className="space-y-2 text-bodyLarge text-ink/70">
                <div>
                  Status gate: a card cannot be listed and auctioned simultaneously in the mock engine.
                </div>
              </div>
              <ButtonPillOutline
                onClick={() => router.push('/portfolio')}
                className="w-full justify-center"
              >
                Back to portfolio
              </ButtonPillOutline>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

