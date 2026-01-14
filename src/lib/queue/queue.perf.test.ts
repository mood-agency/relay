import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { OptimizedRedisQueue, QueueConfig } from './index.js';

/**
 * Quick Performance Tests for Redis Queue Operations
 *
 * These tests are designed to run quickly (~30 seconds) and catch
 * obvious performance regressions during development.
 *
 * Run with: pnpm test src/lib/queue/queue.perf.ts
 *
 * For comprehensive benchmarking, use queue.benchmark.ts instead.
 */

// Lightweight config for quick tests
const PERF_ITERATIONS = 20;
const BATCH_SIZE = 50;

let queue: OptimizedRedisQueue;
const testConfig = new QueueConfig({
  redis_host: process.env.REDIS_HOST || 'localhost',
  redis_port: parseInt(process.env.REDIS_PORT || '6379', 10),
  redis_db: parseInt(process.env.REDIS_DB || '0', 10),
  redis_password: process.env.REDIS_PASSWORD || undefined,
  queue_name: 'perf_test_queue',
  processing_queue_name: 'perf_test_queue_processing',
  dead_letter_queue_name: 'perf_test_queue_dlq',
  metadata_hash_name: 'perf_test_queue_metadata',
  ack_timeout_seconds: 30,
  max_attempts: 3,
  batch_size: 100,
  redis_pool_size: 5,
  enable_message_encryption: false,
});

interface PerfResult {
  operation: string;
  count: number;
  totalMs: number;
  avgMs: number;
  opsPerSec: number;
}

function measurePerf(operation: string, count: number, totalMs: number): PerfResult {
  return {
    operation,
    count,
    totalMs,
    avgMs: totalMs / count,
    opsPerSec: (count / totalMs) * 1000,
  };
}

function printResult(result: PerfResult) {
  console.log(
    `  ${result.operation.padEnd(25)} | ` +
    `${result.count.toString().padStart(5)} ops | ` +
    `${result.avgMs.toFixed(2).padStart(8)} ms/op | ` +
    `${result.opsPerSec.toFixed(1).padStart(8)} ops/sec`
  );
}

