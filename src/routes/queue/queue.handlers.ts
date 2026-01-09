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
} from "./queue.routes";
import type { AppRouteHandler } from "../../config/types";
import { streamSSE } from "hono/streaming";

import env from "../../config/env";
import { OptimizedRedisQueue, QueueConfig } from "../../lib/redis.js";

/**
 * --- Redis Queue Architecture & Stream Types ---
 * 
 * This application uses Redis Streams to implement a robust, multi-priority queue system.
 * Below is an explanation of the different queue types and their purposes:
 * 
 * 1. **Manual Queue (`queue_manual`)**
 *    - **Priority:** Highest (Checked 1st).
 *    - **Purpose:** Reserved exclusively for messages manually moved to "Processing" via the Dashboard UI.
 *    - **Why:** Isolates user-initiated actions from the general backlog. When a user clicks "Move to Processing", 
 *      the message goes here so the system can immediately pick it up without processing thousands of backlog items first.
 * 
 * 2. **Priority Queues (`queue_p{N}` e.g., `queue_p9`, `queue_p1`)**
 *    - **Priority:** High to Low (Checked 2nd to Nth).
 *    - **Purpose:** Standard segmented priority streams.
 *    - **Order:** `queue_p9` is checked before `queue_p8`, and so on.
 * 
 * 3. **Main/Standard Queue (`queue`)**
 *    - **Priority:** Normal (Priority 0).
 *    - **Purpose:** The default stream for messages enqueued without a specific high priority.
 *    - **Behavior:** Processed after all manual and higher-priority streams are empty.
 * 
 * 4. **Processing Queue (Consumer Group PEL)**
 *    - **Type:** Logical State (Not a separate list key).
 *    - **Purpose:** Messages that have been dequeued (read) by a consumer but not yet Acknowledged (ACK) or Failed.
 *    - **Storage:** Tracked in the Redis Stream's Pending Entry List (PEL).
 * 
 * 5. **Acknowledged Queue (`queue_acknowledged`)**
 *    - **Type:** Stream.
 *    - **Purpose:** Archive of successfully processed messages.
 *    - **Retention:** Trimmed to a configurable limit (e.g., last 100 messages) to prevent indefinite growth.
 * 
 * 6. **Dead Letter Queue (`queue_dlq`)**
 *    - **Type:** Stream.
 *    - **Purpose:** Graveyard for messages that failed after maximum retry attempts.
 *    - **Action:** Messages here usually require manual intervention or inspection.
 * 
 * --- Message Lifecycle ---
 * Enqueue -> [Manual/Priority/Main Stream] -> Dequeue (Consumer Group) -> Processing (PEL) -> ACK (-> Acknowledged Stream) OR Fail (-> DLQ Stream)
 */

interface QueueConfigI {
  redis_host: string;
  redis_port: number;
  redis_db: number;
  redis_password: string | undefined;
  queue_name: string;
  processing_queue_name: string;
  dead_letter_queue_name: string;
  archived_queue_name: string;
  metadata_hash_name: string;
  ack_timeout_seconds: number;
  max_attempts: number;
  requeue_batch_size: number;
  max_priority_levels: number;
  redis_pool_size: number;
  enable_message_encryption: string;
  secret_key: string | undefined;
  events_channel: string;
}

const queueConfig: QueueConfigI = {
  redis_host: env.REDIS_HOST,
  redis_port: env.REDIS_PORT,
  redis_db: env.REDIS_DB,
  redis_password: env.REDIS_PASSWORD ?? undefined,
  queue_name: env.QUEUE_NAME,
  processing_queue_name: env.PROCESSING_QUEUE_NAME,
  dead_letter_queue_name: env.DEAD_LETTER_QUEUE_NAME,
  archived_queue_name: env.ARCHIVED_QUEUE_NAME,
  metadata_hash_name: env.METADATA_HASH_NAME,
  ack_timeout_seconds: env.ACK_TIMEOUT_SECONDS,
  max_attempts: env.MAX_ATTEMPTS,
  requeue_batch_size: env.REQUEUE_BATCH_SIZE,
  max_priority_levels: env.MAX_PRIORITY_LEVELS,
  redis_pool_size: env.REDIS_POOL_SIZE,
  enable_message_encryption: env.ENABLE_ENCRYPTION,
  secret_key: env.SECRET_KEY ?? undefined,
  events_channel: env.EVENTS_CHANNEL,
};

export const queue = new OptimizedRedisQueue(new QueueConfig(queueConfig as any));

