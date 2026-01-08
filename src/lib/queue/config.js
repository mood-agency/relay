import { generateId } from "./utils.js";

/**
 * Configuration class for the Redis Queue.
 * Validates and stores configuration settings.
 */
export class QueueConfig {
  /**
   * Creates a new QueueConfig instance.
   * @param {Object} config - Configuration object.
   * @param {string} [config.redis_host="localhost"] - Redis host.
   * @param {string|number} [config.redis_port="6379"] - Redis port.
   * @param {string|number} [config.redis_db="0"] - Redis database index.
   * @param {string} [config.redis_password=null] - Redis password.
   * @param {string} [config.queue_name="queue"] - Base name for the queue.
   * @param {string} [config.processing_queue_name="queue_processing"] - Name for processing queue (legacy/virtual).
   * @param {string} [config.dead_letter_queue_name="queue_dlq"] - Name for dead letter queue.
   * @param {string} [config.archived_queue_name="queue_archived"] - Name for archived queue.
   * @param {string} [config.acknowledged_queue_name="queue_acknowledged"] - Name for acknowledged queue.
   * @param {string} [config.total_acknowledged_key="queue:stats:total_acknowledged"] - Redis key for total ack stats.
   * @param {string} [config.metadata_hash_name="queue_metadata"] - Redis hash name for metadata.
   * @param {string} [config.consumer_group_name="queue_group"] - Redis stream consumer group name.
   * @param {string} [config.consumer_name] - Unique consumer name. Defaults to generated ID.
   * @param {string|number} [config.ack_timeout_seconds="30"] - Acknowledgment timeout in seconds.
   * @param {string|number} [config.max_attempts="3"] - Maximum retry attempts.
   * @param {string|number} [config.requeue_batch_size="100"] - Batch size for requeue operations.
   * @param {string|number} [config.max_acknowledged_history="100"] - Max history size for acknowledged messages.
   * @param {string|number} [config.redis_pool_size="10"] - Redis connection pool size (informational).
   * @param {string|number} [config.max_priority_levels="10"] - Number of priority levels (0-9).
   * @param {string} [config.enable_message_encryption="false"] - Enable encryption ("true"/"false").
   * @param {string} [config.secret_key] - Secret key for encryption (required if enabled).
   * @param {string} [config.events_channel="queue_events"] - Redis channel for events.
   */
  constructor(config) {
    this.redis_host = config.redis_host || "localhost";
    this.redis_port = parseInt(config.redis_port || "6379", 10);
    this.redis_db = parseInt(config.redis_db || "0", 10);
    this.redis_password = config.redis_password || null;

    this.queue_name = config.queue_name || "queue";
    this.processing_queue_name = config.processing_queue_name || "queue_processing";
    this.dead_letter_queue_name = config.dead_letter_queue_name || "queue_dlq";
    this.archived_queue_name = config.archived_queue_name || "queue_archived";
    this.acknowledged_queue_name = config.acknowledged_queue_name || "queue_acknowledged";
    this.total_acknowledged_key = config.total_acknowledged_key || "queue:stats:total_acknowledged";
    this.metadata_hash_name = config.metadata_hash_name || "queue_metadata";
    
    // Stream-specific configuration
    this.consumer_group_name = config.consumer_group_name || "queue_group";
    this.consumer_name = config.consumer_name || `consumer-${generateId()}`;

    this.ack_timeout_seconds = parseInt(config.ack_timeout_seconds || "30", 10);
    this.max_attempts = parseInt(config.max_attempts || "3", 10);
    this.requeue_batch_size = parseInt(config.requeue_batch_size || "100", 10);
    this.max_acknowledged_history = parseInt(config.max_acknowledged_history || "100", 10);
    this.connection_pool_size = parseInt(config.redis_pool_size || "10", 10);
    
    // Priority configuration (0-9 = 10 levels, higher number = higher priority)
    this.max_priority_levels = parseInt(config.max_priority_levels || "10", 10);

    this.enable_message_encryption =
      (config.enable_message_encryption || "false").toLowerCase() === "true";
    this.secret_key = config.secret_key || null;

    this.events_channel = config.events_channel || "queue_events";

    this._validate();
  }

  /**
   * Validates the configuration.
   * @private
   * @throws {Error} If validation fails.
   */
  _validate() {
    if (this.enable_message_encryption && !this.secret_key) {
      throw new Error("SECRET_KEY is required when encryption is enabled");
    }
    if (this.ack_timeout_seconds <= 0) {
      throw new Error("ACK_TIMEOUT_SECONDS must be greater than 0");
    }
    if (this.max_attempts <= 0) {
      throw new Error("MAX_ATTEMPTS must be greater than 0");
    }
    // Max safe priority levels to prevent score overflow in type index
    // 900 * 10^13 < MAX_SAFE_INTEGER
    if (this.max_priority_levels > 900) {
      throw new Error("MAX_PRIORITY_LEVELS must be 900 or less to ensure index stability");
    }
  }
}
