'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { PACK_ECONOMICS, PACK_TIERS } from '@pullvault/shared/constants';

import { ButtonPillOutline } from '@/components/ui/ButtonPillOutline';
import { ButtonPrimary } from '@/components/ui/ButtonPrimary';
import { MonoLabel } from '@/components/ui/MonoLabel';

type SnapshotTier = {
  tierName: string;
  evPerPackUSD: string;
  evPerCardUSD: string;
  houseMarginUSD: string;
};

type SimulationRow = {
  tierCode: string;
  trials: number;
  pricePerPackUsd: string;
  avgPackEvUsd: string;
  p10PackEvUsd: string;
  p50PackEvUsd: string;
  p90PackEvUsd: string;
  avgMarginPct: string;
  winRate: number;
  projectedHousePnlUsd: string;
  rarityHitRate: Record<string, number>;
};

type SimulateResponse = {
  context: { generatedAt: string; catalogCardCount: number };
  results: SimulationRow[];
  warnings: Array<{ tierCode: string; severity: 'warn' | 'error'; message: string }>;
};

type SolveResponse = {
  tierCode: string;
  current: { weights: Record<string, number>; evPerPackUsd: string; marginPct: string };
  recommended: {
    weights: Record<string, number>;
    evPerPackUsd: string;
    marginPct: string;
    converged: boolean;
    reason: string;
    notes: string;
    winRateIterations?: number;
    warnings?: Array<{ code: string; message: string }>;
  };
  verification: SimulationRow;
};

type RebalanceLogEntry = {
  tierCode: string;
  tierName: string;
  rebalancedAt: string;
  reason: string | null;
  previousWeights: Record<string, number>;
  currentWeights: Record<string, number>;
  previousMarginPct: string | null;
  newMarginPct: string | null;
};

type CardSearchResult = {
  id: string;
  name: string;
  rarity: string;
  marketPriceUsd: string;
  setName: string;
};

type RebalanceRunResult = {
  tierCode: string;
  action: 'none' | 'rebalanced' | 'solve_failed';
  previousMarginPct: string;
  newMarginPct?: string;
  reason?: string;
  warnings?: Array<{ code: string; message: string }>;
};

function money(v: string | number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return '$0.00';
  return `$${n.toFixed(2)}`;
}

function pct(v: string | number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n * 100 : 0;
}

function marginPctFromUsd(marginUsd: string | number, priceUsd: string | number): number {
  const margin = Number(marginUsd);
  const price = Number(priceUsd);
  if (!Number.isFinite(margin) || !Number.isFinite(price) || price <= 0) return 0;
  return (margin / price) * 100;
}

function statusFromMargin(marginPct: number): { label: string; cls: string } {
  if (marginPct < 5) return { label: 'Critical', cls: 'text-coral' };
  if (marginPct > 45) return { label: 'Warning', cls: 'text-yellow-700' };
  return { label: 'Healthy', cls: 'text-deepEnterpriseGreen' };
}

function buildSpikeDefaultPrice(marketPriceUsd: string): string {
  const price = Number(marketPriceUsd);
  if (!Number.isFinite(price) || price <= 0) return '1.00';
  return Math.max(price * 50, 1).toFixed(2);
}

