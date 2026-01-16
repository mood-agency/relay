import { createRoute, z } from "@hono/zod-openapi";
import { jsonContent, jsonContentRequired } from "stoker/openapi/helpers";
import { createErrorSchema } from "stoker/openapi/schemas";
import {
  notFoundSchema,
  paginationSchema,
  UUIDParamsSchema,
} from "../../utils/schemas.utils";

const tags = ["Queue"];

/* 

Now you can use the API with these endpoints:
POST /queue/message - Enqueue a message
POST /queue/batch - Enqueue multiple messages
GET /queue/message?timeout=30 - Get a message from the queue
POST /queue/ack - Acknowledge message processing
GET /queue/metrics - Get queue metrics
*/

export const QueueMessageSchema = z.object({
  type: z.string(),
  payload: z.any(),
  priority: z.number().optional(),
  ackTimeout: z.number().optional(),
  maxAttempts: z.number().int().positive().optional(),
  queue: z.string().optional().describe("Target queue name (defaults to 'default')"),
  consumerId: z.string().optional().describe("Consumer/producer identifier for activity logging"),
});

export type QueueMessage = z.infer<typeof QueueMessageSchema>;

export const DequeuedMessageSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.any(),
  created_at: z.number(),
  priority: z.number().optional(),
  custom_ack_timeout: z.number().optional(),
  custom_max_attempts: z.number().optional(),
  attempt_count: z.number(),
  dequeued_at: z.number().nullable(),
  last_error: z.string().nullable(),
  processing_duration: z.number().optional(),
  acknowledged_at: z.number().optional(),
  consumer_id: z.string().nullable().optional(),
  lock_token: z.string().optional().describe("Unique fencing token for lock ownership - use this for ACK and touch operations"),
  _stream_id: z.string().optional(),
  _stream_name: z.string().optional(),
});

export type DequeuedMessage = z.infer<typeof DequeuedMessageSchema>;

export const AcknowledgedMessageSchema = z.object({
  id: z.string().describe("Message ID"),
  lock_token: z.string().optional().describe("Fencing token - if provided, ACK will be rejected if it doesn't match (prevents stale ACKs after re-queue)"),
});

export type AcknowledgedMessage = z.infer<typeof AcknowledgedMessageSchema>;

export const addMessage = createRoute({
  path: "/queue/message",
  method: "post",
  tags,
  request: {
    body: jsonContentRequired(QueueMessageSchema, "Queue Message"),
  },
  responses: {
    201: jsonContent(
      z.object({ message: z.string() }),
      "Queue Message Added Successfully"
    ),
    422: jsonContent(createErrorSchema(QueueMessageSchema), "Validation Error"),
    500: jsonContent(
      z.object({ message: z.string() }),
      "Internal Server Error"
    ),
  },
});

export const addBatch = createRoute({
  path: "/queue/batch",
  method: "post",
  tags,
  request: {
    body: jsonContentRequired(z.array(QueueMessageSchema), "Queue Message"),
  },
  responses: {
    201: jsonContent(
      z.object({
        message: z.string(),
      }),
      "Batch Added Successfully"
    ),
    422: jsonContent(
      createErrorSchema(z.array(QueueMessageSchema)),
      "Validation Error"
    ),
  },
});


export const getMessage = createRoute({
  path: "/queue/message",
  method: "get",
  tags,
  request: {
    query: z.object({
      timeout: z.string().pipe(z.coerce.number()).optional(),
      ackTimeout: z.string().pipe(z.coerce.number()).optional(),
      type: z.string().optional(),
      consumerId: z.string().optional(),
      queue: z.string().optional().describe("Target queue name (defaults to 'default')"),
    }),
  },
  responses: {
    200: jsonContent(DequeuedMessageSchema, "Queue Message"),
    404: jsonContent(z.object({ message: z.string() }), "Message not found"),
    422: jsonContent(
      createErrorSchema(z.object({
        timeout: z.number().optional(),
        ackTimeout: z.number().optional(),
        type: z.string().optional(),
        consumerId: z.string().optional()
      })),
      "Validation Error"
    ),
  },
});

