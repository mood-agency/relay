import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { OptimizedRedisQueue, QueueConfig } from './index.js';

/**
 * Performance Benchmark Tests for Redis Queue Operations
 *
 * These tests measure the performance of key Redis operations to help
 * identify improvements or regressions when making changes to the queue library.
 *
 * Run with: pnpm test src/lib/queue/queue.benchmark.test.ts -- --run
 *
 * Metrics captured:
 * - Latency (p50, p95, p99, max)
 * - Throughput (operations/second)
 * - Redis command counts (reads, writes, total)
 */

// Test configuration
const BENCHMARK_CONFIG = {
  // Number of iterations for each benchmark
  iterations: {
    single: 100,      // Single message operations
    batch: 10,        // Batch operations (each batch has batchSize messages)
    lifecycle: 50,    // Full lifecycle tests
  },
  // Batch sizes to test
  batchSizes: [10, 50, 100, 500],
  // Payload sizes in bytes (approximate)
  payloadSizes: {
    small: 100,       // ~100 bytes
    medium: 1000,     // ~1KB
    large: 10000,     // ~10KB
  },
  // Timeout settings
  dequeueTimeout: 0.1, // Short timeout for benchmarks - we don't want to wait for messages
  ackTimeout: 30,
};

// Redis command classification
const WRITE_COMMANDS = new Set([
  'set', 'setnx', 'setex', 'psetex', 'mset', 'msetnx',
  'incr', 'incrby', 'incrbyfloat', 'decr', 'decrby',
  'append', 'setrange', 'setbit',
  'hset', 'hsetnx', 'hmset', 'hincrby', 'hincrbyfloat', 'hdel',
  'lpush', 'lpushx', 'rpush', 'rpushx', 'lset', 'linsert', 'lpop', 'rpop', 'lrem', 'ltrim',
  'sadd', 'srem', 'spop', 'smove',
  'zadd', 'zincrby', 'zrem', 'zremrangebyrank', 'zremrangebyscore', 'zremrangebylex', 'zpopmin', 'zpopmax',
  'xadd', 'xdel', 'xtrim', 'xack', 'xclaim', 'xautoclaim', 'xsetid',
  'xgroup', // XGROUP CREATE, DESTROY, etc.
  'del', 'unlink', 'expire', 'expireat', 'pexpire', 'pexpireat', 'persist',
  'rename', 'renamenx',
  'flushdb', 'flushall',
  'eval', 'evalsha', // Lua scripts can do both, counted as writes for safety
  'multi', 'exec', 'discard',
]);

const READ_COMMANDS = new Set([
  'get', 'mget', 'getrange', 'getbit', 'strlen', 'getset', 'getex', 'getdel',
  'hget', 'hmget', 'hgetall', 'hkeys', 'hvals', 'hlen', 'hexists', 'hscan',
  'lrange', 'lindex', 'llen',
  'smembers', 'sismember', 'smismember', 'scard', 'srandmember', 'sscan',
  'zrange', 'zrevrange', 'zrangebyscore', 'zrevrangebyscore', 'zrangebylex', 'zrevrangebylex',
  'zrank', 'zrevrank', 'zscore', 'zmscore', 'zcard', 'zcount', 'zlexcount', 'zscan',
  'xrange', 'xrevrange', 'xlen', 'xinfo', 'xread', 'xreadgroup', 'xpending',
  'exists', 'type', 'ttl', 'pttl', 'keys', 'scan', 'dbsize',
  'ping', 'echo', 'info', 'time',
]);

/**
 * Redis Command Tracker
 * Wraps Redis client to count read/write operations
 */
class RedisCommandTracker {
  public reads = 0;
  public writes = 0;
  public commands: { cmd: string; args: number; timestamp: number }[] = [];
  public trackDetails = false;

  reset() {
    this.reads = 0;
    this.writes = 0;
    this.commands = [];
  }

  get total() {
    return this.reads + this.writes;
  }

