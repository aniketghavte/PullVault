import 'server-only';

import { eq, and, sql, inArray } from 'drizzle-orm';
import type { DB } from '@pullvault/db';
import { schema } from '@pullvault/db';
import { money, sub, toMoneyString, feeOf } from '@pullvault/shared/money';
import { ApiError } from '@/lib/api';
import { ERROR_CODES } from '@pullvault/shared';
import { logger } from '@pullvault/shared/logger';
import type { Rarity } from '@pullvault/shared/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PurchasePackInput {
  dropId: string;
  idempotencyKey: string;
}

export interface PurchasePackResult {
  purchaseId: string;
  dropId: string;
  tierId: string;
  remaining: number;
  pricePaidUsd: string;
  status: string; // 'live' | 'sold_out'
}

// ---------------------------------------------------------------------------
// Weighted rarity roll (server-side, non-deterministic)
// ---------------------------------------------------------------------------

function weightedRandomRarity(rarityWeights: Record<string, number>): Rarity {
  const r = Math.random();
  let acc = 0;
  for (const [rarity, weight] of Object.entries(rarityWeights)) {
    acc += weight;
    if (r <= acc) return rarity as Rarity;
  }
  // Fallback to last entry (floating-point edge case)
  const keys = Object.keys(rarityWeights);
  return (keys[keys.length - 1] ?? 'common') as Rarity;
}

// ---------------------------------------------------------------------------
// Core transaction
// ---------------------------------------------------------------------------

/**
 * Purchase a pack from a live drop.
 *
 * This is the **P0 concurrency hot-path**. A single DB transaction that:
 *   1. Atomically decrements remaining_inventory (WHERE remaining > 0)
 *   2. Atomically debits the user's available_balance (WHERE balance >= price)
 *   3. Inserts the pack purchase (idempotent on user + idempotency_key)
 *   4. Draws N cards server-side using rarity weights
 *   5. Creates user_cards (one per drawn card)
 *   6. Writes ledger entries (user debit + platform fee)
 *
 * If any step fails the entire transaction rolls back — no orphan state.
 *
 * Callers MUST publish the Redis event AFTER this function returns
 * (i.e. after the DB commit), never inside.
 */
