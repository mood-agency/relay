import { PgConnectionManager, PgConnectionConfig } from "./pg-connection.js";
import { QueueConfig } from "./config.js";
import { createLogger } from "./utils.js";
import {
  QueueContext,
  MessageInput,
  QueueDefinition,
  CreateQueueInput,
  QueueMessage,
  DequeuedMessage,
  PaginatedMessages,
  QueueStatus,
  ActivityLogEntry,
  AckResult,
  TouchResult,
  MessageQueryParams,
  MoveMessagesOptions,
  UpdateMessageOptions,
  UpdateQueueConfigOptions,
  ActivityLogFilters,
  AnomalyFilters,
} from "./types.js";
import {
  QueueManagementService,
  ProducerService,
  ConsumerService,
  AdminService,
  MetricsService,
  ActivityService,
  AnomalyService,
  EventEmitterService,
} from "./services/index.js";

const logger = createLogger("pg-queue");

// Re-export types for backward compatibility
export type {
  MessageInput,
  QueueDefinition,
  CreateQueueInput,
  QueueMessage,
  DequeuedMessage,
  PaginatedMessages,
  QueueStatus,
  ActivityLogEntry,
  Anomaly,
} from "./types.js";

export class PostgresQueue {
  public pgManager: PgConnectionManager;
  public config: QueueConfig;
  public eventEmitter: EventEmitterService;

  private ctx: QueueContext;
  private queueManagement: QueueManagementService;
  private producer: ProducerService;
  private consumer: ConsumerService;
  private admin: AdminService;
  private metrics: MetricsService;
  private activity: ActivityService;
  private anomaly: AnomalyService;

  constructor(config: QueueConfig) {
    this.config = config;

    const pgConfig: PgConnectionConfig = {
      host: (config as any).postgres_host || "localhost",
      port: (config as any).postgres_port || 5432,
      database: (config as any).postgres_database || "relay",
      user: (config as any).postgres_user || "postgres",
      password: (config as any).postgres_password || "",
      max: (config as any).postgres_pool_size || 10,
      ssl: (config as any).postgres_ssl || false,
    };

    this.pgManager = new PgConnectionManager(pgConfig);

    this.ctx = { pgManager: this.pgManager, config: this.config };

    // Initialize services - order matters for dependencies
    this.activity = new ActivityService(this.ctx);
    this.anomaly = new AnomalyService(this.ctx);

    this.queueManagement = new QueueManagementService(
      this.ctx,
      this.activity.logActivity.bind(this.activity)
    );

    this.producer = new ProducerService(
      this.ctx,
      this.queueManagement.getQueueConfig.bind(this.queueManagement),
      this.activity.logActivity.bind(this.activity),
      this.activity.logActivityBatch.bind(this.activity),
      this.anomaly.runDetection.bind(this.anomaly)
    );

    this.consumer = new ConsumerService(
      this.ctx,
      this.queueManagement.getQueueConfig.bind(this.queueManagement),
      this.activity.logActivity.bind(this.activity),
      this.activity.logActivityBatch.bind(this.activity),
      this.anomaly.runDetection.bind(this.anomaly),
      this.anomaly.recordAnomalyBatch.bind(this.anomaly),
      this.anomaly.updateConsumerStats.bind(this.anomaly),
      this.anomaly.checkBurstDequeue.bind(this.anomaly)
    );

    this.admin = new AdminService(
      this.ctx,
      this.activity.logActivity.bind(this.activity),
      this.activity.logActivityBatch.bind(this.activity),
      this.anomaly.runDetection.bind(this.anomaly)
    );

    this.metrics = new MetricsService(this.ctx);

    // Event emitter for SSE (polling-based, works with serverless PostgreSQL like Neon)
    this.eventEmitter = new EventEmitterService(
      (text: string, params?: unknown[]) => this.pgManager.query(text, params),
      1000 // Poll every 1 second
    );
  }

  // ==================== QUEUE MANAGEMENT ====================

  createQueue(input: CreateQueueInput): Promise<QueueDefinition> {
    return this.queueManagement.createQueue(input);
  }

  listQueues(): Promise<QueueDefinition[]> {
    return this.queueManagement.listQueues();
  }

  getQueueByName(
    name: string,
    options?: { includeStats?: boolean }
  ): Promise<QueueDefinition | null> {
    return this.queueManagement.getQueueByName(name, options);
  }

  updateQueueConfig(
    name: string,
    updates: UpdateQueueConfigOptions
  ): Promise<QueueDefinition | null> {
    return this.queueManagement.updateQueueConfig(name, updates);
  }

  deleteQueueByName(
    name: string,
    force: boolean = false
  ): Promise<{ deleted_messages: number }> {
    return this.queueManagement.deleteQueueByName(name, force);
  }

  renameQueue(oldName: string, newName: string): Promise<QueueDefinition> {
    return this.queueManagement.renameQueue(oldName, newName);
  }

  purgeQueue(name: string, status: string = "all"): Promise<number> {
    return this.queueManagement.purgeQueue(name, status);
  }

  // ==================== PRODUCER ====================

  enqueueMessage(
    messageData: MessageInput,
    priority: number = 0
  ): Promise<QueueMessage> {
    return this.producer.enqueueMessage(messageData, priority);
  }

