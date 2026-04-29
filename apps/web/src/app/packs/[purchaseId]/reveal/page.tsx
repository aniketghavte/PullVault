'use client';

import Image from 'next/image';
import { useMemo, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { formatUSD, money, toMoneyString } from '@pullvault/shared/money';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonPillOutline } from '@/components/ui/ButtonPillOutline';
import { MonoLabel } from '@/components/ui/MonoLabel';
import { ProductCard } from '@/components/ui/ProductCard';

function rarityLabel(rarity: string) {
  switch (rarity) {
    case 'common':
      return 'Common';
    case 'uncommon':
      return 'Uncommon';
    case 'rare':
      return 'Rare';
    case 'ultra_rare':
      return 'Ultra rare';
    case 'secret_rare':
      return 'Secret rare';
    default:
      return rarity;
  }
}

interface DrawnCard {
  rarity: string;
  drawPriceUSD: string;
  card: {
    name: string;
    set: string;
    rarity: string;
    imageUrl: string;
    marketPriceUSD: string;
  };
}

interface PurchaseData {
  purchaseId: string;
  dropId: string;
  tierCode: string;
  pricePaidUSD: string;
  sealed: boolean;
  revealedCount: number;
  drawnCards: DrawnCard[];
}

export default function PackRevealPage({ params }: { params: { purchaseId: string } }) {
  const { purchaseId } = params;
  const router = useRouter();
  
  const [purchase, setPurchase] = useState<PurchaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  
  const fetchPurchase = useCallback(async () => {
    try {
      const res = await fetch(`/api/packs/${purchaseId}`);
      const json = await res.json();
      if (json.ok) {
        setPurchase(json.data);
      } else {
        setError(json.error?.message ?? 'Purchase not found');
      }
    } catch {
      setError('Failed to load pack details');
    } finally {
      setLoading(false);
    }
  }, [purchaseId]);

  useEffect(() => {
    fetchPurchase();
  }, [fetchPurchase]);

  const drawnCards = purchase?.drawnCards ?? [];
  const revealedCount = purchase?.revealedCount ?? 0;

  const totalValueUSD = useMemo(() => {
    if (!purchase) return '0.00';
    return toMoneyString(
      drawnCards.reduce((acc, c) => acc.plus(money(c.card.marketPriceUSD)), money(0)),
    );
  }, [purchase, drawnCards]);

  const pnlUSD = useMemo(() => {
    if (!purchase) return '0.00';
    const value = money(totalValueUSD);
    const cost = money(purchase.pricePaidUSD);
    const diff = value.minus(cost);
    return toMoneyString(diff);
  }, [purchase, totalValueUSD]);

  const pnlTone =
    money(pnlUSD).gt(0) ? 'text-deepEnterpriseGreen' : money(pnlUSD).lt(0) ? 'text-errorRed' : 'text-mutedSlate';

  const rip = async () => {
    if (!purchase) return;
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/packs/${purchaseId}/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: 0 }),
      });
      const json = await res.json();
      if (json.ok) {
        setPurchase(prev => prev ? { ...prev, revealedCount: json.data.revealedCount } : prev);
      } else {
        alert(json.error?.message ?? 'Failed to reveal');
      }
    } catch {
      alert('Network error');
    } finally {
      setBusy(false);
    }
  };

  const revealNext = async () => {
    if (!purchase) return;
    if (busy) return;
    const pos = purchase.revealedCount;
    setBusy(true);
    try {
      const res = await fetch(`/api/packs/${purchaseId}/reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position: pos }),
      });
      const json = await res.json();
      if (json.ok) {
        setPurchase(prev => prev ? { ...prev, revealedCount: json.data.revealedCount } : prev);
      } else {
        alert(json.error?.message ?? 'Failed to reveal');
      }
    } catch {
      alert('Network error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <section className="px-4 pt-10 pb-16">
        <div className="mx-auto w-full max-w-3xl">
          <MonoLabel>Loading pack...</MonoLabel>
        </div>
      </section>
    );
  }

  if (!purchase) {
    return (
      <section className="px-4 pt-10 pb-16">
        <div className="mx-auto w-full max-w-3xl">
          <MonoLabel>Purchase not found</MonoLabel>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </div>
      </section>
    );
  }

  const isComplete = revealedCount >= drawnCards.length;
  const nextToReveal = drawnCards[revealedCount];

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-10">
        <div className="space-y-3">
          <MonoLabel>Pack reveal</MonoLabel>
          <h1 className="font-display text-sectionDisplay tracking-tight leading-none">
            Reveal tension — commons first.
          </h1>
          <p className="text-bodyLarge text-ink/70">
            Pack contents are drawn at purchase time in the mock engine, so the reveal is purely presentation.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3 items-start">
          <div className="lg:col-span-2">
            <ProductCard
              title="Sealed pack"
              subtitle={`${purchase.dropId} • ${purchase.tierCode}`}
            >
              <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
                <div className="space-y-2">
                  <div className="text-micro font-semibold text-mutedSlate">Status</div>
                  <div className="text-bodyLarge font-semibold">
                    {revealedCount === 0 ? 'Sealed' : isComplete ? 'All cards revealed' : `Revealed ${revealedCount}/${drawnCards.length}`}
                  </div>
                </div>

                {revealedCount === 0 ? (
                  <ButtonPrimary onClick={rip} disabled={busy} className="min-w-[220px] justify-center">
                    Rip it open
                  </ButtonPrimary>
                ) : isComplete ? (
                  <ButtonPrimary onClick={() => router.push('/portfolio')} className="min-w-[220px] justify-center">
                    View portfolio
                  </ButtonPrimary>
                ) : (
                  <ButtonPrimary onClick={revealNext} disabled={busy} className="min-w-[220px] justify-center">
                    Reveal next card
                  </ButtonPrimary>
                )}
              </div>
            </ProductCard>

            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {drawnCards.map((d, idx) => {
                const revealed = idx < revealedCount;
                return (
                  <div
                    key={`${purchase.purchaseId}_${idx}`}
                    className={[
                      'rounded-lg border border-cardBorder bg-canvas overflow-hidden',
                      revealed ? 'opacity-100' : 'opacity-60',
                    ].join(' ')}
                  >
                    {revealed ? (
                      <div className="p-4 space-y-3">
                        <div className="relative h-32 w-full rounded-sm overflow-hidden border border-cardBorder">
                          <Image src={d.card.imageUrl} alt={d.card.name} fill className="object-cover" />
                        </div>
                        <div className="space-y-1">
                          <div className="text-featureHeading font-semibold text-ink leading-tight">
                            {d.card.name}
                          </div>
                          <div className="text-micro text-mutedSlate">{d.card.set}</div>
                          <div className="text-body text-ink/70">
                            {rarityLabel(d.rarity)}
                          </div>
                        </div>
                        <div className="text-micro font-semibold text-ink">
                          {formatUSD(d.card.marketPriceUSD)}
                        </div>
                      </div>
                    ) : (
                      <div className="p-4 space-y-3">
                        <div className="h-32 w-full rounded-sm bg-nearBlack/5 border border-cardBorder" />
                        <div className="text-micro text-mutedSlate uppercase tracking-[0.28px]">
                          Locked
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-6">
            <ProductCard
              title="Pack summary"
              subtitle="Realistic valuation display (mock)"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="text-micro text-mutedSlate">Paid</div>
                  <div className="font-semibold">{formatUSD(purchase.pricePaidUSD)}</div>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div className="text-micro text-mutedSlate">Total value</div>
                  <div className="font-semibold">{formatUSD(totalValueUSD)}</div>
                </div>
                <div className="rounded-lg border border-cardBorder p-4">
                  <div className="text-micro font-semibold text-mutedSlate">P&amp;L</div>
                  <div className={`mt-2 text-bodyLarge font-semibold ${pnlTone}`}>
                    {money(pnlUSD).gt(0) ? '+' : ''}
                    {formatUSD(pnlUSD)}
                  </div>
                  <div className="text-micro text-mutedSlate pt-1">
                    Compared to what you paid.
                  </div>
                </div>
              </div>
            </ProductCard>

            <div className="rounded-lg border border-cardBorder bg-paleGreenWash p-6 space-y-3">
              <div className="text-featureHeading font-semibold">Next</div>
              <p className="text-bodyLarge text-ink/70">
                After reveal, each card can be listed for trade or put into a live auction.
              </p>
              {isComplete ? (
                <ButtonPrimary onClick={() => router.push('/portfolio')} className="w-full justify-center">
                  Manage your cards
                </ButtonPrimary>
              ) : (
                <ButtonPillOutline disabled className="w-full justify-center">
                  Reveal to unlock actions
                </ButtonPillOutline>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

