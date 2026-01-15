import type {
  AddMessageRoute,
  AddBatchRoute,
  GetMessageRoute,
  AcknowledgeMessageRoute,
  MetricsRoute,
  HealthCheckRoute,
  RemoveMessagesByDateRangeRoute,
  GetMessagesByDateRangeRoute,
  GetQueueStatusRoute,
  GetMessagesRoute,
  MoveMessagesRoute,
  DequeuedMessage,
  ClearAllQueuesRoute,
  ClearQueueRoute,
  GetConfigRoute,
  GetEventsRoute,
  ExportMessagesRoute,
  ImportMessagesRoute,
  NackMessageRoute,
  TouchMessageRoute,
  CreateQueueRoute,
  ListQueuesRoute,
  GetQueueRoute,
  UpdateQueueRoute,
  DeleteQueueRoute,
  PurgeQueueRoute,
} from "./queue.routes";
import type { AppRouteHandler } from "../../config/types";
import { streamSSE } from "hono/streaming";

import env from "../../config/env";
import { PostgresQueue, QueueConfig } from "../../lib/queue/index.js";

/**
 * --- PostgreSQL Queue Architecture ---
 *
 * This application uses PostgreSQL to implement a robust message queue system.
 * All messages are stored in a single `messages` table with a `status` column
 * that tracks their lifecycle state.
 *
 * Message States:
 * - `queued`: Waiting to be processed (main queue)
 * - `processing`: Currently being handled by a consumer
 * - `acknowledged`: Successfully processed
 * - `dead`: Failed after max retry attempts (DLQ)
 * - `archived`: Long-term retention
 *
 * Key Features:
 * - Priority levels 0-9 (higher = more urgent)
 * - Split-brain prevention via lock tokens
 * - LISTEN/NOTIFY for real-time SSE updates
 * - SELECT FOR UPDATE SKIP LOCKED for atomic dequeue
 * - Automatic timeout handling and requeue
 */

interface QueueConfigI {
  postgres_host: string;
  postgres_port: number;
  postgres_database: string;
  postgres_user: string;
  postgres_password: string;
  postgres_pool_size: number;
  postgres_ssl: boolean;
  queue_name: string;
  ack_timeout_seconds: number;
  max_attempts: number;
  requeue_batch_size: number;
  max_priority_levels: number;
  relay_actor: string;
  manual_operation_actor: string;
  activity_log_enabled: boolean;
  activity_log_retention_hours: number;
  activity_large_payload_threshold_bytes: number;
  activity_bulk_operation_threshold: number;
  activity_flash_message_threshold_ms: number;
  activity_long_processing_threshold_ms: number;
  events_channel: string;
}

function createQueueConfig(): QueueConfigI {
  return {
    postgres_host: env.POSTGRES_HOST,
    postgres_port: env.POSTGRES_PORT,
    postgres_database: env.POSTGRES_DATABASE,
    postgres_user: env.POSTGRES_USER,
    postgres_password: env.POSTGRES_PASSWORD,
    postgres_pool_size: env.POSTGRES_POOL_SIZE,
    postgres_ssl: env.POSTGRES_SSL === "true",
    queue_name: env.QUEUE_NAME,
    ack_timeout_seconds: env.ACK_TIMEOUT_SECONDS,
    max_attempts: env.MAX_ATTEMPTS,
    requeue_batch_size: env.REQUEUE_BATCH_SIZE,
    max_priority_levels: env.MAX_PRIORITY_LEVELS,
    relay_actor: env.RELAY_ACTOR,
    manual_operation_actor: env.MANUAL_OPERATION_ACTOR,
    activity_log_enabled: env.ACTIVITY_LOG_ENABLED === "true",
    activity_log_retention_hours: env.ACTIVITY_LOG_RETENTION_HOURS,
    activity_large_payload_threshold_bytes: env.ACTIVITY_LARGE_PAYLOAD_THRESHOLD_BYTES,
    activity_bulk_operation_threshold: env.ACTIVITY_BULK_OPERATION_THRESHOLD,
    activity_flash_message_threshold_ms: env.ACTIVITY_FLASH_MESSAGE_THRESHOLD_MS,
    activity_long_processing_threshold_ms: env.ACTIVITY_LONG_PROCESSING_THRESHOLD_MS,
    events_channel: env.EVENTS_CHANNEL,
  };
}