  recordCommand(cmd: string, argsCount: number) {
    const cmdLower = cmd.toLowerCase();

    if (WRITE_COMMANDS.has(cmdLower)) {
      this.writes++;
    } else if (READ_COMMANDS.has(cmdLower)) {
      this.reads++;
    } else {
      // Unknown commands - log and count as read
      // console.log(`Unknown Redis command: ${cmd}`);
      this.reads++;
    }

    if (this.trackDetails) {
      this.commands.push({ cmd: cmdLower, args: argsCount, timestamp: Date.now() });
    }
  }

  getStats() {
    return {
      reads: this.reads,
      writes: this.writes,
      total: this.total,
      ratio: this.reads > 0 ? (this.writes / this.reads).toFixed(2) : 'N/A',
    };
  }

  formatStats(label: string): string {
    const stats = this.getStats();
    return `${label}: Reads=${stats.reads}, Writes=${stats.writes}, Total=${stats.total}, W/R Ratio=${stats.ratio}`;
  }
}

/**
 * Wraps a Redis client to track commands
 */
function wrapRedisClient(redis: any, tracker: RedisCommandTracker): any {
  // Store original sendCommand
  const originalSendCommand = redis.sendCommand.bind(redis);

  // Override sendCommand to track all commands
  redis.sendCommand = function(command: any, ...args: any[]) {
    if (command && command.name) {
      tracker.recordCommand(command.name, command.args?.length || 0);
    }
    return originalSendCommand(command, ...args);
  };

  return redis;
}

// Helper to generate payload of specific size
function generatePayload(sizeBytes: number): Record<string, unknown> {
  const basePayload = { timestamp: Date.now(), random: Math.random() };
  const baseSize = JSON.stringify(basePayload).length;
  const paddingSize = Math.max(0, sizeBytes - baseSize - 20);
  return {
    ...basePayload,
    padding: 'x'.repeat(paddingSize),
  };
}

// Statistics calculator
interface Stats {
  count: number;
  total: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  throughput: number;
}

interface BenchmarkResult {
  latency: Stats;
  redis: {
    reads: number;
    writes: number;
    total: number;
    readsPerOp: number;
    writesPerOp: number;
    totalPerOp: number;
  };
}

