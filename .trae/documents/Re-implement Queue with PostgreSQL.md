I will replace the Redis-based queue implementation with a PostgreSQL-based solution. This involves creating a new database schema, replacing the Redis client with a PostgreSQL client, and rewriting the queue logic to use SQL queries.

### 1. Dependencies and Configuration
- **Action**: Install `pg` and remove `ioredis`.
- **Action**: Update `.env.example` to include `DATABASE_URL` (or `POSTGRES_URL`) and remove Redis variables.
- **File**: `package.json`, `.env.example`.

### 2. Database Layer
- **Action**: Create `src/lib/db.ts` to manage the PostgreSQL connection pool.
- **Action**: Create a schema setup script (or function in `QueueService`) to ensure tables exist on startup.
    - **Tables**:
        - `queue_messages`: Stores all messages (pending, processing, dlq, archived).
        - `queue_activity_logs`: Stores audit logs for message lifecycle.
        - `queue_consumer_stats`: Stores consumer metrics.
    - **Indices**: On `status`, `priority`, `created_at`, `type`, and `consumer_id` for performance.

### 3. Core Queue Implementation Refactor
I will rewrite the modules in `src/lib/queue/` to use SQL.

- **`src/lib/queue/connection.js`**:
    - Replace Redis connection logic with Postgres pool initialization.
- **`src/lib/queue/producer.js`**:
    - **`enqueueMessage`**: Insert a new row into `queue_messages` with `status = 'pending'`.
- **`src/lib/queue/consumer.js`**:
    - **`dequeueMessage`**: Use `SELECT ... FOR UPDATE SKIP LOCKED` to atomically fetch and lock the next highest-priority pending message.
    - **`acknowledgeMessage`**: Update message status to `completed` (or `archived`).
    - **`nackMessage`**: Update status back to `pending` and increment `attempt_count`.
- **`src/lib/queue/admin.js`**:
    - **`getQueueMessages`**: `SELECT` with `LIMIT/OFFSET` and `WHERE` clauses for filtering.
    - **`moveMessages`**: Batch `UPDATE` queries to change message status/queue.
    - **`deleteMessages`**: `DELETE` or soft-delete rows.
- **`src/lib/queue/metrics.js`**:
    - **`getMetrics`**: Use `COUNT(*)` with `GROUP BY status` to gather queue sizes.
- **`src/lib/queue/activity.js`**:
    - **`logActivity`**: Insert into `queue_activity_logs`.

### 4. Application Integration
- **Action**: Update `src/lib/queue/queue.js` (Main Class) to orchestrate the new Postgres-based modules.
- **Action**: Ensure `src/routes/queue/` handlers continue to work by maintaining method signatures in the queue service.

### 5. Verification
- **Action**: Create a test script `test_pg_queue.js` to verify:
    1.  Enqueueing messages.
    2.  Concurrent dequeueing (ensuring no double delivery).
    3.  Ack/Nack behavior.
    4.  Metrics reporting.
