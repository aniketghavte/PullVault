import Decimal from 'decimal.js';

// Money policy:
// - All money is represented as decimal.js `Decimal`, never `number`.
// - On the wire and in Postgres, money is a string with exactly 2 decimal places ("12.34").
// - In Postgres columns we use NUMERIC(14, 2) for balances and prices.
// - Rounding: ROUND_HALF_UP for display, ROUND_DOWN when crediting users
//   (we never credit a fraction of a cent that we can't actually pay out).

Decimal.set({
  precision: 30,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -9,
  toExpPos: 21,
});

export type MoneyInput = string | number | Decimal;

/** Wraps any input as a Decimal. Throws on NaN / non-finite. */
export function money(value: MoneyInput): Decimal {
  const d = value instanceof Decimal ? value : new Decimal(value);
  if (!d.isFinite()) {
    throw new TypeError(`Invalid money value: ${String(value)}`);
  }
  return d;
}

export const ZERO = new Decimal(0);

/** Formats money as a fixed 2-decimal string suitable for the DB and the wire. */
export function toMoneyString(value: MoneyInput): string {
  return money(value).toFixed(2, Decimal.ROUND_HALF_UP);
}

/** Formats money for display, e.g. "$1,234.56". */
export function formatUSD(value: MoneyInput): string {
  const fixed = toMoneyString(value);
  const [whole, frac] = fixed.split('.') as [string, string];
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = sign ? whole.slice(1) : whole;
  const withCommas = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${withCommas}.${frac}`;
}

export function add(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).plus(money(b));
}

export function sub(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).minus(money(b));
}

export function mul(a: MoneyInput, b: MoneyInput): Decimal {
  return money(a).times(money(b));
}

export function div(a: MoneyInput, b: MoneyInput): Decimal {
  const denom = money(b);
  if (denom.isZero()) throw new RangeError('division by zero');
  return money(a).dividedBy(denom);
}

export function gt(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).gt(money(b));
}

export function gte(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).gte(money(b));
}

export function lt(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).lt(money(b));
}

export function lte(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).lte(money(b));
}

export function eq(a: MoneyInput, b: MoneyInput): boolean {
  return money(a).eq(money(b));
}

export function isPositive(a: MoneyInput): boolean {
  return money(a).gt(0);
}

export function isNegative(a: MoneyInput): boolean {
  return money(a).lt(0);
}

/**
 * Compute platform fee given a gross amount and fee rate (e.g. "0.05" for 5%).
 * Always rounds DOWN so we never overcharge by a fraction of a cent.
 */
export function feeOf(amount: MoneyInput, rate: MoneyInput): Decimal {
  return money(amount)
    .times(money(rate))
    .toDecimalPlaces(2, Decimal.ROUND_DOWN);
}

/** Truncate to 2 decimal places (no rounding up). Useful for credits. */
export function truncate2(value: MoneyInput): Decimal {
  return money(value).toDecimalPlaces(2, Decimal.ROUND_DOWN);
}

/** Round to 2 decimal places using bankers' default (HALF_UP here). */
export function round2(value: MoneyInput): Decimal {
  return money(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export { Decimal };
