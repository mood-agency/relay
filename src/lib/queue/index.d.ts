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
  dequeueMessage(timeout?: number, ackTimeout?: number | null, specificStreams?: string[] | null): Promise<DequeuedMessage | null>;
  acknowledgeMessage(message: DequeuedMessage | { id: string, _stream_id: string, _stream_name: string }): Promise<boolean>;
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
}