function calculateStats(latencies: number[], totalTimeMs: number): Stats {
  if (latencies.length === 0) {
    return { count: 0, total: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0, avg: 0, throughput: 0 };
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const count = sorted.length;
  const total = sorted.reduce((a, b) => a + b, 0);

  return {
    count,
    total,
    min: sorted[0],
    max: sorted[count - 1],
    p50: sorted[Math.floor(count * 0.5)],
    p95: sorted[Math.floor(count * 0.95)],
    p99: sorted[Math.floor(count * 0.99)],
    avg: total / count,
    throughput: totalTimeMs > 0 ? (count / totalTimeMs) * 1000 : 0,
  };
}

function formatResult(result: BenchmarkResult, label: string): string {
  const { latency, redis } = result;
  return `
╔══════════════════════════════════════════════════════════════════════════════╗
║ ${label.padEnd(76)} ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ LATENCY                                                                      ║
║   Operations: ${latency.count.toString().padEnd(62)} ║
║   Avg: ${latency.avg.toFixed(2).padStart(8)}ms | P50: ${latency.p50.toFixed(2).padStart(8)}ms | P95: ${latency.p95.toFixed(2).padStart(8)}ms | P99: ${latency.p99.toFixed(2).padStart(8)}ms ║
║   Min: ${latency.min.toFixed(2).padStart(8)}ms | Max: ${latency.max.toFixed(2).padStart(8)}ms | Throughput: ${latency.throughput.toFixed(1).padStart(8)} ops/s     ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ REDIS COMMANDS                                                               ║
║   Total: ${redis.total.toString().padStart(6)} | Reads: ${redis.reads.toString().padStart(6)} | Writes: ${redis.writes.toString().padStart(6)}                          ║
║   Per Operation: ${redis.totalPerOp.toFixed(2).padStart(6)} total | ${redis.readsPerOp.toFixed(2).padStart(6)} reads | ${redis.writesPerOp.toFixed(2).padStart(6)} writes            ║
╚══════════════════════════════════════════════════════════════════════════════╝
`;
}

// Test setup
let queue: OptimizedRedisQueue;
let tracker: RedisCommandTracker;

const testConfig = new QueueConfig({
  redis_host: process.env.REDIS_HOST || 'localhost',
  redis_port: parseInt(process.env.REDIS_PORT || '6379', 10),
  redis_db: parseInt(process.env.REDIS_DB || '0', 10),
  redis_password: process.env.REDIS_PASSWORD || undefined,
  queue_name: 'benchmark_queue',
  processing_queue_name: 'benchmark_queue_processing',
  dead_letter_queue_name: 'benchmark_queue_dlq',
  metadata_hash_name: 'benchmark_queue_metadata',
  ack_timeout_seconds: BENCHMARK_CONFIG.ackTimeout,
  max_attempts: 3,
  batch_size: 1000,
  redis_pool_size: 10,
  enable_message_encryption: false,
});

describe('Queue Performance Benchmarks', () => {
  beforeAll(async () => {
    queue = new OptimizedRedisQueue(testConfig);
    tracker = new RedisCommandTracker();

    // Wrap the Redis client to track commands
    wrapRedisClient(queue.redisManager.redis, tracker);

    // Clear benchmark data
    await queue.redisManager.redis.flushdb();
    tracker.reset(); // Don't count setup commands
  });

  afterAll(async () => {
    if (queue) {
      await queue.redisManager.redis.flushdb();
      await queue.redisManager.disconnect();
    }
  });

  beforeEach(async () => {
    // Clear queue between tests
    await queue.clearAllQueues();
    tracker.reset(); // Reset counter before each test
  });

  describe('1. Enqueue Performance', () => {
    it('should benchmark single message enqueue (small payload)', async () => {
      const iterations = BENCHMARK_CONFIG.iterations.single;
      const payload = generatePayload(BENCHMARK_CONFIG.payloadSizes.small);
      const latencies: number[] = [];

      tracker.reset();
      const totalStart = performance.now();

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await queue.enqueueMessage({ type: 'benchmark', payload });
        latencies.push(performance.now() - start);
      }

      const totalTime = performance.now() - totalStart;
      const stats = calculateStats(latencies, totalTime);
      const redisStats = tracker.getStats();

      const result: BenchmarkResult = {
        latency: stats,
        redis: {
          reads: redisStats.reads,
          writes: redisStats.writes,
          total: redisStats.total,
          readsPerOp: redisStats.reads / iterations,
          writesPerOp: redisStats.writes / iterations,
          totalPerOp: redisStats.total / iterations,
        },
      };

      console.log(formatResult(result, `Single Enqueue (Small Payload ~100 bytes) - ${iterations} ops`));

      // Assertions
      expect(stats.avg).toBeLessThan(50);
      expect(stats.p99).toBeLessThan(100);
    }, 60000);

    it('should benchmark single message enqueue (medium payload)', async () => {
      const iterations = BENCHMARK_CONFIG.iterations.single;
      const payload = generatePayload(BENCHMARK_CONFIG.payloadSizes.medium);
      const latencies: number[] = [];

      tracker.reset();
      const totalStart = performance.now();

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await queue.enqueueMessage({ type: 'benchmark', payload });
        latencies.push(performance.now() - start);
      }

      const totalTime = performance.now() - totalStart;
      const stats = calculateStats(latencies, totalTime);
      const redisStats = tracker.getStats();

      const result: BenchmarkResult = {
        latency: stats,
        redis: {
          reads: redisStats.reads,
          writes: redisStats.writes,
          total: redisStats.total,
          readsPerOp: redisStats.reads / iterations,
          writesPerOp: redisStats.writes / iterations,
          totalPerOp: redisStats.total / iterations,
        },
      };

      console.log(formatResult(result, `Single Enqueue (Medium Payload ~1KB) - ${iterations} ops`));

      expect(stats.avg).toBeLessThan(100);
      expect(stats.p99).toBeLessThan(200);
    }, 60000);

    it('should benchmark single message enqueue (large payload)', async () => {
      const iterations = BENCHMARK_CONFIG.iterations.single;
      const payload = generatePayload(BENCHMARK_CONFIG.payloadSizes.large);
      const latencies: number[] = [];

      tracker.reset();
      const totalStart = performance.now();

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await queue.enqueueMessage({ type: 'benchmark', payload });
        latencies.push(performance.now() - start);
      }

      const totalTime = performance.now() - totalStart;
      const stats = calculateStats(latencies, totalTime);
      const redisStats = tracker.getStats();

      const result: BenchmarkResult = {
        latency: stats,
        redis: {
          reads: redisStats.reads,
          writes: redisStats.writes,
          total: redisStats.total,
          readsPerOp: redisStats.reads / iterations,
          writesPerOp: redisStats.writes / iterations,
          totalPerOp: redisStats.total / iterations,
        },
      };

      console.log(formatResult(result, `Single Enqueue (Large Payload ~10KB) - ${iterations} ops`));

      expect(stats.avg).toBeLessThan(200);
      expect(stats.p99).toBeLessThan(500);
    }, 60000);
  });

  describe('2. Batch Enqueue Performance', () => {
    for (const batchSize of BENCHMARK_CONFIG.batchSizes) {
      it(`should benchmark batch enqueue (batch size: ${batchSize})`, async () => {
        const iterations = BENCHMARK_CONFIG.iterations.batch;
        const payload = generatePayload(BENCHMARK_CONFIG.payloadSizes.small);
        const latencies: number[] = [];
        let totalMessages = 0;

        tracker.reset();
        const totalStart = performance.now();

        for (let i = 0; i < iterations; i++) {
          const messages = Array.from({ length: batchSize }, (_, j) => ({
            type: 'benchmark-batch',
            payload: { ...payload, index: j },
          }));

          const start = performance.now();
          const count = await queue.enqueueBatch(messages);
          latencies.push(performance.now() - start);
          totalMessages += count;

          // Clear between batches to avoid memory buildup
          if (i % 5 === 4) {
            await queue.clearAllQueues();
            tracker.reset(); // Don't count cleanup
          }
        }

        const totalTime = performance.now() - totalStart;
        const stats = calculateStats(latencies, totalTime);
        const redisStats = tracker.getStats();

        const result: BenchmarkResult = {
          latency: stats,
          redis: {
            reads: redisStats.reads,
            writes: redisStats.writes,
            total: redisStats.total,
            readsPerOp: redisStats.reads / totalMessages,
            writesPerOp: redisStats.writes / totalMessages,
            totalPerOp: redisStats.total / totalMessages,
          },
        };

        console.log(formatResult(result, `Batch Enqueue (${batchSize} msgs/batch) - ${totalMessages} total msgs`));

        expect(stats.avg).toBeLessThan(batchSize * 5);
      }, 120000);
    }
  });

  describe('3. Dequeue Performance', () => {
    it('should benchmark dequeue latency (messages available)', async () => {
      const iterations = BENCHMARK_CONFIG.iterations.single;
      const payload = generatePayload(BENCHMARK_CONFIG.payloadSizes.small);

      // Pre-populate queue
      const messages = Array.from({ length: iterations }, () => ({
        type: 'benchmark-dequeue',
        payload,
      }));
      await queue.enqueueBatch(messages);
      tracker.reset(); // Don't count setup

      const latencies: number[] = [];
      const dequeuedMsgs: any[] = [];
      const totalStart = performance.now();

      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        const msg = await queue.dequeueMessage(BENCHMARK_CONFIG.dequeueTimeout, BENCHMARK_CONFIG.ackTimeout);
        latencies.push(performance.now() - start);
        if (msg) dequeuedMsgs.push(msg);
      }

      const totalTime = performance.now() - totalStart;
      const stats = calculateStats(latencies, totalTime);
      const redisStats = tracker.getStats();

      const result: BenchmarkResult = {
        latency: stats,
        redis: {
          reads: redisStats.reads,
          writes: redisStats.writes,
          total: redisStats.total,
          readsPerOp: redisStats.reads / dequeuedMsgs.length,
          writesPerOp: redisStats.writes / dequeuedMsgs.length,
          totalPerOp: redisStats.total / dequeuedMsgs.length,
        },
      };

      console.log(formatResult(result, `Dequeue (Messages Available) - ${dequeuedMsgs.length} ops`));

      // Cleanup
      tracker.reset();
      for (const msg of dequeuedMsgs) {
        await queue.acknowledgeMessage({
          id: msg.id,
          _stream_id: msg._stream_id,
          _stream_name: msg._stream_name,
          lock_token: msg.lock_token,
        });
      }

      // Thresholds account for priority stream scanning and consumer group operations
      // These are baselines - improvements should lower these numbers
      expect(stats.avg).toBeLessThan(100); // Average latency per dequeue
      expect(stats.p99).toBeLessThan(500); // p99 accounts for occasional slow operations
    }, 120000);

    it('should benchmark dequeue with type filter', async () => {
      const iterations = BENCHMARK_CONFIG.iterations.single;
      const payload = generatePayload(BENCHMARK_CONFIG.payloadSizes.small);

      // Pre-populate queue with different types
      const types = ['type-a', 'type-b', 'type-c'];
      for (const type of types) {
        const messages = Array.from({ length: Math.floor(iterations / 3) }, () => ({
          type,
          payload,
        }));
        await queue.enqueueBatch(messages);
      }
      tracker.reset(); // Don't count setup

      const targetType = 'type-b';
      const latencies: number[] = [];
      const dequeuedMsgs: any[] = [];
      const totalStart = performance.now();

      for (let i = 0; i < Math.floor(iterations / 3); i++) {
        const start = performance.now();
        const msg = await queue.dequeueMessage(
          BENCHMARK_CONFIG.dequeueTimeout,
          BENCHMARK_CONFIG.ackTimeout,
          null,
          targetType
        );
        latencies.push(performance.now() - start);
        if (msg) dequeuedMsgs.push(msg);
      }

      const totalTime = performance.now() - totalStart;
      const stats = calculateStats(latencies, totalTime);
      const redisStats = tracker.getStats();

      const result: BenchmarkResult = {
        latency: stats,
        redis: {
          reads: redisStats.reads,
          writes: redisStats.writes,
          total: redisStats.total,
          readsPerOp: redisStats.reads / Math.max(1, dequeuedMsgs.length),
          writesPerOp: redisStats.writes / Math.max(1, dequeuedMsgs.length),
          totalPerOp: redisStats.total / Math.max(1, dequeuedMsgs.length),
        },
      };

      console.log(formatResult(result, `Dequeue with Type Filter - ${dequeuedMsgs.length} ops`));

      // Cleanup
      tracker.reset();
      for (const msg of dequeuedMsgs) {
        await queue.acknowledgeMessage({
          id: msg.id,
          _stream_id: msg._stream_id,
          _stream_name: msg._stream_name,
          lock_token: msg.lock_token,
        });
      }

      expect(stats.avg).toBeLessThan(100);
      expect(stats.p99).toBeLessThan(300);
    }, 120000);
  });

  describe('4. Acknowledge Performance', () => {
    it('should benchmark acknowledge latency', async () => {
      const iterations = BENCHMARK_CONFIG.iterations.single;
      const payload = generatePayload(BENCHMARK_CONFIG.payloadSizes.small);

      // Pre-populate and dequeue
      const messages = Array.from({ length: iterations }, () => ({
        type: 'benchmark-ack',
        payload,
      }));
      await queue.enqueueBatch(messages);

      const dequeuedMessages: any[] = [];
      for (let i = 0; i < iterations; i++) {
        const msg = await queue.dequeueMessage(BENCHMARK_CONFIG.dequeueTimeout, BENCHMARK_CONFIG.ackTimeout);
        if (msg) dequeuedMessages.push(msg);
      }
      tracker.reset(); // Don't count setup

      const latencies: number[] = [];
      const totalStart = performance.now();

      for (const msg of dequeuedMessages) {
        const start = performance.now();
        await queue.acknowledgeMessage({
          id: msg.id,
          _stream_id: msg._stream_id,
          _stream_name: msg._stream_name,
          lock_token: msg.lock_token,
        });
        latencies.push(performance.now() - start);
      }

      const totalTime = performance.now() - totalStart;
      const stats = calculateStats(latencies, totalTime);
      const redisStats = tracker.getStats();

      const result: BenchmarkResult = {
        latency: stats,
        redis: {
          reads: redisStats.reads,
          writes: redisStats.writes,
          total: redisStats.total,
          readsPerOp: redisStats.reads / dequeuedMessages.length,
          writesPerOp: redisStats.writes / dequeuedMessages.length,
          totalPerOp: redisStats.total / dequeuedMessages.length,
        },
      };

      console.log(formatResult(result, `Acknowledge - ${dequeuedMessages.length} ops`));

      expect(stats.avg).toBeLessThan(50);
      expect(stats.p99).toBeLessThan(150);
    }, 120000);
  });

  describe('5. Full Message Lifecycle', () => {
    it('should benchmark complete lifecycle: enqueue -> dequeue -> ack', async () => {
      const iterations = BENCHMARK_CONFIG.iterations.lifecycle;
      const payload = generatePayload(BENCHMARK_CONFIG.payloadSizes.small);

      const enqueueLatencies: number[] = [];
      const dequeueLatencies: number[] = [];
      const ackLatencies: number[] = [];
      const totalLatencies: number[] = [];

      tracker.reset();
      const totalStart = performance.now();

      for (let i = 0; i < iterations; i++) {
        const cycleStart = performance.now();

        // Enqueue
        let start = performance.now();
        await queue.enqueueMessage({ type: 'benchmark-lifecycle', payload });
        enqueueLatencies.push(performance.now() - start);

        // Dequeue
        start = performance.now();
        const msg = await queue.dequeueMessage(BENCHMARK_CONFIG.dequeueTimeout, BENCHMARK_CONFIG.ackTimeout);
        dequeueLatencies.push(performance.now() - start);

        // Acknowledge
        if (msg) {
          start = performance.now();
          await queue.acknowledgeMessage({
            id: msg.id,
            _stream_id: msg._stream_id,
            _stream_name: msg._stream_name,
            lock_token: msg.lock_token,
          });
          ackLatencies.push(performance.now() - start);
        }

        totalLatencies.push(performance.now() - cycleStart);
      }

      const totalTime = performance.now() - totalStart;
      const redisStats = tracker.getStats();

      // Calculate stats for each phase
      const enqueueStats = calculateStats(enqueueLatencies, totalTime);
      const dequeueStats = calculateStats(dequeueLatencies, totalTime);
      const ackStats = calculateStats(ackLatencies, totalTime);
      const totalStats = calculateStats(totalLatencies, totalTime);

      console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║ FULL MESSAGE LIFECYCLE BENCHMARK - ${iterations} complete cycles                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ PHASE BREAKDOWN (Latency in ms)                                              ║
║   Enqueue:     Avg=${enqueueStats.avg.toFixed(2).padStart(6)} | P50=${enqueueStats.p50.toFixed(2).padStart(6)} | P99=${enqueueStats.p99.toFixed(2).padStart(6)}                    ║
║   Dequeue:     Avg=${dequeueStats.avg.toFixed(2).padStart(6)} | P50=${dequeueStats.p50.toFixed(2).padStart(6)} | P99=${dequeueStats.p99.toFixed(2).padStart(6)}                    ║
║   Acknowledge: Avg=${ackStats.avg.toFixed(2).padStart(6)} | P50=${ackStats.p50.toFixed(2).padStart(6)} | P99=${ackStats.p99.toFixed(2).padStart(6)}                    ║
║   TOTAL:       Avg=${totalStats.avg.toFixed(2).padStart(6)} | P50=${totalStats.p50.toFixed(2).padStart(6)} | P99=${totalStats.p99.toFixed(2).padStart(6)}                    ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ REDIS COMMANDS (Total for all ${iterations} cycles)                                     ║
║   Total: ${redisStats.total.toString().padStart(6)} | Reads: ${redisStats.reads.toString().padStart(6)} | Writes: ${redisStats.writes.toString().padStart(6)}                          ║
║   Per Lifecycle: ${(redisStats.total / iterations).toFixed(2).padStart(6)} total | ${(redisStats.reads / iterations).toFixed(2).padStart(6)} reads | ${(redisStats.writes / iterations).toFixed(2).padStart(6)} writes            ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

      expect(totalStats.avg).toBeLessThan(200);
      expect(totalStats.p99).toBeLessThan(500);
    }, 120000);
  });

  describe('6. Metrics Query Performance', () => {
    it('should benchmark getMetrics() with various queue sizes', async () => {
      const payload = generatePayload(BENCHMARK_CONFIG.payloadSizes.small);
      const queueSizes = [0, 100, 500, 1000];

      console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║ getMetrics() BENCHMARK - Varying Queue Sizes                                 ║
╠══════════════════════════════════════════════════════════════════════════════╣`);

      for (const size of queueSizes) {
        // Populate queue
        if (size > 0) {
          const batchSize = 100;
          for (let i = 0; i < size; i += batchSize) {
            const batch = Array.from({ length: Math.min(batchSize, size - i) }, () => ({
              type: 'metrics-benchmark',
              payload,
            }));
            await queue.enqueueBatch(batch);
          }
        }

        tracker.reset();
        const latencies: number[] = [];
        const iterations = 50;

        const totalStart = performance.now();
        for (let i = 0; i < iterations; i++) {
          const start = performance.now();
          await queue.getMetrics();
          latencies.push(performance.now() - start);
        }
        const totalTime = performance.now() - totalStart;

        const stats = calculateStats(latencies, totalTime);
        const redisStats = tracker.getStats();

        console.log(`║ Queue Size: ${size.toString().padStart(5)} | Avg: ${stats.avg.toFixed(2).padStart(6)}ms | Reads: ${(redisStats.reads / iterations).toFixed(1).padStart(4)}/op | Writes: ${(redisStats.writes / iterations).toFixed(1).padStart(4)}/op ║`);

        // Clear for next test
        await queue.clearAllQueues();
      }

      console.log(`╚══════════════════════════════════════════════════════════════════════════════╝
`);
    }, 120000);
  });

  describe('7. Summary Report', () => {
    it('should generate a comprehensive benchmark report', async () => {
      const iterations = 50;
      const payload = generatePayload(BENCHMARK_CONFIG.payloadSizes.small);

      // Collect all results
      const results: { operation: string; latencyAvg: number; readsPerOp: number; writesPerOp: number; totalPerOp: number }[] = [];

      // Enqueue
      tracker.reset();
      let latencies: number[] = [];
      let totalStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await queue.enqueueMessage({ type: 'summary-benchmark', payload });
        latencies.push(performance.now() - start);
      }
      let totalTime = performance.now() - totalStart;
      let stats = calculateStats(latencies, totalTime);
      let redisStats = tracker.getStats();
      results.push({
        operation: 'enqueue',
        latencyAvg: stats.avg,
        readsPerOp: redisStats.reads / iterations,
        writesPerOp: redisStats.writes / iterations,
        totalPerOp: redisStats.total / iterations,
      });

      // Dequeue
      tracker.reset();
      latencies = [];
      const dequeuedMsgs: any[] = [];
      totalStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        const msg = await queue.dequeueMessage(1, 30);
        latencies.push(performance.now() - start);
        if (msg) dequeuedMsgs.push(msg);
      }
      totalTime = performance.now() - totalStart;
      stats = calculateStats(latencies, totalTime);
      redisStats = tracker.getStats();
      results.push({
        operation: 'dequeue',
        latencyAvg: stats.avg,
        readsPerOp: redisStats.reads / dequeuedMsgs.length,
        writesPerOp: redisStats.writes / dequeuedMsgs.length,
        totalPerOp: redisStats.total / dequeuedMsgs.length,
      });

      // Acknowledge
      tracker.reset();
      latencies = [];
      totalStart = performance.now();
      for (const msg of dequeuedMsgs) {
        const start = performance.now();
        await queue.acknowledgeMessage({
          id: msg.id,
          _stream_id: msg._stream_id,
          _stream_name: msg._stream_name,
          lock_token: msg.lock_token,
        });
        latencies.push(performance.now() - start);
      }
      totalTime = performance.now() - totalStart;
      stats = calculateStats(latencies, totalTime);
      redisStats = tracker.getStats();
      results.push({
        operation: 'acknowledge',
        latencyAvg: stats.avg,
        readsPerOp: redisStats.reads / dequeuedMsgs.length,
        writesPerOp: redisStats.writes / dequeuedMsgs.length,
        totalPerOp: redisStats.total / dequeuedMsgs.length,
      });

      // Batch enqueue
      tracker.reset();
      latencies = [];
      let totalMsgs = 0;
      totalStart = performance.now();
      for (let i = 0; i < 10; i++) {
        const batch = Array.from({ length: 100 }, () => ({
          type: 'batch-summary',
          payload,
        }));
        const start = performance.now();
        const count = await queue.enqueueBatch(batch);
        latencies.push(performance.now() - start);
        totalMsgs += count;
      }
      totalTime = performance.now() - totalStart;
      stats = calculateStats(latencies, totalTime);
      redisStats = tracker.getStats();
      results.push({
        operation: 'batch_enqueue_100',
        latencyAvg: stats.avg,
        readsPerOp: redisStats.reads / totalMsgs,
        writesPerOp: redisStats.writes / totalMsgs,
        totalPerOp: redisStats.total / totalMsgs,
      });

      // Metrics
      tracker.reset();
      latencies = [];
      totalStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        const start = performance.now();
        await queue.getMetrics();
        latencies.push(performance.now() - start);
      }
      totalTime = performance.now() - totalStart;
      stats = calculateStats(latencies, totalTime);
      redisStats = tracker.getStats();
      results.push({
        operation: 'getMetrics',
        latencyAvg: stats.avg,
        readsPerOp: redisStats.reads / iterations,
        writesPerOp: redisStats.writes / iterations,
        totalPerOp: redisStats.total / iterations,
      });

      // Print summary
      console.log(`
╔═══════════════════════════════════════════════════════════════════════════════════════════╗
║                              BENCHMARK SUMMARY REPORT                                     ║
╠═══════════════════════════════════════════════════════════════════════════════════════════╣
║ Operation            │ Avg Latency │ Redis Reads │ Redis Writes │ Total Cmds │ Cmds/Op   ║
╠═══════════════════════════════════════════════════════════════════════════════════════════╣`);

      for (const r of results) {
        const op = r.operation.padEnd(20);
        const lat = `${r.latencyAvg.toFixed(2)} ms`.padStart(11);
        const reads = r.readsPerOp.toFixed(2).padStart(11);
        const writes = r.writesPerOp.toFixed(2).padStart(12);
        const total = r.totalPerOp.toFixed(2).padStart(10);
        const perOp = r.totalPerOp.toFixed(2).padStart(9);
        console.log(`║ ${op} │ ${lat} │ ${reads} │ ${writes} │ ${total} │ ${perOp}   ║`);
      }

      console.log(`╚═══════════════════════════════════════════════════════════════════════════════════════════╝
`);

      // JSON output for tracking over time
      const reportJson = JSON.stringify({
        timestamp: new Date().toISOString(),
        results: results.map(r => ({
          ...r,
          latencyAvg: Number(r.latencyAvg.toFixed(2)),
          readsPerOp: Number(r.readsPerOp.toFixed(2)),
          writesPerOp: Number(r.writesPerOp.toFixed(2)),
          totalPerOp: Number(r.totalPerOp.toFixed(2)),
        })),
      }, null, 2);

      console.log('Benchmark results JSON (save for comparison):');
      console.log(reportJson);

      expect(true).toBe(true);
    }, 180000);
  });
});
