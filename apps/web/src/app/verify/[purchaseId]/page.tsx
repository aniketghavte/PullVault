'use client';

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { hashSeed, verifyPurchase, type VerificationResult } from '@pullvault/shared';

interface PurchaseData {
  id: string;
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  revealed: boolean;
  tier: {
    rarityWeights: Record<string, number>;
  };
  cards: Array<{
    drawIndex: number;
    rarity: string;
    cardId: string;
    card: { name: string; imageUrl: string };
  }>;
}

export default function VerifyPurchasePage({ params }: { params: Promise<{ purchaseId: string }> }) {
  const { purchaseId } = use(params);
  const [purchase, setPurchase] = useState<PurchaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [manualSeed, setManualSeed] = useState('');
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [seedHashPreview, setSeedHashPreview] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/packs/${purchaseId}/verify-data`);
        const json = await res.json();
        if (!cancelled && json.ok) {
          setPurchase(json.data);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [purchaseId]);

  const verdict = useMemo(() => {
    if (!result) return null;
    return result.hashValid && result.allMatched
      ? 'VERIFIED - draw commitment and rarity rolls match'
      : 'VERIFICATION FAILED - commitment or draw mismatch detected';
  }, [result]);

  const runVerification = async (seedToUse: string) => {
    if (!purchase || !seedToUse) return;
    setRunning(true);
    try {
      const verification = await verifyPurchase({
        serverSeed: seedToUse,
        serverSeedHash: purchase.serverSeedHash,
        clientSeed: purchase.clientSeed,
        purchaseId: purchase.id,
        rarityWeights: purchase.tier.rarityWeights,
        drawnCards: purchase.cards.map((c) => ({
          drawIndex: c.drawIndex,
          rarity: c.rarity,
          cardId: c.cardId,
        })),
      });
      setResult(verification);
      setSeedHashPreview(await hashSeed(seedToUse));
      void fetch(`/api/packs/${purchase.id}/verify-data`, { method: 'POST' });
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (purchase?.serverSeed) {
      void runVerification(purchase.serverSeed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchase?.serverSeed]);

  if (loading) return <section className="px-4 py-10">Loading verification data...</section>;
  if (!purchase) return <section className="px-4 py-10">Purchase not found.</section>;

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="space-y-2">
          <h1 className="font-display text-sectionDisplay tracking-tight">Provably fair verification</h1>
          <p className="text-bodyLarge text-ink/70">Purchase ID: <code>{purchase.id}</code></p>
        </div>

        <div className="rounded-lg border border-cardBorder bg-canvas p-5 space-y-3">
          <div><strong>Server commitment hash:</strong> <code>{purchase.serverSeedHash}</code></div>
          <div><strong>Client seed:</strong> <code>{purchase.clientSeed}</code></div>
          <div>
            <strong>Server seed:</strong>{' '}
            {purchase.serverSeed ? <code>{purchase.serverSeed}</code> : 'Not revealed yet. Open the pack first.'}
          </div>
          <div className="text-micro text-mutedSlate">
            Verify with the revealed seed for a pass, or try any custom seed to see tamper detection fail.
          </div>
        </div>

        <div className="rounded-lg border border-cardBorder bg-canvas p-5 space-y-3">
          <label htmlFor="manualSeed" className="block text-sm font-semibold">Manual seed test</label>
          <input
            id="manualSeed"
            className="w-full rounded border border-cardBorder px-3 py-2"
            placeholder="Paste or type a seed..."
            value={manualSeed}
            onChange={(e) => setManualSeed(e.target.value)}
          />
          <button
            type="button"
            className="rounded bg-ink px-4 py-2 text-white disabled:opacity-60"
            disabled={running || manualSeed.trim().length === 0}
            onClick={() => void runVerification(manualSeed.trim())}
          >
            {running ? 'Verifying...' : 'Verify with this seed'}
          </button>
          {seedHashPreview && (
            <div className="text-micro">
              SHA256(manual seed): <code>{seedHashPreview}</code>
            </div>
          )}
        </div>

        {result && (
          <div className="rounded-lg border border-cardBorder bg-canvas p-5 space-y-4">
            <div className={result.hashValid && result.allMatched ? 'text-deepEnterpriseGreen' : 'text-errorRed'}>
              <strong>{verdict}</strong>
            </div>
            <div>Hash check: {result.hashValid ? 'PASS' : 'FAIL'}</div>
            <div>Card-by-card match: {result.allMatched ? 'PASS' : 'FAIL'}</div>

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="py-2 pr-4">Draw</th>
                    <th className="py-2 pr-4">Float</th>
                    <th className="py-2 pr-4">Expected rarity</th>
                    <th className="py-2 pr-4">Actual card</th>
                    <th className="py-2 pr-4">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {result.cards.map((row) => (
                    <tr key={row.drawIndex} className="border-t border-cardBorder/60">
                      <td className="py-2 pr-4">{row.drawIndex}</td>
                      <td className="py-2 pr-4">{row.float.toFixed(6)}</td>
                      <td className="py-2 pr-4">{row.rarity}</td>
                      <td className="py-2 pr-4">{purchase.cards[row.drawIndex]?.card?.name ?? 'Unknown card'}</td>
                      <td className="py-2 pr-4">{row.matched ? 'PASS' : 'FAIL'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <Link className="inline-block text-sm underline" href={`/packs/${purchase.id}/reveal`}>
          Back to reveal page
        </Link>
      </div>
    </section>
  );
}
