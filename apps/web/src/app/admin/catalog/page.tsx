'use client';

import { useState } from 'react';

import { mockApi } from '@/lib/mock/api';

import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { MonoLabel } from '@/components/ui/MonoLabel';

import { DarkFeatureBand } from '@/components/ui/DarkFeatureBand';

export default function AdminCatalogPage() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const res = await mockApi.admin.refreshCatalog();
      if (!res.ok) {
        setStatus(res.error.message);
        return;
      }
      setStatus(`Catalog refreshed: ${res.data.count} cards loaded into mock cache.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-10">
        <div className="space-y-3">
          <MonoLabel>Admin</MonoLabel>
          <h1 className="font-display text-sectionDisplay tracking-tight leading-none">Catalog refresh</h1>
          <p className="text-bodyLarge text-ink/70">
            Refresh the mock Pokemon catalog from the free Pokemon TCG API (optional network dependency).
          </p>
        </div>

        <DarkFeatureBand tone="navy" className="rounded-lg border border-cardBorder">
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div className="space-y-2">
                <div className="text-featureHeading font-semibold">Pokemon catalog cache</div>
                <div className="text-bodyLarge text-canvas/85">
                  You can keep browsing without refresh; this only updates the mock snapshot.
                </div>
              </div>
              <div className="flex gap-3">
                <ButtonPrimary onClick={refresh} disabled={loading} className="justify-center">
                  {loading ? 'Refreshing…' : 'Refresh catalog'}
                </ButtonPrimary>
              </div>
            </div>

            {status ? (
              <div className="rounded-lg border border-canvas/20 bg-canvas/10 p-4">
                <div className="text-micro text-canvas/90 font-semibold">Status</div>
                <div className="text-bodyLarge text-canvas/85 mt-1">{status}</div>
              </div>
            ) : null}
          </div>
        </DarkFeatureBand>
      </div>
    </section>
  );
}

