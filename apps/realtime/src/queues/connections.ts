import { newRedisConnection } from '@pullvault/shared';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';

// BullMQ wants its own connection per Queue + Worker.
export function bullConnection(): ConnectionOptions {
  return newRedisConnection() as unknown as ConnectionOptions;
}

export { Queue, Worker };
