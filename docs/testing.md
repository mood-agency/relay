# Testing

## Running Tests

Relay uses [Vitest](https://vitest.dev/) for testing. Tests require a running PostgreSQL instance.

```bash
# Run all tests in watch mode
pnpm test

# Run tests once
pnpm test -- --run

# Run specific test file
pnpm test src/routes/queue/__tests__/queue.health.test.ts -- --run

# Run all queue tests
pnpm test src/routes/queue/__tests__/ -- --run
```

## Test Files

Tests are located in `src/routes/queue/__tests__/`:

| File | Description |
|------|-------------|
| `queue.health.test.ts` | Health check endpoint |
| `queue.enqueue-dequeue.test.ts` | Basic enqueue/dequeue operations |
| `queue.ack-nack.test.ts` | Acknowledgment and negative acknowledgment |
| `queue.batch.test.ts` | Batch enqueue operations |
| `queue.activity.test.ts` | Activity logging |
| `queue.bulk-operations.test.ts` | Bulk delete, move, clear operations |
| `queue.concurrent.test.ts` | Concurrent dequeue behavior |
| `queue.lock-validation.test.ts` | Lock token validation |
| `queue.split-brain.test.ts` | Split-brain prevention |
| `queue.status-transitions.test.ts` | Message state transitions |
| `queue.timeout-requeue.test.ts` | Timeout and requeue logic |

## Writing Tests

Tests use a shared test setup that creates a fresh database schema:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testApp, setupTestDatabase, cleanupTestDatabase } from './test-utils';

describe('My Feature', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  it('should do something', async () => {
    const response = await testApp.request('/api/queue/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'test',
        payload: { data: 'value' }
      })
    });

    expect(response.status).toBe(201);
  });
});
```

---

## Benchmarking

Run the benchmark script to measure queue throughput:

```bash
npx tsx benchmark.ts
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--duration <seconds>` | Test duration per operation | `5` |
| `--batch-size <size>` | Messages per batch | `100` |
| `--workers <count>` | Concurrent workers | `5` |
| `--test <type>` | Test type: `enqueue`, `batch`, `dequeue`, `cycle`, `concurrent`, `all` | `all` |
| `--logging` | Enable activity logging (slower) | disabled |

### Examples

```bash
# Run all benchmarks for 10 seconds each
npx tsx benchmark.ts --duration 10

# Test only batch enqueue with 200 messages per batch
npx tsx benchmark.ts --test batch --batch-size 200

# Test concurrent enqueue with 10 workers
npx tsx benchmark.ts --test concurrent --workers 10

# Run with activity logging enabled
npx tsx benchmark.ts --logging
```

### Sample Output

```
┌────────────────────────────────────┬────────────┬───────────┬───────────┐
│ Operation                          │   Ops/Sec  │  Avg (ms) │  P99 (ms) │
├────────────────────────────────────┼────────────┼───────────┼───────────┤
│ Single Enqueue                     │        847 │      1.18 │      2.45 │
│ Batch Enqueue (100/batch)          │      12453 │      8.03 │     15.21 │
│ Single Dequeue                     │        623 │      1.60 │      3.12 │
│ Full Cycle (enqueue→dequeue→ack)   │        312 │      3.20 │      6.54 │
│ Concurrent Enqueue (5 workers)     │       2134 │      2.34 │      4.89 │
└────────────────────────────────────┴────────────┴───────────┴───────────┘
```

---

## CLI Testing Tools

Two CLI tools are included for testing and populating the queue.

### Enqueue Messages

Bulk-add sample messages to the queue:

```bash
npx tsx enqueue_messages.ts [options]
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--url <url>` | Base URL of the queue API | `http://localhost:3000` |
| `--messages <count>` | Total number of messages to add | `500` |
| `--batch-size <size>` | Messages per batch request | `50` |
| `--api-key <key>` | API key for authentication | `$SECRET_KEY` env var |

#### Examples

```bash
# Add 1000 messages in batches of 100
npx tsx enqueue_messages.ts --messages 1000 --batch-size 100

# Use a custom API URL with authentication
npx tsx enqueue_messages.ts --url http://localhost:8080 --api-key mykey

# Specific example
npx tsx enqueue_messages.ts --api-key GR+pRF8U... --messages 100 --batch-size 1
```

Messages are created with random:
- Types: `email_send`, `image_process`, `data_sync`, `notification`, `backup`
- Priorities: 0-9

### Dequeue Messages

Consume messages from the queue:

```bash
npx tsx dequeue_messages.ts [options]
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--url <url>` | Base URL of the queue API | `http://localhost:3000` |
| `--count <number>` | Number of messages to dequeue | `10` |
| `--timeout <seconds>` | Wait timeout if queue is empty | `30` |
| `--ack-timeout <seconds>` | Processing timeout before requeue | `30` |
| `--consumer <name>` | Custom consumer ID | Random ID |
| `--ack` | Automatically acknowledge messages | `false` |
| `--api-key <key>` | API key for authentication | `$SECRET_KEY` env var |

#### Examples

```bash
# Dequeue 5 messages without acknowledging (they'll return to queue)
npx tsx dequeue_messages.ts --count 5

# Dequeue and acknowledge messages as a named worker
npx tsx dequeue_messages.ts --ack --consumer my-worker

# Long-running worker with extended timeouts
npx tsx dequeue_messages.ts --timeout 60 --ack-timeout 120 --ack
```

---

## Load Testing Tips

### Preparing for Load Tests

1. Use a dedicated PostgreSQL instance
2. Disable activity logging: `ACTIVITY_LOG_ENABLED=false`
3. Increase connection pool: `POSTGRES_POOL_SIZE=50`
4. Enable enqueue buffering for high-throughput enqueue tests

### Monitoring During Tests

- Watch PostgreSQL connections: `SELECT count(*) FROM pg_stat_activity;`
- Monitor queue depth: `GET /api/queue/metrics`
- Check for lock contention in PostgreSQL logs

### Common Bottlenecks

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| Low enqueue throughput | Connection pool exhausted | Increase `POSTGRES_POOL_SIZE` |
| High P99 latency | Disk I/O | Use SSD, tune `wal_buffers` |
| Inconsistent performance | Autovacuum | Tune vacuum settings |
| Memory pressure | Large payloads | Reduce payload size |
