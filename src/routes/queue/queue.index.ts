import { createRouter } from "@/lib/create-app";
import * as handlers from "./queue.handlers";
import * as routes from "./queue.routes";

const router = createRouter()
  .openapi(routes.addMessage, handlers.addMessage)
  .openapi(routes.addBatch, handlers.addBatch)
  .openapi(routes.getMessage, handlers.getMessage)
  .openapi(routes.acknowledgeMessage, handlers.acknowledgeMessage)
  .openapi(routes.metrics, handlers.metrics)
  .openapi(routes.healthCheck, handlers.healthCheck);

export default router;
