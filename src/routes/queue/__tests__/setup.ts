import { beforeAll, afterAll, beforeEach } from 'vitest';
import { testClient } from 'hono/testing';
import router from '../queue.index';
import { getQueue } from '../queue.handlers';

export { router, getQueue, testClient };

/**
 * Standard test setup that truncates all tables before/after tests.
 * Call this in each test file's describe block.
 */
export function setupQueueTests() {
  beforeAll(async () => {
    const queue = await getQueue();
    await queue.pgManager.query('TRUNCATE messages, activity_logs, anomalies, consumer_stats CASCADE');
  });

  afterAll(async () => {
    const queue = await getQueue();
    await queue.pgManager.query('TRUNCATE messages, activity_logs, anomalies, consumer_stats CASCADE');
    // Don't disconnect - the queue is a singleton and other test files may use it
    // The connection will be cleaned up when the process exits
  });

  beforeEach(async () => {
    const queue = await getQueue();
    await queue.pgManager.query('TRUNCATE messages, activity_logs, anomalies, consumer_stats CASCADE');
  });
}

/**
 * Helper to wait for async operations (like activity logging)
 */
export const waitForAsync = (ms = 100) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Helper to enqueue a test message
 */
export async function enqueueMessage(options: {
  type: string;
  payload?: Record<string, unknown>;
  priority?: number;
}) {
  const { type, payload = {}, priority } = options;
  const res = await testClient(router).queue.message.$post({
    json: { type, payload, priority }
  });
  return res.json();
}

/**
 * Helper to dequeue a message
 */
export async function dequeueMessage(options?: {
  type?: string;
  timeout?: string;
  consumerId?: string;
}) {
  const query: Record<string, string> = { timeout: options?.timeout ?? '0' };
  if (options?.type) query.type = options.type;
  if (options?.consumerId) query.consumerId = options.consumerId;

  return testClient(router).queue.message.$get({ query });
}

/**
 * Helper to get messages from a queue type
 */
export async function getQueueMessages(queueType: string, options?: {
  page?: string;
  limit?: string;
  sortBy?: string;
  sortOrder?: string;
  filterType?: string;
}) {
  return testClient(router).queue[':queueType'].messages.$get({
    param: { queueType },
    query: options
  });
}