export const acknowledgeMessage = createRoute({
  path: "/queue/ack",
  method: "post",
  tags,
  request: {
    body: jsonContentRequired(
      AcknowledgedMessageSchema,
      "Acknowledged Message"
    ),
  },
  responses: {
    200: jsonContent(z.object({ message: z.string() }), "Message Acknowledged"),
    400: jsonContent(
      z.object({ message: z.string() }),
      "Message not acknowledged"
    ),
    409: jsonContent(
      z.object({
        message: z.string(),
        error: z.literal("LOCK_LOST"),
      }),
      "Lock Lost - lock_token mismatch (message was re-queued and picked up by another worker)"
    ),
    422: jsonContent(
      createErrorSchema(AcknowledgedMessageSchema),
      "Validation Error"
    ),
  },
});

export const metrics = createRoute({
  path: "/queue/metrics",
  method: "get",
  tags,
  responses: {
    200: jsonContent(
      z.object({
        totalMessages: z.number(),
        totalMessagesProcessed: z.number(),
        totalMessagesFailed: z.number(),
        totalMessagesAcknowledged: z.number(),
        totalMessagesRequeued: z.number(),
      }),
      "Queue Metrics"
    ),
  },
});

export const healthCheck = createRoute({
  path: "/health",
  method: "get",
  tags,
  responses: {
    200: jsonContent(z.object({ status: z.string() }), "Health Check"),
    500: jsonContent(z.object({ status: z.string() }), "Internal Server Error"),
  },
});

