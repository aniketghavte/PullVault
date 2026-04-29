'use client';

import Link from 'next/link';
import { useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { PLATFORM } from '@pullvault/shared/constants';
import { feeOf, formatUSD, money, toMoneyString } from '@pullvault/shared/money';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonPillOutline } from '@/components/ui/ButtonPillOutline';
import { MonoLabel } from '@/components/ui/MonoLabel';
import { ResearchTable, ResearchTableRow } from '@/components/ui/ResearchTable';

interface ListingDetail {
  listing: {
    listingId: string;
    userCardId: string;
    sellerId: string;
    sellerHandle: string;
    priceUSD: string;
    status: string;
  };
  card: {
    id: string;
    name: string;
    set: string;
    rarity: string;
    imageUrl: string;
    marketPriceUSD: string;
  };
}

export default function MarketplaceListingDetailPage({ params }: { params: { listingId: string } }) {
  const router = useRouter();
  const { listingId } = params;

  const [data, setData] = useState<ListingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [meId, setMeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then(res => res.json())
      .then(json => {
        if (json.ok && json.data.user) {
          setMeId(json.data.user.id);
        }
      });
  }, []);

  useEffect(() => {
    fetch(`/api/listings/${listingId}`)
      .then(res => res.json())
      .then(json => {
        if (json.ok) {
          setData(json.data);
        }
      })
      .finally(() => setLoading(false));
  }, [listingId]);

  const listing = data?.listing;
  const card = data?.card;

  const sellerOwns = listing && meId ? listing.sellerId === meId : false;

  const fee = useMemo(() => {
    if (!listing) return '0.00';
    return toMoneyString(feeOf(listing.priceUSD, PLATFORM.TRADE_FEE_RATE));
  }, [listing]);

  const market = card?.marketPriceUSD ?? '0.00';
  const ask = listing?.priceUSD ?? '0.00';
  const delta = useMemo(() => {
    if (!listing || !card) return money(0);
    return money(ask).minus(money(market));
  }, [listing, card, ask, market]);

  const buy = async () => {
    if (!listing) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/listings/${listingId}/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? 'Failed to buy');
        return;
      }
      router.push('/portfolio');
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!listing) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/listings/${listingId}/cancel`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error?.message ?? 'Failed to cancel');
        return;
      }
      router.push('/portfolio');
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
          <MonoLabel>Loading listing...</MonoLabel>
        </div>
      </section>
    );
  }

  if (!listing || !card) {
    return (
      <section className="px-4 pt-10 pb-16">
        <div className="mx-auto w-full max-w-4xl space-y-3">
          <MonoLabel>Listing not found</MonoLabel>
          <Link href="/marketplace" className="text-actionBlue underline underline-offset-4 decoration-actionBlue/30 hover:decoration-actionBlue/60">
            Back to marketplace
          </Link>
        </div>
      </section>
    );
  }

  const sellerGetsGross = money(ask).minus(money(fee));

  const pnlTone = delta.gt(0) ? 'text-errorRed' : delta.lt(0) ? 'text-deepEnterpriseGreen' : 'text-mutedSlate';

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-10">
        <div className="grid gap-8 lg:grid-cols-3 lg:items-start">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-lg border border-cardBorder bg-canvas p-6">
              <MonoLabel>Active listing</MonoLabel>
              <div className="mt-4 flex gap-6 items-start">
                <div className="relative h-56 w-56 rounded-sm overflow-hidden bg-stone border border-cardBorder">
                  {/* Uses remote images; mock uses pokemontcg snapshot */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {/* eslint-disable-next-line jsx-a11y/alt-text */}
                  {/* eslint-disable-next-line react/no-unescaped-entities */}
                  <img src={card.imageUrl} className="object-cover w-full h-full" />
                </div>
                <div className="space-y-3">
                  <h1 className="font-display text-sectionHeading leading-tight tracking-tight">
                    {card.name}
                  </h1>
                  <div className="text-bodyLarge text-ink/70">
                    {card.set} • {card.rarity.replace('_', ' ')}
                  </div>
                  <div className="text-micro text-mutedSlate">Seller: {listing.sellerHandle}</div>
                </div>
              </div>
            </div>

            <ResearchTable>
              <ResearchTableRow
                left={<span className="text-body font-semibold text-mutedSlate">Fee</span>}
                center={<span className="text-body text-canvas/85" />}
                right={<span className="text-body font-semibold">{formatUSD(fee)}</span>}
              />
              <ResearchTableRow
                left={<span className="text-body font-semibold text-mutedSlate">Seller receives</span>}
                right={<span className="text-body font-semibold">{formatUSD(toMoneyString(sellerGetsGross))}</span>}
              />
              <ResearchTableRow
                left={<span className="text-body font-semibold text-mutedSlate">Market vs ask</span>}
                right={
                  <span className={`text-body font-semibold ${pnlTone}`}>
                    {delta.gt(0) ? '+' : ''}
                    {formatUSD(toMoneyString(delta))}
                  </span>
                }
              />
            </ResearchTable>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-cardBorder bg-stone p-6">
              <MonoLabel>Buy</MonoLabel>
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-micro text-mutedSlate">Asking</div>
                  <div className="font-display text-cardHeading">{formatUSD(ask)}</div>
                </div>
                <div className="text-micro text-mutedSlate">
                  Platform fee: {formatUSD(fee)} • Seller gets {formatUSD(toMoneyString(sellerGetsGross))}
                </div>

                <ButtonPrimary onClick={buy} disabled={busy || sellerOwns || listing.status !== 'active'} className="w-full justify-center">
                  {listing.status !== 'active' ? `${listing.status === 'sold' ? 'Already sold' : 'Cancelled'}` : sellerOwns ? 'Your listing' : busy ? 'Buying…' : 'Buy card'}
                </ButtonPrimary>

                {sellerOwns && listing.status === 'active' ? (
                  <ButtonPillOutline onClick={cancel} disabled={busy} className="w-full justify-center text-errorRed border-errorRed/30 hover:border-errorRed/60">
                    Cancel listing
                  </ButtonPillOutline>
                ) : null}

                {error ? (
                  <div className="rounded-lg border border-errorRed/30 bg-errorRed/10 px-4 py-2 text-micro text-errorRed">
                    {error}
                  </div>
                ) : null}

                <ButtonPillOutline
                  onClick={() => router.push('/marketplace')}
                  disabled={busy}
                  className="w-full justify-center"
                >
                  Back to marketplace
                </ButtonPillOutline>
              </div>
            </div>

            <div className="rounded-lg border border-cardBorder bg-canvas p-6">
              <div className="text-featureHeading font-semibold">Atomic trade</div>
              <p className="mt-2 text-bodyLarge text-ink/70">
                When you click buy, the card transfers and your balance is debited in the same state update.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