// Lazy initialization - queue is created on first access after env is initialized
let _queue: PostgresQueue | null = null;

export async function getQueue(): Promise<PostgresQueue> {
  if (!_queue) {
    _queue = new PostgresQueue(new QueueConfig(createQueueConfig() as any));
  }
  return _queue;
}

// Synchronous getter for places that need it (after initialization)
export function getQueueSync(): PostgresQueue {
  if (!_queue) {
    _queue = new PostgresQueue(new QueueConfig(createQueueConfig() as any));
  }
  return _queue;
}

// For backwards compatibility
export const queue = new Proxy({} as PostgresQueue, {
  get(_target, prop) {
    return (getQueueSync() as any)[prop];
  },
});

export const addMessage: AppRouteHandler<AddMessageRoute> = async (c: any) => {
  const { type, payload, priority, ackTimeout, maxAttempts, queue: queueName, consumerId } = c.req.valid("json");
  const q = await getQueue();

  try {
    const message = await q.enqueueMessage(
      {
        type,
        payload,
        custom_ack_timeout: ackTimeout,
        custom_max_attempts: maxAttempts,
        queue: queueName || "default",
        consumerId,
      },
      priority
    );

    if (!message) {
      return c.json({ message: "Message not added" }, 500);
    }

    return c.json({ message: "Message added successfully", id: message.id, queue: message.queue_name }, 201);
  } catch (error: any) {
    if (error.message?.includes("Queue not found")) {
      return c.json({ message: error.message }, 404);
    }
    return c.json({ message: error.message || "Failed to add message" }, 500);
  }
};

export const addBatch: AppRouteHandler<AddBatchRoute> = async (c: any) => {
  const messages = c.req.valid("json");
  const q = await getQueue();
  const batch = await q.enqueueBatch(messages);
  return c.json(
    {
      message: `Batch processed: ${batch.length}/${messages.length} messages enqueued`,
    },
    201
  );
};

export const getEvents: AppRouteHandler<GetEventsRoute> = async (c: any) => {
  const apiKey = c.req.query("apiKey");
  const secretKey = env.SECRET_KEY;
  const isAuthenticated = !secretKey || (apiKey && apiKey === secretKey);

  const q = await getQueue();
  console.log("[SSE] New SSE connection established");

  return streamSSE(c, async (stream) => {
    // Event handler for polling-based events
    const eventHandler = (event: { type: string; queue: string; timestamp: number; payload: Record<string, unknown> }) => {
      console.log("[SSE] Emitting event:", event.type);

      let dataToSend: string;

      // For unauthenticated clients, send lightweight events
      if (!isAuthenticated) {
        const lightweightEvent: Record<string, unknown> = {
          type: event.type,
          timestamp: event.timestamp,
          payload: {
            count: event.payload.count || 1,
            force_refresh: event.payload.force_refresh || false,
          },
        };
        dataToSend = JSON.stringify(lightweightEvent);
      } else {
        dataToSend = JSON.stringify(event);
      }

      stream.writeSSE({
        data: dataToSend,
        event: "queue-update",
        id: String(Date.now()),
      });
    };

    let unsubscribe: (() => void) | null = null;

    try {
      // Use polling-based event emitter (works with serverless PostgreSQL like Neon)
      console.log("[SSE] Subscribing to polling-based event emitter");
      unsubscribe = q.eventEmitter.subscribe(eventHandler);
      console.log("[SSE] Successfully subscribed to event emitter");

      stream.onAbort(() => {
        console.log("[SSE] Connection aborted, unsubscribing");
        if (unsubscribe) unsubscribe();
      });

      // Keep connection alive with pings
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 15000));
        await stream.writeSSE({
          event: "ping",
          data: "ping",
        });
      }
    } catch (e) {
      console.error("SSE Error:", e);
      if (unsubscribe) unsubscribe();
    }
  });
};

