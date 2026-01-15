#!/usr/bin/env npx tsx
/**
 * Queue Benchmark Script
 *
 * Measures operations per second for enqueue, dequeue, and full cycle operations.
 *
 * Usage:
 *   npx tsx benchmark.ts [options]
 *
 * Options:
 *   --duration <seconds>   Test duration per operation (default: 5)
 *   --batch-size <size>    Batch size for batch enqueue (default: 100)
 *   --workers <count>      Concurrent workers for concurrent tests (default: 5)
 *   --test <type>          Run specific test: enqueue, batch, dequeue, cycle, concurrent, all (default: all)
 *   --no-logging           Disable activity logging during tests (default: true)
 */

import 'dotenv/config';
import { PostgresQueue, QueueConfig } from './src/lib/queue/index.js';

interface BenchmarkResult {
  operation: string;
  totalOperations: number;
  durationMs: number;
  opsPerSecond: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    duration: 5,
    batchSize: 100,
    workers: 5,
    test: 'all',
    logging: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--duration':
        options.duration = parseInt(args[++i], 10);
        break;
      case '--batch-size':
        options.batchSize = parseInt(args[++i], 10);
        break;
      case '--workers':
        options.workers = parseInt(args[++i], 10);
        break;
      case '--test':
        options.test = args[++i];
        break;
      case '--no-logging':
        options.logging = false;
        break;
      case '--logging':
        options.logging = true;
        break;
      case '--help':
        console.log(`
Queue Benchmark Script

Usage:
  npx tsx benchmark.ts [options]

Options:
  --duration <seconds>   Test duration per operation (default: 5)
  --batch-size <size>    Batch size for batch enqueue (default: 100)
  --workers <count>      Concurrent workers (default: 5)
  --test <type>          Test type: enqueue, batch, dequeue, cycle, concurrent, all (default: all)
  --logging              Enable activity logging (default: disabled)
  --help                 Show this help
`);
        process.exit(0);
    }
  }

  return options;
}

