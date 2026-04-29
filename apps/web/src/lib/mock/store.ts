'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { MockState } from './types';
import { createSeedState } from './seed';

import { refreshMockState } from './refresh';

const EMPTY_STATE: MockState = {
  initialized: false,
  initializationError: undefined,
  me: {
    id: 'me',
    email: 'you@example.com',
    displayName: 'You',
    availableUSD: '500.00',
    heldUSD: '0.00',
  },
  heldAuctionAmounts: {},
  catalogGeneratedAt: undefined,
  drops: [],
  purchases: [],
  userCards: [],
  listings: [],
  auctions: [],
  ledger: [],
  packPurchaseByIdempotencyKey: {},
  bidsByIdempotencyKey: {},
};

const memoryStorage: Storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  key: () => null,
  length: 0,
  clear: () => {},
};

const jsonStorage = createJSONStorage(() => (typeof window !== 'undefined' ? window.localStorage : memoryStorage));

export const useMockStore = create<MockState & { initialize: () => Promise<void>; refreshNow: (nowMs: number) => void }>()(
  persist(
    (set, get) => ({
      ...EMPTY_STATE,

      initialize: async () => {
        if (get().initialized) return;
        const nowMs = Date.now();
        try {
          const seeded = await createSeedState(nowMs);
          set((prev) => ({ ...prev, ...seeded }));
        } catch (e) {
          set((prev) => ({ ...prev, initializationError: (e as Error).message }));
        }
      },

      refreshNow: (nowMs: number) => {
        set((prev) => ({ ...prev, ...refreshMockState(prev, nowMs) }));
      },
    }),
    {
      name: 'pv:mock:state',
      storage: jsonStorage,
      partialize: (state) =>
        ({
          initialized: state.initialized,
          initializationError: state.initializationError,
          me: state.me,
          heldAuctionAmounts: state.heldAuctionAmounts,
          catalogGeneratedAt: state.catalogGeneratedAt,
          drops: state.drops,
          purchases: state.purchases,
          userCards: state.userCards,
          listings: state.listings,
          auctions: state.auctions,
          ledger: state.ledger,
          packPurchaseByIdempotencyKey: state.packPurchaseByIdempotencyKey,
          bidsByIdempotencyKey: state.bidsByIdempotencyKey,
        }) as any,
    },
  ),
);

