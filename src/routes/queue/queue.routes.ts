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

Ahora puedes usar la API con estos endpoints:
POST /queue/message - Encolar un mensaje
POST /queue/batch - Encolar múltiples mensajes
GET /queue/message?timeout=30 - Obtener un mensaje de la cola
POST /queue/ack - Confirmar procesamiento de un mensaje
GET /queue/metrics - Obtener métricas de la cola
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
    query: z.object({ timeout: z.number().optional() }),
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
export type MetricsRoute = typeof metrics;
export type HealthCheckRoute = typeof healthCheck;