export const nackMessage = createRoute({
  path: "/queue/message/:messageId/nack",
  method: "post",
  tags,
  request: {
    params: z.object({
      messageId: z.string(),
    }),
    body: jsonContent(
      z.object({
        errorReason: z.string().optional(),
      }),
      "Nack Message"
    ),
  },
  responses: {
    200: jsonContent(z.object({ message: z.string() }), "Message Nacked"),
    400: jsonContent(z.object({ message: z.string() }), "Bad Request"),
    404: jsonContent(z.object({ message: z.string() }), "Message not found"),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const touchMessage = createRoute({
  path: "/queue/message/:messageId/touch",
  method: "put",
  tags,
  description: "Extends the lock/visibility timeout for a message in processing. Use this as a heartbeat to prevent timeout while processing heavy tasks.",
  request: {
    params: z.object({
      messageId: z.string(),
    }),
    body: jsonContentRequired(
      z.object({
        lock_token: z.string().describe("The lock_token received when the message was dequeued (fencing token for validation)"),
        extend_seconds: z.number().optional().describe("Optional seconds to extend. Defaults to ack_timeout_seconds from config."),
      }),
      "Touch Message Request"
    ),
  },
  responses: {
    200: jsonContent(
      z.object({
        message: z.string(),
        new_timeout_at: z.number().describe("Unix timestamp when the new timeout will expire"),
        extended_by: z.number().describe("Seconds the timeout was extended by"),
        lock_token: z.string().describe("The current lock_token (unchanged)"),
      }),
      "Lock Extended Successfully"
    ),
    404: jsonContent(z.object({ message: z.string() }), "Message not found in processing"),
    409: jsonContent(
      z.object({
        message: z.string(),
        error: z.literal("LOCK_LOST"),
      }),
      "Lock Lost - lock_token mismatch (message was re-queued)"
    ),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export type AddMessageRoute = typeof addMessage;
export type AddBatchRoute = typeof addBatch;
export type GetMessageRoute = typeof getMessage;
export type AcknowledgeMessageRoute = typeof acknowledgeMessage;
export type NackMessageRoute = typeof nackMessage;
export type TouchMessageRoute = typeof touchMessage;
export const removeMessagesByDateRange = createRoute({
  path: "/queue/messages",
  method: "delete",
  tags,
  request: {
    query: z.object({
      startTimestamp: z.string().transform((val: string) => new Date(val).getTime()),
      endTimestamp: z.string().transform((val: string) => new Date(val).getTime()),
    }),
  },
  responses: {
    200: jsonContent(z.object({ message: z.string() }), "Messages Deleted"),
    422: jsonContent(
      createErrorSchema(z.object({ startTimestamp: z.string(), endTimestamp: z.string() })),
      "Validation Error"
    ),
  },
});

export type MetricsRoute = typeof metrics;
export type HealthCheckRoute = typeof healthCheck;
export type RemoveMessagesByDateRangeRoute = typeof removeMessagesByDateRange;
export type GetMessagesByDateRangeRoute = typeof getMessagesByDateRange;

export const getMessagesByDateRange = createRoute({
  path: "/queue/messages",
  method: "get",
  tags,
  request: {
    query: z.object({
      startTimestamp: z.string().transform((val: string) => new Date(val).getTime()),
      endTimestamp: z.string().transform((val: string) => new Date(val).getTime()),
      limit: z.string().transform((val: string) => parseInt(val, 10)).optional(),
    }),
  },
  responses: {
    200: jsonContent(z.array(DequeuedMessageSchema), "Messages Found"),
    422: jsonContent(
      createErrorSchema(z.object({ startTimestamp: z.string(), endTimestamp: z.string(), limit: z.string().optional() })),
      "Validation Error"
    ),
  },
});

export const getQueueStatus = createRoute({
  path: "/queue/status",
  method: "get",
  tags,
  request: {
    query: z.object({
      include_messages: z.enum(["true", "false"]).optional(),
      queueName: z.string().optional().describe("Filter by queue name"),
    }),
  },
  responses: {
    200: jsonContent(
      z.object({
        mainQueue: z.object({
          name: z.string(),
          length: z.number(),
          messages: z.array(DequeuedMessageSchema),
        }),
        processingQueue: z.object({
          name: z.string(),
          length: z.number(),
          messages: z.array(DequeuedMessageSchema),
        }),
        deadLetterQueue: z.object({
          name: z.string(),
          length: z.number(),
          messages: z.array(DequeuedMessageSchema),
        }),
        acknowledgedQueue: z.object({
          name: z.string(),
          length: z.number(),
          messages: z.array(DequeuedMessageSchema),
          total: z.number(),
        }),
        archivedQueue: z.object({
          name: z.string(),
          length: z.number(),
          messages: z.array(DequeuedMessageSchema),
        }),
        metadata: z.object({
          totalProcessed: z.number(),
          totalFailed: z.number(),
        }),
      }),
      "Queue Status"
    ),
  },
});

export type GetQueueStatusRoute = typeof getQueueStatus;

export const getMessages = createRoute({
  path: "/queue/:queueType/messages",
  method: "get",
  tags,
  request: {
    params: z.object({
      queueType: z.enum(["main", "processing", "dead", "acknowledged", "archived"]),
    }),
    query: z.object({
      page: z.string().optional(),
      limit: z.string().optional(),
      sortBy: z.string().optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
      filterType: z.string().optional(),
      filterPriority: z.string().optional(),
      filterAttempts: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      search: z.string().optional(),
      queueName: z.string().optional().describe("Filter by queue name (defaults to all queues)"),
    }),
  },
  responses: {
    200: jsonContent(
      z.object({
        messages: z.array(DequeuedMessageSchema),
        pagination: z.object({
          total: z.number(),
          page: z.number(),
          limit: z.number(),
          totalPages: z.number(),
        }),
      }),
      "Queue Messages"
    ),
    400: jsonContent(z.object({ message: z.string() }), "Bad Request"),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const exportMessages = createRoute({
  path: "/queue/:queueType/export",
  method: "get",
  tags,
  request: {
    params: z.object({
      queueType: z.enum(["main", "processing", "dead", "acknowledged", "archived"]),
    }),
    query: z.object({
      sortBy: z.string().optional(),
      sortOrder: z.enum(["asc", "desc"]).optional(),
      filterType: z.string().optional(),
      filterPriority: z.string().optional(),
      filterAttempts: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      search: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.any(), // File download
        },
      },
      description: "Exported Messages File",
    },
    400: jsonContent(z.object({ message: z.string() }), "Bad Request"),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const importMessages = createRoute({
  path: "/queue/import",
  method: "post",
  tags,
  request: {
    body: {
      content: {
        "multipart/form-data": {
          schema: z.object({
            file: z.any().openapi({
              type: "string",
              format: "binary",
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: jsonContent(
      z.object({
        message: z.string(),
        count: z.number(),
      }),
      "Import Successful"
    ),
    400: jsonContent(z.object({ message: z.string() }), "Bad Request"),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export type GetMessagesRoute = typeof getMessages;
export type ExportMessagesRoute = typeof exportMessages;
export type ImportMessagesRoute = typeof importMessages;

export const moveMessages = createRoute({
  path: "/queue/move",
  method: "post",
  tags,
  request: {
    body: jsonContentRequired(
      z.object({
        messages: z.array(z.any()),
        fromQueue: z.enum(["main", "processing", "dead", "acknowledged", "archived"]),
        toQueue: z.enum(["main", "processing", "dead", "acknowledged", "archived"]),
        errorReason: z.string().max(2000).optional(),
      }),
      "Move Messages Request"
    ),
  },
  responses: {
    200: jsonContent(
      z.object({
        message: z.string(),
        movedCount: z.number(),
      }),
      "Messages Moved"
    ),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export type MoveMessagesRoute = typeof moveMessages;

export const deleteMessage = createRoute({
  path: "/queue/message/:messageId",
  method: "delete",
  tags,
  request: {
    params: z.object({
      messageId: z.string(),
    }),
    query: z.object({
      queueType: z.enum(["main", "processing", "dead", "acknowledged", "archived"]),
    }),
  },
  responses: {
    200: jsonContent(
      z.object({
        success: z.boolean(),
        messageId: z.string(),
        queueType: z.string(),
        message: z.string(),
      }),
      "Message Deleted"
    ),
    400: jsonContent(z.object({ message: z.string() }), "Bad Request"),
    404: jsonContent(z.object({ message: z.string() }), "Message not found"),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const deleteMessages = createRoute({
  path: "/queue/messages/delete",
  method: "post",
  tags,
  request: {
    query: z.object({
      queueType: z.enum(["main", "processing", "dead", "acknowledged", "archived"]),
    }),
    body: jsonContentRequired(
      z.object({
        messageIds: z.array(z.string()),
      }),
      "Delete Messages Batch"
    ),
  },
  responses: {
    200: jsonContent(
      z.object({
        success: z.boolean(),
        deletedCount: z.number(),
        message: z.string(),
      }),
      "Messages Deleted"
    ),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export type DeleteMessageRoute = typeof deleteMessage;
export type DeleteMessagesRoute = typeof deleteMessages;

export const updateMessage = createRoute({
  path: "/queue/message/:messageId",
  method: "put",
  tags,
  request: {
    params: z.object({
      messageId: z.string(),
    }),
    query: z.object({
      queueType: z.enum(["main", "processing", "dead"]),
    }),
    body: jsonContentRequired(
      z.object({
        type: z.string().optional(),
        payload: z.any().optional(),
        priority: z.number().optional(),
        custom_ack_timeout: z.number().optional(),
      }),
      "Update Message"
    ),
  },
  responses: {
    200: jsonContent(
      z.object({
        success: z.boolean(),
        messageId: z.string(),
        queueType: z.string(),
        message: z.string(),
        data: z.any(),
      }),
      "Message Updated"
    ),
    400: jsonContent(z.object({ message: z.string() }), "Bad Request"),
    404: jsonContent(z.object({ message: z.string() }), "Message not found"),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export type UpdateMessageRoute = typeof updateMessage;

export const clearAllQueues = createRoute({
  path: "/queue/clear",
  method: "delete",
  tags,
  responses: {
    200: jsonContent(
      z.object({
        message: z.string(),
      }),
      "All Queues Cleared"
    ),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const clearQueue = createRoute({
  path: "/queue/:queueType/clear",
  method: "delete",
  tags,
  request: {
    params: z.object({
      queueType: z.enum(["main", "processing", "dead", "acknowledged", "archived"]),
    }),
  },
  responses: {
    200: jsonContent(
      z.object({
        success: z.boolean(),
        queueType: z.string(),
        message: z.string(),
      }),
      "Queue Cleared"
    ),
    400: jsonContent(z.object({ message: z.string() }), "Bad Request"),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export type ClearAllQueuesRoute = typeof clearAllQueues;
export type ClearQueueRoute = typeof clearQueue;

export const getConfig = createRoute({
  path: "/queue/config",
  method: "get",
  tags,
  responses: {
    200: jsonContent(
      z.object({
        ack_timeout_seconds: z.number(),
        max_attempts: z.number(),
      }),
      "Queue Configuration"
    ),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const getEvents = createRoute({
  path: "/queue/events",
  method: "get",
  tags,
  responses: {
    200: {
      content: {
        "text/event-stream": {
          schema: z.string(),
        },
      },
      description: "Server-Sent Events stream",
    },
  },
});

export type GetConfigRoute = typeof getConfig;
export type GetEventsRoute = typeof getEvents;

// === Activity Log Routes ===

export const ActivityLogEntrySchema = z.object({
  log_id: z.string(),
  message_id: z.string().nullable(),
  action: z.enum(["enqueue", "dequeue", "ack", "nack", "timeout", "requeue", "dlq", "touch", "move", "delete", "clear"]),
  timestamp: z.number(),
  queue: z.string(),
  source_queue: z.string().nullable(),
  dest_queue: z.string().nullable(),
  priority: z.number(),
  message_type: z.string().nullable(),
  consumer_id: z.string().nullable(),
  prev_consumer_id: z.string().nullable(),
  lock_token: z.string().nullable(),
  prev_lock_token: z.string().nullable(),
  attempt_count: z.number().nullable(),
  max_attempts: z.number().nullable(),
  attempts_remaining: z.number().nullable(),
  message_created_at: z.number().nullable(),
  message_age_ms: z.number().nullable(),
  time_in_queue_ms: z.number().nullable(),
  processing_time_ms: z.number().nullable(),
  total_processing_time_ms: z.number().nullable(),
  payload_size_bytes: z.number().nullable(),
  redis_operation_ms: z.number().nullable(),
  queue_depth: z.number().nullable(),
  processing_depth: z.number().nullable(),
  dlq_depth: z.number().nullable(),
  error_reason: z.string().nullable(),
  error_code: z.string().nullable(),
  triggered_by: z.string(),
  user_id: z.string().nullable(),
  reason: z.string().nullable(),
  batch_id: z.string().nullable(),
  batch_size: z.number().nullable(),
  prev_action: z.string().nullable(),
  prev_timestamp: z.number().nullable(),
  payload: z.any().optional(),
  anomaly: z.object({
    type: z.string(),
    severity: z.enum(["info", "warning", "critical"]),
    description: z.string(),
  }).nullable(),
});

export const getActivityLogs = createRoute({
  path: "/queue/activity",
  method: "get",
  tags,
  description: "Get activity logs with optional filters. Use message_id to see full message journey.",
  request: {
    query: z.object({
      message_id: z.string().optional().describe("Filter by message ID (correlation key)"),
      consumer_id: z.string().optional().describe("Filter by consumer ID"),
      action: z.string().optional().describe("Filter by action(s), comma-separated"),
      has_anomaly: z.enum(["true", "false"]).optional().describe("Only entries with anomalies"),
      anomaly_type: z.string().optional().describe("Filter by anomaly type"),
      start_time: z.string().optional().describe("Start timestamp (Unix seconds)"),
      end_time: z.string().optional().describe("End timestamp (Unix seconds)"),
      limit: z.string().optional().describe("Max entries to return (default: 100)"),
      offset: z.string().optional().describe("Offset for pagination"),
    }),
  },
  responses: {
    200: jsonContent(
      z.object({
        logs: z.array(ActivityLogEntrySchema),
        pagination: z.object({
          total: z.number(),
          limit: z.number(),
          offset: z.number(),
          has_more: z.boolean(),
        }),
      }),
      "Activity Logs"
    ),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const getMessageHistory = createRoute({
  path: "/queue/activity/message/:messageId",
  method: "get",
  tags,
  description: "Get full activity history for a specific message (chronological order)",
  request: {
    params: z.object({
      messageId: z.string(),
    }),
  },
  responses: {
    200: jsonContent(
      z.object({
        message_id: z.string(),
        history: z.array(ActivityLogEntrySchema),
      }),
      "Message Activity History"
    ),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const getAnomalies = createRoute({
  path: "/queue/activity/anomalies",
  method: "get",
  tags,
  description: "Get detected anomalies with summary",
  request: {
    query: z.object({
      severity: z.enum(["info", "warning", "critical"]).optional().describe("Filter by severity"),
      type: z.string().optional().describe("Filter by anomaly type"),
      action: z.string().optional().describe("Filter by action(s), comma-separated"),
      start_time: z.string().optional().describe("Start timestamp (Unix seconds)"),
      end_time: z.string().optional().describe("End timestamp (Unix seconds)"),
      limit: z.string().optional().describe("Max entries to return (default: 100)"),
      sort_by: z.enum(["severity", "type", "action", "timestamp"]).optional().describe("Sort by field (default: timestamp)"),
      sort_order: z.enum(["asc", "desc"]).optional().describe("Sort order (default: desc)"),
    }),
  },
  responses: {
    200: jsonContent(
      z.object({
        anomalies: z.array(ActivityLogEntrySchema),
        summary: z.object({
          total: z.number(),
          by_type: z.record(z.number()),
          by_severity: z.object({
            critical: z.number(),
            warning: z.number(),
            info: z.number(),
          }),
        }),
        pagination: z.object({
          total: z.number(),
          limit: z.number(),
          offset: z.number(),
          has_more: z.boolean(),
        }),
      }),
      "Anomalies Summary"
    ),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const clearActivityLogs = createRoute({
  path: "/queue/activity/clear",
  method: "delete",
  tags,
  description: "Clear all activity logs and consumer statistics",
  responses: {
    200: jsonContent(z.object({ message: z.string() }), "Activity Logs Cleared"),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const getConsumerStats = createRoute({
  path: "/queue/activity/consumers",
  method: "get",
  tags,
  description: "Get consumer statistics for burst detection",
  request: {
    query: z.object({
      consumer_id: z.string().optional().describe("Filter by consumer ID"),
    }),
  },
  responses: {
    200: jsonContent(
      z.object({
        stats: z.any(),
      }),
      "Consumer Statistics"
    ),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export type GetActivityLogsRoute = typeof getActivityLogs;
export type GetMessageHistoryRoute = typeof getMessageHistory;
export type GetAnomaliesRoute = typeof getAnomalies;
export type GetConsumerStatsRoute = typeof getConsumerStats;

// ==================== QUEUE MANAGEMENT ROUTES ====================

const queueManagementTags = ["Queue Management"];

export const QueueSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/, "Queue name can only contain alphanumeric characters, underscores, and hyphens"),
  queue_type: z.enum(["standard", "unlogged", "partitioned"]).default("standard"),
  ack_timeout_seconds: z.number().int().positive().default(30),
  max_attempts: z.number().int().positive().default(3),
  partition_interval: z.string().optional().describe("For partitioned queues: 'daily', 'hourly', 'weekly'"),
  retention_interval: z.string().optional().describe("For partitioned queues: e.g., '7 days', '30 days'"),
  description: z.string().max(500).optional(),
});

export const QueueInfoSchema = z.object({
  name: z.string(),
  queue_type: z.enum(["standard", "unlogged", "partitioned"]),
  ack_timeout_seconds: z.number(),
  max_attempts: z.number(),
  partition_interval: z.string().nullable(),
  retention_interval: z.string().nullable(),
  description: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  message_count: z.number(),
  processing_count: z.number(),
  dead_count: z.number(),
});

export type QueueInput = z.infer<typeof QueueSchema>;
export type QueueInfo = z.infer<typeof QueueInfoSchema>;

export const createQueue = createRoute({
  path: "/queues",
  method: "post",
  tags: queueManagementTags,
  description: `Create a new queue with the specified type.

**Queue Types:**
- **standard**: High durability. Messages stored in logged PostgreSQL tables. Best for general use where message loss is unacceptable.
- **unlogged**: Low durability, high performance. 2-3x faster writes. Data lost on crash. Best for transient/ephemeral data.
- **partitioned**: High durability and scalability. Uses table partitioning for very high throughput. Requires partition_interval and retention_interval.`,
  request: {
    body: jsonContentRequired(QueueSchema, "Queue Configuration"),
  },
  responses: {
    201: jsonContent(
      z.object({
        message: z.string(),
        queue: QueueInfoSchema,
      }),
      "Queue Created Successfully"
    ),
    400: jsonContent(
      z.object({ message: z.string() }),
      "Invalid queue configuration"
    ),
    409: jsonContent(
      z.object({ message: z.string() }),
      "Queue already exists"
    ),
    422: jsonContent(createErrorSchema(QueueSchema), "Validation Error"),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const listQueues = createRoute({
  path: "/queues",
  method: "get",
  tags: queueManagementTags,
  description: "List all created queues with their configurations and statistics",
  responses: {
    200: jsonContent(
      z.object({
        queues: z.array(QueueInfoSchema),
        total: z.number(),
      }),
      "List of Queues"
    ),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const getQueue = createRoute({
  path: "/queues/:queueName",
  method: "get",
  tags: queueManagementTags,
  description: "Get details of a specific queue",
  request: {
    params: z.object({
      queueName: z.string(),
    }),
  },
  responses: {
    200: jsonContent(QueueInfoSchema, "Queue Details"),
    404: jsonContent(z.object({ message: z.string() }), "Queue not found"),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const updateQueue = createRoute({
  path: "/queues/:queueName",
  method: "patch",
  tags: queueManagementTags,
  description: "Update queue configuration (ack_timeout, max_attempts, description only)",
  request: {
    params: z.object({
      queueName: z.string(),
    }),
    body: jsonContentRequired(
      z.object({
        ack_timeout_seconds: z.number().int().positive().optional(),
        max_attempts: z.number().int().positive().optional(),
        description: z.string().max(500).optional(),
      }),
      "Queue Update"
    ),
  },
  responses: {
    200: jsonContent(
      z.object({
        message: z.string(),
        queue: QueueInfoSchema,
      }),
      "Queue Updated"
    ),
    404: jsonContent(z.object({ message: z.string() }), "Queue not found"),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const deleteQueue = createRoute({
  path: "/queues/:queueName",
  method: "delete",
  tags: queueManagementTags,
  description: "Delete a queue and all its messages. This action is irreversible.",
  request: {
    params: z.object({
      queueName: z.string(),
    }),
    query: z.object({
      force: z.enum(["true", "false"]).optional().describe("Force delete even if queue has messages"),
    }),
  },
  responses: {
    200: jsonContent(
      z.object({
        message: z.string(),
        deleted_messages: z.number(),
      }),
      "Queue Deleted"
    ),
    400: jsonContent(z.object({ message: z.string() }), "Cannot delete queue with messages (use force=true)"),
    404: jsonContent(z.object({ message: z.string() }), "Queue not found"),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const purgeQueue = createRoute({
  path: "/queues/:queueName/purge",
  method: "post",
  tags: queueManagementTags,
  description: "Delete all messages from a queue without deleting the queue itself",
  request: {
    params: z.object({
      queueName: z.string(),
    }),
    body: jsonContent(
      z.object({
        status: z.enum(["queued", "processing", "dead", "acknowledged", "archived", "all"]).optional().default("all"),
      }),
      "Purge Options"
    ),
  },
  responses: {
    200: jsonContent(
      z.object({
        message: z.string(),
        deleted_count: z.number(),
      }),
      "Queue Purged"
    ),
    404: jsonContent(z.object({ message: z.string() }), "Queue not found"),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export const renameQueue = createRoute({
  path: "/queues/:queueName/rename",
  method: "post",
  tags: queueManagementTags,
  description: "Rename a queue. Updates the queue name in all related tables (messages, logs, etc.)",
  request: {
    params: z.object({
      queueName: z.string(),
    }),
    body: jsonContentRequired(
      z.object({
        newName: z.string().min(1).max(100).describe("New name for the queue"),
      }),
      "Rename Options"
    ),
  },
  responses: {
    200: jsonContent(
      z.object({
        message: z.string(),
        queue: QueueInfoSchema,
      }),
      "Queue Renamed"
    ),
    400: jsonContent(z.object({ message: z.string() }), "Invalid queue name or cannot rename"),
    404: jsonContent(z.object({ message: z.string() }), "Queue not found"),
    409: jsonContent(z.object({ message: z.string() }), "Queue with new name already exists"),
    500: jsonContent(z.object({ message: z.string() }), "Internal Server Error"),
  },
});

export type CreateQueueRoute = typeof createQueue;
export type ListQueuesRoute = typeof listQueues;
export type GetQueueRoute = typeof getQueue;
export type UpdateQueueRoute = typeof updateQueue;
export type DeleteQueueRoute = typeof deleteQueue;
export type PurgeQueueRoute = typeof purgeQueue;
export type RenameQueueRoute = typeof renameQueue;
