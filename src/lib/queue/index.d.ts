import { Redis, Pipeline } from "ioredis";

export interface QueueConfigI {
  redis_host: string;
  redis_port: number;
  redis_db: number;
  redis_password?: string | null;
  queue_name: string;
  processing_queue_name: string;
  dead_letter_queue_name: string;
  archived_queue_name: string;
  acknowledged_queue_name: string;
  total_acknowledged_key: string;
  metadata_hash_name: string;
  consumer_group_name: string;
  consumer_name: string;
  ack_timeout_seconds: number;
  max_attempts: number;
  requeue_batch_size: number;
  max_acknowledged_history: number;
  connection_pool_size: number;
  max_priority_levels: number;
  enable_message_encryption: boolean;
  secret_key?: string | null;
  events_channel: string;
  // Activity Log Config
  activity_log_enabled: boolean;
  activity_log_stream_name: string;
  activity_log_max_entries: number;
  activity_log_retention_hours: number;
  activity_burst_threshold_count: number;
  activity_burst_threshold_seconds: number;
  activity_flash_message_threshold_ms: number;
  activity_zombie_message_threshold_hours: number;
  activity_long_processing_multiplier: number;
  activity_near_dlq_threshold: number;
  activity_bulk_operation_threshold: number;
  activity_large_payload_bytes: number;
  activity_queue_growth_threshold: number;
  activity_dlq_spike_threshold: number;
}

export class QueueConfig {
  constructor(config: any);
  redis_host: string;
  redis_port: number;
  redis_db: number;
  redis_password: string | null;
  queue_name: string;
  processing_queue_name: string;
  dead_letter_queue_name: string;
  archived_queue_name: string;
  acknowledged_queue_name: string;
  total_acknowledged_key: string;
  metadata_hash_name: string;
  consumer_group_name: string;
  consumer_name: string;
  ack_timeout_seconds: number;
  max_attempts: number;
  requeue_batch_size: number;
  max_acknowledged_history: number;
  connection_pool_size: number;
  max_priority_levels: number;
  enable_message_encryption: boolean;
  secret_key: string | null;
  events_channel: string;
}

export interface DequeuedMessage {
  id: string;
  type: string;
  payload: any;
  priority: number;
  created_at: number;
  consumer_id?: string | null;
  _stream_id: string;
  _stream_name: string;
  [key: string]: any;
}

export class RedisConnectionManager {
  constructor(config: QueueConfig);
  redis: Redis;
  subscriber: Redis;
  pipeline(): Pipeline;
}

export interface QueueStatus {
  mainQueue: {
    name: string;
    length: number;
    messages: any[];
    priority_levels: number;
  };
  processingQueue: {
    name: string;
    length: number;
    messages: any[];
  };
  deadLetterQueue: {
    name: string;
    length: number;
    messages: any[];
  };
  acknowledgedQueue: {
    name: string;
    length: number;
    messages: any[];
    total: number;
  };
  archivedQueue: {
    name: string;
    length: number;
    messages: any[];
  };
  metadata: {
    totalProcessed: number;
    totalFailed: number;
    totalAcknowledged: number;
  };
  availableTypes: string[];
}

