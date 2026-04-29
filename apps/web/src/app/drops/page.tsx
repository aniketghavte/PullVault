'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { mockApi } from '@/lib/mock/api';
import { useMockStore } from '@/lib/mock/store';
import { useServerClock } from '@/lib/mock/clock';
import type { Drop } from '@/lib/mock/types';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonPillOutline } from '@/components/ui/ButtonPillOutline';
import { MonoLabel } from '@/components/ui/MonoLabel';
import { ProductCard } from '@/components/ui/ProductCard';

function formatMmSs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function InventoryBar({ remaining, total }: { remaining: number; total: number }) {
  const pct = total <= 0 ? 0 : Math.min(1, remaining / total);
  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-micro text-mutedSlate mb-2">
        <span>{remaining} left</span>
        <span>{Math.round(pct * 100)}%</span>
      </div>
      <div className="h-2 rounded-full bg-nearBlack/10 overflow-hidden">
        <div className="h-full bg-nearBlack" style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}

export default function DropsPage() {
  const router = useRouter();
  const nowMs = useServerClock({ syncMockEngine: true });
  const drops = useMockStore((s) => s.drops);
  const [busyDropId, setBusyDropId] = useState<string | null>(null);

  const orderedDrops = useMemo(() => {
    return [...drops].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }, [drops]);

  const buy = async (drop: Drop) => {
    setBusyDropId(drop.dropId);
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await mockApi.drops.buyPack(drop.dropId, idempotencyKey);
      if (!res.ok) {
        alert(res.error.message);
        return;
      }
      router.push(`/packs/${res.data.purchaseId}/reveal`);
    } finally {
      setBusyDropId(null);
    }
  };

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl">
        <div className="space-y-3 pb-8">
          <MonoLabel>Pack Drops</MonoLabel>
          <h1 className="font-display text-sectionDisplay tracking-tight leading-none">Limited inventory, scheduled tension.</h1>
          <p className="text-bodyLarge text-ink/70">
            Drops go live at scheduled times. Inventory decrements instantly in the mock engine.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {orderedDrops.map((d) => {
            const scheduledMs = new Date(d.scheduledAt).getTime();
            const countdownMs = scheduledMs - nowMs;
            const statusLabel =
              d.status === 'scheduled'
                ? `Starts in ${formatMmSs(countdownMs)}`
                : d.status === 'live'
                  ? 'Live now'
                  : d.status === 'sold_out'
                    ? 'Sold out'
                    : 'Closed';

            return (
              <ProductCard key={d.dropId} title={d.tierName} subtitle={`${d.priceUSD} pack • ${d.remaining}/${d.totalInventory} remaining`}>
                <div className="space-y-4">
                  <div className="text-micro font-semibold text-mutedSlate">{statusLabel}</div>
                  <InventoryBar remaining={d.remaining} total={d.totalInventory} />

                  {d.status === 'live' && d.remaining > 0 ? (
                    <div className="flex gap-3">
                      <ButtonPrimary
                        onClick={() => buy(d)}
                        disabled={busyDropId === d.dropId}
                        className="w-full justify-center"
                      >
                        Buy 1 pack — {d.priceUSD}
                      </ButtonPrimary>
                    </div>
                  ) : (
                    <ButtonPillOutline disabled className="w-full justify-center">
                      {d.status === 'scheduled' ? 'Opens soon' : 'Sold out'}
                    </ButtonPillOutline>
                  )}

                  <div className="pt-2 flex items-center justify-between gap-4">
                    <div className="text-micro text-mutedSlate">
                      Drop ID: <span className="text-ink">{d.dropId}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push(`/drops/${d.dropId}`)}
                      className="text-actionBlue underline underline-offset-4 decoration-actionBlue/30 hover:decoration-actionBlue/60"
                    >
                      Details
                    </button>
                  </div>
                </div>
              </ProductCard>
            );
          })}
        </div>
      </div>
    </section>
  );
}
