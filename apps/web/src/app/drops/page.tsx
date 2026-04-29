'use client';

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';

import type { DropState } from '@pullvault/shared';
import { getSocket } from '@/lib/socket-client';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonPillOutline } from '@/components/ui/ButtonPillOutline';
import { MonoLabel } from '@/components/ui/MonoLabel';
import { ProductCard } from '@/components/ui/ProductCard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// useLiveClock — ticks every second for countdown display
// ---------------------------------------------------------------------------

function useLiveClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DropsPage() {
  const router = useRouter();
  const nowMs = useLiveClock();
  const [drops, setDrops] = useState<DropState[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyDropId, setBusyDropId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef(false);

  // Fetch drops from real API
  const fetchDrops = useCallback(async () => {
    try {
      const res = await fetch('/api/drops');
      const json = await res.json();
      if (json.ok) {
        setDrops(json.data.drops);
      } else {
        setError(json.error?.message ?? 'Failed to load drops');
      }
    } catch (err) {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDrops();
  }, [fetchDrops]);

  // Subscribe to Socket.io drop rooms for live inventory updates
  useEffect(() => {
    if (drops.length === 0 || socketRef.current) return;

    try {
      const socket = getSocket();
      socketRef.current = true;

      // Join rooms for all active drops
      for (const d of drops) {
        if (d.status === 'live' || d.status === 'scheduled') {
          socket.emit('drop:join', { dropId: d.dropId });
        }
      }

      // Listen for inventory updates
      socket.on('drop:inventory', (payload: { dropId: string; remaining: number }) => {
        setDrops((prev) =>
          prev.map((d) =>
            d.dropId === payload.dropId ? { ...d, remaining: payload.remaining } : d,
          ),
        );
      });

      // Listen for sold-out events
      socket.on('drop:sold_out', (payload: { dropId: string }) => {
        setDrops((prev) =>
          prev.map((d) =>
            d.dropId === payload.dropId ? { ...d, status: 'sold_out', remaining: 0 } : d,
          ),
        );
      });

      return () => {
        for (const d of drops) {
          socket.emit('drop:leave', { dropId: d.dropId });
        }
        socket.off('drop:inventory');
        socket.off('drop:sold_out');
        socketRef.current = false;
      };
    } catch {
      // Socket.io not available — fallback to polling
    }
  }, [drops.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Buy handler — calls real API
  const buy = async (drop: DropState) => {
    setBusyDropId(drop.dropId);
    setError(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch(`/api/drops/${drop.dropId}/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey }),
      });
      const json = await res.json();
      if (json.ok) {
        router.push(`/packs/${json.data.purchaseId}/reveal`);
      } else {
        const msg = json.error?.message ?? 'Purchase failed';
        setError(msg);
        // Refresh drops to get current state
        fetchDrops();
      }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusyDropId(null);
    }
  };

  const orderedDrops = useMemo(() => {
    return [...drops].sort(
      (a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime(),
    );
  }, [drops]);

  if (loading) {
    return (
      <section className="px-4 pt-10 pb-16">
        <div className="mx-auto w-full max-w-7xl">
          <div className="space-y-3 pb-8">
            <MonoLabel>Pack Drops</MonoLabel>
            <h1 className="font-display text-sectionDisplay tracking-tight leading-none">
              Loading drops…
            </h1>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl">
        <div className="space-y-3 pb-8">
          <MonoLabel>Pack Drops</MonoLabel>
          <h1 className="font-display text-sectionDisplay tracking-tight leading-none">
            Limited inventory, real-time tension.
          </h1>
          <p className="text-bodyLarge text-ink/70">
            Drops go live at scheduled times. Inventory decrements are atomic and
            broadcast in real-time.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {orderedDrops.length === 0 && (
          <div className="text-center py-16 text-mutedSlate text-bodyLarge">
            No drops available.{' '}
            <button
              type="button"
              onClick={async () => {
                await fetch('/api/admin/seed-drops', { method: 'POST' });
                fetchDrops();
              }}
              className="text-actionBlue underline underline-offset-4"
            >
              Seed test drops
            </button>
          </div>
        )}

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
              <ProductCard
                key={d.dropId}
                title={d.tierName}
                subtitle={`$${d.priceUSD} pack • ${d.remaining}/${d.totalInventory} remaining`}
              >
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
                        {busyDropId === d.dropId ? 'Buying…' : `Buy 1 pack — $${d.priceUSD}`}
                      </ButtonPrimary>
                    </div>
                  ) : (
                    <ButtonPillOutline disabled className="w-full justify-center">
                      {d.status === 'scheduled' ? 'Opens soon' : 'Sold out'}
                    </ButtonPillOutline>
                  )}

                  <div className="pt-2 flex items-center justify-between gap-4">
                    <div className="text-micro text-mutedSlate">
                      Drop ID: <span className="text-ink">{d.dropId.slice(0, 8)}…</span>
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
