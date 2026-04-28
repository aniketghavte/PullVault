import { handler } from '@/lib/api';

// GET /api/drops — list scheduled and live drops with countdown info.
// Implementation lands in the drops slice.
export const GET = handler(async () => {
  return { drops: [] as unknown[] };
});