export const getMessage: AppRouteHandler<GetMessageRoute> = async (c: any) => {
  const { timeout, ackTimeout, type, consumerId, queue: queueName } = c.req.valid("query");
  const q = await getQueue();

  try {
    const message = (await q.dequeueMessage(
      timeout,
      ackTimeout,
      queueName || "default",
      type,
      consumerId
    )) as DequeuedMessage;

    if (!message) {
      return c.json({ message: "Message not found" }, 404);
    }
    return c.json(message, 200);
  } catch (error: any) {
    if (error.message?.includes("Queue not found")) {
      return c.json({ message: error.message }, 404);
    }
    return c.json({ message: error.message || "Failed to get message" }, 500);
  }
};

export const acknowledgeMessage: AppRouteHandler<AcknowledgeMessageRoute> = async (c: any) => {
  const message = c.req.valid("json");
  const q = await getQueue();
  const result = await q.acknowledgeMessage(message);

  if (result && typeof result === "object" && "error" in result) {
    if (result.code === "LOCK_LOST") {
      return c.json(
        {
          message:
            "Lock lost - lock_token mismatch. The message was re-queued and picked up by another worker.",
          error: "LOCK_LOST",
        },
        409
      );
    }
    return c.json({ message: result.error }, 400);
  }

  if (!result) {
    return c.json({ message: "Message not acknowledged" }, 400);
  }
  return c.json({ message: "Message acknowledged" }, 200);
};

export const nackMessage: AppRouteHandler<NackMessageRoute> = async (c: any) => {
  const { messageId } = c.req.valid("param");
  const body = await c.req.json().catch(() => ({}));
  const { errorReason, lock_token } = body;
  const q = await getQueue();

  const result = await q.nackMessage(messageId, lock_token, errorReason);

  if (result && typeof result === "object" && "error" in result) {
    if (result.code === "LOCK_LOST") {
      return c.json({ message: "Lock lost", error: "LOCK_LOST" }, 409);
    }
    return c.json({ message: result.error }, 404);
  }

  if (!result) {
    return c.json({ message: "Message not found or could not be nacked" }, 404);
  }
  return c.json({ message: "Message nacked successfully" }, 200);
};

export const touchMessage: AppRouteHandler<TouchMessageRoute> = async (c: any) => {
  const { messageId } = c.req.valid("param");
  const { lock_token, extend_seconds } = c.req.valid("json");
  const q = await getQueue();

  const result = await q.touchMessage(messageId, lock_token, extend_seconds);

  if (!result.success) {
    // Return 404 for non-existent messages
    if (result.not_found) {
      return c.json(
        {
          message: result.error || "Message not found",
          error: "NOT_FOUND",
        },
        404
      );
    }
    // Return 409 for lock token mismatch
    if (result.error?.includes("mismatch")) {
      return c.json(
        {
          message: result.error,
          error: "LOCK_LOST",
        },
        409
      );
    }
    return c.json({ message: "Failed to extend message lock" }, 500);
  }

  return c.json(
    {
      message: "Lock extended successfully",
      new_timeout_at: result.new_timeout_at,
      lock_token: result.lock_token,
    },
    200
  );
};

export const metrics: AppRouteHandler<MetricsRoute> = async (c: any) => {
  const q = await getQueue();
  const metricsData = await q.getMetrics();
  return c.json(metricsData, 200);
};

export const healthCheck: AppRouteHandler<HealthCheckRoute> = async (c: any) => {
  const q = await getQueue();
  const health = await q.healthCheck();
  if (!health || health.status === "unhealthy") {
    return c.json({ status: "ERROR", details: health }, 500);
  }
  return c.json({ status: "OK", details: health }, 200);
};

export const removeMessagesByDateRange: AppRouteHandler<RemoveMessagesByDateRangeRoute> = async (
  c: any
) => {
  const { startTimestamp, endTimestamp } = c.req.valid("query");
  const q = await getQueue();

  // startTimestamp/endTimestamp are already in milliseconds from the route transform
  const start = new Date(startTimestamp);
  const end = new Date(endTimestamp);

  const result = await q.pgManager.query(
    `DELETE FROM messages WHERE created_at >= $1 AND created_at <= $2`,
    [start, end]
  );

  return c.json({ message: `${result.rowCount} messages removed successfully` }, 200);
};

