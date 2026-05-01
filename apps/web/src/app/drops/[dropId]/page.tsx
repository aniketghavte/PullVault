'use client';

import { useCallback, useEffect, useMemo, useState, useRef, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { PACK_TIERS } from '@pullvault/shared/constants';
import type { DropState } from '@pullvault/shared';
import { getSocket } from '@/lib/socket-client';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { ButtonPillOutline } from '@/components/ui/ButtonPillOutline';
import { DarkFeatureBand } from '@/components/ui/DarkFeatureBand';
import { MonoLabel } from '@/components/ui/MonoLabel';
import { ProductCard } from '@/components/ui/ProductCard';
import { ResearchTableRow, ResearchTable } from '@/components/ui/ResearchTable';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMmSs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

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

export default function DropDetailPage({ params }: { params: Promise<{ dropId: string }> }) {
  const { dropId } = use(params);
  const router = useRouter();
  const nowMs = useLiveClock();
  const [drop, setDrop] = useState<DropState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef(false);

  // Fetch single drop from real API
  const fetchDrop = useCallback(async () => {
    try {
      const res = await fetch(`/api/drops/${dropId}`);
      const json = await res.json();
      if (json.ok) {
        setDrop(json.data.drop);
      } else {
        setError(json.error?.message ?? 'Drop not found');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, [dropId]);

  useEffect(() => {
    fetchDrop();
  }, [fetchDrop]);

  // Subscribe to Socket.io for live inventory updates
  useEffect(() => {
    if (!drop || socketRef.current) return;

    try {
      const socket = getSocket();
      socketRef.current = true;

      socket.emit('drop:join', { dropId });

      socket.on('drop:inventory', (payload: { dropId: string; remaining: number }) => {
        if (payload.dropId === dropId) {
          setDrop((prev) => (prev ? { ...prev, remaining: payload.remaining } : prev));
        }
      });

      socket.on('drop:sold_out', (payload: { dropId: string }) => {
        if (payload.dropId === dropId) {
          setDrop((prev) =>
            prev ? { ...prev, status: 'sold_out', remaining: 0 } : prev,
          );
        }
      });

      return () => {
        socket.emit('drop:leave', { dropId });
        socket.off('drop:inventory');
        socket.off('drop:sold_out');
        socketRef.current = false;
      };
    } catch {
      // Socket.io not available
    }
  }, [drop !== null, dropId]); // eslint-disable-line react-hooks/exhaustive-deps

  const tier = useMemo(() => {
    if (!drop) return null;
    return PACK_TIERS.find((t) => t.code === drop.tierCode) ?? null;
  }, [drop]);

  // Track when this component rendered so the server can flag sub-500ms
  // page-load-to-click clicks as bot signals. `useRef` so we capture the
  // mount time exactly once and don't churn it on re-renders.
  const pageLoadMsRef = useRef<number>(Date.now());

  // Separate status string for the fairness-queue spinner.
  // null      → idle
  // 'queued'  → enqueued, waiting for the BullMQ jitter + worker
  const [queueStatus, setQueueStatus] = useState<null | 'queued'>(null);

  // B2 — Purchases now enqueue with 0-2000ms jitter. After a successful
  // enqueue we poll the status endpoint until the worker commits the
  // transaction, then navigate to the reveal page. If polling exceeds
  // the timeout we surface a retryable error instead of hanging.
  const buy = async () => {
    if (!drop) return;
    setBusy(true);
    setQueueStatus(null);
    setError(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch(`/api/drops/${drop.dropId}/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey,
          pageLoadTimestamp: pageLoadMsRef.current,
        }),
      });
      const json = await res.json();

      // Rate-limit / validation / auth errors come back synchronously.
      if (!json.ok) {
        setError(json.error?.message ?? 'Purchase failed');
        fetchDrop();
        return;
      }

      // Enqueued — poll for the worker's result.
      const { jobId, timeoutMs } = json.data as {
        jobId: string;
        estimatedDelayMs: number;
        timeoutMs: number;
      };
      setQueueStatus('queued');

      const deadline = Date.now() + (timeoutMs ?? 30_000);
      // Poll every 500ms. Exit when completed/failed or deadline hit.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (Date.now() > deadline) {
          setError('Purchase is taking longer than expected — please try again.');
          fetchDrop();
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
        const poll = await fetch(`/api/drops/purchase-status/${jobId}`, { cache: 'no-store' });
        const pj = await poll.json();
        if (!pj.ok) {
          setError(pj.error?.message ?? 'Purchase lookup failed');
          fetchDrop();
          return;
        }
        const data = pj.data as
          | { status: 'queued' }
          | { status: 'completed'; result: { success: boolean; purchaseId?: string; errorMessage?: string } }
          | { status: 'failed'; errorMessage?: string };
        if (data.status === 'completed') {
          if (data.result.success && data.result.purchaseId) {
            router.push(`/packs/${data.result.purchaseId}/reveal`);
            return;
          }
          setError(data.result.errorMessage ?? 'Purchase failed');
          fetchDrop();
          return;
        }
        if (data.status === 'failed') {
          setError(data.errorMessage ?? 'Purchase failed');
          fetchDrop();
          return;
        }
        // still queued — loop
      }
    } catch {
      setError('Network error — please try again.');
    } finally {
      setBusy(false);
      setQueueStatus(null);
    }
  };

  if (loading) {
    return (
      <section className="px-4 pt-10 pb-16">
        <div className="mx-auto w-full max-w-3xl">
          <MonoLabel>Loading drop…</MonoLabel>
        </div>
      </section>
    );
  }

  if (!drop) {
    return (
      <section className="px-4 pt-10 pb-16">
        <div className="mx-auto w-full max-w-3xl">
          <MonoLabel>Drop not found</MonoLabel>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
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
            ${drop.priceUSD} pack • {drop.remaining}/{drop.totalInventory} remaining
          </h1>
          <p className="text-bodyLarge text-ink/70">
            Inventory is server-authoritative. Concurrent purchases are resolved atomically.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3 items-start">
          <ProductCard
            title="Buy pack"
            subtitle={
              drop.status === 'scheduled'
                ? `Starts in ${formatMmSs(countdownMs)}`
                : drop.status === 'live'
                  ? 'Live now'
                  : 'Sold out'
            }
          >
            <div className="space-y-4">
              {drop.status === 'live' && drop.remaining > 0 ? (
                <ButtonPrimary
                  onClick={buy}
                  disabled={busy}
                  className="w-full justify-center"
                >
                  {queueStatus === 'queued'
                    ? 'Processing your purchase…'
                    : busy
                      ? 'Buying…'
                      : `Buy 1 pack — $${drop.priceUSD}`}
                </ButtonPrimary>
              ) : (
                <ButtonPillOutline disabled className="w-full justify-center">
                  {drop.status === 'scheduled' ? 'Opens soon' : 'Sold out'}
                </ButtonPillOutline>
              )}
              <div className="pt-2 text-micro text-mutedSlate">
                Drop ID: <span className="text-ink">{drop.dropId}</span>
              </div>
              <Link
                href="/portfolio"
                className="text-actionBlue underline underline-offset-4 decoration-actionBlue/30 hover:decoration-actionBlue/60"
              >
                View portfolio valuation
              </Link>
            </div>
          </ProductCard>

          <div className="lg:col-span-2 space-y-6">
            <DarkFeatureBand
              tone={drop.status === 'live' ? 'green' : 'navy'}
              className="rounded-lg border border-cardBorder"
            >
              <div className="space-y-3">
                <div className="text-featureHeading font-semibold">Rarity weights</div>
                <p className="text-bodyLarge text-canvas/85">
                  Higher tiers bias toward rarer cards. Contents are determined at purchase
                  time.
                </p>
              </div>

              {tier ? (
                <div className="pt-8">
                  <ResearchTable>
                    <ResearchTableRow
                      left={<span className="text-body font-semibold">Common</span>}
                      center={
                        <span className="text-body text-canvas/85">
                          {Math.round(tier.rarityWeights.common * 100)}%
                        </span>
                      }
                      right={<span />}
                    />
                    <ResearchTableRow
                      left={<span className="text-body font-semibold">Uncommon</span>}
                      center={
                        <span className="text-body text-canvas/85">
                          {Math.round(tier.rarityWeights.uncommon * 100)}%
                        </span>
                      }
                      right={<span />}
                    />
                    <ResearchTableRow
                      left={<span className="text-body font-semibold">Rare</span>}
                      center={
                        <span className="text-body text-canvas/85">
                          {Math.round(tier.rarityWeights.rare * 100)}%
                        </span>
                      }
                      right={<span />}
                    />
                    <ResearchTableRow
                      left={<span className="text-body font-semibold">Ultra rare</span>}
                      center={
                        <span className="text-body text-canvas/85">
                          {Math.round(tier.rarityWeights.ultra_rare * 100)}%
                        </span>
                      }
                      right={<span />}
                    />
                    <ResearchTableRow
                      left={<span className="text-body font-semibold">Secret rare</span>}
                      center={
                        <span className="text-body text-canvas/85">
                          {Math.round(tier.rarityWeights.secret_rare * 100)}%
                        </span>
                      }
                      right={<span />}
                    />
                  </ResearchTable>
                </div>
              ) : null}
            </DarkFeatureBand>

            <div className="grid gap-4 md:grid-cols-3">
              {[
                { t: 'Tension first', d: 'Commons reveal before rares.' },
                { t: 'Real pricing', d: 'Each drawn card shows market value.' },
                {
                  t: 'Atomic purchase',
                  d: 'Funds and inventory update together in one DB transaction.',
                },
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
