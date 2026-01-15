import { generateId } from "./utils.js";

/**
 * Configuration class for the PostgreSQL Queue.
 * Validates and stores configuration settings.
 */
export class QueueConfig {
  /**
   * Creates a new QueueConfig instance.
   * @param {Object} config - Configuration object.
   * @param {string} [config.postgres_host="localhost"] - PostgreSQL host.
   * @param {string|number} [config.postgres_port="5432"] - PostgreSQL port.
   * @param {string} [config.postgres_database="relay"] - PostgreSQL database name.
   * @param {string} [config.postgres_user="postgres"] - PostgreSQL user.
   * @param {string} [config.postgres_password=""] - PostgreSQL password.
   * @param {string|number} [config.postgres_pool_size="10"] - Connection pool size.
   * @param {boolean} [config.postgres_ssl=false] - Enable SSL for PostgreSQL connection.
   * @param {string} [config.queue_name="queue"] - Base name for the queue.
   * @param {string|number} [config.ack_timeout_seconds="30"] - Acknowledgment timeout in seconds.
   * @param {string|number} [config.max_attempts="3"] - Maximum retry attempts.
   * @param {string|number} [config.requeue_batch_size="100"] - Batch size for requeue operations.
   * @param {string|number} [config.max_priority_levels="10"] - Number of priority levels (0-9).
   * @param {string} [config.events_channel="queue_events"] - PostgreSQL NOTIFY channel for events.
   */
  constructor(config) {
    // PostgreSQL connection settings
    this.postgres_host = config.postgres_host || "localhost";
    this.postgres_port = parseInt(config.postgres_port || "5432", 10);
    this.postgres_database = config.postgres_database || "relay";
    this.postgres_user = config.postgres_user || "postgres";
    this.postgres_password = config.postgres_password || "";
    this.postgres_pool_size = parseInt(config.postgres_pool_size || "10", 10);
    this.postgres_ssl = config.postgres_ssl === true || config.postgres_ssl === "true";

    // Queue settings
    this.queue_name = config.queue_name || "queue";
    this.ack_timeout_seconds = parseInt(config.ack_timeout_seconds || "30", 10);
    this.max_attempts = parseInt(config.max_attempts || "3", 10);
    this.requeue_batch_size = parseInt(config.requeue_batch_size || "100", 10);

    // Priority configuration (0-9 = 10 levels, higher number = higher priority)
    this.max_priority_levels = parseInt(config.max_priority_levels || "10", 10);

    // Events channel for LISTEN/NOTIFY
    this.events_channel = config.events_channel || "queue_events";

    // Actor name for system/automated operations (timeouts, requeue, etc.)
    this.relay_actor = config.relay_actor || "relay-actor";

    // Actor name for manual user operations (via dashboard/API)
    this.manual_operation_actor = config.manual_operation_actor || "user-manual-operation";

    // Activity Log Configuration
    this.activity_log_enabled =
      config.activity_log_enabled === true ||
      (typeof config.activity_log_enabled === "string" &&
        config.activity_log_enabled.toLowerCase() === "true") ||
      config.activity_log_enabled === undefined;
    this.activity_log_retention_hours = parseInt(
      config.activity_log_retention_hours || "24",
      10
    );

    // Anomaly Detection Thresholds
    this.activity_burst_threshold_count = parseInt(
      config.activity_burst_threshold_count || "50",
      10
    );
    this.activity_burst_threshold_seconds = parseInt(
      config.activity_burst_threshold_seconds || "5",
      10
    );
    this.activity_flash_message_threshold_ms = parseInt(
      config.activity_flash_message_threshold_ms || "500",
      10
    );
    this.activity_long_processing_threshold_ms = parseInt(
      config.activity_long_processing_threshold_ms || "10000",
      10
    );
    this.activity_bulk_operation_threshold = parseInt(
      config.activity_bulk_operation_threshold || "5",
      10
    );
    this.activity_large_payload_threshold_bytes = parseInt(
      config.activity_large_payload_threshold_bytes || "5000",
      10
    );

    // Additional Anomaly Detection Thresholds
    this.activity_zombie_threshold_multiplier = parseInt(
      config.activity_zombie_threshold_multiplier || "2",
      10
    );
    this.activity_near_dlq_threshold = parseInt(
      config.activity_near_dlq_threshold || "1",
      10
    );

    // Enqueue Buffering Configuration
    this.enqueue_buffer_enabled =
      config.enqueue_buffer_enabled === true ||
      config.enqueue_buffer_enabled === "true";
    this.enqueue_buffer_max_size = parseInt(
      config.enqueue_buffer_max_size || "50",
      10
    );
    this.enqueue_buffer_max_wait_ms = parseInt(
      config.enqueue_buffer_max_wait_ms || "100",
      10
    );

    this._validate();
  }

  /**
   * Validates the configuration.
   * @private
   * @throws {Error} If validation fails.
   */
  _validate() {
    if (this.ack_timeout_seconds <= 0) {
      throw new Error("ACK_TIMEOUT_SECONDS must be greater than 0");
    }
    if (this.max_attempts <= 0) {
      throw new Error("MAX_ATTEMPTS must be greater than 0");
    }
    if (this.max_priority_levels < 1 || this.max_priority_levels > 10) {
      throw new Error("MAX_PRIORITY_LEVELS must be between 1 and 10");
    }
  }
}
