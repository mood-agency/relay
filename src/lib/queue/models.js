/**
 * Represents metadata associated with a queue message.
 */
export class MessageMetadata {
  /**
   * Creates a new MessageMetadata instance.
   * @param {number} [attempt_count=0] - Number of processing attempts.
   * @param {number|null} [dequeued_at=null] - Timestamp when dequeued (seconds).
   * @param {number} [created_at=0.0] - Timestamp when created (seconds).
   * @param {string|null} [last_error=null] - Last error message encountered.
   * @param {number} [processing_duration=0.0] - Duration of processing.
   * @param {number|null} [custom_ack_timeout=null] - Custom timeout for this message.
   * @param {number|null} [custom_max_attempts=null] - Custom max attempts for this message.
   * @param {string|null} [consumer_id=null] - ID of the consumer that dequeued this message.
   */
  constructor(
    attempt_count = 0,
    dequeued_at = null,
    created_at = 0.0,
    last_error = null,
    processing_duration = 0.0,
    custom_ack_timeout = null,
    custom_max_attempts = null,
    consumer_id = null
  ) {
    this.attempt_count = attempt_count;
    this.dequeued_at = dequeued_at; // timestamp in seconds
    this.created_at = created_at; // timestamp in seconds
    this.last_error = last_error;
    this.processing_duration = processing_duration;
    this.custom_ack_timeout = custom_ack_timeout;
    this.custom_max_attempts = custom_max_attempts;
    this.consumer_id = consumer_id; // consumer that owns this message
  }

  /**
   * Creates a MessageMetadata instance from a plain object.
   * @param {Object} data - The plain object data.
   * @returns {MessageMetadata} A new instance.
   */
  static fromObject(data) {
    return new MessageMetadata(
      data.attempt_count,
      data.dequeued_at,
      data.created_at,
      data.last_error,
      data.processing_duration,
      data.custom_ack_timeout,
      data.custom_max_attempts,
      data.consumer_id
    );
  }
}

/**
 * Represents a message in the queue.
 */
export class QueueMessage {
  /**
   * Creates a new QueueMessage instance.
   * @param {string} id - Unique message ID.
   * @param {string} type - Message type identifier.
   * @param {Object} payload - Message payload.
   * @param {number} created_at - Creation timestamp (seconds).
   * @param {number} [priority=0] - Priority level (0-9).
   */
  constructor(id, type, payload, created_at, priority = 0) {
    this.id = id;
    this.type = type;
    this.payload = payload;
    this.created_at = created_at; // timestamp in seconds
    this.priority = priority;
  }

  /**
   * Creates a QueueMessage instance from a plain object.
   * @param {Object} data - The plain object data.
   * @returns {QueueMessage} A new instance.
   */
  static fromObject(data) {
    return new QueueMessage(
      data.id,
      data.type,
      data.payload,
      data.created_at,
      data.priority
    );
  }
}
