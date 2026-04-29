'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { PACK_TIERS } from '@pullvault/shared/constants';
import { mockApi } from '@/lib/mock/api';
import { useMockStore } from '@/lib/mock/store';
import { useServerClock } from '@/lib/mock/clock';
import type { Drop } from '@/lib/mock/types';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonPillOutline } from '@/components/ui/ButtonPillOutline';
import { DarkFeatureBand } from '@/components/ui/DarkFeatureBand';
import { MonoLabel } from '@/components/ui/MonoLabel';
import { ProductCard } from '@/components/ui/ProductCard';
import { ResearchTableRow, ResearchTable } from '@/components/ui/ResearchTable';

function formatMmSs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

export default function DropDetailPage({ params }: { params: { dropId: string } }) {
  const router = useRouter();
  const nowMs = useServerClock({ syncMockEngine: true });
  const drop = useMockStore((s) => s.drops.find((d) => d.dropId === params.dropId));
  const [busy, setBusy] = useState(false);

  const tier = useMemo(() => {
    if (!drop) return null;
    return PACK_TIERS.find((t) => t.code === drop.tierCode) ?? null;
  }, [drop]);

  const buy = async (d: Drop) => {
    setBusy(true);
    try {
      const res = await mockApi.drops.buyPack(d.dropId, crypto.randomUUID());
      if (!res.ok) {
        alert(res.error.message);
        return;
      }
      router.push(`/packs/${res.data.purchaseId}/reveal`);
    } finally {
      setBusy(false);
    }
  };

  if (!drop) {
    return (
      <section className="px-4 pt-10 pb-16">
        <div className="mx-auto w-full max-w-3xl">
          <MonoLabel>Drop not found</MonoLabel>
        </div>
      </section>
    );
  }

  const scheduledMs = new Date(drop.scheduledAt).getTime();
  const countdownMs = scheduledMs - nowMs;

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-10">
        <div className="space-y-3">
          <MonoLabel>{drop.tierName}</MonoLabel>
          <h1 className="font-display text-sectionDisplay tracking-tight leading-none">
            {drop.priceUSD} pack • {drop.remaining}/{drop.totalInventory} remaining
          </h1>
          <p className="text-bodyLarge text-ink/70">
            Inventory is server-authoritative in the real build; here it updates inside the mock engine.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3 items-start">
          <ProductCard
            title="Buy pack"
            subtitle={drop.status === 'scheduled' ? `Starts in ${formatMmSs(countdownMs)}` : drop.status === 'live' ? 'Live now' : 'Sold out'}
          >
            <div className="space-y-4">
              {drop.status === 'live' && drop.remaining > 0 ? (
                <ButtonPrimary onClick={() => buy(drop)} disabled={busy} className="w-full justify-center">
                  Buy 1 pack — {drop.priceUSD}
                </ButtonPrimary>
              ) : (
                <ButtonPillOutline disabled className="w-full justify-center">
                  {drop.status === 'scheduled' ? 'Opens soon' : 'Sold out'}
                </ButtonPillOutline>
              )}
              <div className="pt-2 text-micro text-mutedSlate">
                Drop ID: <span className="text-ink">{drop.dropId}</span>
              </div>
              <Link href="/portfolio" className="text-actionBlue underline underline-offset-4 decoration-actionBlue/30 hover:decoration-actionBlue/60">
                View portfolio valuation
              </Link>
            </div>
          </ProductCard>

          <div className="lg:col-span-2 space-y-6">
            <DarkFeatureBand tone={drop.status === 'live' ? 'green' : 'navy'} className="rounded-lg border border-cardBorder">
              <div className="space-y-3">
                <div className="text-featureHeading font-semibold">Rarity weights</div>
                <p className="text-bodyLarge text-canvas/85">
                  Higher tiers bias toward rarer cards. Contents are determined at purchase time.
                </p>
              </div>

              {tier ? (
                <div className="pt-8">
                  <ResearchTable>
                    <ResearchTableRow
                      left={<span className="text-body font-semibold">Common</span>}
                      center={<span className="text-body text-canvas/85">{Math.round(tier.rarityWeights.common * 100)}%</span>}
                      right={<span />}
                    />
                    <ResearchTableRow
                      left={<span className="text-body font-semibold">Uncommon</span>}
                      center={<span className="text-body text-canvas/85">{Math.round(tier.rarityWeights.uncommon * 100)}%</span>}
                      right={<span />}
                    />
                    <ResearchTableRow
                      left={<span className="text-body font-semibold">Rare</span>}
                      center={<span className="text-body text-canvas/85">{Math.round(tier.rarityWeights.rare * 100)}%</span>}
                      right={<span />}
                    />
                    <ResearchTableRow
                      left={<span className="text-body font-semibold">Ultra rare</span>}
                      center={<span className="text-body text-canvas/85">{Math.round(tier.rarityWeights.ultra_rare * 100)}%</span>}
                      right={<span />}
                    />
                    <ResearchTableRow
                      left={<span className="text-body font-semibold">Secret rare</span>}
                      center={<span className="text-body text-canvas/85">{Math.round(tier.rarityWeights.secret_rare * 100)}%</span>}
                      right={<span />}
                    />
                  </ResearchTable>
                </div>
              ) : null}
            </DarkFeatureBand>

            <div className="grid gap-4 md:grid-cols-3">
              {[
                { t: 'Tension first', d: 'Commons reveal before rares.' },
                { t: 'Real pricing feel', d: 'Each drawn card shows market value.' },
                { t: 'Atomic experience', d: 'Funds and inventory update together in the UI.' },
              ].map((c) => (
                <div key={c.t} className="rounded-lg border border-cardBorder bg-canvas p-6">
                  <div className="text-featureHeading font-semibold">{c.t}</div>
                  <p className="mt-2 text-bodyLarge text-ink/70">{c.d}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

