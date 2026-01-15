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
    original_priority INTEGER,

    -- Encryption/signature support
    encryption JSONB,
    signature TEXT
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

-- Function to notify on message changes (for SSE)
CREATE OR REPLACE FUNCTION notify_message_change()
RETURNS TRIGGER AS $$
DECLARE
    notify_payload JSONB;
BEGIN
    IF TG_OP = 'INSERT' THEN
        notify_payload := jsonb_build_object(
            'type', 'enqueue',
            'queue', NEW.queue_name,
            'timestamp', extract(epoch from NOW()) * 1000,
            'payload', jsonb_build_object(
                'count', 1,
                'message', jsonb_build_object(
                    'id', NEW.id,
                    'type', NEW.type,
                    'priority', NEW.priority,
                    'payload', NEW.payload
                )
            )
        );
        PERFORM pg_notify('queue_events', notify_payload::text);
    ELSIF TG_OP = 'UPDATE' THEN
        -- Status change notifications
        IF OLD.status != NEW.status THEN
            IF NEW.status = 'acknowledged' THEN
                notify_payload := jsonb_build_object(
                    'type', 'acknowledge',
                    'queue', NEW.queue_name,
                    'timestamp', extract(epoch from NOW()) * 1000,
                    'payload', jsonb_build_object(
                        'count', 1,
                        'message', jsonb_build_object(
                            'id', NEW.id,
                            'type', NEW.type
                        )
                    )
                );
            ELSIF NEW.status = 'dead' THEN
                notify_payload := jsonb_build_object(
                    'type', 'move_to_dlq',
                    'queue', NEW.queue_name,
                    'timestamp', extract(epoch from NOW()) * 1000,
                    'payload', jsonb_build_object(
                        'count', 1,
                        'message', jsonb_build_object(
                            'id', NEW.id,
                            'type', NEW.type
                        )
                    )
                );
            ELSIF NEW.status = 'queued' AND OLD.status = 'processing' THEN
                notify_payload := jsonb_build_object(
                    'type', 'requeue',
                    'queue', NEW.queue_name,
                    'timestamp', extract(epoch from NOW()) * 1000,
                    'payload', jsonb_build_object(
                        'count', 1,
                        'triggered_by', 'timeout'
                    )
                );
            ELSIF NEW.status = 'processing' THEN
                notify_payload := jsonb_build_object(
                    'type', 'dequeue',
                    'queue', NEW.queue_name,
                    'timestamp', extract(epoch from NOW()) * 1000,
                    'payload', jsonb_build_object(
                        'count', 1,
                        'message', jsonb_build_object(
                            'id', NEW.id,
                            'type', NEW.type
                        )
                    )
                );
            END IF;
            IF notify_payload IS NOT NULL THEN
                PERFORM pg_notify('queue_events', notify_payload::text);
            END IF;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        notify_payload := jsonb_build_object(
            'type', 'delete',
            'queue', OLD.queue_name,
            'timestamp', extract(epoch from NOW()) * 1000,
            'payload', jsonb_build_object(
                'count', 1,
                'message', jsonb_build_object(
                    'id', OLD.id,
                    'type', OLD.type
                )
            )
        );
        PERFORM pg_notify('queue_events', notify_payload::text);
    END IF;

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

-- Function to clean up old activity logs (retention)
CREATE OR REPLACE FUNCTION cleanup_old_activity_logs(retention_hours INTEGER DEFAULT 24)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM activity_logs
    WHERE created_at < NOW() - (retention_hours || ' hours')::INTERVAL;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to clean up old anomalies
CREATE OR REPLACE FUNCTION cleanup_old_anomalies(retention_hours INTEGER DEFAULT 72)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM anomalies
    WHERE created_at < NOW() - (retention_hours || ' hours')::INTERVAL;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
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
