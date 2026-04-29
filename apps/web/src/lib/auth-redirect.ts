/**
 * Prevents open redirects — only relative same-origin paths are allowed after auth.
 */
const DEFAULT_AFTER_AUTH = '/drops';

export function sanitizeReturnPath(
  candidate: string | null | undefined,
  fallback: string = DEFAULT_AFTER_AUTH,
): string {
  if (candidate === null || candidate === undefined) return fallback;
  const trimmed = String(candidate).trim();
  if (trimmed.length === 0) return fallback;
  if (!trimmed.startsWith('/')) return fallback;
  if (trimmed.startsWith('//')) return fallback;
  if (/[\r\n<>]/.test(trimmed)) return fallback;
  return trimmed;
}
