-- Relay Queue PostgreSQL Schema
-- This schema replaces the Redis Streams implementation with PostgreSQL
-- Supports multiple queue types: standard (logged), unlogged (fast), partitioned (scalable)

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==================== MIGRATION: Add queue_name column if missing ====================
-- Add queue_name column to messages if it doesn't exist (for existing installations)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'queue_name') THEN
            ALTER TABLE messages ADD COLUMN queue_name TEXT NOT NULL DEFAULT 'default';
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'activity_logs') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'activity_logs' AND column_name = 'queue_name') THEN
            ALTER TABLE activity_logs ADD COLUMN queue_name TEXT;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'anomalies') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'anomalies' AND column_name = 'queue_name') THEN
            ALTER TABLE anomalies ADD COLUMN queue_name TEXT;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'consumer_stats') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'consumer_stats' AND column_name = 'queue_name') THEN
            ALTER TABLE consumer_stats ADD COLUMN queue_name TEXT;
        END IF;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'queue_metrics') THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'queue_metrics' AND column_name = 'queue_name') THEN
            ALTER TABLE queue_metrics ADD COLUMN queue_name TEXT;
        END IF;
    END IF;
END $$;

-- Drop old indexes if they exist (will be recreated with queue_name)
DROP INDEX IF EXISTS idx_messages_dequeue;
DROP INDEX IF EXISTS idx_messages_type_dequeue;
DROP INDEX IF EXISTS idx_messages_overdue;
DROP INDEX IF EXISTS idx_messages_status;
DROP INDEX IF EXISTS idx_messages_created_at;

-- Drop old views (will be recreated with new schema)
DROP VIEW IF EXISTS queue_status CASCADE;
DROP VIEW IF EXISTS queue_status_by_queue CASCADE;
DROP VIEW IF EXISTS type_distribution CASCADE;

-- ==================== QUEUE REGISTRY ====================
-- Tracks all created queues and their types

CREATE TABLE IF NOT EXISTS queues (
    name TEXT PRIMARY KEY,
    queue_type TEXT NOT NULL DEFAULT 'standard' CHECK (queue_type IN ('standard', 'unlogged', 'partitioned')),

    -- Configuration
    ack_timeout_seconds INTEGER DEFAULT 30,
    max_attempts INTEGER DEFAULT 3,

    -- Partitioned queue settings
    partition_interval TEXT, -- e.g., 'daily', 'hourly', 'weekly'
    retention_interval TEXT, -- e.g., '7 days', '30 days'

    -- Metadata
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Stats (updated periodically)
    message_count BIGINT DEFAULT 0,
    processing_count BIGINT DEFAULT 0,
    dead_count BIGINT DEFAULT 0
);

-- Create default queue if it doesn't exist
INSERT INTO queues (name, queue_type, description)
VALUES ('default', 'standard', 'Default message queue')
ON CONFLICT (name) DO NOTHING;

-- ==================== MAIN MESSAGES TABLE (Standard/Logged) ====================

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY DEFAULT 'msg_' || encode(gen_random_bytes(12), 'hex'),
    queue_name TEXT NOT NULL DEFAULT 'default',
    type TEXT,
    payload JSONB NOT NULL,
    priority INTEGER DEFAULT 0 CHECK (priority >= 0 AND priority <= 9),
    status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'acknowledged', 'dead', 'archived')),

    -- Attempt tracking
    attempt_count INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,

    -- Timeout configuration
    ack_timeout_seconds INTEGER DEFAULT 30,

    -- Lock management (for split-brain prevention)
    lock_token TEXT,
    locked_until TIMESTAMPTZ,
    consumer_id TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    dequeued_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,

    -- Error tracking
    last_error TEXT,

    -- Payload metadata
    payload_size INTEGER DEFAULT 0,

    -- Original message data (for moves/requeues)
    original_priority INTEGER
);

-- Indexes for efficient dequeue (priority DESC, created_at ASC for FIFO within priority)
CREATE INDEX IF NOT EXISTS idx_messages_dequeue
    ON messages(queue_name, priority DESC, created_at ASC)
    WHERE status = 'queued';

-- Index for type-filtered dequeue
CREATE INDEX IF NOT EXISTS idx_messages_type_dequeue
    ON messages(queue_name, type, priority DESC, created_at ASC)
    WHERE status = 'queued';

