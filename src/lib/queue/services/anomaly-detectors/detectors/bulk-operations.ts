import { AnomalyDetector, DetectionContext, AnomalyResult } from "../types.js";

/**
 * Detects bulk operations that affect many messages at once.
 * Tracks bulk enqueues, deletes, and moves.
 *
 * Useful for:
 * - Auditing large-scale queue operations
 * - Detecting unusual activity patterns
 * - Capacity planning
 */
export const bulkEnqueueDetector: AnomalyDetector = {
  name: "bulk_enqueue",
  description: "Detects bulk enqueue operations",
  events: ["bulk_operation"],
  enabledByDefault: true,

  async detect(context: DetectionContext): Promise<AnomalyResult | null> {
    const { operationType, affectedCount, queueName, consumerId, config } =
      context;

    if (operationType !== "enqueue" || !affectedCount) {
      return null;
    }

    const threshold = (config as any).activity_bulk_threshold ?? 10;

    if (affectedCount >= threshold) {
      return {
        type: "bulk_enqueue",
        severity: "info",
        messageId: null,
        consumerId: consumerId ?? null,
        details: {
          queue_name: queueName,
          count: affectedCount,
          threshold,
        },
      };
    }

    return null;
  },
};

export const bulkDeleteDetector: AnomalyDetector = {
  name: "bulk_delete",
  description: "Detects bulk delete operations",
  events: ["bulk_operation"],
  enabledByDefault: true,

  async detect(context: DetectionContext): Promise<AnomalyResult | null> {
    const { operationType, affectedCount, queueName, consumerId, extra } =
      context;

    if (operationType !== "delete" || !affectedCount) {
      return null;
    }

    return {
      type: "bulk_delete",
      severity: "info",
      messageId: null,
      consumerId: consumerId ?? null,
      details: {
        queue_name: queueName,
        count: affectedCount,
        source_status: extra?.sourceStatus,
      },
    };
  },
};

export const bulkMoveDetector: AnomalyDetector = {
  name: "bulk_move",
  description: "Detects bulk move operations between queues/statuses",
  events: ["bulk_operation"],
  enabledByDefault: true,

  async detect(context: DetectionContext): Promise<AnomalyResult | null> {
    const { operationType, affectedCount, queueName, consumerId, extra } =
      context;

    if (operationType !== "move" || !affectedCount) {
      return null;
    }

    return {
      type: "bulk_move",
      severity: "info",
      messageId: null,
      consumerId: consumerId ?? null,
      details: {
        queue_name: queueName,
        count: affectedCount,
        source_status: extra?.sourceStatus,
        target_status: extra?.targetStatus,
      },
    };
  },
};

export const queueClearedDetector: AnomalyDetector = {
  name: "queue_cleared",
  description: "Detects when a queue is completely cleared",
  events: ["bulk_operation"],
  enabledByDefault: true,

  async detect(context: DetectionContext): Promise<AnomalyResult | null> {
    const { operationType, affectedCount, queueName, consumerId, extra } =
      context;

    if (operationType !== "clear" || !affectedCount) {
      return null;
    }

    return {
      type: "queue_cleared",
      severity: "warning",
      messageId: null,
      consumerId: consumerId ?? null,
      details: {
        queue_name: queueName,
        count: affectedCount,
        status: extra?.status,
      },
    };
  },
};