export const addMessage: AppRouteHandler<AddMessageRoute> = async (c: any) => {
  const { type, payload, priority, ackTimeout, maxAttempts } = c.req.valid("json");

  const message = await queue.enqueueMessage({
    type,
    payload,
    custom_ack_timeout: ackTimeout,
    custom_max_attempts: maxAttempts,
  }, priority);

  if (!message) {
    return c.json({ message: "Message not added" }, 500);
  }

  return c.json({ message: "Message added successfully" }, 201);
};

export const addBatch: AppRouteHandler<AddBatchRoute> = async (c: any) => {
  const messages = c.req.valid("json");
  const batch = await queue.enqueueBatch(messages);
  return c.json(
    {
      message: `Batch processed: ${batch}/${messages.length} messages enqueued`,
    },
    201
  );
};

export const getEvents: AppRouteHandler<GetEventsRoute> = async (c: any) => {
  // Check for API key authentication via query parameter
  // (EventSource doesn't support custom headers, so we use query params)
  const apiKey = c.req.query("apiKey");
  const secretKey = env.SECRET_KEY;
  const isAuthenticated = !secretKey || (apiKey && apiKey === secretKey);

  return streamSSE(c, async (stream) => {
    const subscriber = queue.redisManager.subscriber;
    const channel = queue.config.events_channel;

    const messageHandler = (chan: string, message: string) => {
      if (chan === channel) {
        let dataToSend = message;

        // If not authenticated, strip sensitive payload data from events
        if (!isAuthenticated) {
          try {
            const parsed = JSON.parse(message);
            // Strip payload from individual messages
            if (parsed.payload?.message) {
              const { payload: msgPayload, ...rest } = parsed.payload.message;
              parsed.payload.message = { ...rest, payload: "[REDACTED]" };
            }
            // Strip payloads from batch messages
            if (parsed.payload?.messages && Array.isArray(parsed.payload.messages)) {
              parsed.payload.messages = parsed.payload.messages.map((m: any) => {
                const { payload: msgPayload, ...rest } = m;
                return { ...rest, payload: "[REDACTED]" };
              });
            }
            dataToSend = JSON.stringify(parsed);
          } catch (e) {
            // If parsing fails, still send the original message
          }
        }

        stream.writeSSE({
          data: dataToSend,
          event: 'queue-update',
          id: String(Date.now()),
        });
      }
    };

    try {
      await subscriber.subscribe(channel);
      subscriber.on("message", messageHandler);

      stream.onAbort(() => {
        subscriber.removeListener("message", messageHandler);
      });

      while (true) {
        await new Promise((resolve) => setTimeout(resolve, 15000));
        await stream.writeSSE({
          event: 'ping',
          data: 'ping'
        });
      }
    } catch (e) {
      console.error("SSE Error:", e);
    }
  });
};

export const getMessage: AppRouteHandler<GetMessageRoute> = async (c: any) => {
  const { timeout, ackTimeout, type, consumerId } = c.req.valid("query");
  const message = (await queue.dequeueMessage(timeout, ackTimeout, null, type, consumerId)) as DequeuedMessage;
  if (!message) {
    return c.json({ message: "Message not found" }, 404);
  }
  return c.json(message, 200);
};

export const acknowledgeMessage: AppRouteHandler<
  AcknowledgeMessageRoute
> = async (c: any) => {
  const message = c.req.valid("json");
  const result = await queue.acknowledgeMessage(message);

  // Handle lock lost error (fencing token mismatch)
  if (result && typeof result === 'object' && result.error === "LOCK_LOST") {
    return c.json({
      message: "Lock lost - lock_token mismatch. The message was re-queued and picked up by another worker. Your work should be discarded.",
      error: "LOCK_LOST"
    }, 409);
  }

  if (!result) {
    return c.json({ message: "Message not acknowledged" }, 400);
  }
  return c.json({ message: "Message acknowledged" }, 200);
};

export const nackMessage: AppRouteHandler<NackMessageRoute> = async (c: any) => {
  const { messageId } = c.req.valid("param");
  const body = await c.req.json().catch(() => ({}));
  const errorReason = body.errorReason;

  const nacked = await queue.nackMessage(messageId, errorReason);
  if (!nacked) {
    return c.json({ message: "Message not found or could not be nacked" }, 404);
  }
  return c.json({ message: "Message nacked successfully" }, 200);
};

