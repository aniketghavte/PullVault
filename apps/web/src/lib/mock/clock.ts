'use client';

import { useEffect, useState } from 'react';

import { useMockStore } from './store';

export function useServerClock(options?: { syncMockEngine?: boolean }) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const syncMockEngine = options?.syncMockEngine ?? false;

  useEffect(() => {
    let mounted = true;
    // Ensure the mock world exists before we start ticking.
    useMockStore
      .getState()
      .initialize()
      .catch(() => {
        // initialization errors are surfaced in the mock UI via store state
      })
      .finally(() => {
        if (!mounted) return;
      });

    const interval = setInterval(() => {
      const next = Date.now();
      setNowMs(next);
      if (syncMockEngine) {
        useMockStore.getState().refreshNow(next);
      }
    }, 250);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [syncMockEngine]);

  return nowMs;
}

