import { AnomalyDetector, DetectionContext, AnomalyResult } from "../types.js";

/**
 * Detects messages that are dequeued very quickly after being enqueued.
 * This could indicate:
 * - Testing/debugging activity
 * - A very fast producer-consumer loop
 * - Potential issues with queue configuration
 */
export const flashMessageDetector: AnomalyDetector = {
  name: "flash_message",
  description:
    "Detects messages dequeued within milliseconds of being enqueued",
  events: ["dequeue"],
  enabledByDefault: true,

  async detect(context: DetectionContext): Promise<AnomalyResult | null> {
    const { message, consumerId, queueName, timeInQueueMs, config } = context;

    if (!message || timeInQueueMs === undefined) {
      return null;
    }

    const threshold =
      (config as any).activity_flash_message_threshold_ms ?? 1000;

    if (timeInQueueMs < threshold) {
      return {
        type: "flash_message",
        severity: "warning",
        messageId: message.id,
        consumerId: consumerId ?? null,
        details: {
          time_in_queue_ms: timeInQueueMs,
          threshold,
          queue_name: queueName,
          payload: message.payload,
        },
      };
    }

    return null;
  },
};