-- Index for finding overdue processing messages (by queue)
CREATE INDEX IF NOT EXISTS idx_messages_overdue
    ON messages(queue_name, locked_until)
    WHERE status = 'processing';

-- Index for finding ALL overdue processing messages (for requeue worker)
-- This index is critical for fast timeout detection across all queues
CREATE INDEX IF NOT EXISTS idx_messages_overdue_global
    ON messages(locked_until)
    WHERE status = 'processing';

-- Index for status-based queries (dashboard)
CREATE INDEX IF NOT EXISTS idx_messages_status
    ON messages(queue_name, status);

-- Index for message history lookups
CREATE INDEX IF NOT EXISTS idx_messages_created_at
    ON messages(queue_name, created_at DESC);

-- Index for consumer tracking
CREATE INDEX IF NOT EXISTS idx_messages_consumer
    ON messages(consumer_id)
    WHERE status = 'processing';

-- ==================== OPTIMIZED INDEXES ====================

-- Index for fast ACK operations (lookup by id when status is processing)
-- Speeds up acknowledgeMessage() which queries by id and verifies status
CREATE INDEX IF NOT EXISTS idx_messages_ack
    ON messages(id)
    WHERE status = 'processing';

-- Index for cleanup of acknowledged messages (archival/deletion)
-- Enables efficient batch cleanup of old acknowledged messages
CREATE INDEX IF NOT EXISTS idx_messages_cleanup
    ON messages(acknowledged_at)
    WHERE status = 'acknowledged';

-- Index for consumer history and statistics
-- Supports queries for per-consumer metrics across all statuses
CREATE INDEX IF NOT EXISTS idx_messages_consumer_history
    ON messages(consumer_id, acknowledged_at DESC)
    WHERE consumer_id IS NOT NULL AND status = 'acknowledged';

-- Index for dead letter queue analysis
-- Fast lookup of failed messages for debugging and retry operations
CREATE INDEX IF NOT EXISTS idx_messages_dlq
    ON messages(queue_name, created_at DESC)
    WHERE status = 'dead';

-- ==================== UNLOGGED MESSAGES TABLE (High Performance) ====================
-- Uses UNLOGGED for faster writes (2-3x), but data lost on crash

CREATE UNLOGGED TABLE IF NOT EXISTS messages_unlogged (
    id TEXT PRIMARY KEY DEFAULT 'msg_' || encode(gen_random_bytes(12), 'hex'),
    queue_name TEXT NOT NULL,
    type TEXT,
    payload JSONB NOT NULL,
    priority INTEGER DEFAULT 0 CHECK (priority >= 0 AND priority <= 9),
    status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'acknowledged', 'dead', 'archived')),

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
    last_error TEXT,

    -- Payload metadata
    payload_size INTEGER DEFAULT 0,
    original_priority INTEGER
);

-- Indexes for unlogged table
CREATE INDEX IF NOT EXISTS idx_messages_unlogged_dequeue
    ON messages_unlogged(queue_name, priority DESC, created_at ASC)
    WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_messages_unlogged_overdue
    ON messages_unlogged(queue_name, locked_until)
    WHERE status = 'processing';

-- Global overdue index for unlogged table
CREATE INDEX IF NOT EXISTS idx_messages_unlogged_overdue_global
    ON messages_unlogged(locked_until)
    WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_messages_unlogged_status
    ON messages_unlogged(queue_name, status);

-- Optimized indexes for unlogged table (same as standard table)
CREATE INDEX IF NOT EXISTS idx_messages_unlogged_ack
    ON messages_unlogged(id)
    WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_messages_unlogged_cleanup
    ON messages_unlogged(acknowledged_at)
    WHERE status = 'acknowledged';

CREATE INDEX IF NOT EXISTS idx_messages_unlogged_consumer_history
    ON messages_unlogged(consumer_id, acknowledged_at DESC)
    WHERE consumer_id IS NOT NULL AND status = 'acknowledged';

CREATE INDEX IF NOT EXISTS idx_messages_unlogged_dlq
    ON messages_unlogged(queue_name, created_at DESC)
    WHERE status = 'dead';

-- ==================== ACTIVITY LOG TABLE ====================