  enqueueBatch(
    messages: MessageInput[],
    priority: number = 0,
    queueName: string = "default",
    consumerId?: string
  ): Promise<QueueMessage[]> {
    return this.producer.enqueueBatch(messages, priority, queueName, consumerId);
  }

  // ==================== CONSUMER ====================

  dequeueMessage(
    timeout: number = 0,
    ackTimeout?: number | null,
    queueName: string = "default",
    type?: string | null,
    consumerId?: string | null
  ): Promise<DequeuedMessage | null> {
    return this.consumer.dequeueMessage(
      timeout,
      ackTimeout,
      queueName,
      type,
      consumerId
    );
  }

  acknowledgeMessage(ackPayload: {
    id: string;
    lock_token?: string;
  }): Promise<AckResult> {
    return this.consumer.acknowledgeMessage(ackPayload);
  }

  nackMessage(
    messageId: string,
    lockToken?: string,
    errorReason?: string
  ): Promise<AckResult> {
    return this.consumer.nackMessage(messageId, lockToken, errorReason);
  }

  touchMessage(
    messageId: string,
    lockToken: string,
    extendSeconds?: number
  ): Promise<TouchResult> {
    return this.consumer.touchMessage(messageId, lockToken, extendSeconds);
  }

  requeueFailedMessages(): Promise<number> {
    return this.consumer.requeueFailedMessages();
  }

  // ==================== ADMIN ====================

  moveMessages(
    messageIds: string[],
    fromQueue: string,
    toQueue: string,
    options?: MoveMessagesOptions
  ): Promise<number> {
    return this.admin.moveMessages(messageIds, fromQueue, toQueue, options);
  }

  getQueueMessages(
    queueType: string,
    params: MessageQueryParams = {}
  ): Promise<PaginatedMessages> {
    return this.admin.getQueueMessages(queueType, params);
  }

  deleteMessage(
    messageId: string,
    queueType?: string
  ): Promise<{ success: boolean }> {
    return this.admin.deleteMessage(messageId, queueType);
  }

  deleteMessages(messageIds: string[], queueType?: string): Promise<number> {
    return this.admin.deleteMessages(messageIds, queueType);
  }

  updateMessage(
    messageId: string,
    queueType: string,
    updates: UpdateMessageOptions
  ): Promise<QueueMessage | null> {
    return this.admin.updateMessage(messageId, queueType, updates);
  }

  clearQueue(queueType: string): Promise<boolean> {
    return this.admin.clearQueue(queueType);
  }

  clearAllQueues(): Promise<boolean> {
    return this.admin.clearAllQueues();
  }

  // ==================== METRICS ====================

  getQueueStatus(
    typeFilter?: string | null,
    includeMessages: boolean = true,
    queueName?: string
  ): Promise<QueueStatus> {
    return this.metrics.getQueueStatus(typeFilter, includeMessages, queueName);
  }

  getMetrics(): Promise<any> {
    return this.metrics.getMetrics();
  }

  healthCheck(): Promise<any> {
    return this.metrics.healthCheck();
  }

  // ==================== ACTIVITY LOGGING ====================

  logActivity(
    action: string,
    messageData: any,
    context: any
  ): Promise<number | null> {
    return this.activity.logActivity(action, messageData, context);
  }

  getActivityLogs(filters: ActivityLogFilters = {}): Promise<{
    logs: any[];
    total: number;
    pagination: {
      total: number;
      limit: number;
      offset: number;
      has_more: boolean;
      hasMore: boolean;
    };
  }> {
    return this.activity.getActivityLogs(filters);
  }

  getMessageHistory(messageId: string): Promise<ActivityLogEntry[]> {
    return this.activity.getMessageHistory(messageId);
  }

  // ==================== ANOMALY ====================

  getAnomalies(filters: AnomalyFilters = {}): Promise<{
    anomalies: any[];
    summary: {
      total: number;
      by_type: Record<string, number>;
      by_severity: { critical: number; warning: number; info: number };
    };
  }> {
    return this.anomaly.getAnomalies(filters);
  }

  getConsumerStats(consumerId?: string): Promise<any> {
    return this.anomaly.getConsumerStats(consumerId);
  }

  clearActivityLogs(): Promise<boolean> {
    return this.anomaly.clearActivityLogs();
  }

  /**
   * Get the anomaly detector registry for custom configuration.
   * Use this to register custom detectors or enable/disable built-in ones.
   *
   * @example
   * ```typescript
   * const registry = queue.getAnomalyDetectorRegistry();
   *
   * // Disable a built-in detector
   * registry.setEnabled('flash_message', false);
   *
   * // Register a custom detector
   * registry.register({
   *   name: 'my_custom_detector',
   *   description: 'Detects custom anomaly patterns',
   *   events: ['dequeue'],
   *   enabledByDefault: true,
   *   async detect(context) {
   *     // Your detection logic here
   *     return null;
   *   }
   * });
   * ```
   */
  getAnomalyDetectorRegistry() {
    return this.anomaly.getRegistry();
  }

  // ==================== UTILITY ====================

  async publishEvent(type: string, payload?: any): Promise<void> {
    await this.pgManager.notify("queue_events", {
      type,
      timestamp: Date.now(),
      payload: payload || {},
    });
  }

  async disconnect(): Promise<void> {
    await this.pgManager.disconnect();
  }
}
