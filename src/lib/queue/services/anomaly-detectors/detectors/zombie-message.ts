import { AnomalyDetector, DetectionContext, AnomalyResult } from "../types.js";

/**
 * Detects "zombie" messages - messages stuck in processing state
 * well beyond their expected timeout.
 *
 * This indicates:
 * - Consumer crashed without proper cleanup
 * - Network partition or connectivity issues
 * - Severe processing delays
 */
export const zombieMessageDetector: AnomalyDetector = {
  name: "zombie_message",
  description:
    "Detects messages stuck in processing state beyond expected timeout",
  events: ["timeout_requeue"],
  enabledByDefault: true,

  async detect(context: DetectionContext): Promise<AnomalyResult | null> {
    const { message, consumerId, overdueMs, expectedTimeoutMs, config } =
      context;

    if (!message || overdueMs === undefined || expectedTimeoutMs === undefined) {
      return null;
    }

    const zombieMultiplier =
      (config as any).activity_zombie_threshold_multiplier ?? 2;
    const zombieThreshold = expectedTimeoutMs * zombieMultiplier;

    if (overdueMs > zombieThreshold) {
      return {
        type: "zombie_message",
        severity: "critical",
        messageId: message.id,
        consumerId: consumerId ?? null,
        details: {
          queue_name: message.queue_name,
          overdue_ms: overdueMs,
          expected_timeout_ms: expectedTimeoutMs,
          multiplier: zombieMultiplier,
          attempt_count: message.attempt_count,
          payload: message.payload,
        },
      };
    }

    return null;
  },
};
