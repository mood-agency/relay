import { createRoute, z } from "@hono/zod-openapi";
import { jsonContent, jsonContentRequired } from "stoker/openapi/helpers";
import { createErrorSchema } from "stoker/openapi/schemas";
import {
  notFoundSchema,
  paginationSchema,
  UUIDParamsSchema,
} from "@/utils/schemas.utils";

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
});

export type QueueMessage = z.infer<typeof QueueMessageSchema>;

export const DequeuedMessageSchema = z.object({
  id: z.string(),
  type: z.string(),
  payload: z.any(),
  created_at: z.number(),
  priority: z.number().optional(),
  attempt_count: z.number(),
  dequeued_at: z.number().nullable(),
  last_error: z.string().nullable(),
  processing_duration: z.number(),
  acknowledged_at: z.number().optional(),
});

export type DequeuedMessage = z.infer<typeof DequeuedMessageSchema>;

export const AcknowledgedMessageSchema =
  DequeuedMessageSchema.partial().required({
    id: true,
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
    query: z.object({ timeout: z.string().pipe(z.coerce.number()).optional() }),
  },
  responses: {
    200: jsonContent(DequeuedMessageSchema, "Queue Message"),
    404: jsonContent(z.object({ message: z.string() }), "Message not found"),
    422: jsonContent(
      createErrorSchema(z.object({ timeout: z.number().optional() })),
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

export type AddMessageRoute = typeof addMessage;
export type AddBatchRoute = typeof addBatch;
export type GetMessageRoute = typeof getMessage;
export type AcknowledgeMessageRoute = typeof acknowledgeMessage;
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
      queueType: z.enum(["main", "processing", "dead", "acknowledged"]),
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

export type GetMessagesRoute = typeof getMessages;

export const deleteMessage = createRoute({
  path: "/queue/message/:messageId",
  method: "delete",
  tags,
  request: {
    params: z.object({
      messageId: z.string(),
    }),
    query: z.object({
      queueType: z.enum(["main", "processing", "dead", "acknowledged"]),
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

export type DeleteMessageRoute = typeof deleteMessage;

export const updateMessage = createRoute({
  path: "/queue/message/:messageId",
  method: "put",
  tags,
  request: {
    params: z.object({
      messageId: z.string(),
    }),
    query: z.object({
      queueType: z.enum(["main", "dead"]),
    }),
    body: jsonContentRequired(
      z.object({
        type: z.string().optional(),
        payload: z.any().optional(),
        priority: z.number().optional(),
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
      queueType: z.enum(["main", "processing", "dead", "acknowledged"]),
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
