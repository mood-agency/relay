export { QueueConfig } from "./config.js";
export { PostgresQueue } from "./pg-queue.js";
export { PgConnectionManager } from "./pg-connection.js";
export { createLogger, generateId } from "./utils.js";

// Re-export types from dedicated types file
export type {
  MessageInput,
  QueueMessage,
  DequeuedMessage,
  PaginatedMessages,
  QueueStatus,
  ActivityLogEntry,
  Anomaly,
  QueueDefinition,
  CreateQueueInput,
  QueueContext,
  AckResult,
  TouchResult,
  ActivityLogFilters,
  AnomalyFilters,
  MessageQueryParams,
  MoveMessagesOptions,
  UpdateMessageOptions,
  UpdateQueueConfigOptions,
} from "./types.js";

// Export helper functions if consumers need them
export { mapMessage, getTableName, STATUS_MAP } from "./helpers.js";

// Export individual services for advanced use cases
export {
  QueueManagementService,
  ProducerService,
  ConsumerService,
  AdminService,
  MetricsService,
  ActivityService,
  AnomalyService,
} from "./services/index.js";
