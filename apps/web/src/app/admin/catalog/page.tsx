'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonPillOutline } from '@/components/ui/ButtonPillOutline';
import { DarkFeatureBand } from '@/components/ui/DarkFeatureBand';
import { MonoLabel } from '@/components/ui/MonoLabel';
import { getSocket } from '@/lib/socket-client';
import { formatUSD } from '@pullvault/shared/money';

type CardSummary = {
  id: string;
  externalId: string;
  name: string;
  set: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'ultra_rare' | 'secret_rare';
  imageUrl: string;
  marketPriceUSD: string;
  priceUpdatedAt: string;
};

type Stats = {
  total: number;
  byRarity: Record<string, number>;
  lastPricedAt: string | null;
  lastHistoryAt: string | null;
};

type RefreshMode = 'full' | 'hot' | 'seed';

async function jsonOrError<T>(res: Response): Promise<T> {
  const json = (await res.json()) as { ok: boolean; data?: T; error?: { message?: string } };
  if (!json.ok) throw new Error(json.error?.message ?? `Request failed (${res.status})`);
  return json.data as T;
}

function formatTime(iso: string | null) {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

export default function AdminCatalogPage() {
  const [loading, setLoading] = useState<RefreshMode | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [tickById, setTickById] = useState<Record<string, { priceUSD: string; ts: string }>>({});

  const loadStats = useCallback(async () => {
    try {
      const data = await jsonOrError<Stats>(await fetch('/api/admin/catalog/stats', { cache: 'no-store' }));
      setStats(data);
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to load stats' });
    }
  }, []);

  const loadCards = useCallback(async () => {
    try {
      const data = await jsonOrError<{ cards: CardSummary[] }>(
        await fetch('/api/cards?limit=24', { cache: 'no-store' }),
      );
      setCards(data.cards);
    } catch {
      // non-fatal — catalog may be empty before first seed.
    }
  }, []);

  useEffect(() => {
    void loadStats();
    void loadCards();
  }, [loadStats, loadCards]);

  useEffect(() => {
    const socket = getSocket();
    const onTick = (payload: { ts: string; cards: { cardId: string; priceUSD: string }[] }) => {
      if (!payload?.cards?.length) return;
      setTickById((prev) => {
        const next = { ...prev };
        for (const t of payload.cards) {
          next[t.cardId] = { priceUSD: t.priceUSD, ts: payload.ts };
        }
        return next;
      });
    };
    socket.on('price:tick', onTick);
    return () => {
      socket.off('price:tick', onTick);
    };
  }, []);

  const refresh = useCallback(
    async (mode: RefreshMode) => {
      setLoading(mode);
      setStatus(null);
      try {
        const data = await jsonOrError<{ jobId: string; mode: string }>(
          await fetch('/api/admin/catalog/refresh', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode }),
          }),
        );
        setStatus({
          kind: 'ok',
          text: `Queued ${data.mode} refresh (job ${data.jobId}). Worker is picking it up — refresh stats in a few seconds.`,
        });
        setTimeout(() => {
          void loadStats();
          void loadCards();
        }, 4_000);
      } catch (err) {
        setStatus({ kind: 'err', text: err instanceof Error ? err.message : 'Refresh failed' });
      } finally {
        setLoading(null);
      }
    },
    [loadCards, loadStats],
  );

  const cardsView = useMemo(() => {
    return cards.map((c) => {
      const tick = tickById[c.id];
      const price = tick?.priceUSD ?? c.marketPriceUSD;
      return { ...c, displayPrice: price, hasTick: Boolean(tick) };
    });
  }, [cards, tickById]);

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-10">
        <div className="space-y-3">
          <MonoLabel>Admin · Catalog & price engine</MonoLabel>
          <h1 className="font-display text-sectionDisplay tracking-tight leading-none">
            Live valuation pipeline
          </h1>
          <p className="text-bodyLarge text-ink/70">
            Refresh the Pokemon TCG catalog, then watch the BullMQ price-refresh worker drift live
            quotes through Redis pub/sub into your browser. Every action below enqueues a real job
            on the realtime server.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DarkFeatureBand tone="navy" className="rounded-lg border border-cardBorder">
              <div className="space-y-6">
                <div className="flex flex-col gap-2">
                  <div className="text-featureHeading font-semibold">Run a refresh</div>
                  <div className="text-bodyLarge text-canvas/85">
                    Use <span className="font-mono">seed</span> on first run, <span className="font-mono">full</span>
                    {' '}to repaginate the API, or <span className="font-mono">hot</span> to drift prices for
                    listings, auctions, and recently revealed cards.
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <ButtonPrimary
                    onClick={() => void refresh('seed')}
                    disabled={loading !== null}
                    className="justify-center"
                  >
                    {loading === 'seed' ? 'Queuing seed…' : 'Seed catalog'}
                  </ButtonPrimary>
                  <ButtonPrimary
                    onClick={() => void refresh('full')}
                    disabled={loading !== null}
                    className="justify-center"
                  >
                    {loading === 'full' ? 'Queuing full…' : 'Full refresh'}
                  </ButtonPrimary>
                  <ButtonPillOutline
                    onClick={() => void refresh('hot')}
                    disabled={loading !== null}
                    className="justify-center"
                  >
                    {loading === 'hot' ? 'Queuing hot…' : 'Hot tick'}
                  </ButtonPillOutline>
                </div>

                {status ? (
                  <div
                    className={`rounded-sm border px-4 py-3 text-body ${
                      status.kind === 'err'
                        ? 'border-coral/40 bg-coral/10 text-canvas'
                        : 'border-canvas/30 bg-canvas/10 text-canvas'
                    }`}
                  >
                    {status.text}
                  </div>
                ) : null}
              </div>
            </DarkFeatureBand>
          </div>

          <div className="rounded-lg border border-cardBorder bg-canvas p-6">
            <MonoLabel>Catalog state</MonoLabel>
            <dl className="mt-4 space-y-3 text-body">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-mutedSlate">Cards</dt>
                <dd className="font-semibold">{stats ? stats.total.toLocaleString() : '—'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-mutedSlate">Last price write</dt>
                <dd className="font-mono text-micro">{formatTime(stats?.lastPricedAt ?? null)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-mutedSlate">Last history row</dt>
                <dd className="font-mono text-micro">{formatTime(stats?.lastHistoryAt ?? null)}</dd>
              </div>
            </dl>

            {stats && Object.keys(stats.byRarity).length > 0 ? (
              <div className="mt-5 border-t border-hairline pt-4 space-y-2 text-micro">
                {Object.entries(stats.byRarity)
                  .sort((a, b) => b[1] - a[1])
                  .map(([rarity, count]) => (
                    <div key={rarity} className="flex items-center justify-between gap-3">
                      <span className="text-mutedSlate">{rarity.replace('_', ' ')}</span>
                      <span className="font-semibold">{count}</span>
                    </div>
                  ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <MonoLabel>Live preview</MonoLabel>
              <h2 className="mt-1 font-display text-sectionHeading tracking-tight leading-none">
                Latest cards & ticks
              </h2>
              <p className="text-bodyLarge text-ink/70">
                Subscribed to <span className="font-mono">price:tick</span>. Cells flash green/red as the
                worker pushes drift through Redis.
              </p>
            </div>
          </div>

          {cardsView.length === 0 ? (
            <div className="rounded-lg border border-dashed border-cardBorder bg-canvas/60 p-8 text-bodyLarge text-mutedSlate">
              Catalog is empty. Click <em>Seed catalog</em> to populate from the Pokemon TCG API.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {cardsView.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-cardBorder bg-canvas overflow-hidden"
                >
                  <div className="relative h-40 w-full bg-stone">
                    <Image
                      src={c.imageUrl}
                      alt={c.name}
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
                      className="object-contain"
                    />
                  </div>
                  <div className="p-3 space-y-1">
                    <div className="text-micro font-semibold text-ink truncate">{c.name}</div>
                    <div className="text-micro text-mutedSlate truncate">{c.set}</div>
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-micro text-mutedSlate">{c.rarity.replace('_', ' ')}</span>
                      <span
                        className={`text-micro font-mono ${
                          c.hasTick ? 'text-deepEnterpriseGreen' : 'text-ink'
                        }`}
                      >
                        {formatUSD(c.displayPrice)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
