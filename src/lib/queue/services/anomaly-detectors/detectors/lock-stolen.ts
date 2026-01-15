import { AnomalyDetector, DetectionContext, AnomalyResult } from "../types.js";

/**
 * Detects when a consumer tries to acknowledge a message but the lock token
 * doesn't match. This indicates the message was likely requeued due to timeout
 * and potentially picked up by another consumer.
 *
 * This is a critical anomaly as it indicates:
 * - Split-brain scenario where multiple consumers think they own the message
 * - Consumer taking too long and losing the lock
 * - Potential duplicate processing
 */
export const lockStolenDetector: AnomalyDetector = {
  name: "lock_stolen",
  description: "Detects lock token mismatch during acknowledgment",
  events: ["ack"],
  enabledByDefault: true,

  async detect(context: DetectionContext): Promise<AnomalyResult | null> {
    const { message, consumerId, expectedLockToken, receivedLockToken } =
      context;

    if (!expectedLockToken || !receivedLockToken) {
      return null;
    }

    if (expectedLockToken !== receivedLockToken) {
      return {
        type: "lock_stolen",
        severity: "critical",
        messageId: message?.id ?? null,
        consumerId: consumerId ?? null,
        details: {
          expected_token: expectedLockToken,
          received_token: receivedLockToken,
          queue_name: message?.queue_name,
        },
      };
    }

    return null;
  },
};
