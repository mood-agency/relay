import { QueueMessage } from "../../types.js";
import { QueueConfig } from "../../config.js";

/**
 * Events that can trigger anomaly detection
 */
export type AnomalyEvent =
  | "enqueue"
  | "dequeue"
  | "ack"
  | "nack"
  | "timeout_requeue"
  | "bulk_operation"
  | "periodic";

/**
 * Severity levels for anomalies
 */
export type AnomalySeverity = "info" | "warning" | "critical";

/**
 * Context provided to anomaly detectors during detection
 */
export interface DetectionContext {
  // The message being processed (if applicable)
  message?: QueueMessage;

  // Consumer information
  consumerId?: string | null;

  // Queue information
  queueName?: string;

  // Processing metrics
  processingTimeMs?: number;
  timeInQueueMs?: number;

  // For bulk operations
  operationType?: string;
  affectedCount?: number;

  // For timeout/requeue scenarios
  overdueMs?: number;
  expectedTimeoutMs?: number;

  // Error information
  errorReason?: string;

  // Lock token info (for lock-related detections)
  expectedLockToken?: string;
  receivedLockToken?: string;

  // Queue configuration
  config: QueueConfig;

  // Additional custom data
  extra?: Record<string, any>;
}

/**
 * Result returned by an anomaly detector when an anomaly is detected
 */
export interface AnomalyResult {
  type: string;
  severity: AnomalySeverity;
  messageId?: string | null;
  consumerId?: string | null;
  details: Record<string, any>;
}

/**
 * Interface that all anomaly detectors must implement
 */
export interface AnomalyDetector {
  /** Unique name for this detector */
  name: string;

  /** Human-readable description */
  description: string;

  /** Which event(s) trigger this detector */
  events: AnomalyEvent[];

  /** Whether this detector is enabled by default */
  enabledByDefault: boolean;

  /**
   * Detect anomalies based on the provided context
   * @returns AnomalyResult if anomaly detected, null otherwise
   */
  detect(context: DetectionContext): Promise<AnomalyResult | null>;
}

/**
 * Options for registering a detector
 */
export interface DetectorRegistrationOptions {
  /** Override the default enabled state */
  enabled?: boolean;

  /** Custom configuration for this detector */
  config?: Record<string, any>;
}