export default function B1LabPage() {
  const [snapshotData, setSnapshotData] = useState<Record<string, SnapshotTier> | null>(null);
  const [simResults, setSimResults] = useState<SimulateResponse | null>(null);
  const [solverResults, setSolverResults] = useState<SolveResponse | null>(null);
  const [rebalanceLog, setRebalanceLog] = useState<RebalanceLogEntry[]>([]);
  const [spikedCard, setSpikedCard] = useState<{ cardId: string; oldPrice: string } | null>(null);

  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, string>>({});

  const [searchQ, setSearchQ] = useState('');
  const [cardResults, setCardResults] = useState<CardSearchResult[]>([]);
  const [selectedCard, setSelectedCard] = useState<CardSearchResult | null>(null);
  const [newPrice, setNewPrice] = useState('');

  const [simTier, setSimTier] = useState('');
  const [simTrials, setSimTrials] = useState(10000);
  const [simSeed, setSimSeed] = useState('');

  const [solveTier, setSolveTier] = useState<string>(PACK_TIERS[0]?.code ?? 'standard');
  const [solveTarget, setSolveTarget] = useState(15);

  const [expandedLogRow, setExpandedLogRow] = useState<string | null>(null);
  const [rebalanceRunResults, setRebalanceRunResults] = useState<RebalanceRunResult[] | null>(null);

  const setLoadingFor = (key: string, val: boolean) => setLoading((p) => ({ ...p, [key]: val }));
  const setErrorFor = (key: string, val: string) => setErrors((p) => ({ ...p, [key]: val }));
  const clearErrorFor = (key: string) =>
    setErrors((p) => {
      const next = { ...p };
      delete next[key];
      return next;
    });
  const setMessageFor = (key: string, val: string) => setMessages((p) => ({ ...p, [key]: val }));

  const loadSnapshot = useCallback(async () => {
    setLoadingFor('snapshot', true);
    clearErrorFor('snapshot');
    try {
      const json = await fetch('/api/admin/economics', { cache: 'no-store', credentials: 'include' }).then(
        (r) => r.json(),
      );
      if (!json.ok) throw new Error(json.error?.message ?? 'Snapshot load failed');
      setSnapshotData((json.data?.packEVByTier ?? null) as Record<string, SnapshotTier> | null);
      setMessageFor('snapshot', `Last loaded: ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setErrorFor('snapshot', e instanceof Error ? e.message : 'Snapshot load failed');
    } finally {
      setLoadingFor('snapshot', false);
    }
  }, []);

  const loadRebalanceLog = useCallback(async () => {
    setLoadingFor('rebalanceLog', true);
    clearErrorFor('rebalanceLog');
    try {
      const json = await fetch('/api/admin/rebalance-log', {
        cache: 'no-store',
        credentials: 'include',
      }).then((r) => r.json());
      if (!json.ok) throw new Error(json.error?.message ?? 'Rebalance log failed');
      setRebalanceLog((json.data?.entries ?? []) as RebalanceLogEntry[]);
    } catch (e) {
      setErrorFor('rebalanceLog', e instanceof Error ? e.message : 'Rebalance log failed');
    } finally {
      setLoadingFor('rebalanceLog', false);
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
    void loadRebalanceLog();
  }, [loadSnapshot, loadRebalanceLog]);

  const triggerHotRefresh = async () => {
    setLoadingFor('refresh', true);
    clearErrorFor('refresh');
    try {
      const json = await fetch('/api/admin/catalog/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'hot' }),
      }).then((r) => r.json());
      if (!json.ok) throw new Error(json.error?.message ?? 'Refresh trigger failed');
      setMessageFor('refresh', 'Price refresh triggered. Wait 5-10 seconds then reload snapshot.');
    } catch (e) {
      setErrorFor('refresh', e instanceof Error ? e.message : 'Refresh trigger failed');
    } finally {
      setLoadingFor('refresh', false);
    }
  };

  const searchCards = async () => {
    setLoadingFor('search', true);
    clearErrorFor('search');
    try {
      const json = await fetch(`/api/admin/b1-lab/cards?q=${encodeURIComponent(searchQ)}`, {
        credentials: 'include',
        cache: 'no-store',
      }).then((r) => r.json());
      if (!json.ok) throw new Error(json.error?.message ?? 'Card search failed');
      setCardResults((json.data?.cards ?? []) as CardSearchResult[]);
    } catch (e) {
      setErrorFor('search', e instanceof Error ? e.message : 'Card search failed');
    } finally {
      setLoadingFor('search', false);
    }
  };

  const spikePrice = async (restore = false) => {
    if (!selectedCard) return;
    const target = restore && spikedCard ? spikedCard.oldPrice : newPrice;
    setLoadingFor('spike', true);
    clearErrorFor('spike');
    try {
      const json = await fetch('/api/admin/b1-lab/spike-price', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cardId: selectedCard.id, newPrice: target }),
      }).then((r) => r.json());
      if (!json.ok) throw new Error(json.error?.message ?? 'Price update failed');
      const payload = json.data as { cardId: string; oldPrice: string; newPrice: string; name: string };
      if (restore) {
        setSpikedCard(null);
        setMessageFor('spike', `Restored ${payload.name} to ${money(payload.newPrice)}.`);
      } else {
        setSpikedCard({ cardId: payload.cardId, oldPrice: payload.oldPrice });
        setMessageFor(
          'spike',
          `Price spiked from ${money(payload.oldPrice)} to ${money(payload.newPrice)}. Trigger rebalance in Step 3.`,
        );
      }
      await loadSnapshot();
    } catch (e) {
      setErrorFor('spike', e instanceof Error ? e.message : 'Price update failed');
    } finally {
      setLoadingFor('spike', false);
    }
  };

  const runSimulation = async () => {
    setLoadingFor('sim', true);
    clearErrorFor('sim');
    try {
      const body: Record<string, unknown> = { trials: simTrials };
      if (simTier) body.tierCode = simTier;
      if (simSeed.trim()) body.seed = Number(simSeed);

      const json = await fetch('/api/admin/simulate-packs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json());
      if (!json.ok) throw new Error(json.error?.message ?? 'Simulation failed');
      setSimResults(json.data as SimulateResponse);
      if (simSeed.trim()) setMessageFor('sim', `Seed used: ${simSeed} (reproducible run).`);
    } catch (e) {
      setErrorFor('sim', e instanceof Error ? e.message : 'Simulation failed');
    } finally {
      setLoadingFor('sim', false);
    }
  };

  const runSolver = async () => {
    setLoadingFor('solve', true);
    clearErrorFor('solve');
    try {
      const json = await fetch('/api/admin/solve-weights', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tierCode: solveTier, targetMarginPct: solveTarget / 100 }),
      }).then((r) => r.json());
      if (!json.ok) throw new Error(json.error?.message ?? 'Solver failed');
      setSolverResults(json.data as SolveResponse);
    } catch (e) {
      setErrorFor('solve', e instanceof Error ? e.message : 'Solver failed');
    } finally {
      setLoadingFor('solve', false);
    }
  };

  const triggerRebalance = async () => {
    setLoadingFor('rebalance', true);
    clearErrorFor('rebalance');
    try {
      const json = await fetch('/api/admin/b1-lab/trigger-rebalance', {
        method: 'POST',
        credentials: 'include',
      }).then((r) => r.json());
      if (!json.ok) throw new Error(json.error?.message ?? 'Rebalance run failed');
      setRebalanceRunResults((json.data?.results ?? []) as RebalanceRunResult[]);
      setMessageFor('rebalance', 'Rebalance run complete. Reload snapshot to verify recovery.');
      await Promise.all([loadSnapshot(), loadRebalanceLog()]);
    } catch (e) {
      setErrorFor('rebalance', e instanceof Error ? e.message : 'Rebalance run failed');
    } finally {
      setLoadingFor('rebalance', false);
    }
  };

  const rows = useMemo(
    () => PACK_TIERS.map((tier) => ({ tier, row: snapshotData?.[tier.code] })),
    [snapshotData],
  );

  return (
    <section className="px-4 pt-10 pb-16">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <div className="rounded-lg border border-cardBorder bg-canvas p-6 space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <MonoLabel>B1 Demo Workspace</MonoLabel>
              <h1 className="font-display text-sectionHeading tracking-tight leading-none mt-1">
                B1 Economics Lab
              </h1>
              <p className="text-bodyLarge text-ink/70 mt-2 max-w-3xl">
                Live demonstration workspace for pack economics. Refresh prices, spike a card,
                run simulation/solver, and verify rebalancing from one page.
              </p>
            </div>
            <Link href="/admin/economics" className="text-button font-semibold text-actionBlue underline underline-offset-2">
              Back to Economics
            </Link>
          </div>
        </div>

        <StepCard step={1} title="Price Controls">
          <div className="space-y-4">
            <Subhead title="A) Trigger Price Refresh" />
            <ButtonPrimary onClick={() => void triggerHotRefresh()} disabled={!!loading.refresh}>
              {loading.refresh ? 'Triggering...' : 'Trigger Hot Price Refresh'}
            </ButtonPrimary>
            {messages.refresh ? <Msg kind="ok" text={messages.refresh} /> : null}
            {errors.refresh ? <Msg kind="error" text={errors.refresh} /> : null}

            <Subhead title="B) Price Spike Tool (Demo)" />
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="Search card name..."
                className="rounded-sm border border-cardBorder bg-canvas px-3 py-2 font-mono text-body"
              />
              <ButtonPillOutline onClick={() => void searchCards()} disabled={!!loading.search}>
                {loading.search ? 'Searching...' : 'Search'}
              </ButtonPillOutline>
            </div>
            {errors.search ? <Msg kind="error" text={errors.search} /> : null}

            {cardResults.length > 0 ? (
              <div className="rounded-sm border border-cardBorder overflow-hidden">
                {cardResults.map((c) => {
                  const isSelected = selectedCard?.id === c.id;
                  return (
                  <button
                    key={c.id}
                    type="button"
                    className={`block w-full border-b border-hairline px-3 py-2 text-left font-mono text-micro hover:bg-nearBlack/[0.03] ${
                      isSelected ? 'bg-nearBlack/[0.05]' : ''
                    }`}
                    onClick={() => {
                      setSelectedCard(c);
                      setNewPrice(buildSpikeDefaultPrice(c.marketPriceUsd));
                      setMessageFor('spike', `Selected ${c.name}. Set a new price and press Spike Price.`);
                      clearErrorFor('spike');
                    }}
                  >
                    {c.name} | {c.rarity} | current: {money(c.marketPriceUsd)}
                  </button>
                  );
                })}
              </div>
            ) : null}

            {selectedCard ? (
              <div className="rounded-sm border border-cardBorder p-3 space-y-3">
                <div className="font-mono text-micro">
                  Selected: {selectedCard.name} | {selectedCard.rarity} | current: {money(selectedCard.marketPriceUsd)}
                </div>
                <div className="grid gap-3 md:grid-cols-[220px_auto_auto]">
                  <input
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    type="number"
                    step="0.01"
                    className="rounded-sm border border-cardBorder bg-canvas px-3 py-2 font-mono text-body"
                  />
                  <ButtonPillOutline onClick={() => void spikePrice(false)} disabled={!!loading.spike}>
                    {loading.spike ? 'Updating...' : 'Spike Price'}
                  </ButtonPillOutline>
                  <ButtonPillOutline onClick={() => void spikePrice(true)} disabled={!spikedCard || !!loading.spike}>
                    Restore Original
                  </ButtonPillOutline>
                </div>
              </div>
            ) : null}

            {messages.spike ? <Msg kind="ok" text={messages.spike} /> : null}
            {errors.spike ? <Msg kind="error" text={errors.spike} /> : null}
            {spikedCard ? (
              <Msg kind="warn" text="Demo action: restore original price after interview demo." />
            ) : null}
          </div>
        </StepCard>

        <StepCard step={2} title="Current EV Snapshot">
          <div className="space-y-3">
            <ButtonPillOutline onClick={() => void loadSnapshot()} disabled={!!loading.snapshot}>
              {loading.snapshot ? 'Reloading...' : 'Reload snapshot'}
            </ButtonPillOutline>
            {errors.snapshot ? <Msg kind="error" text={errors.snapshot} /> : null}
            {messages.snapshot ? <div className="font-mono text-micro text-mutedSlate">{messages.snapshot}</div> : null}

            <div className="overflow-x-auto">
              <table className="w-full font-mono text-micro">
                <thead>
                  <tr className="text-mutedSlate">
                    <th className="text-left py-2">Tier</th>
                    <th className="text-right py-2">Price</th>
                    <th className="text-right py-2">EV/pack</th>
                    <th className="text-right py-2">EV/card</th>
                    <th className="text-right py-2">Margin</th>
                    <th className="text-right py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ tier, row }) => {
                    const margin = marginPctFromUsd(row?.houseMarginUSD ?? 0, tier.priceUSD);
                    const status = statusFromMargin(margin);
                    return (
                      <tr key={tier.code} className="border-t border-hairline">
                        <td className="py-2">{row?.tierName ?? tier.name}</td>
                        <td className="py-2 text-right">{money(tier.priceUSD)}</td>
                        <td className="py-2 text-right">{money(row?.evPerPackUSD ?? 0)}</td>
                        <td className="py-2 text-right">{money(row?.evPerCardUSD ?? 0)}</td>
                        <td className="py-2 text-right">{margin.toFixed(1)}%</td>
                        <td className={`py-2 text-right ${status.cls}`}>{status.label}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </StepCard>

        <StepCard step={3} title="Live Rebalance Demo">
          <div className="space-y-3">
            <p className="text-body text-ink/80">
              Spike a price -&gt; reload snapshot -&gt; trigger rebalancer -&gt; reload snapshot to verify recovery.
            </p>
            <div className="flex gap-2 flex-wrap">
              <ButtonPillOutline onClick={() => void loadSnapshot()}>2. Reload EV snapshot</ButtonPillOutline>
              <ButtonPillOutline onClick={() => void triggerRebalance()} disabled={!!loading.rebalance}>
                {loading.rebalance ? 'Running...' : '3. Trigger Auto-Rebalancer Now'}
              </ButtonPillOutline>
              <ButtonPillOutline onClick={() => void loadSnapshot()}>4. Reload EV snapshot again</ButtonPillOutline>
            </div>
            {errors.rebalance ? <Msg kind="error" text={errors.rebalance} /> : null}
            {messages.rebalance ? <Msg kind="ok" text={messages.rebalance} /> : null}
            {rebalanceRunResults ? (
              <pre className="rounded-sm border border-cardBorder bg-canvas p-3 text-micro overflow-x-auto font-mono">{JSON.stringify(rebalanceRunResults, null, 2)}</pre>
            ) : null}
          </div>
        </StepCard>

        <StepCard step={4} title="Monte-Carlo Simulator">
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-4">
              <label className="space-y-1">
                <span className="text-micro text-mutedSlate">Tier</span>
                <select value={simTier} onChange={(e) => setSimTier(e.target.value)} className="w-full rounded-sm border border-cardBorder bg-canvas px-2 py-2 font-mono text-micro">
                  <option value="">All</option>
                  {PACK_TIERS.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-micro text-mutedSlate">Trials</span>
                <input type="number" value={simTrials} onChange={(e) => setSimTrials(Number(e.target.value) || 10000)} max={50000} className="w-full rounded-sm border border-cardBorder bg-canvas px-2 py-2 font-mono text-micro" />
              </label>
              <label className="space-y-1">
                <span className="text-micro text-mutedSlate">Seed</span>
                <input value={simSeed} onChange={(e) => setSimSeed(e.target.value)} className="w-full rounded-sm border border-cardBorder bg-canvas px-2 py-2 font-mono text-micro" />
              </label>
              <div className="flex items-end">
                <ButtonPrimary onClick={() => void runSimulation()} disabled={!!loading.sim}>
                  {loading.sim ? 'Simulating...' : 'Run Simulation'}
                </ButtonPrimary>
              </div>
            </div>
            {errors.sim ? <Msg kind="error" text={errors.sim} /> : null}
            {messages.sim ? <Msg kind="ok" text={messages.sim} /> : null}
            {simResults ? (
              <div className="space-y-3">
                <div className="font-mono text-micro text-mutedSlate">
                  catalog: {simResults.context.catalogCardCount} cards | generated{' '}
                  {new Date(simResults.context.generatedAt).toLocaleTimeString()}
                </div>
                {simResults.warnings.map((w, i) => (
                  <Msg key={`${w.tierCode}-${i}`} kind={w.severity === 'error' ? 'error' : 'warn'} text={`${w.severity} ${w.tierCode}: ${w.message}`} />
                ))}
                {simResults.results.map((r) => (
                  <div key={r.tierCode} className="rounded-sm border border-cardBorder p-3">
                    <div className="font-mono text-micro text-deepEnterpriseGreen">{r.tierCode.toUpperCase()} tier results</div>
                    <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-micro">
                      <KV label="Win rate" value={`${(r.winRate * 100).toFixed(2)}%`} />
                      <KV label="Avg margin" value={`${(Number(r.avgMarginPct) * 100).toFixed(2)}%`} />
                      <KV label="Avg pack EV" value={money(r.avgPackEvUsd)} />
                      <KV label="p10 EV" value={money(r.p10PackEvUsd)} />
                      <KV label="p50 EV" value={money(r.p50PackEvUsd)} />
                      <KV label="p90 EV" value={money(r.p90PackEvUsd)} />
                      <KV label="Proj. P&L" value={money(r.projectedHousePnlUsd)} />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </StepCard>

        <StepCard step={5} title="Weight Solver">
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-micro text-mutedSlate">Tier</span>
                <select value={solveTier} onChange={(e) => setSolveTier(e.target.value)} className="w-full rounded-sm border border-cardBorder bg-canvas px-2 py-2 font-mono text-micro">
                  {PACK_TIERS.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-micro text-mutedSlate">Target: {solveTarget}%</span>
                <input type="range" min={5} max={40} value={solveTarget} onChange={(e) => setSolveTarget(Number(e.target.value))} className="w-full" />
              </label>
              <div className="flex items-end">
                <ButtonPillOutline onClick={() => void runSolver()} disabled={!!loading.solve}>
                  {loading.solve ? 'Solving...' : 'Solve Weights'}
                </ButtonPillOutline>
              </div>
            </div>
            {errors.solve ? <Msg kind="error" text={errors.solve} /> : null}
            {solverResults ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <WeightPanel title="Current Weights" weights={solverResults.current.weights} />
                <WeightPanel title="Recommended Weights" weights={solverResults.recommended.weights} />
                <div className="lg:col-span-2 rounded-sm border border-cardBorder p-3 font-mono text-micro">
                  Reason: {solverResults.recommended.reason} | Iterations:{' '}
                  {solverResults.recommended.winRateIterations ?? 0} | Verified margin:{' '}
                  {(Number(solverResults.verification.avgMarginPct) * 100).toFixed(2)}% | Verified win rate:{' '}
                  {(solverResults.verification.winRate * 100).toFixed(2)}%
                </div>
                {solverResults.recommended.warnings?.map((w, i) => (
                  <Msg key={`${w.code}-${i}`} kind="warn" text={`${w.code}: ${w.message}`} />
                ))}
              </div>
            ) : null}
          </div>
        </StepCard>

        <StepCard step={6} title="Auto-Rebalance Log">
          <div className="space-y-3">
            <ButtonPillOutline onClick={() => void loadRebalanceLog()} disabled={!!loading.rebalanceLog}>
              Refresh log
            </ButtonPillOutline>
            {errors.rebalanceLog ? <Msg kind="error" text={errors.rebalanceLog} /> : null}
            {rebalanceLog.length === 0 ? (
              <div className="text-micro text-mutedSlate">
                No rebalancing events yet. Spike a price and trigger rebalancer in Step 3.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full font-mono text-micro">
                  <thead>
                    <tr className="text-mutedSlate">
                      <th className="text-left py-2">Tier</th>
                      <th className="text-right py-2">Prev Margin</th>
                      <th className="text-right py-2">New Margin</th>
                      <th className="text-left py-2">Reason</th>
                      <th className="text-left py-2">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rebalanceLog.map((r) => {
                      const key = `${r.tierCode}-${r.rebalancedAt}`;
                      return (
                        <>
                          <tr
                            key={key}
                            className="border-t border-hairline cursor-pointer"
                            onClick={() => setExpandedLogRow((v) => (v === key ? null : key))}
                          >
                            <td className="py-2">{r.tierName}</td>
                            <td className="py-2 text-right">
                              {r.previousMarginPct ? `${(Number(r.previousMarginPct) * 100).toFixed(2)}%` : '-'}
                            </td>
                            <td className="py-2 text-right">
                              {r.newMarginPct ? `${(Number(r.newMarginPct) * 100).toFixed(2)}%` : '-'}
                            </td>
                            <td className="py-2">{r.reason ?? '-'}</td>
                            <td className="py-2">{new Date(r.rebalancedAt).toLocaleString()}</td>
                          </tr>
                          {expandedLogRow === key ? (
                            <tr>
                              <td className="py-2" colSpan={5}>
                                <div className="grid gap-3 md:grid-cols-2">
                                  <pre className="rounded-sm border border-cardBorder bg-canvas p-2 overflow-x-auto">
                                    {JSON.stringify(r.previousWeights, null, 2)}
                                  </pre>
                                  <pre className="rounded-sm border border-cardBorder bg-canvas p-2 overflow-x-auto">
                                    {JSON.stringify(r.currentWeights, null, 2)}
                                  </pre>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </StepCard>
      </div>
    </section>
  );
}

function StepCard({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-cardBorder bg-canvas p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="rounded-sm border border-nearBlack/15 bg-nearBlack/[0.03] px-2 py-1 font-mono text-micro text-mutedSlate">
          STEP {step}
        </span>
        <h2 className="font-display text-featureHeading text-ink">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Subhead({ title }: { title: string }) {
  return <div className="font-mono text-micro text-mutedSlate">{title}</div>;
}

function Msg({ kind, text }: { kind: 'ok' | 'warn' | 'error'; text: string }) {
  const cls =
    kind === 'ok'
      ? 'border-deepEnterpriseGreen/40 bg-deepEnterpriseGreen/10 text-deepEnterpriseGreen'
      : kind === 'warn'
        ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-700'
        : 'border-coral/40 bg-coral/10 text-coral';
  return <div className={`rounded-sm border px-3 py-2 font-mono text-micro ${cls}`}>{text}</div>;
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-mutedSlate">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function WeightPanel({ title, weights }: { title: string; weights: Record<string, number> }) {
  const entries = Object.entries(weights).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-sm border border-cardBorder p-3">
      <div className="font-mono text-micro text-mutedSlate mb-2">{title}</div>
      <div className="space-y-1 font-mono text-micro">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between">
            <span>{k}</span>
            <span>{(v * 100).toFixed(2)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