export const getMessagesByDateRange: AppRouteHandler<GetMessagesByDateRangeRoute> = async (
  c: any
) => {
  const { startTimestamp, endTimestamp, limit = 100 } = c.req.valid("query");
  const q = await getQueue();

  // startTimestamp/endTimestamp are already in milliseconds from the route transform
  const start = new Date(startTimestamp);
  const end = new Date(endTimestamp);

  const result = await q.pgManager.query(
    `SELECT * FROM messages WHERE created_at >= $1 AND created_at <= $2 ORDER BY created_at DESC LIMIT $3`,
    [start, end, limit]
  );

  // Map messages to proper format
  const messages = result.rows.map((row: any) => ({
    ...row,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
  }));

  return c.json(messages, 200);
};

export const getQueueStatus: AppRouteHandler<GetQueueStatusRoute> = async (c: any) => {
  try {
    const { include_messages, queueName } = c.req.valid("query");
    const includeMessages = include_messages !== "false";
    const q = await getQueue();
    const status = await q.getQueueStatus(null, includeMessages, queueName);

    // Transform to match expected API schema
    const response = {
      mainQueue: {
        name: "main",
        length: status.mainQueue.length,
        messages: status.mainQueue.messages,
      },
      processingQueue: {
        name: "processing",
        length: status.processingQueue.length,
        messages: status.processingQueue.messages,
      },
      deadLetterQueue: {
        name: "dead",
        length: status.deadLetterQueue.length,
        messages: status.deadLetterQueue.messages,
      },
      acknowledgedQueue: {
        name: "acknowledged",
        length: status.acknowledgedQueue.length,
        messages: status.acknowledgedQueue.messages,
        total: status.totalAcknowledged,
      },
      archivedQueue: {
        name: "archived",
        length: status.archivedQueue.length,
        messages: status.archivedQueue.messages,
      },
      metadata: {
        totalProcessed: status.totalAcknowledged,
        totalFailed: status.deadLetterQueue.length,
      },
      availableTypes: status.availableTypes,
    };

    return c.json(response, 200);
  } catch (error: any) {
    return c.json({ message: `Failed to get queue status: ${error.message || error}` }, 500);
  }
};

export const getMessages: AppRouteHandler<GetMessagesRoute> = async (c: any) => {
  try {
    const { queueType } = c.req.valid("param");
    const query = c.req.valid("query");
    const q = await getQueue();

    console.log('DEBUG getMessages: queueType=', queueType, 'query=', query);

    const result = await q.getQueueMessages(queueType, {
      ...query,
      queueName: query.queueName,
    });
    return c.json(result, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to get queue messages" }, 500);
  }
};

export const exportMessages: AppRouteHandler<ExportMessagesRoute> = async (c: any) => {
  try {
    const { queueType } = c.req.valid("param");
    const query = c.req.valid("query");
    const q = await getQueue();

    const exportQuery = { ...query, limit: 1000000, page: 1 };
    const result = await q.getQueueMessages(queueType, exportQuery);
    const jsonString = JSON.stringify(result.messages, null, 2);

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);

    c.header("Content-Type", "application/json");
    c.header(
      "Content-Disposition",
      `attachment; filename="${queueType}-queue-export-${timestamp}.json"`
    );

    return c.body(jsonString, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to export messages" }, 500);
  }
};

export const importMessages: AppRouteHandler<ImportMessagesRoute> = async (c: any) => {
  try {
    const body = await c.req.parseBody();
    const file = body["file"];

    if (!file || !(file instanceof File)) {
      return c.json({ message: "No file uploaded or invalid file" }, 400);
    }

    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return c.json({ message: "Invalid JSON content" }, 400);
    }

    const messages = Array.isArray(data) ? data : [data];
    const q = await getQueue();

    const batch = messages.map((m: any) => ({
      type: m.type || "default",
      payload: m.payload || {},
      custom_ack_timeout: m.custom_ack_timeout || m.ackTimeout,
      custom_max_attempts: m.custom_max_attempts || m.maxAttempts,
    }));

    const enqueued = await q.enqueueBatch(batch);

    return c.json(
      {
        message: `Imported ${enqueued.length} messages successfully`,
        count: enqueued.length,
      },
      200
    );
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to import messages" }, 500);
  }
};

