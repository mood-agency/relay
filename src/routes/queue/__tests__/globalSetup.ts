import { getQueue } from '../queue.handlers';

export async function setup() {
  // Initialize schema once before all tests
  const queue = await getQueue();
  await queue.pgManager.initializeSchema();

  // Clean slate for tests
  await queue.pgManager.query('TRUNCATE messages, activity_logs, anomalies, consumer_stats CASCADE');
}

export async function teardown() {
  const queue = await getQueue();
  await queue.pgManager.disconnect();
}
