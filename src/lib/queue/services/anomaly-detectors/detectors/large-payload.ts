import { AnomalyDetector, DetectionContext, AnomalyResult } from "../types.js";

/**
 * Detects messages with unusually large payloads.
 * Large payloads can:
 * - Impact queue performance
 * - Indicate misuse of the queue system
 * - Cause memory pressure on consumers
 */
export const largePayloadDetector: AnomalyDetector = {
  name: "large_payload",
  description: "Detects messages with payload size exceeding threshold",
  events: ["enqueue"],
  enabledByDefault: true,

  async detect(context: DetectionContext): Promise<AnomalyResult | null> {
    const { message, queueName, config } = context;

    if (!message) {
      return null;
    }

    const threshold =
      (config as any).activity_large_payload_threshold_bytes ?? 10000;
    const payloadSize = message.payload_size;

    if (payloadSize > threshold) {
      return {
        type: "large_payload",
        severity: "info",
        messageId: message.id,
        consumerId: null,
        details: {
          payload_size: payloadSize,
          threshold,
          queue_name: queueName,
        },
      };
    }

    return null;
  },
};
