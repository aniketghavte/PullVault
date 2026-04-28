import { handler } from '@/lib/api';

// GET /api/portfolio — joined view of user's cards + live prices + P&L.
export const GET = handler(async () => ({ portfolio: null as unknown }));