export const touchMessage: AppRouteHandler<TouchMessageRoute> = async (c: any) => {
  const { messageId } = c.req.valid("param");
  const { lock_token, extend_seconds } = c.req.valid("json");

  const result = await queue.touchMessage(messageId, lock_token, extend_seconds);

  if (!result.success) {
    if (result.error === "NOT_FOUND") {
      return c.json({ message: "Message not found in processing queue" }, 404);
    }
    if (result.error === "LOCK_LOST") {
      return c.json({
        message: "Lock lost - lock_token mismatch. The message may have been re-queued and picked up by another worker.",
        error: "LOCK_LOST"
      }, 409);
    }
    return c.json({ message: "Failed to extend message lock" }, 500);
  }

  return c.json({
    message: "Lock extended successfully",
    new_timeout_at: result.new_timeout_at,
    extended_by: result.extended_by,
    lock_token: result.lock_token
  }, 200);
};

export const metrics: AppRouteHandler<MetricsRoute> = async (c: any) => {
  const metrics = await queue.getMetrics();
  return c.json(metrics, 200);
};

export const healthCheck: AppRouteHandler<HealthCheckRoute> = async (c: any) => {
  const health = await queue.healthCheck();
  if (!health) {
    return c.json({ status: "ERROR" }, 500);
  }
  return c.json({ status: "OK" }, 200);
};

export const removeMessagesByDateRange: AppRouteHandler<
  RemoveMessagesByDateRangeRoute
> = async (c: any) => {
  const { startTimestamp, endTimestamp } = c.req.valid("query");

  const removedCount = await queue.removeMessagesByDateRange(
    startTimestamp,
    endTimestamp
  );

  return c.json(
    { message: `${removedCount} messages removed successfully` },
    200
  );
};

export const getMessagesByDateRange: AppRouteHandler<
  GetMessagesByDateRangeRoute
> = async (c: any) => {
  const { startTimestamp, endTimestamp, limit = 100 } = c.req.valid("query");

  const messages = await queue.getMessagesByDateRange(
    startTimestamp,
    endTimestamp,
    limit
  );

  return c.json(messages, 200);
};

export const getQueueStatus: AppRouteHandler<GetQueueStatusRoute> = async (c: any) => {
  try {
    const { include_messages } = c.req.valid("query");
    const includeMessages = include_messages !== "false";
    const status = await queue.getQueueStatus(null, includeMessages);
    return c.json(status, 200);
  } catch (error: any) {
    return c.json({ message: `Failed to get queue status: ${error.message || error}` }, 500);
  }
};

