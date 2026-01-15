import { AnomalyDetector, DetectionContext, AnomalyResult } from "../types.js";

/**
 * Detects burst dequeue patterns - when a consumer is dequeuing
 * messages at an unusually high rate.
 *
 * This can indicate:
 * - A consumer in a tight loop
 * - Load testing activity
 * - Potential resource exhaustion
 *
 * Note: This detector requires additional context about recent dequeue activity,
 * which should be passed via the `extra` field.
 */
export const burstDequeueDetector: AnomalyDetector = {
  name: "burst_dequeue",
  description: "Detects high rate of dequeue operations from a consumer",
  events: ["dequeue"],
  enabledByDefault: true,

  async detect(context: DetectionContext): Promise<AnomalyResult | null> {
    const { consumerId, queueName, config, extra } = context;

    if (!consumerId || !extra?.recentDequeueCount) {
      return null;
    }

    const burstThresholdCount =
      (config as any).activity_burst_threshold_count ?? 50;
    const burstThresholdSeconds =
      (config as any).activity_burst_threshold_seconds ?? 5;

    const dequeueCount = extra.recentDequeueCount as number;

    if (dequeueCount >= burstThresholdCount) {
      return {
        type: "burst_dequeue",
        severity: "warning",
        messageId: null,
        consumerId,
        details: {
          queue_name: queueName,
          dequeue_count: dequeueCount,
          window_seconds: burstThresholdSeconds,
          threshold: burstThresholdCount,
        },
      };
    }

    return null;
  },
};
