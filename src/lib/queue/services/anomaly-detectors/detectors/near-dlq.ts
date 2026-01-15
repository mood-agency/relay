import { AnomalyDetector, DetectionContext, AnomalyResult } from "../types.js";

/**
 * Detects messages that are close to being moved to the dead letter queue.
 * This provides early warning before a message fails permanently.
 *
 * Useful for:
 * - Proactive monitoring of problematic messages
 * - Taking action before complete failure
 * - Identifying patterns in failing messages
 */
export const nearDlqDetector: AnomalyDetector = {
  name: "near_dlq",
  description: "Detects messages approaching max retry attempts",
  events: ["nack"],
  enabledByDefault: true,

  async detect(context: DetectionContext): Promise<AnomalyResult | null> {
    const { message, consumerId, errorReason, config, extra } = context;

    if (!message) {
      return null;
    }

    const attemptCount = extra?.attemptCount ?? message.attempt_count;
    const maxAttempts = extra?.maxAttempts ?? message.max_attempts;
    const attemptsRemaining = maxAttempts - attemptCount;

    const threshold = (config as any).activity_near_dlq_threshold ?? 1;

    if (attemptsRemaining <= threshold && attemptsRemaining > 0) {
      return {
        type: "near_dlq",
        severity: "warning",
        messageId: message.id,
        consumerId: consumerId ?? null,
        details: {
          queue_name: message.queue_name,
          attempt_count: attemptCount,
          max_attempts: maxAttempts,
          attempts_remaining: attemptsRemaining,
          error_reason: errorReason,
          payload: message.payload,
        },
      };
    }

    return null;
  },
};
