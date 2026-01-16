import { createRouter } from "../../lib/create-app";
import * as handlers from "./queue.handlers";
import * as routes from "./queue.routes";

const router = createRouter()
  // Queue Management Routes (must be before specific queue routes)
  .openapi(routes.createQueue, handlers.createQueueHandler)
  .openapi(routes.listQueues, handlers.listQueuesHandler)
  .openapi(routes.getQueue, handlers.getQueueHandler)
  .openapi(routes.updateQueue, handlers.updateQueueHandler)
  .openapi(routes.deleteQueue, handlers.deleteQueueHandler)
  .openapi(routes.purgeQueue, handlers.purgeQueueHandler)
  .openapi(routes.renameQueue, handlers.renameQueueHandler)
  // Message Routes
  .openapi(routes.addMessage, handlers.addMessage)
  .openapi(routes.addBatch, handlers.addBatch)
  .openapi(routes.getMessage, handlers.getMessage)
  .openapi(routes.getMessagesBatch, handlers.getMessagesBatch)
  .openapi(routes.acknowledgeMessage, handlers.acknowledgeMessage)
  .openapi(routes.acknowledgeMessagesBatch, handlers.acknowledgeMessagesBatch)
  .openapi(routes.nackMessagesBatch, handlers.nackMessagesBatch)
  .openapi(routes.nackMessage, handlers.nackMessage)
  .openapi(routes.touchMessage, handlers.touchMessage)
  .openapi(routes.metrics, handlers.metrics)
  .openapi(routes.healthCheck, handlers.healthCheck)
  .openapi(routes.getQueueStatus, handlers.getQueueStatus)
  .openapi(
    routes.removeMessagesByDateRange,
    handlers.removeMessagesByDateRange
  )
  .openapi(
    routes.getMessagesByDateRange,
    handlers.getMessagesByDateRange
  )
  .openapi(routes.deleteMessage, handlers.deleteMessage)
  .openapi(routes.deleteMessages, handlers.deleteMessages)
  .openapi(routes.updateMessage, handlers.updateMessage)
  .openapi(routes.getMessages, handlers.getMessages)
  .openapi(routes.exportMessages, handlers.exportMessages)
  .openapi(routes.importMessages, handlers.importMessages)
  .openapi(routes.moveMessages, handlers.moveMessages)
  .openapi(routes.clearActivityLogs, handlers.clearActivityLogs)
  .openapi(routes.clearQueue, handlers.clearQueue)
  .openapi(routes.clearAllQueues, handlers.clearAllQueues)
  .openapi(routes.getConfig, handlers.getConfig)
  .openapi(routes.getEvents, handlers.getEvents)
  // Activity Log Routes
  .openapi(routes.getActivityLogs, handlers.getActivityLogs)
  .openapi(routes.getMessageHistory, handlers.getMessageHistory)
  .openapi(routes.getAnomalies, handlers.getAnomalies)
  .openapi(routes.getConsumerStats, handlers.getConsumerStats);

export default router;
