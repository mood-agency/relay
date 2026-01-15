import { AnomalyDetector, DetectionContext, AnomalyResult } from "../types.js";

/**
 * Detects when a message is moved to the dead letter queue.
 * This happens when a message has exhausted all retry attempts.
 *
 * Important for:
 * - Tracking message failures
 * - Alerting on critical business messages
 * - Monitoring system health
 */
export const dlqMovementDetector: AnomalyDetector = {
  name: "dlq_movement",
  description: "Detects messages moved to dead letter queue",
  events: ["nack", "timeout_requeue"],
  enabledByDefault: true,

  async detect(context: DetectionContext): Promise<AnomalyResult | null> {
    const { message, consumerId, errorReason, extra } = context;

    if (!message) {
      return null;
    }

    // Check if this is a DLQ movement (attempt_count >= max_attempts)
    const attemptCount = extra?.attemptCount ?? message.attempt_count;
    const maxAttempts = extra?.maxAttempts ?? message.max_attempts;
    const isMovingToDlq = extra?.isMovingToDlq === true;

    if (isMovingToDlq || attemptCount >= maxAttempts) {
      return {
        type: "dlq_movement",
        severity: "warning",
        messageId: message.id,
        consumerId: consumerId ?? null,
        details: {
          queue_name: message.queue_name,
          reason: errorReason || "max_attempts_exceeded",
          attempt_count: attemptCount,
          max_attempts: maxAttempts,
          payload: message.payload,
        },
      };
    }

    return null;
  },
};
