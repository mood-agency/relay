import { QueueMessage } from "./types.js";

/**
 * Get the correct table name based on queue type
 */
export function getTableName(queueType: string): string {
  switch (queueType) {
    case "unlogged":
      return "messages_unlogged";
    case "partitioned":
      return "messages";
    default:
      return "messages";
  }
}

/**
 * Map database row to QueueMessage format
 * Converts dates to Unix timestamps for dashboard compatibility
 */
export function mapMessage(row: any): QueueMessage {
  const created_at = row.created_at
    ? Math.floor(new Date(row.created_at).getTime() / 1000)
    : null;
  const dequeued_at = row.dequeued_at
    ? Math.floor(new Date(row.dequeued_at).getTime() / 1000)
    : null;
  const acknowledged_at = row.acknowledged_at
    ? Math.floor(new Date(row.acknowledged_at).getTime() / 1000)
    : null;

  return {
    id: row.id,
    queue_name: row.queue_name || "default",
    type: row.type,
    payload:
      typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
    priority: row.priority,
    status: row.status,
    attempt_count: row.attempt_count,
    max_attempts: row.max_attempts,
    ack_timeout_seconds: row.ack_timeout_seconds,
    lock_token: row.lock_token,
    locked_until: row.locked_until,
    consumer_id: row.consumer_id,
    created_at: created_at,
    dequeued_at: dequeued_at,
    acknowledged_at: acknowledged_at,
    last_error: row.last_error,
    payload_size: row.payload_size,
    processing_started_at: dequeued_at || undefined,
    _stream_name: `queue_${row.status}`,
    _stream_id: row.id,
  } as any;
}

/**
 * Status mapping for queue type to database status
 */
export const STATUS_MAP: Record<string, string> = {
  main: "queued",
  processing: "processing",
  dead: "dead",
  acknowledged: "acknowledged",
  archived: "archived",
  dlq: "dead",
};
