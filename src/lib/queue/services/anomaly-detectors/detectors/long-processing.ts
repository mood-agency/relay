import { AnomalyDetector, DetectionContext, AnomalyResult } from "../types.js";

/**
 * Detects messages that take an unusually long time to process.
 * Long processing times can indicate:
 * - Performance issues in the consumer
 * - Complex or problematic payloads
 * - External dependency delays
 */
export const longProcessingDetector: AnomalyDetector = {
  name: "long_processing",
  description: "Detects messages with processing time exceeding threshold",
  events: ["ack"],
  enabledByDefault: true,

  async detect(context: DetectionContext): Promise<AnomalyResult | null> {
    const { message, consumerId, processingTimeMs, config } = context;

    if (!message || processingTimeMs === undefined) {
      return null;
    }

    const threshold =
      (config as any).activity_long_processing_threshold_ms ?? 30000;

    if (processingTimeMs > threshold) {
      return {
        type: "long_processing",
        severity: "warning",
        messageId: message.id,
        consumerId: consumerId ?? null,
        details: {
          processing_time_ms: processingTimeMs,
          threshold_ms: threshold,
          queue_name: message.queue_name,
          payload: message.payload,
        },
      };
    }

    return null;
  },
};
