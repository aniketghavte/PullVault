import { handler } from '@/lib/api';

// GET /api/admin/economics — pack EV per tier, fees collected by stream, etc.
// Reads from ledger_entries (the source of truth) plus pack_tiers EV math.
export const GET = handler(async () => ({ economics: null as unknown }));
