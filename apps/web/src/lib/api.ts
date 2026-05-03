import { NextResponse } from 'next/server';
import type { ApiResponse, ErrorCode } from '@pullvault/shared';
import { ERROR_CODES } from '@pullvault/shared';
import { logger } from '@pullvault/shared/logger';

// Standard JSON envelopes for API routes. Always 200 status for `ok` responses.
// For errors we map error codes to HTTP status codes consistently.

const ERROR_STATUS: Record<ErrorCode, number> = {
  [ERROR_CODES.UNAUTHENTICATED]: 401,
  [ERROR_CODES.FORBIDDEN]: 403,
  [ERROR_CODES.VALIDATION]: 400,
  [ERROR_CODES.INSUFFICIENT_FUNDS]: 402,
  [ERROR_CODES.SOLD_OUT]: 409,
  [ERROR_CODES.ALREADY_SOLD]: 409,
  [ERROR_CODES.CARD_LOCKED]: 409,
  [ERROR_CODES.RATE_LIMITED]: 429,
  [ERROR_CODES.AUCTION_CLOSED]: 410,
  [ERROR_CODES.BID_TOO_LOW]: 409,
  [ERROR_CODES.BID_OUTBID]: 409,
  [ERROR_CODES.BID_EXCEEDS_MAXIMUM]: 409,
  [ERROR_CODES.BID_TOO_FREQUENT]: 429,
  [ERROR_CODES.SELF_BID_FORBIDDEN]: 403,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.CONFLICT]: 409,
  [ERROR_CODES.INTERNAL]: 500,
};

export function ok<T>(data: T, init?: ResponseInit) {
  const body: ApiResponse<T> = { ok: true, data };
  return NextResponse.json(body, { status: 200, ...init });
}

export function fail(code: ErrorCode, message: string, details?: unknown) {
  const status = ERROR_STATUS[code] ?? 500;
  const body: ApiResponse<never> = { ok: false, error: { code, message, details } };
  return NextResponse.json(body, { status });
}

// Wrap an async handler with consistent error -> JSON mapping.
export function handler<TArgs extends unknown[], TBody>(
  fn: (...args: TArgs) => Promise<TBody>,
) {
  return async (...args: TArgs): Promise<Response> => {
    try {
      const result = await fn(...args);
      if (result instanceof Response) return result;
      return ok(result);
    } catch (err) {
      // Known typed errors can be re-thrown by callers as `ApiError`.
      if (err instanceof ApiError) return fail(err.code, err.message, err.details);
      logger.error({ err }, 'unhandled api error');
      return fail(ERROR_CODES.INTERNAL, 'Something went wrong.');
    }
  };
}

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
