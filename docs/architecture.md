# Relay Architecture

This document explains the PostgreSQL-based queue architecture.

## Overview

Relay uses PostgreSQL as its backing store, leveraging:
- **ACID transactions** for data integrity
- **SELECT FOR UPDATE SKIP LOCKED** for atomic, non-blocking dequeue
- **LISTEN/NOTIFY** for real-time SSE updates
- **JSONB** for flexible message payloads

## Database Schema

### Messages Table

The core `messages` table stores all queue messages with a `status` column tracking lifecycle:

```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    type TEXT,
    payload JSONB NOT NULL,
    priority INTEGER DEFAULT 0 CHECK (priority >= 0 AND priority <= 9),
    status TEXT DEFAULT 'queued',  -- queued, processing, acknowledged, dead, archived

    -- Attempt tracking
    attempt_count INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,

    -- Timeout configuration
    ack_timeout_seconds INTEGER DEFAULT 30,

    -- Lock management
    lock_token TEXT,
    locked_until TIMESTAMPTZ,
    consumer_id TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    dequeued_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,

    -- Error tracking
    last_error TEXT
);
```

### Indexes

```sql
-- Efficient dequeue: priority DESC, FIFO within priority
CREATE INDEX idx_messages_dequeue ON messages(priority DESC, created_at ASC)
    WHERE status = 'queued';

-- Type-filtered dequeue
CREATE INDEX idx_messages_type_dequeue ON messages(type, priority DESC, created_at ASC)
    WHERE status = 'queued';

-- Finding overdue messages
CREATE INDEX idx_messages_overdue ON messages(locked_until)
    WHERE status = 'processing';
```

### Supporting Tables

- **activity_logs** - Message lifecycle events
- **anomalies** - Detected unusual patterns
- **consumer_stats** - Per-consumer statistics
- **queue_metrics** - Historical metrics snapshots

## Message Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ENQUEUE (INSERT)                                              │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────┐                                                   │
│  │ queued  │◄─────────────────┐                                │
│  └────┬────┘                  │                                │
│       │                       │                                │
│       │ DEQUEUE               │ NACK (retry)                   │
│       │ (SELECT FOR UPDATE    │ or TIMEOUT                     │
│       │  SKIP LOCKED)         │                                │
│       ▼                       │                                │
│  ┌──────────────┐             │                                │
│  │ processing   │─────────────┘                                │
│  └──────┬───────┘                                              │
│         │                                                       │
│         ├──── ACK ──────► ┌──────────────┐                     │
│         │                 │ acknowledged │                     │
│         │                 └──────────────┘                     │
│         │                                                       │
│         └──── MAX_ATTEMPTS ──► ┌──────┐                        │
│                                │ dead │ (DLQ)                  │
│                                └──────┘                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Atomic Dequeue

The key to reliable queue processing is atomic dequeue using PostgreSQL's `SELECT FOR UPDATE SKIP LOCKED`:

```sql
UPDATE messages SET
    status = 'processing',
    lock_token = $1,
    locked_until = NOW() + ($2 || ' seconds')::INTERVAL,
    consumer_id = $3,
    dequeued_at = NOW(),
    attempt_count = attempt_count + 1
WHERE id = (
    SELECT id FROM messages
    WHERE status = 'queued'
    ORDER BY priority DESC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
RETURNING *;
```

**Why SKIP LOCKED?**
- Multiple workers can dequeue concurrently without blocking
- Each message is delivered to exactly one worker
- No distributed locks needed

## Split-Brain Prevention

### The Problem

Without protection:
1. Worker A takes message, starts processing
2. Processing takes longer than timeout
3. System thinks Worker A is dead, message gets requeued
4. Worker B picks up the same message
5. Both workers are now processing the same message

### The Solution: Lock Tokens

Each dequeue generates a unique `lock_token`:

```typescript
const lockToken = generateId(); // e.g., "lt_abc123..."
```

ACK/NACK/TOUCH requests must include the matching token:

```sql
-- ACK with lock validation
UPDATE messages SET status = 'acknowledged'
WHERE id = $1 AND lock_token = $2 AND status = 'processing';
```

If the token doesn't match → 409 Conflict response.

### TOUCH Endpoint

Workers processing long tasks can extend their lock:

```typescript
// Extend lock by 30 more seconds
PUT /queue/message/:id/touch
{ "lock_token": "lt_abc123", "extend_seconds": 30 }
```

## Real-Time Updates (SSE)

PostgreSQL LISTEN/NOTIFY powers real-time dashboard updates:

### Trigger on Message Changes

```sql
CREATE FUNCTION notify_message_change() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM pg_notify('queue_events', json_build_object(
            'type', 'enqueue',
            'payload', json_build_object('id', NEW.id, 'type', NEW.type)
        )::text);
    ELSIF TG_OP = 'UPDATE' AND OLD.status != NEW.status THEN
        -- Notify on status changes
        PERFORM pg_notify('queue_events', ...);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### SSE Connection

```typescript
// Server subscribes to PostgreSQL notifications
await pgClient.query('LISTEN queue_events');
pgClient.on('notification', (msg) => {
    sseStream.writeSSE({ data: msg.payload });
});
```

## Overdue Message Handling

A background worker periodically checks for overdue messages:

```sql
-- Find and requeue overdue messages
UPDATE messages SET
    status = CASE
        WHEN attempt_count >= max_attempts THEN 'dead'
        ELSE 'queued'
    END,
    lock_token = NULL,
    locked_until = NULL
WHERE status = 'processing' AND locked_until < NOW()
RETURNING *;
```

**Configuration:**
- `OVERDUE_CHECK_INTERVAL_MS` - How often to check (default: 5000ms)
- `ACK_TIMEOUT_SECONDS` - Default lock duration (default: 30s)

## Performance Characteristics

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Enqueue | O(1) | Simple INSERT |
| Dequeue | O(log n) | Index scan on priority + created_at |
| ACK | O(1) | Primary key lookup |
| Status counts | O(1) | COUNT with index |
| Type-filtered dequeue | O(log n) | Partial index on type |

## Scaling Considerations

### Horizontal Scaling

- Multiple API servers can connect to same PostgreSQL
- Each server runs its own overdue-check worker (with distributed lock)
- SKIP LOCKED ensures no message duplication

### Connection Pooling

- Default pool size: 10 connections
- Adjust `POSTGRES_POOL_SIZE` based on worker count
- Use PgBouncer for high-connection scenarios

### High Volume

For very high throughput:
1. Tune `work_mem` and `shared_buffers`
2. Consider table partitioning by `created_at`
3. Add read replicas for dashboard queries
4. Archive old acknowledged/dead messages