function calculatePercentile(sortedArray: number[], percentile: number): number {
  if (sortedArray.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
  return sortedArray[Math.max(0, index)];
}

function formatResult(result: BenchmarkResult): void {
  console.log(`
  ${result.operation}
  ${'─'.repeat(50)}
  Total Operations:  ${result.totalOperations.toLocaleString()}
  Duration:          ${(result.durationMs / 1000).toFixed(2)}s
  Throughput:        ${result.opsPerSecond.toFixed(2)} ops/sec

  Latency:
    Average:         ${result.avgLatencyMs.toFixed(3)}ms
    Min:             ${result.minLatencyMs.toFixed(3)}ms
    Max:             ${result.maxLatencyMs.toFixed(3)}ms
    P50:             ${result.p50LatencyMs.toFixed(3)}ms
    P95:             ${result.p95LatencyMs.toFixed(3)}ms
    P99:             ${result.p99LatencyMs.toFixed(3)}ms
`);
}

function createResult(operation: string, latencies: number[], durationMs: number): BenchmarkResult {
  latencies.sort((a, b) => a - b);
  return {
    operation,
    totalOperations: latencies.length,
    durationMs,
    opsPerSecond: (latencies.length / durationMs) * 1000,
    avgLatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
    minLatencyMs: latencies[0] || 0,
    maxLatencyMs: latencies[latencies.length - 1] || 0,
    p50LatencyMs: calculatePercentile(latencies, 50),
    p95LatencyMs: calculatePercentile(latencies, 95),
    p99LatencyMs: calculatePercentile(latencies, 99),
  };
}

async function runEnqueueBenchmark(queue: PostgresQueue, durationMs: number): Promise<BenchmarkResult> {
  const latencies: number[] = [];
  const startTime = performance.now();

  while (performance.now() - startTime < durationMs) {
    const opStart = performance.now();
    await queue.enqueueMessage({
      type: 'benchmark',
      payload: { index: latencies.length, timestamp: Date.now() },
      queue: 'default',
    });
    latencies.push(performance.now() - opStart);
  }

  return createResult('Single Enqueue', latencies, performance.now() - startTime);
}

async function runBatchEnqueueBenchmark(queue: PostgresQueue, durationMs: number, batchSize: number): Promise<BenchmarkResult> {
  const latencies: number[] = [];
  const startTime = performance.now();
  let totalMessages = 0;

  while (performance.now() - startTime < durationMs) {
    const messages = Array.from({ length: batchSize }, (_, i) => ({
      type: 'benchmark-batch',
      payload: { batchIndex: latencies.length, index: i, timestamp: Date.now() },
    }));

    const opStart = performance.now();
    await queue.enqueueBatch(messages, 0, 'default');
    latencies.push(performance.now() - opStart);
    totalMessages += batchSize;
  }

  const duration = performance.now() - startTime;
  const result = createResult(`Batch Enqueue (${batchSize}/batch)`, latencies, duration);
  // Override to show per-message throughput
  result.totalOperations = totalMessages;
  result.opsPerSecond = (totalMessages / duration) * 1000;
  return result;
}

async function runDequeueBenchmark(queue: PostgresQueue, durationMs: number): Promise<BenchmarkResult> {
  // Pre-populate
  const prepopCount = 5000;
  console.log(`    Pre-populating ${prepopCount} messages...`);
  for (let i = 0; i < prepopCount / 100; i++) {
    const messages = Array.from({ length: 100 }, (_, j) => ({
      type: 'dequeue-benchmark',
      payload: { index: i * 100 + j },
    }));
    await queue.enqueueBatch(messages, 0, 'default');
  }

  const latencies: number[] = [];
  const startTime = performance.now();
  let emptyCount = 0;

  while (performance.now() - startTime < durationMs && emptyCount < 10) {
    const opStart = performance.now();
    const msg = await queue.dequeueMessage(0, null, 'default', null, 'benchmark-consumer');
    latencies.push(performance.now() - opStart);

    if (msg) {
      emptyCount = 0;
    } else {
      emptyCount++;
    }
  }

  return createResult('Single Dequeue', latencies, performance.now() - startTime);
}

async function runFullCycleBenchmark(queue: PostgresQueue, durationMs: number): Promise<BenchmarkResult> {
  const latencies: number[] = [];
  const startTime = performance.now();

  while (performance.now() - startTime < durationMs) {
    const opStart = performance.now();

    // Enqueue
    await queue.enqueueMessage({
      type: 'cycle-benchmark',
      payload: { index: latencies.length, timestamp: Date.now() },
      queue: 'default',
    });

    // Dequeue
    const msg = await queue.dequeueMessage(0, null, 'default', null, 'cycle-consumer');

    // Acknowledge
    if (msg) {
      await queue.acknowledgeMessage({ id: msg.id, lock_token: msg.lock_token });
    }

    latencies.push(performance.now() - opStart);
  }

  return createResult('Full Cycle (enqueue→dequeue→ack)', latencies, performance.now() - startTime);
}

async function runConcurrentEnqueueBenchmark(queue: PostgresQueue, durationMs: number, workers: number): Promise<BenchmarkResult> {
  const allLatencies: number[] = [];
  const startTime = performance.now();

  const workerPromises = Array.from({ length: workers }, async (_, workerId) => {
    const localLatencies: number[] = [];
    while (performance.now() - startTime < durationMs) {
      const opStart = performance.now();
      await queue.enqueueMessage({
        type: 'concurrent-benchmark',
        payload: { workerId, index: localLatencies.length, timestamp: Date.now() },
        queue: 'default',
      });
      localLatencies.push(performance.now() - opStart);
    }
    return localLatencies;
  });

  const results = await Promise.all(workerPromises);
  results.forEach(latencies => allLatencies.push(...latencies));

  const result = createResult(`Concurrent Enqueue (${workers} workers)`, allLatencies, performance.now() - startTime);
  console.log(`    Worker distribution: ${results.map(r => r.length).join(', ')}`);
  return result;
}

async function main() {
  const options = parseArgs();
  const durationMs = options.duration * 1000;

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    QUEUE BENCHMARK                           ║
╚══════════════════════════════════════════════════════════════╝

Configuration:
  Duration per test:  ${options.duration}s
  Batch size:         ${options.batchSize}
  Workers:            ${options.workers}
  Activity logging:   ${options.logging ? 'enabled' : 'disabled'}
  Test:               ${options.test}
`);

  // Initialize queue with config from environment
  const config = new QueueConfig({
    postgres_host: process.env.POSTGRES_HOST || 'localhost',
    postgres_port: process.env.POSTGRES_PORT || '5432',
    postgres_database: process.env.POSTGRES_DATABASE || 'relay',
    postgres_user: process.env.POSTGRES_USER || 'postgres',
    postgres_password: process.env.POSTGRES_PASSWORD || '',
    postgres_pool_size: process.env.POSTGRES_POOL_SIZE || '10',
    postgres_ssl: process.env.POSTGRES_SSL === 'true',
    queue_name: process.env.QUEUE_NAME || 'queue',
    ack_timeout_seconds: process.env.ACK_TIMEOUT_SECONDS || '30',
    max_attempts: process.env.MAX_ATTEMPTS || '3',
    activity_log_enabled: options.logging,
  } as any);

  const queue = new PostgresQueue(config);

  // Verify connection by running a simple query
  await queue.pgManager.query('SELECT 1');
  console.log('  Connected to PostgreSQL\n');

  const results: BenchmarkResult[] = [];

  try {
    // Clean up before tests
    await queue.pgManager.query('TRUNCATE messages CASCADE');

    if (options.test === 'all' || options.test === 'enqueue') {
      console.log('Running: Single Enqueue...');
      await queue.pgManager.query('TRUNCATE messages CASCADE');
      results.push(await runEnqueueBenchmark(queue, durationMs));
      formatResult(results[results.length - 1]);
    }

    if (options.test === 'all' || options.test === 'batch') {
      console.log('Running: Batch Enqueue...');
      await queue.pgManager.query('TRUNCATE messages CASCADE');
      results.push(await runBatchEnqueueBenchmark(queue, durationMs, options.batchSize));
      formatResult(results[results.length - 1]);
    }

    if (options.test === 'all' || options.test === 'dequeue') {
      console.log('Running: Dequeue...');
      await queue.pgManager.query('TRUNCATE messages CASCADE');
      results.push(await runDequeueBenchmark(queue, durationMs));
      formatResult(results[results.length - 1]);
    }

    if (options.test === 'all' || options.test === 'cycle') {
      console.log('Running: Full Cycle...');
      await queue.pgManager.query('TRUNCATE messages CASCADE');
      results.push(await runFullCycleBenchmark(queue, durationMs));
      formatResult(results[results.length - 1]);
    }

    if (options.test === 'all' || options.test === 'concurrent') {
      console.log('Running: Concurrent Enqueue...');
      await queue.pgManager.query('TRUNCATE messages CASCADE');
      results.push(await runConcurrentEnqueueBenchmark(queue, durationMs, options.workers));
      formatResult(results[results.length - 1]);
    }

    // Print summary
    if (results.length > 1) {
      console.log(`
╔══════════════════════════════════════════════════════════════╗
║                        SUMMARY                               ║
╚══════════════════════════════════════════════════════════════╝
`);
      console.log('┌────────────────────────────────────┬────────────┬───────────┬───────────┐');
      console.log('│ Operation                          │   Ops/Sec  │  Avg (ms) │  P99 (ms) │');
      console.log('├────────────────────────────────────┼────────────┼───────────┼───────────┤');
      for (const r of results) {
        const op = r.operation.substring(0, 34).padEnd(34);
        const ops = r.opsPerSecond.toFixed(0).padStart(10);
        const avg = r.avgLatencyMs.toFixed(2).padStart(9);
        const p99 = r.p99LatencyMs.toFixed(2).padStart(9);
        console.log(`│ ${op} │ ${ops} │ ${avg} │ ${p99} │`);
      }
      console.log('└────────────────────────────────────┴────────────┴───────────┴───────────┘');
    }

  } finally {
    // Cleanup
    await queue.pgManager.query('TRUNCATE messages CASCADE');
    await queue.disconnect();
    console.log('\nBenchmark complete.');
  }
}

main().catch(console.error);
