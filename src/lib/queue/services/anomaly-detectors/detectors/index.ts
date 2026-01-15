// Re-export all built-in anomaly detectors
export { flashMessageDetector } from "./flash-message.js";
export { largePayloadDetector } from "./large-payload.js";
export { longProcessingDetector } from "./long-processing.js";
export { lockStolenDetector } from "./lock-stolen.js";
export { nearDlqDetector } from "./near-dlq.js";
export { dlqMovementDetector } from "./dlq-movement.js";
export { zombieMessageDetector } from "./zombie-message.js";
export { burstDequeueDetector } from "./burst-dequeue.js";
export {
  bulkEnqueueDetector,
  bulkDeleteDetector,
  bulkMoveDetector,
  queueClearedDetector,
} from "./bulk-operations.js";

import { AnomalyDetector } from "../types.js";
import { flashMessageDetector } from "./flash-message.js";
import { largePayloadDetector } from "./large-payload.js";
import { longProcessingDetector } from "./long-processing.js";
import { lockStolenDetector } from "./lock-stolen.js";
import { nearDlqDetector } from "./near-dlq.js";
import { dlqMovementDetector } from "./dlq-movement.js";
import { zombieMessageDetector } from "./zombie-message.js";
import { burstDequeueDetector } from "./burst-dequeue.js";
import {
  bulkEnqueueDetector,
  bulkDeleteDetector,
  bulkMoveDetector,
  queueClearedDetector,
} from "./bulk-operations.js";

/**
 * All built-in anomaly detectors
 */
export const builtInDetectors: AnomalyDetector[] = [
  // Dequeue detectors
  flashMessageDetector,
  burstDequeueDetector,

  // Enqueue detectors
  largePayloadDetector,

  // Ack detectors
  longProcessingDetector,
  lockStolenDetector,

  // Nack detectors
  nearDlqDetector,
  dlqMovementDetector,

  // Timeout/requeue detectors
  zombieMessageDetector,

  // Bulk operation detectors
  bulkEnqueueDetector,
  bulkDeleteDetector,
  bulkMoveDetector,
  queueClearedDetector,
];
