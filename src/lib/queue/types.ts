import { PgConnectionManager } from "./pg-connection.js";
import { QueueConfig } from "./config.js";

// Context passed to all services
export interface QueueContext {
  pgManager: PgConnectionManager;
  config: QueueConfig;
}

export interface MessageInput {
  id?: string;
  type?: string;
  payload: any;
  custom_ack_timeout?: number;
  custom_max_attempts?: number;
  queue?: string;
  consumerId?: string;
}

export interface QueueDefinition {
  name: string;
  queue_type: "standard" | "unlogged" | "partitioned";
  ack_timeout_seconds: number;
  max_attempts: number;
  partition_interval: string | null;
  retention_interval: string | null;
  description: string | null;
  created_at: Date;
  updated_at: Date;
  message_count: number;
  processing_count: number;
  dead_count: number;
}

export interface CreateQueueInput {
  name: string;
  queue_type?: "standard" | "unlogged" | "partitioned";
  ack_timeout_seconds?: number;
  max_attempts?: number;
  partition_interval?: string;
  retention_interval?: string;
  description?: string;
}

export interface QueueMessage {
  id: string;
  queue_name: string;
  type: string | null;
  payload: any;
  priority: number;
  status: string;
  attempt_count: number;
  max_attempts: number;
  ack_timeout_seconds: number;
  lock_token: string | null;
  locked_until: Date | null;
  consumer_id: string | null;
  created_at: Date;
  dequeued_at: Date | null;
  acknowledged_at: Date | null;
  last_error: string | null;
  payload_size: number;
  processing_started_at?: number;
  _stream_name?: string;
  _stream_id?: string;
}

export interface DequeuedMessage extends QueueMessage {
  lock_token: string;
  dequeued_at: Date;
  processing_started_at: number;
}

export interface PaginatedMessages {
  messages: QueueMessage[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasMore: boolean;
  };
}

export interface QueueStatus {
  mainQueue: { length: number; messages: QueueMessage[] };
  processingQueue: { length: number; messages: QueueMessage[] };
  deadLetterQueue: { length: number; messages: QueueMessage[] };
  acknowledgedQueue: { length: number; messages: QueueMessage[] };
  archivedQueue: { length: number; messages: QueueMessage[] };
  totalAcknowledged: number;
  availableTypes: string[];
  priorities: Record<number, number>;
}

export interface ActivityLogEntry {
  id: number;
  action: string;
  message_id: string | null;
  message_type: string | null;
  consumer_id: string | null;
  context: any;
  payload_size: number | null;
  queue_type: string | null;
  processing_time_ms: number | null;
  attempt_count: number | null;
  created_at: Date;
}

export interface Anomaly {
  id: number;
  type: string;
  severity: string;
  message_id: string | null;
  consumer_id: string | null;
  details: any;
  created_at: Date;
}

// Operation result types
export type AckResult =
  | boolean
  | { success: false; error: string; code?: string };

export interface TouchResult {
  success: boolean;
  error?: string;
  new_timeout_at?: number;
  lock_token?: string;
  not_found?: boolean;
}

// Activity log filters
export interface ActivityLogFilters {
  action?: string;
  messageId?: string;
  consumerId?: string;
  queueName?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

// Anomaly filters
export interface AnomalyFilters {
  type?: string;
  severity?: string;
  queueName?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
}

// Message query params
export interface MessageQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  type?: string;
  filterType?: string;
  filterPriority?: string;
  filterAttempts?: string;
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortOrder?: string;
  queueName?: string;
}

// Move messages options
export interface MoveMessagesOptions {
  errorReason?: string;
  consumerId?: string;
}

// Update message options
export interface UpdateMessageOptions {
  payload?: any;
  priority?: number;
  type?: string;
}

// Update queue config options
export interface UpdateQueueConfigOptions {
  ack_timeout_seconds?: number;
  max_attempts?: number;
  description?: string;
}