export const moveMessages: AppRouteHandler<MoveMessagesRoute> = async (c: any) => {
  try {
    const { messages, fromQueue, toQueue, errorReason } = c.req.valid("json");
    const q = await getQueue();

    // Extract message IDs - messages can be objects with id or just strings
    const messageIds = messages.map((m: any) => (typeof m === "string" ? m : m.id));

    const movedCount = await q.moveMessages(messageIds, fromQueue, toQueue, { errorReason });
    return c.json({ message: `${movedCount} messages moved successfully`, movedCount }, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to move messages" }, 500);
  }
};

export const deleteMessage: AppRouteHandler<any> = async (c: any) => {
  try {
    const { messageId } = c.req.valid("param");
    const { queueType } = c.req.valid("query");
    const q = await getQueue();

    const result = await q.deleteMessage(messageId, queueType);
    return c.json(result, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to delete message" }, 500);
  }
};

export const deleteMessages: AppRouteHandler<any> = async (c: any) => {
  try {
    const { queueType } = c.req.valid("query");
    const { messageIds } = c.req.valid("json");
    const q = await getQueue();

    const deletedCount = await q.deleteMessages(messageIds, queueType);
    return c.json(
      {
        success: true,
        deletedCount,
        message: `${deletedCount} messages deleted successfully`,
      },
      200
    );
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to delete messages" }, 500);
  }
};

export const updateMessage: AppRouteHandler<any> = async (c: any) => {
  try {
    const { messageId } = c.req.valid("param");
    const { queueType } = c.req.valid("query");
    const updates = c.req.valid("json");
    const q = await getQueue();

    const result = await q.updateMessage(messageId, queueType, updates);
    if (!result) {
      return c.json({ success: false, message: "Message not found" }, 404);
    }
    return c.json({ success: true, data: result }, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to update message" }, 500);
  }
};

export const clearAllQueues: AppRouteHandler<ClearAllQueuesRoute> = async (c: any) => {
  try {
    const q = await getQueue();
    await q.clearAllQueues();
    return c.json({ message: "All queues cleared successfully" }, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to clear queues" }, 500);
  }
};

export const clearQueue: AppRouteHandler<ClearQueueRoute> = async (c: any) => {
  try {
    const { queueType } = c.req.valid("param");
    const q = await getQueue();
    await q.clearQueue(queueType);
    return c.json(
      {
        success: true,
        queueType,
        message: `${queueType} queue cleared successfully`,
      },
      200
    );
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to clear queue" }, 500);
  }
};

export const getConfig: AppRouteHandler<GetConfigRoute> = async (c: any) => {
  try {
    const q = await getQueue();
    return c.json(
      {
        ack_timeout_seconds: q.config.ack_timeout_seconds,
        max_attempts: q.config.max_attempts,
      },
      200
    );
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to get config" }, 500);
  }
};

// === Activity Log Handlers ===

export const getActivityLogs: AppRouteHandler<any> = async (c: any) => {
  try {
    const query = c.req.query();
    const q = await getQueue();

    const filters = {
      messageId: query.message_id?.trim(),
      consumerId: query.consumer_id?.trim(),
      action: query.action,
      queueName: query.queue_name?.trim(),
      startDate: query.start_time ? new Date(parseFloat(query.start_time) * 1000).toISOString() : undefined,
      endDate: query.end_time ? new Date(parseFloat(query.end_time) * 1000).toISOString() : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 100,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    };

    const result = await q.getActivityLogs(filters);
    return c.json(result, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to get activity logs" }, 500);
  }
};

export const getMessageHistory: AppRouteHandler<any> = async (c: any) => {
  try {
    const { messageId } = c.req.param();
    const trimmedId = messageId?.trim();
    const q = await getQueue();

    const history = await q.getMessageHistory(trimmedId);
    return c.json({ message_id: trimmedId, history }, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to get message history" }, 500);
  }
};

export const getAnomalies: AppRouteHandler<any> = async (c: any) => {
  try {
    const query = c.req.query();
    const q = await getQueue();

    const filters = {
      severity: query.severity,
      type: query.type,
      queueName: query.queue_name?.trim(),
      startDate: query.start_time ? new Date(parseFloat(query.start_time) * 1000).toISOString() : undefined,
      endDate: query.end_time ? new Date(parseFloat(query.end_time) * 1000).toISOString() : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 100,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    };

    const result = await q.getAnomalies(filters);
    return c.json(result, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to get anomalies" }, 500);
  }
};

export const getConsumerStats: AppRouteHandler<any> = async (c: any) => {
  try {
    const query = c.req.query();
    const consumerId = query.consumer_id;
    const q = await getQueue();

    const rows = await q.getConsumerStats(consumerId);

    // Transform array of rows into Record<consumerId, { dequeue_count, last_dequeue }>
    // Note: last_dequeue is in seconds (Unix timestamp) for frontend compatibility
    const stats: Record<string, { dequeue_count: number; last_dequeue: number }> = {};
    if (Array.isArray(rows)) {
      for (const row of rows) {
        stats[row.consumer_id] = {
          dequeue_count: Number(row.total_dequeued) || 0,
          last_dequeue: row.last_dequeue_at ? Math.floor(new Date(row.last_dequeue_at).getTime() / 1000) : 0
        };
      }
    } else if (rows) {
      // Single consumer lookup
      stats[rows.consumer_id] = {
        dequeue_count: Number(rows.total_dequeued) || 0,
        last_dequeue: rows.last_dequeue_at ? Math.floor(new Date(rows.last_dequeue_at).getTime() / 1000) : 0
      };
    }

    return c.json({ stats }, 200);
  } catch (error: any) {
    // Handle deadlock gracefully - return empty stats with a warning
    if (error.message?.includes('deadlock')) {
      console.warn('Deadlock detected in getConsumerStats endpoint, returning empty stats');
      return c.json({
        stats: {},
        warning: 'Database busy, stats temporarily unavailable'
      }, 200);
    }
    return c.json({ message: error.message || "Failed to get consumer stats" }, 500);
  }
};

export const clearActivityLogs: AppRouteHandler<any> = async (c: any) => {
  try {
    const q = await getQueue();
    await q.clearActivityLogs();
    return c.json({ message: "Activity logs cleared successfully" }, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to clear activity logs" }, 500);
  }
};

// ==================== QUEUE MANAGEMENT HANDLERS ====================

export const createQueueHandler: AppRouteHandler<CreateQueueRoute> = async (c: any) => {
  try {
    const body = c.req.valid("json");
    const q = await getQueue();

    const queue = await q.createQueue({
      name: body.name,
      queue_type: body.queue_type,
      ack_timeout_seconds: body.ack_timeout_seconds,
      max_attempts: body.max_attempts,
      partition_interval: body.partition_interval,
      retention_interval: body.retention_interval,
      description: body.description,
    });

    return c.json(
      {
        message: `Queue '${queue.name}' created successfully`,
        queue: {
          name: queue.name,
          queue_type: queue.queue_type,
          ack_timeout_seconds: queue.ack_timeout_seconds,
          max_attempts: queue.max_attempts,
          partition_interval: queue.partition_interval,
          retention_interval: queue.retention_interval,
          description: queue.description,
          created_at: queue.created_at.toISOString(),
          updated_at: queue.updated_at.toISOString(),
          message_count: queue.message_count,
          processing_count: queue.processing_count,
          dead_count: queue.dead_count,
        },
      },
      201
    );
  } catch (error: any) {
    if (error.message?.includes("duplicate key") || error.code === "23505") {
      return c.json({ message: `Queue already exists` }, 409);
    }
    if (error.message?.includes("require partition_interval")) {
      return c.json({ message: error.message }, 400);
    }
    return c.json({ message: error.message || "Failed to create queue" }, 500);
  }
};

export const listQueuesHandler: AppRouteHandler<ListQueuesRoute> = async (c: any) => {
  try {
    const q = await getQueue();
    const queues = await q.listQueues();

    return c.json(
      {
        queues: queues.map((queue) => ({
          name: queue.name,
          queue_type: queue.queue_type,
          ack_timeout_seconds: queue.ack_timeout_seconds,
          max_attempts: queue.max_attempts,
          partition_interval: queue.partition_interval,
          retention_interval: queue.retention_interval,
          description: queue.description,
          created_at: queue.created_at.toISOString(),
          updated_at: queue.updated_at.toISOString(),
          message_count: queue.message_count,
          processing_count: queue.processing_count,
          dead_count: queue.dead_count,
        })),
        total: queues.length,
      },
      200
    );
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to list queues" }, 500);
  }
};

export const getQueueHandler: AppRouteHandler<GetQueueRoute> = async (c: any) => {
  try {
    const { queueName } = c.req.valid("param");
    const q = await getQueue();

    const queue = await q.getQueueByName(queueName, { includeStats: true });
    if (!queue) {
      return c.json({ message: `Queue '${queueName}' not found` }, 404);
    }

    return c.json(
      {
        name: queue.name,
        queue_type: queue.queue_type,
        ack_timeout_seconds: queue.ack_timeout_seconds,
        max_attempts: queue.max_attempts,
        partition_interval: queue.partition_interval,
        retention_interval: queue.retention_interval,
        description: queue.description,
        created_at: queue.created_at.toISOString(),
        updated_at: queue.updated_at.toISOString(),
        message_count: queue.message_count,
        processing_count: queue.processing_count,
        dead_count: queue.dead_count,
      },
      200
    );
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to get queue" }, 500);
  }
};

export const updateQueueHandler: AppRouteHandler<UpdateQueueRoute> = async (c: any) => {
  try {
    const { queueName } = c.req.valid("param");
    const updates = c.req.valid("json");
    const q = await getQueue();

    const queue = await q.updateQueueConfig(queueName, updates);
    if (!queue) {
      return c.json({ message: `Queue '${queueName}' not found` }, 404);
    }

    return c.json(
      {
        message: `Queue '${queue.name}' updated successfully`,
        queue: {
          name: queue.name,
          queue_type: queue.queue_type,
          ack_timeout_seconds: queue.ack_timeout_seconds,
          max_attempts: queue.max_attempts,
          partition_interval: queue.partition_interval,
          retention_interval: queue.retention_interval,
          description: queue.description,
          created_at: queue.created_at.toISOString(),
          updated_at: queue.updated_at.toISOString(),
          message_count: queue.message_count,
          processing_count: queue.processing_count,
          dead_count: queue.dead_count,
        },
      },
      200
    );
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to update queue" }, 500);
  }
};

export const deleteQueueHandler: AppRouteHandler<DeleteQueueRoute> = async (c: any) => {
  try {
    const { queueName } = c.req.valid("param");
    const { force } = c.req.valid("query");
    const q = await getQueue();

    const result = await q.deleteQueueByName(queueName, force === "true");

    return c.json(
      {
        message: `Queue '${queueName}' deleted successfully`,
        deleted_messages: result.deleted_messages,
      },
      200
    );
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      return c.json({ message: error.message }, 404);
    }
    if (error.message?.includes("Use force=true")) {
      return c.json({ message: error.message }, 400);
    }
    return c.json({ message: error.message || "Failed to delete queue" }, 500);
  }
};

export const purgeQueueHandler: AppRouteHandler<PurgeQueueRoute> = async (c: any) => {
  try {
    const { queueName } = c.req.valid("param");
    const body = c.req.valid("json") || {};
    const status = body.status || "all";
    const q = await getQueue();

    const deletedCount = await q.purgeQueue(queueName, status);

    return c.json(
      {
        message: `Purged ${deletedCount} messages from queue '${queueName}'`,
        deleted_count: deletedCount,
      },
      200
    );
  } catch (error: any) {
    if (error.message?.includes("not found")) {
      return c.json({ message: error.message }, 404);
    }
    return c.json({ message: error.message || "Failed to purge queue" }, 500);
  }
};
