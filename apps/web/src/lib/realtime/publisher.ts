import 'server-only';
import { getPublisher, INTERNAL_EVENTS, type InternalEnvelope, type InternalEventName } from '@pullvault/shared';
import { logger } from '@pullvault/shared/logger';

// Web API routes call this AFTER successfully committing a DB transaction.
// The realtime server subscribes to these channels and fans out via Socket.io.

export async function publishInternal<T>(channel: string, event: InternalEventName, payload: T) {
  const envelope: InternalEnvelope<T> = {
    event,
    emittedAt: new Date().toISOString(),
    payload,
  };
  try {
    await getPublisher().publish(channel, JSON.stringify(envelope));
  } catch (err) {
    // Pub/sub is best-effort. If it fails, the on-page poll still recovers.
    logger.warn({ err, channel, event }, 'realtime publish failed');
  }
}

export { INTERNAL_EVENTS };