export interface PaginatedMessages {
  messages: any[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface QueueMetrics {
  main_queue_size: number;
  processing_queue_size: number;
  dead_letter_queue_size: number;
  acknowledged_queue_size: number;
  archived_queue_size: number;
  total_acknowledged: number;
  metadata_count: number;
  priority_levels: number;
  details: Record<string, number>;
  stats: {
    enqueued: number;
    dequeued: number;
    acknowledged: number;
    failed: number;
    requeued: number;
  };
}

export class OptimizedRedisQueue {
  constructor(config: QueueConfig);
  config: QueueConfig;
  redisManager: RedisConnectionManager;
  _stats: {
    enqueued: number;
    dequeued: number;
    acknowledged: number;
    failed: number;
    requeued: number;
  };

  // Helpers
  publishEvent(type: string, payload?: any): Promise<void>;
  _getManualStreamName(): string;
  _getPriorityStreamName(priority: number): string;
  _getAllPriorityStreams(): string[];
  _getAllMainQueueStreams(): string[];
  _serializeMessage(message: any): string;
  _deserializeMessage(messageJson: string): any;

  // Producer
  enqueueMessage(messageData: any, priority?: number): Promise<boolean>;
  enqueueBatch(messages: any[]): Promise<number>;

  // Consumer
  dequeueMessage(timeout?: number, ackTimeout?: number | null, specificStreams?: string[] | null, type?: string | null, consumerId?: string | null): Promise<DequeuedMessage | null>;
  acknowledgeMessage(message: DequeuedMessage | { id: string, _stream_id: string, _stream_name: string, lock_token?: string }): Promise<boolean | { success: false, error: string }>;
  nackMessage(messageId: string, errorReason?: string): Promise<boolean>;
  touchMessage(messageId: string, lockToken: string, extendSeconds?: number): Promise<{ success: boolean, error?: string, new_timeout_at?: number, extended_by?: number, lock_token?: string }>;
  requeueFailedMessages(): Promise<number>;

  // Admin
  moveMessages(messages: any[], fromQueue: string, toQueue: string, options?: { errorReason?: string }): Promise<number>;
  getMessagesByDateRange(startTimestamp: number, endTimestamp: number, limit: number): Promise<any[]>;
  removeMessagesByDateRange(startTimestamp: number, endTimestamp: number): Promise<number>;
  deleteMessages(messageIds: string[], queueType: string): Promise<number>;
  deleteMessage(messageId: string, queueType: string): Promise<{ success: boolean; messageId: string; queueType: string; message: string }>;
  updateMessage(messageId: string, queueType: string, updates: any): Promise<any>;
  getQueueMessages(queueType: string, params?: any): Promise<PaginatedMessages>;
  getQueueStatus(typeFilter?: string | null, includeMessages?: boolean): Promise<QueueStatus>;
  clearAllQueues(): Promise<boolean>;
  clearQueue(queueType: string): Promise<boolean>;

  // Metrics
  getMetrics(): Promise<QueueMetrics>;
  healthCheck(): Promise<any>;

  // Activity Log
  logActivity(action: string, messageData: any, context?: ActivityLogContext): Promise<string | null>;
  getActivityLogs(filters?: ActivityLogFilters): Promise<ActivityLogsResult>;
  getMessageHistory(messageId: string): Promise<ActivityLogEntry[]>;
  getAnomalies(filters?: AnomalyFilters): Promise<AnomaliesResult>;
  getConsumerStats(consumerId?: string): Promise<any>;
}

// Activity Log Types
export interface ActivityLogEntry {
  log_id: string;
  message_id: string | null;
  action: 'enqueue' | 'dequeue' | 'ack' | 'nack' | 'timeout' | 'requeue' | 'dlq' | 'touch' | 'move' | 'delete' | 'clear';
  timestamp: number;
  queue: string;
  source_queue: string | null;
  dest_queue: string | null;
  priority: number;
  message_type: string | null;
  consumer_id: string | null;
  prev_consumer_id: string | null;
  lock_token: string | null;
  prev_lock_token: string | null;
  attempt_count: number | null;
  max_attempts: number | null;
  attempts_remaining: number | null;
  message_created_at: number | null;
  message_age_ms: number | null;
  time_in_queue_ms: number | null;
  processing_time_ms: number | null;
  total_processing_time_ms: number | null;
  payload_size_bytes: number | null;
  redis_operation_ms: number | null;
  queue_depth: number | null;
  processing_depth: number | null;
  dlq_depth: number | null;
  error_reason: string | null;
  error_code: string | null;
  triggered_by: string;
  user_id: string | null;
  reason: string | null;
  batch_id: string | null;
  batch_size: number | null;
  prev_action: string | null;
  prev_timestamp: number | null;
  payload: any;
  anomaly: Anomaly | null;
}

export interface Anomaly {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  description: string;
  all_anomalies?: Anomaly[];
}

export interface ActivityLogContext {
  queue?: string;
  source_queue?: string;
  dest_queue?: string;
  priority?: number;
  message_type?: string;
  consumer_id?: string;
  prev_consumer_id?: string;
  lock_token?: string;
  prev_lock_token?: string;
  attempt_count?: number;
  max_attempts?: number;
  time_in_queue_ms?: number;
  processing_time_ms?: number;
  total_processing_time_ms?: number;
  payload_size_bytes?: number;
  redis_operation_ms?: number;
  queue_depth?: number;
  processing_depth?: number;
  dlq_depth?: number;
  error_reason?: string;
  error_code?: string;
  triggered_by?: string;
  user_id?: string;
  reason?: string;
  batch_id?: string;
  batch_size?: number;
  prev_action?: string;
  prev_timestamp?: number;
  message_id?: string;
}

export interface ActivityLogFilters {
  message_id?: string;
  consumer_id?: string;
  action?: string | string[];
  has_anomaly?: boolean;
  anomaly_type?: string;
  start_time?: number;
  end_time?: number;
  limit?: number;
  offset?: number;
}

export interface ActivityLogsResult {
  logs: ActivityLogEntry[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

export interface AnomalyFilters {
  severity?: 'info' | 'warning' | 'critical';
  type?: string;
  action?: string | string[];
  start_time?: number;
  end_time?: number;
  limit?: number;
  sort_by?: 'severity' | 'type' | 'action' | 'timestamp';
  sort_order?: 'asc' | 'desc';
}

export interface AnomaliesResult {
  anomalies: ActivityLogEntry[];
  summary: {
    total: number;
    by_type: Record<string, number>;
    by_severity: {
      critical: number;
      warning: number;
      info: number;
    };
  };
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}
