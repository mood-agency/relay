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
  DequeuedMessage,
} from "./queue.routes";
import type { AppRouteHandler } from "@/config/types";

import env from "@/config/env";
import { OptimizedRedisQueue, QueueConfig } from "@/lib/redis.js";
interface QueueConfigI {
  redis_host: string;
  redis_port: number;
  redis_db: number;
  redis_password: string | null | undefined;
  queue_name: string;
  processing_queue_name: string;
  dead_letter_queue_name: string;
  metadata_hash_name: string;
  ack_timeout_seconds: number;
  max_attempts: number;
  batch_size: number;
  redis_pool_size: number;
  enable_message_encryption: string;
  secret_key: string | null | undefined;
}

const queueConfig: QueueConfigI = {
  redis_host: env.REDIS_HOST,
  redis_port: env.REDIS_PORT,
  redis_db: env.REDIS_DB,
  redis_password: env.REDIS_PASSWORD,
  queue_name: env.QUEUE_NAME,
  processing_queue_name: env.PROCESSING_QUEUE_NAME,
  dead_letter_queue_name: env.DEAD_LETTER_QUEUE_NAME,
  metadata_hash_name: env.METADATA_HASH_NAME,
  ack_timeout_seconds: env.ACK_TIMEOUT_SECONDS,
  max_attempts: env.MAX_ATTEMPTS,
  batch_size: env.BATCH_SIZE,
  redis_pool_size: env.REDIS_POOL_SIZE,
  enable_message_encryption: env.ENABLE_ENCRYPTION,
  secret_key: env.SECRET_KEY,
};

const queue = new OptimizedRedisQueue(new QueueConfig(queueConfig));

export const addMessage: AppRouteHandler<AddMessageRoute> = async (c: any) => {
  const { type, payload, priority } = c.req.valid("json");

  const message = await queue.enqueueMessage({
    type,
    payload,
    priority,
  });

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

export const getMessage: AppRouteHandler<GetMessageRoute> = async (c: any) => {
  const { timeout } = c.req.valid("query");
  const message = (await queue.dequeueMessage(timeout)) as DequeuedMessage;
  if (!message) {
    return c.json({ message: "Message not found" }, 404);
  }
  return c.json(message, 200);
};

export const acknowledgeMessage: AppRouteHandler<
  AcknowledgeMessageRoute
> = async (c: any) => {
  const message = c.req.valid("json");
  const acknowledged = await queue.acknowledgeMessage(message);
  if (!acknowledged) {
    return c.json({ message: "Message not acknowledged" }, 400);
  }
  return c.json({ message: "Message acknowledged" }, 200);
};

export const metrics: AppRouteHandler<MetricsRoute> = async (c:any) => {
  const metrics = await queue.getMetrics();
  return c.json(metrics, 200);
};

export const healthCheck: AppRouteHandler<HealthCheckRoute> = async (c:any) => {
  const health = await queue.healthCheck();
  if (!health) {
    return c.json({ status: "ERROR" }, 500);
  }
  return c.json({ status: "OK" }, 200);
};

export const removeMessagesByDateRange: AppRouteHandler<
  RemoveMessagesByDateRangeRoute
> = async (c:any) => {
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
    const status = await queue.getQueueStatus();
    return c.json(status, 200);
  } catch (error) {
    return c.json({ message: "Failed to get queue status" }, 500);
  }
};

export const deleteMessage: AppRouteHandler<any> = async (c: any) => {
  try {
    const { messageId } = c.req.param();
    const { queueType } = await c.req.json();
    
    if (!messageId) {
      return c.json({ message: "Message ID is required" }, 400);
    }
    
    if (!queueType || !['main', 'processing', 'dead'].includes(queueType)) {
      return c.json({ message: "Valid queue type is required (main, processing, dead)" }, 400);
    }
    
    const result = await queue.deleteMessage(messageId, queueType);
    return c.json(result, 200);
  } catch (error: any) {
    return c.json({ message: error.message || "Failed to delete message" }, 500);
  }
};