CREATE TABLE IF NOT EXISTS activity_logs (
    id BIGSERIAL PRIMARY KEY,
    queue_name TEXT,
    action TEXT NOT NULL,
    message_id TEXT,
    message_type TEXT,
    consumer_id TEXT,
    context JSONB DEFAULT '{}',
    payload_size INTEGER,
    queue_type TEXT,
    processing_time_ms INTEGER,
    attempt_count INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for activity log queries
CREATE INDEX IF NOT EXISTS idx_activity_logs_queue
    ON activity_logs(queue_name);

CREATE INDEX IF NOT EXISTS idx_activity_logs_message_id
    ON activity_logs(message_id);

CREATE INDEX IF NOT EXISTS idx_activity_logs_action
    ON activity_logs(action);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at
    ON activity_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_consumer
    ON activity_logs(consumer_id)
    WHERE consumer_id IS NOT NULL;

-- Composite index for efficient cleanup queries (retention policy)
-- Enables fast deletion of old logs while optionally filtering by queue
CREATE INDEX IF NOT EXISTS idx_activity_logs_cleanup
    ON activity_logs(created_at, queue_name);

-- Composite index for dashboard queries (action + time range)
CREATE INDEX IF NOT EXISTS idx_activity_logs_action_time
    ON activity_logs(action, created_at DESC);

-- ==================== ANOMALIES TABLE ====================

CREATE TABLE IF NOT EXISTS anomalies (
    id BIGSERIAL PRIMARY KEY,
    queue_name TEXT,
    type TEXT NOT NULL,
    severity TEXT DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
    message_id TEXT,
    consumer_id TEXT,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anomalies_queue
    ON anomalies(queue_name);

CREATE INDEX IF NOT EXISTS idx_anomalies_type
    ON anomalies(type);

CREATE INDEX IF NOT EXISTS idx_anomalies_severity
    ON anomalies(severity);

CREATE INDEX IF NOT EXISTS idx_anomalies_created_at
    ON anomalies(created_at DESC);

-- ==================== CONSUMER STATS TABLE ====================

CREATE TABLE IF NOT EXISTS consumer_stats (
    consumer_id TEXT PRIMARY KEY,
    queue_name TEXT,
    total_dequeued BIGINT DEFAULT 0,
    total_acknowledged BIGINT DEFAULT 0,
    total_failed BIGINT DEFAULT 0,
    last_dequeue_at TIMESTAMPTZ,
    last_ack_at TIMESTAMPTZ,
    recent_dequeue_times TIMESTAMPTZ[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==================== QUEUE METRICS TABLE ====================

CREATE TABLE IF NOT EXISTS queue_metrics (
    id BIGSERIAL PRIMARY KEY,
    queue_name TEXT,
    queued_count INTEGER DEFAULT 0,
    processing_count INTEGER DEFAULT 0,
    acknowledged_count INTEGER DEFAULT 0,
    dead_count INTEGER DEFAULT 0,
    archived_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_queue_metrics_queue
    ON queue_metrics(queue_name);

CREATE INDEX IF NOT EXISTS idx_queue_metrics_created_at
    ON queue_metrics(created_at DESC);

-- ==================== NOTIFICATION FUNCTIONS ====================

-- Optimized function to notify on message changes (for SSE)
-- Improvements:
-- 1. Reduced payload size (no full message payload, just metadata)
-- 2. Use clock_timestamp() for more accurate timing
-- 3. Single CASE statement for cleaner code path
-- 4. Only notify on status changes for updates
CREATE OR REPLACE FUNCTION notify_message_change()
RETURNS TRIGGER AS $$
DECLARE
    notify_payload TEXT;
    event_type TEXT;
BEGIN
    -- Determine event type based on operation
    IF TG_OP = 'INSERT' THEN
        event_type := 'enqueue';
    ELSIF TG_OP = 'DELETE' THEN
        event_type := 'delete';
    ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        -- Only notify on status changes for updates
        event_type := CASE NEW.status
            WHEN 'acknowledged' THEN 'acknowledge'
            WHEN 'dead' THEN 'move_to_dlq'
            WHEN 'processing' THEN 'dequeue'
            WHEN 'queued' THEN
                CASE WHEN OLD.status = 'processing' THEN 'requeue' ELSE NULL END
            ELSE NULL
        END;
    END IF;

    -- Skip if no relevant event
    IF event_type IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Build compact notification payload (avoid including full message payload)
    -- Using string concatenation is faster than jsonb_build_object for simple payloads
    IF TG_OP = 'DELETE' THEN
        notify_payload := format(
            '{"type":"%s","queue":"%s","ts":%s,"id":"%s","msg_type":%s}',
            event_type,
            OLD.queue_name,
            extract(epoch from clock_timestamp()) * 1000,
            OLD.id,
            COALESCE('"' || OLD.type || '"', 'null')
        );
    ELSE
        notify_payload := format(
            '{"type":"%s","queue":"%s","ts":%s,"id":"%s","msg_type":%s,"priority":%s}',
            event_type,
            NEW.queue_name,
            extract(epoch from clock_timestamp()) * 1000,
            NEW.id,
            COALESCE('"' || NEW.type || '"', 'null'),
            COALESCE(NEW.priority::text, '0')
        );
    END IF;

    PERFORM pg_notify('queue_events', notify_payload);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger for standard messages table
DROP TRIGGER IF EXISTS message_change_trigger ON messages;
CREATE TRIGGER message_change_trigger
    AFTER INSERT OR UPDATE OR DELETE ON messages
    FOR EACH ROW
    EXECUTE FUNCTION notify_message_change();

-- Trigger for unlogged messages table
DROP TRIGGER IF EXISTS message_unlogged_change_trigger ON messages_unlogged;
CREATE TRIGGER message_unlogged_change_trigger
    AFTER INSERT OR UPDATE OR DELETE ON messages_unlogged
    FOR EACH ROW
    EXECUTE FUNCTION notify_message_change();

-- ==================== QUEUE MANAGEMENT FUNCTIONS ====================

-- Function to create a new queue
CREATE OR REPLACE FUNCTION create_queue(
    p_name TEXT,
    p_queue_type TEXT DEFAULT 'standard',
    p_ack_timeout INTEGER DEFAULT 30,
    p_max_attempts INTEGER DEFAULT 3,
    p_partition_interval TEXT DEFAULT NULL,
    p_retention_interval TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL
)
RETURNS queues AS $$
DECLARE
    new_queue queues;
    partition_table_name TEXT;
BEGIN
    -- Validate queue type
    IF p_queue_type NOT IN ('standard', 'unlogged', 'partitioned') THEN
        RAISE EXCEPTION 'Invalid queue type: %. Must be standard, unlogged, or partitioned', p_queue_type;
    END IF;

    -- Validate partitioned queue settings
    IF p_queue_type = 'partitioned' AND (p_partition_interval IS NULL OR p_retention_interval IS NULL) THEN
        RAISE EXCEPTION 'Partitioned queues require partition_interval and retention_interval';
    END IF;

    -- Insert the queue record
    INSERT INTO queues (name, queue_type, ack_timeout_seconds, max_attempts, partition_interval, retention_interval, description)
    VALUES (p_name, p_queue_type, p_ack_timeout, p_max_attempts, p_partition_interval, p_retention_interval, p_description)
    RETURNING * INTO new_queue;

    -- For partitioned queues, create the partitioned table
    IF p_queue_type = 'partitioned' THEN
        partition_table_name := 'messages_partitioned_' || replace(p_name, '-', '_');

        EXECUTE format($sql$
            CREATE TABLE IF NOT EXISTS %I (
                id TEXT DEFAULT 'msg_' || encode(gen_random_bytes(12), 'hex'),
                queue_name TEXT NOT NULL DEFAULT %L,
                type TEXT,
                payload JSONB NOT NULL,
                priority INTEGER DEFAULT 0 CHECK (priority >= 0 AND priority <= 9),
                status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'acknowledged', 'dead', 'archived')),
                attempt_count INTEGER DEFAULT 0,
                max_attempts INTEGER DEFAULT %s,
                ack_timeout_seconds INTEGER DEFAULT %s,
                lock_token TEXT,
                locked_until TIMESTAMPTZ,
                consumer_id TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                dequeued_at TIMESTAMPTZ,
                acknowledged_at TIMESTAMPTZ,
                last_error TEXT,
                payload_size INTEGER DEFAULT 0,
                original_priority INTEGER,
                PRIMARY KEY (id, created_at)
            ) PARTITION BY RANGE (created_at)
        $sql$, partition_table_name, p_name, p_max_attempts, p_ack_timeout);

        -- Create index for partitioned table
        EXECUTE format($sql$
            CREATE INDEX IF NOT EXISTS %I
            ON %I(priority DESC, created_at ASC)
            WHERE status = 'queued'
        $sql$, partition_table_name || '_dequeue_idx', partition_table_name);
    END IF;

    RETURN new_queue;
END;
$$ LANGUAGE plpgsql;

-- Function to delete a queue
CREATE OR REPLACE FUNCTION delete_queue(p_name TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    queue_record queues;
    partition_table_name TEXT;
BEGIN
    -- Get queue info
    SELECT * INTO queue_record FROM queues WHERE name = p_name;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Queue not found: %', p_name;
    END IF;

    -- Delete messages based on queue type
    IF queue_record.queue_type = 'standard' THEN
        DELETE FROM messages WHERE queue_name = p_name;
    ELSIF queue_record.queue_type = 'unlogged' THEN
        DELETE FROM messages_unlogged WHERE queue_name = p_name;
    ELSIF queue_record.queue_type = 'partitioned' THEN
        partition_table_name := 'messages_partitioned_' || replace(p_name, '-', '_');
        EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', partition_table_name);
    END IF;

    -- Delete from activity logs and anomalies
    DELETE FROM activity_logs WHERE queue_name = p_name;
    DELETE FROM anomalies WHERE queue_name = p_name;

    -- Delete the queue record
    DELETE FROM queues WHERE name = p_name;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- ==================== CLEANUP FUNCTIONS ====================

-- Function to clean up old acknowledged/archived messages (batch delete for performance)
-- Uses batch deletion to avoid long-running transactions and reduce lock contention
CREATE OR REPLACE FUNCTION cleanup_old_messages(
    p_retention_hours INTEGER DEFAULT 168,  -- 7 days default
    p_batch_size INTEGER DEFAULT 1000,
    p_max_batches INTEGER DEFAULT 100
)
RETURNS TABLE(deleted_acknowledged INTEGER, deleted_archived INTEGER) AS $$
DECLARE
    total_ack INTEGER := 0;
    total_arch INTEGER := 0;
    batch_deleted INTEGER;
    batch_count INTEGER := 0;
    cutoff_time TIMESTAMPTZ;
BEGIN
    cutoff_time := NOW() - (p_retention_hours || ' hours')::INTERVAL;

    -- Delete acknowledged messages in batches
    LOOP
        EXIT WHEN batch_count >= p_max_batches;

        DELETE FROM messages
        WHERE id IN (
            SELECT id FROM messages
            WHERE status = 'acknowledged'
            AND acknowledged_at < cutoff_time
            LIMIT p_batch_size
            FOR UPDATE SKIP LOCKED
        );
        GET DIAGNOSTICS batch_deleted = ROW_COUNT;

        total_ack := total_ack + batch_deleted;
        batch_count := batch_count + 1;

        EXIT WHEN batch_deleted < p_batch_size;

        -- Small pause to reduce lock pressure
        PERFORM pg_sleep(0.01);
    END LOOP;

    -- Reset batch counter for archived messages
    batch_count := 0;

    -- Delete archived messages in batches
    LOOP
        EXIT WHEN batch_count >= p_max_batches;

        DELETE FROM messages
        WHERE id IN (
            SELECT id FROM messages
            WHERE status = 'archived'
            AND acknowledged_at < cutoff_time
            LIMIT p_batch_size
            FOR UPDATE SKIP LOCKED
        );
        GET DIAGNOSTICS batch_deleted = ROW_COUNT;

        total_arch := total_arch + batch_deleted;
        batch_count := batch_count + 1;

        EXIT WHEN batch_deleted < p_batch_size;

        PERFORM pg_sleep(0.01);
    END LOOP;

    deleted_acknowledged := total_ack;
    deleted_archived := total_arch;
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- Function to archive old acknowledged messages (move to archived status instead of delete)
CREATE OR REPLACE FUNCTION archive_old_messages(
    p_hours_old INTEGER DEFAULT 24,
    p_batch_size INTEGER DEFAULT 1000
)
RETURNS INTEGER AS $$
DECLARE
    archived_count INTEGER;
BEGIN
    UPDATE messages
    SET status = 'archived'
    WHERE id IN (
        SELECT id FROM messages
        WHERE status = 'acknowledged'
        AND acknowledged_at < NOW() - (p_hours_old || ' hours')::INTERVAL
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    );
    GET DIAGNOSTICS archived_count = ROW_COUNT;
    RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- ==================== REFERENTIAL INTEGRITY (OPTIONAL) ====================

-- Optional: Add foreign key constraint for queue_name
-- This ensures all messages reference a valid queue
-- Note: This adds overhead on INSERT/UPDATE, so only enable if data integrity is critical
-- To enable: SELECT enable_queue_fk_constraint();
-- To disable: SELECT disable_queue_fk_constraint();

CREATE OR REPLACE FUNCTION enable_queue_fk_constraint()
RETURNS VOID AS $$
BEGIN
    -- Add FK constraint if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_messages_queue'
    ) THEN
        ALTER TABLE messages
        ADD CONSTRAINT fk_messages_queue
        FOREIGN KEY (queue_name) REFERENCES queues(name)
        ON DELETE CASCADE;

        RAISE NOTICE 'Foreign key constraint fk_messages_queue enabled';
    ELSE
        RAISE NOTICE 'Foreign key constraint fk_messages_queue already exists';
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION disable_queue_fk_constraint()
RETURNS VOID AS $$
BEGIN
    -- Remove FK constraint if it exists
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_messages_queue'
    ) THEN
        ALTER TABLE messages DROP CONSTRAINT fk_messages_queue;
        RAISE NOTICE 'Foreign key constraint fk_messages_queue disabled';
    ELSE
        RAISE NOTICE 'Foreign key constraint fk_messages_queue does not exist';
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ==================== VIEWS ====================

-- View for queue status by queue name
CREATE OR REPLACE VIEW queue_status_by_queue AS
SELECT
    queue_name,
    status,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE priority = 0) as priority_0,
    COUNT(*) FILTER (WHERE priority = 1) as priority_1,
    COUNT(*) FILTER (WHERE priority = 2) as priority_2,
    COUNT(*) FILTER (WHERE priority = 3) as priority_3,
    COUNT(*) FILTER (WHERE priority = 4) as priority_4,
    COUNT(*) FILTER (WHERE priority = 5) as priority_5,
    COUNT(*) FILTER (WHERE priority = 6) as priority_6,
    COUNT(*) FILTER (WHERE priority = 7) as priority_7,
    COUNT(*) FILTER (WHERE priority = 8) as priority_8,
    COUNT(*) FILTER (WHERE priority = 9) as priority_9
FROM (
    SELECT queue_name, status, priority FROM messages
    UNION ALL
    SELECT queue_name, status, priority FROM messages_unlogged
) combined
GROUP BY queue_name, status;

-- View for queue status (all queues combined - backwards compatible)
CREATE OR REPLACE VIEW queue_status AS
SELECT
    status,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE priority = 0) as priority_0,
    COUNT(*) FILTER (WHERE priority = 1) as priority_1,
    COUNT(*) FILTER (WHERE priority = 2) as priority_2,
    COUNT(*) FILTER (WHERE priority = 3) as priority_3,
    COUNT(*) FILTER (WHERE priority = 4) as priority_4,
    COUNT(*) FILTER (WHERE priority = 5) as priority_5,
    COUNT(*) FILTER (WHERE priority = 6) as priority_6,
    COUNT(*) FILTER (WHERE priority = 7) as priority_7,
    COUNT(*) FILTER (WHERE priority = 8) as priority_8,
    COUNT(*) FILTER (WHERE priority = 9) as priority_9
FROM (
    SELECT status, priority FROM messages
    UNION ALL
    SELECT status, priority FROM messages_unlogged
) combined
GROUP BY status;

-- View for type distribution
CREATE OR REPLACE VIEW type_distribution AS
SELECT
    queue_name,
    type,
    status,
    COUNT(*) as count
FROM (
    SELECT queue_name, type, status FROM messages WHERE type IS NOT NULL
    UNION ALL
    SELECT queue_name, type, status FROM messages_unlogged WHERE type IS NOT NULL
) combined
GROUP BY queue_name, type, status
ORDER BY count DESC;