export const getMessages: AppRouteHandler<GetMessagesRoute> = async (c: any) => {
  try {
    const { queueType } = c.req.valid("param");
    const query = c.req.valid("query");

    const result = await queue.getQueueMessages(queueType, query);
    return c.json(result, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to get queue messages" }, 500);
  }
};

export const exportMessages: AppRouteHandler<ExportMessagesRoute> = async (c: any) => {
  try {
    const { queueType } = c.req.valid("param");
    const query = c.req.valid("query");

    // Force high limit for export to get all matching messages
    // The underlying getQueueMessages handles filtering and sorting
    const exportQuery = { ...query, limit: "1000000", page: "1" };

    const result = await queue.getQueueMessages(queueType, exportQuery);
    const jsonString = JSON.stringify(result.messages, null, 2);

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19); // YYYY-MM-DDTHH-mm-ss

    c.header("Content-Type", "application/json");
    c.header("Content-Disposition", `attachment; filename="${queueType}-queue-export-${timestamp}.json"`);

    return c.body(jsonString, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to export messages" }, 500);
  }
};

export const importMessages: AppRouteHandler<ImportMessagesRoute> = async (c: any) => {
  try {
    const body = await c.req.parseBody();
    const file = body['file'];

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

    // Transform to match QueueMessageSchema
    // The export format (DequeuedMessage) is slightly different from import (QueueMessage)
    // We need to map fields:
    // - custom_ack_timeout -> ackTimeout
    // - custom_max_attempts -> maxAttempts
    // - priority -> priority
    // - type -> type
    // - payload -> payload

    const batch = messages.map((m: any) => ({
      type: m.type || "default",
      payload: m.payload || {},
      priority: m.priority,
      ackTimeout: m.custom_ack_timeout || m.ackTimeout,
      maxAttempts: m.custom_max_attempts || m.maxAttempts,
    }));

    // Use existing batch enqueue logic
    const enqueuedCount = await queue.enqueueBatch(batch);

    return c.json({
      message: `Imported ${enqueuedCount} messages successfully`,
      count: enqueuedCount
    }, 200);

  } catch (error: any) {
    return c.json({ message: error.message || "Failed to import messages" }, 500);
  }
};

export const moveMessages: AppRouteHandler<MoveMessagesRoute> = async (c: any) => {
  try {
    const { messages, fromQueue, toQueue, errorReason } = c.req.valid("json");
    const movedCount = await queue.moveMessages(messages, fromQueue, toQueue, { errorReason });
    return c.json(
      { message: `${movedCount} messages moved successfully`, movedCount },
      200
    );
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to move messages" }, 500);
  }
};

export const deleteMessage: AppRouteHandler<any> = async (c: any) => {
  try {
    const { messageId } = c.req.valid("param");
    const { queueType } = c.req.valid("query");

    const result = await queue.deleteMessage(messageId, queueType);
    return c.json(result, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to delete message" }, 500);
  }
};

export const deleteMessages: AppRouteHandler<any> = async (c: any) => {
  try {
    const { queueType } = c.req.valid("query");
    const { messageIds } = c.req.valid("json");

    const deletedCount = await queue.deleteMessages(messageIds, queueType);
    return c.json({
      success: true,
      deletedCount,
      message: `${deletedCount} messages deleted successfully`
    }, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to delete messages" }, 500);
  }
};

export const updateMessage: AppRouteHandler<any> = async (c: any) => {
  try {
    const { messageId } = c.req.valid("param");
    const { queueType } = c.req.valid("query");
    const updates = c.req.valid("json");

    const result = await queue.updateMessage(messageId, queueType, updates);
    return c.json(result, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to update message" }, 500);
  }
};

export const clearAllQueues: AppRouteHandler<ClearAllQueuesRoute> = async (c: any) => {
  try {
    await queue.clearAllQueues();
    return c.json({ message: "All queues cleared successfully" }, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to clear queues" }, 500);
  }
};

export const clearQueue: AppRouteHandler<ClearQueueRoute> = async (c: any) => {
  try {
    const { queueType } = c.req.valid("param");
    await queue.clearQueue(queueType);
    return c.json({
      success: true,
      queueType,
      message: `${queueType} queue cleared successfully`
    }, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to clear queue" }, 500);
  }
};

export const getConfig: AppRouteHandler<GetConfigRoute> = async (c: any) => {
  try {
    return c.json({
      ack_timeout_seconds: queueConfig.ack_timeout_seconds,
      max_attempts: queueConfig.max_attempts,
    }, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to get config" }, 500);
  }
};

// === Activity Log Handlers ===

export const getActivityLogs: AppRouteHandler<any> = async (c: any) => {
  try {
    const query = c.req.query();
    const filters = {
      message_id: query.message_id?.trim(),
      consumer_id: query.consumer_id?.trim(),
      action: query.action,
      has_anomaly: query.has_anomaly === "true" ? true : query.has_anomaly === "false" ? false : undefined,
      anomaly_type: query.anomaly_type,
      start_time: query.start_time ? parseFloat(query.start_time) : undefined,
      end_time: query.end_time ? parseFloat(query.end_time) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 100,
      offset: query.offset ? parseInt(query.offset, 10) : 0,
    };

    const result = await queue.getActivityLogs(filters);
    return c.json(result, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to get activity logs" }, 500);
  }
};

export const getMessageHistory: AppRouteHandler<any> = async (c: any) => {
  try {
    const { messageId } = c.req.param();
    const trimmedId = messageId?.trim();
    const history = await queue.getMessageHistory(trimmedId);
    return c.json({ message_id: trimmedId, history }, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to get message history" }, 500);
  }
};

export const getAnomalies: AppRouteHandler<any> = async (c: any) => {
  try {
    const query = c.req.query();
    const filters = {
      severity: query.severity,
      type: query.type,
      start_time: query.start_time ? parseFloat(query.start_time) : undefined,
      end_time: query.end_time ? parseFloat(query.end_time) : undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 100,
    };

    const result = await queue.getAnomalies(filters);
    return c.json(result, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to get anomalies" }, 500);
  }
};

export const getConsumerStats: AppRouteHandler<any> = async (c: any) => {
  try {
    const query = c.req.query();
    const consumerId = query.consumer_id;
    const stats = await queue.getConsumerStats(consumerId);
    return c.json({ stats }, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to get consumer stats" }, 500);
  }
};

export const clearActivityLogs: AppRouteHandler<any> = async (c: any) => {
  try {
    await queue.clearActivityLogs();
    return c.json({ message: "Activity logs and stats cleared successfully" }, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to clear activity logs" }, 500);
  }
};