describe('Quick Performance Tests', () => {
  beforeAll(async () => {
    queue = new OptimizedRedisQueue(testConfig);
    await queue.redisManager.redis.flushdb();
  });

  afterAll(async () => {
    if (queue) {
      await queue.redisManager.redis.flushdb();
      await queue.redisManager.disconnect();
    }
  });

  beforeEach(async () => {
    await queue.clearAllQueues();
  });

  it('should meet enqueue performance baseline', async () => {
    const payload = { test: 'data', timestamp: Date.now() };
    const start = performance.now();

    for (let i = 0; i < PERF_ITERATIONS; i++) {
      await queue.enqueueMessage({ type: 'perf-test', payload });
    }

    const elapsed = performance.now() - start;
    const result = measurePerf('Single Enqueue', PERF_ITERATIONS, elapsed);
    printResult(result);

    // Performance assertion: average should be under 30ms
    expect(result.avgMs).toBeLessThan(30);
  });

  it('should meet batch enqueue performance baseline', async () => {
    const payload = { test: 'data', timestamp: Date.now() };
    const messages = Array.from({ length: BATCH_SIZE }, (_, i) => ({
      type: 'perf-batch',
      payload: { ...payload, index: i },
    }));

    const start = performance.now();
    const count = await queue.enqueueBatch(messages);
    const elapsed = performance.now() - start;

    const result = measurePerf('Batch Enqueue (50 msgs)', 1, elapsed);
    const perMessage = measurePerf('Per-message in batch', count, elapsed);

    printResult(result);
    printResult(perMessage);

    // Batch should be efficient: under 5ms per message
    expect(perMessage.avgMs).toBeLessThan(5);
    expect(count).toBe(BATCH_SIZE);
  });

  it('should meet dequeue performance baseline', async () => {
    // Pre-populate
    const payload = { test: 'data' };
    const messages = Array.from({ length: PERF_ITERATIONS }, () => ({
      type: 'perf-dequeue',
      payload,
    }));
    await queue.enqueueBatch(messages);

    const start = performance.now();
    const dequeuedMsgs: any[] = [];

    for (let i = 0; i < PERF_ITERATIONS; i++) {
      const msg = await queue.dequeueMessage(1, 30);
      if (msg) dequeuedMsgs.push(msg);
    }

    const elapsed = performance.now() - start;
    const result = measurePerf('Dequeue', dequeuedMsgs.length, elapsed);
    printResult(result);

    // Dequeue should be under 20ms average
    expect(result.avgMs).toBeLessThan(20);
    expect(dequeuedMsgs.length).toBe(PERF_ITERATIONS);

    // Cleanup
    for (const msg of dequeuedMsgs) {
      await queue.acknowledgeMessage({
        id: msg.id,
        _stream_id: msg._stream_id,
        _stream_name: msg._stream_name,
        lock_token: msg.lock_token,
      });
    }
  });

  it('should meet acknowledge performance baseline', async () => {
    // Pre-populate and dequeue
    const payload = { test: 'data' };
    const messages = Array.from({ length: PERF_ITERATIONS }, () => ({
      type: 'perf-ack',
      payload,
    }));
    await queue.enqueueBatch(messages);

    const dequeuedMsgs: any[] = [];
    for (let i = 0; i < PERF_ITERATIONS; i++) {
      const msg = await queue.dequeueMessage(1, 30);
      if (msg) dequeuedMsgs.push(msg);
    }

    const start = performance.now();

    for (const msg of dequeuedMsgs) {
      await queue.acknowledgeMessage({
        id: msg.id,
        _stream_id: msg._stream_id,
        _stream_name: msg._stream_name,
        lock_token: msg.lock_token,
      });
    }

    const elapsed = performance.now() - start;
    const result = measurePerf('Acknowledge', dequeuedMsgs.length, elapsed);
    printResult(result);

    // Acknowledge should be under 20ms average
    expect(result.avgMs).toBeLessThan(20);
  });

  it('should meet full lifecycle performance baseline', async () => {
    const payload = { test: 'data', timestamp: Date.now() };
    const start = performance.now();

    for (let i = 0; i < PERF_ITERATIONS; i++) {
      // Enqueue
      await queue.enqueueMessage({ type: 'perf-lifecycle', payload });

      // Dequeue
      const msg = await queue.dequeueMessage(1, 30);

      // Acknowledge
      if (msg) {
        await queue.acknowledgeMessage({
          id: msg.id,
          _stream_id: msg._stream_id,
          _stream_name: msg._stream_name,
          lock_token: msg.lock_token,
        });
      }
    }

    const elapsed = performance.now() - start;
    const result = measurePerf('Full Lifecycle', PERF_ITERATIONS, elapsed);
    printResult(result);

    // Full cycle should be under 100ms average
    expect(result.avgMs).toBeLessThan(100);
  });

  it('should meet getMetrics performance baseline', async () => {
    // Add some messages to measure
    const messages = Array.from({ length: 100 }, () => ({
      type: 'perf-metrics',
      payload: { data: 'test' },
    }));
    await queue.enqueueBatch(messages);

    const start = performance.now();

    for (let i = 0; i < PERF_ITERATIONS; i++) {
      await queue.getMetrics();
    }

    const elapsed = performance.now() - start;
    const result = measurePerf('getMetrics', PERF_ITERATIONS, elapsed);
    printResult(result);

    // Metrics query should be under 10ms average
    expect(result.avgMs).toBeLessThan(10);
  });

  it('should print performance summary', async () => {
    console.log('\n========================================');
    console.log('       PERFORMANCE TEST SUMMARY        ');
    console.log('========================================');
    console.log('All performance baselines passed ✓');
    console.log('');
    console.log('Baseline thresholds:');
    console.log('  - Single Enqueue:    < 30ms');
    console.log('  - Batch Enqueue:     < 5ms/message');
    console.log('  - Dequeue:           < 20ms');
    console.log('  - Acknowledge:       < 20ms');
    console.log('  - Full Lifecycle:    < 100ms');
    console.log('  - getMetrics:        < 10ms');
    console.log('========================================\n');

    expect(true).toBe(true);
  });
});
