// ============================================================================
// Activity Log Types
// ============================================================================

export interface ActivityAnomaly {
    type: string
    severity: 'critical' | 'warning' | 'info'
    description: string
    threshold?: number
    actual?: number
}

export interface ActivityLogEntry {
    log_id: string
    message_id: string | null
    action: string
    timestamp: number
    queue: string
    source_queue: string | null
    dest_queue: string | null
    priority: number
    message_type: string | null
    consumer_id: string | null
    prev_consumer_id: string | null
    lock_token: string | null
    prev_lock_token: string | null
    attempt_count: number | null
    max_attempts: number | null
    attempts_remaining: number | null
    message_created_at: number | null
    message_age_ms: number | null
    time_in_queue_ms: number | null
    processing_time_ms: number | null
    total_processing_time_ms: number | null
    payload_size_bytes: number | null
    redis_operation_ms: number | null
    queue_depth: number | null
    processing_depth: number | null
    dlq_depth: number | null
    error_reason: string | null
    error_code: string | null
    triggered_by: string
    user_id: string | null
    reason: string | null
    batch_id: string | null
    batch_size: number | null
    prev_action: string | null
    prev_timestamp: number | null
    payload?: any
    anomaly: ActivityAnomaly | null
}

export interface ActivityLogsResponse {
    logs: ActivityLogEntry[]
    pagination: {
        total: number
        limit: number
        offset: number
        has_more: boolean
    }
}

export interface ActivityLogsFilter {
    action: string
    message_id: string
    has_anomaly: boolean | null
    limit: number
    offset: number
}

export interface AnomaliesResponse {
    anomalies: ActivityLogEntry[]
    summary: {
        total: number
        by_type: Record<string, number>
        by_severity: {
            critical: number
            warning: number
            info: number
        }
    }
}

export interface MessageHistoryResponse {
    message_id: string
    history: ActivityLogEntry[]
}

export interface ConsumerStatsResponse {
    stats: Record<string, {
        last_dequeue: number
        dequeue_count: number
    }>
}

// ============================================================================
// Constants
// ============================================================================

export const ACTION_OPTIONS = ['enqueue', 'dequeue', 'ack', 'nack', 'move', 'delete', 'clear', 'touch', 'timeout', 'requeue', 'dlq'] as const

export const ACTION_COLORS: Record<string, string> = {
    enqueue: 'bg-green-500/10 text-green-500 border-green-500/20',
    dequeue: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
    ack: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    nack: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    move: 'bg-purple-500/10 text-purple-500 border-purple-500/20',
    delete: 'bg-red-500/10 text-red-500 border-red-500/20',
    clear: 'bg-red-500/10 text-red-500 border-red-500/20',
    touch: 'bg-sky-500/10 text-sky-500 border-sky-500/20',
    timeout: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
    requeue: 'bg-indigo-500/10 text-indigo-500 border-indigo-500/20',
    dlq: 'bg-red-500/10 text-red-500 border-red-500/20',
}
