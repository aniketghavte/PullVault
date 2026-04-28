import { ok } from '@/lib/api';

export async function GET() {
  return ok({ status: 'ok', service: 'web', time: new Date().toISOString() });
}