export async function purchasePack(
  db: DB,
  userId: string,
  input: PurchasePackInput,
): Promise<PurchasePackResult> {
  return db.transaction(async (tx) => {
    try {
      // -----------------------------------------------------------------------
      // 1. Atomic inventory decrement
      //    Guarded UPDATE — no explicit lock needed.
      //    0 rows returned ⇒ sold out.
      // -----------------------------------------------------------------------
      const [decremented] = await tx
        .update(schema.packDrops)
        .set({
          remainingInventory: sql`${schema.packDrops.remainingInventory} - 1`,
          status: sql`CASE WHEN ${schema.packDrops.remainingInventory} - 1 = 0 THEN 'sold_out'::drop_status ELSE ${schema.packDrops.status} END`,
        })
        .where(
          and(
            eq(schema.packDrops.id, input.dropId),
            sql`${schema.packDrops.remainingInventory} > 0`,
            inArray(schema.packDrops.status, ['live']),
          ),
        )
        .returning({
          id: schema.packDrops.id,
          remainingInventory: schema.packDrops.remainingInventory,
          tierId: schema.packDrops.tierId,
          status: schema.packDrops.status,
        });

      if (!decremented) {
        throw new ApiError(ERROR_CODES.SOLD_OUT, 'This drop is sold out.');
      }

      // -----------------------------------------------------------------------
      // 2. Fetch tier info (price, cardsPerPack, rarityWeights)
      // -----------------------------------------------------------------------
      const [tier] = await tx
        .select()
        .from(schema.packTiers)
        .where(eq(schema.packTiers.id, decremented.tierId))
        .limit(1);

      if (!tier) {
        throw new ApiError(ERROR_CODES.INTERNAL, 'Pack tier not found.');
      }

      const price = tier.priceUsd;

      // -----------------------------------------------------------------------
      // 3. Atomic balance debit
      //    Guarded UPDATE — 0 rows ⇒ insufficient funds.
      //    If this fails the transaction rolls back, restoring inventory.
      // -----------------------------------------------------------------------
      const [debited] = await tx
        .update(schema.profiles)
        .set({
          availableBalanceUsd: sql`${schema.profiles.availableBalanceUsd} - ${price}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.profiles.id, userId),
            sql`${schema.profiles.availableBalanceUsd} >= ${price}`,
          ),
        )
        .returning({
          id: schema.profiles.id,
          availableBalanceUsd: schema.profiles.availableBalanceUsd,
        });

      if (!debited) {
        throw new ApiError(ERROR_CODES.INSUFFICIENT_FUNDS, 'Not enough funds to buy this pack.');
      }

      // -----------------------------------------------------------------------
      // 4. Idempotent purchase row
      //    ON CONFLICT → the client retried; return the prior purchase.
      // -----------------------------------------------------------------------
      const [inserted] = await tx
        .insert(schema.packPurchases)
        .values({
          userId,
          dropId: input.dropId,
          tierId: decremented.tierId,
          pricePaidUsd: price,
          idempotencyKey: input.idempotencyKey,
        })
        .onConflictDoNothing({
          target: [schema.packPurchases.userId, schema.packPurchases.idempotencyKey],
        })
        .returning({ id: schema.packPurchases.id });

      let purchaseId: string;

      if (inserted) {
        purchaseId = inserted.id;
      } else {
        // Idempotent retry — find the existing purchase
        const [existing] = await tx
          .select({ id: schema.packPurchases.id })
          .from(schema.packPurchases)
          .where(
            and(
              eq(schema.packPurchases.userId, userId),
              eq(schema.packPurchases.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);

        if (!existing) {
          throw new ApiError(ERROR_CODES.INTERNAL, 'Idempotency conflict but no existing row.');
        }

        purchaseId = existing.id;
        return {
          purchaseId,
          dropId: input.dropId,
          tierId: decremented.tierId,
          remaining: decremented.remainingInventory,
          pricePaidUsd: toMoneyString(price),
          status: decremented.status,
        };
      }

      // -----------------------------------------------------------------------
      // 5. Server-side card draw using rarity weights
      // -----------------------------------------------------------------------
      const rarityWeights = (tier.rarityWeights as Record<string, number>) || {};
      if (Object.keys(rarityWeights).length === 0) {
        throw new Error(`Pack tier ${tier.id} has no rarity weights defined.`);
      }
      
      const drawnRarities: Rarity[] = [];

      for (let i = 0; i < tier.cardsPerPack; i++) {
        drawnRarities.push(weightedRandomRarity(rarityWeights));
      }

      // For each rarity, pick a random card from that bucket
      const cardDraws: Array<{
        position: number;
        cardId: string;
        drawPriceUsd: string;
      }> = [];

      for (let i = 0; i < drawnRarities.length; i++) {
        const rarity = drawnRarities[i]!;
        const [card] = await tx
          .select({
            id: schema.cards.id,
            marketPriceUsd: schema.cards.marketPriceUsd,
          })
          .from(schema.cards)
          .where(eq(schema.cards.rarity, rarity))
          .orderBy(sql`random()`)
          .limit(1);

        if (!card) {
          // Fallback: pick any card if rarity bucket is empty
          const [fallbackCard] = await tx
            .select({
              id: schema.cards.id,
              marketPriceUsd: schema.cards.marketPriceUsd,
            })
            .from(schema.cards)
            .orderBy(sql`random()`)
            .limit(1);

          if (!fallbackCard) {
            throw new ApiError(ERROR_CODES.INTERNAL, 'No cards in catalog. Seed the catalog first.');
          }

          cardDraws.push({
            position: i,
            cardId: fallbackCard.id,
            drawPriceUsd: fallbackCard.marketPriceUsd,
          });
        } else {
          cardDraws.push({
            position: i,
            cardId: card.id,
            drawPriceUsd: card.marketPriceUsd,
          });
        }
      }

      // -----------------------------------------------------------------------
      // 6. Insert pack_purchase_cards (sealed contents)
      // -----------------------------------------------------------------------
      if (cardDraws.length > 0) {
        await tx.insert(schema.packPurchaseCards).values(
          cardDraws.map((d) => ({
            purchaseId,
            position: d.position,
            cardId: d.cardId,
            drawPriceUsd: d.drawPriceUsd,
          })),
        );
      }

      // -----------------------------------------------------------------------
      // 7. Create user_cards (one per drawn card)
      // -----------------------------------------------------------------------
      if (cardDraws.length > 0) {
        await tx.insert(schema.userCards).values(
          cardDraws.map((d) => ({
            ownerId: userId,
            cardId: d.cardId,
            acquiredFrom: 'pack' as const,
            sourceRefId: purchaseId,
            acquiredPriceUsd: d.drawPriceUsd,
            status: 'held' as const,
          })),
        );
      }

      // -----------------------------------------------------------------------
      // 8. Ledger entries
      //    - User debit (negative amount = money leaving user)
      //    - Platform fee (pack margin)
      // -----------------------------------------------------------------------
      await tx.insert(schema.ledgerEntries).values({
        kind: 'pack_purchase',
        userId,
        amountUsd: toMoneyString(money(price).neg()),
        referenceTable: 'pack_purchases',
        referenceId: purchaseId,
      });

      // Platform margin: the entire pack price goes to the house as revenue.
      // (The EV of the cards is given to the user as cards, not as cash.)
      await tx.insert(schema.ledgerEntries).values({
        kind: 'platform_fee',
        userId: null,
        amountUsd: toMoneyString(price),
        referenceTable: 'pack_purchases',
        referenceId: purchaseId,
        metadata: { tier: tier.code },
      });

      logger.info(
        { purchaseId, userId, dropId: input.dropId, remaining: decremented.remainingInventory },
        'pack purchased',
      );

      return {
        purchaseId,
        dropId: input.dropId,
        tierId: decremented.tierId,
        remaining: decremented.remainingInventory,
        pricePaidUsd: toMoneyString(price),
        status: decremented.status,
      };
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }
      logger.error({ err, userId, dropId: input.dropId }, 'unhandled error in purchasePack transaction');
      throw err;
    }
  });
}
