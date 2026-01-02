import { generateId, logger } from "./utils.js";
import { MessageMetadata } from "./models.js";

/**
 * Publishes an event to the events channel.
 * @param {string} type - Event type.
 * @param {Object} [payload={}] - Event payload.
 */
export async function publishEvent(type, payload = {}) {
  try {
    const event = JSON.stringify({
      type,
      timestamp: Date.now(),
      payload
    });
    await this.redisManager.redis.publish(this.config.events_channel, event);
  } catch (e) {
    logger.error(`Failed to publish event ${type}: ${e.message}`);
  }
}

/**
 * Gets the manual stream name.
 * @returns {string} The manual stream name.
 * @private
 */
export function _getManualStreamName() {
  return `${this.config.queue_name}_manual`;
}

/**
 * Gets the stream name for a specific priority level.
 * @param {number} priority - The priority level.
 * @returns {string} The stream name.
 * @private
 */
export function _getPriorityStreamName(priority) {
  const maxPriority = this.config.max_priority_levels - 1;
  const clampedPriority = Math.max(0, Math.min(priority, maxPriority));
  if (clampedPriority === 0) {
    return this.config.queue_name; // Base queue for priority 0
  }
  return `${this.config.queue_name}_p${clampedPriority}`;
}

/**
 * Gets all priority stream names.
 * @returns {string[]} Array of stream names.
 * @private
 */
export function _getAllPriorityStreams() {
  // Manual first, then Priority levels
  const streams = [this._getManualStreamName()];
  for (let p = this.config.max_priority_levels - 1; p >= 0; p--) {
    streams.push(this._getPriorityStreamName(p));
  }
  return streams;
}

/**
 * Gets all main queue streams.
 * @returns {string[]} Array of stream names.
 * @private
 */
export function _getAllMainQueueStreams() {
  return this._getAllPriorityStreams();
}

/**
 * Serializes a message.
 * @param {Object} message - The message object.
 * @returns {string} JSON string (signed if encryption enabled).
 * @private
 */
export function _serializeMessage(message) {
  let messageJson = JSON.stringify(message);
  if (this.redisManager.security) {
    messageJson = this.redisManager.security.signMessage(messageJson);
  }
  return messageJson;
}

/**
 * Deserializes a message.
 * @param {string} messageJson - The JSON string.
 * @returns {Object|null} The message object or null if invalid.
 * @private
 */
export function _deserializeMessage(messageJson) {
  try {
    if (this.redisManager.security) {
      messageJson = this.redisManager.security.verifyMessage(messageJson);
      if (messageJson === null) {
        logger.error("Message with invalid signature detected");
        return null;
      }
    }
    return JSON.parse(messageJson);
  } catch (e) {
    logger.error(`Error deserializing message: ${e}`);
    return null;
  }
}

/**
 * Ensures the consumer group exists for a stream.
 * @param {string} queueName - The stream name.
 * @returns {Promise<void>}
 * @private
 */
export async function _ensureConsumerGroup(queueName) {
  try {
    await this.redisManager.redis.xgroup(
      "CREATE",
      queueName,
      this.config.consumer_group_name,
      "0",
      "MKSTREAM"
    );
  } catch (e) {
    if (!e.message.includes("BUSYGROUP")) {
      throw e;
    }
  }
}

/**
 * Ensures a message has full data (type, payload) by fetching from Redis if needed.
 * @param {Object} msg - The partial message.
 * @param {string} queueType - The queue type.
 * @returns {Promise<Object>} The full message.
 * @private
 */
export async function _ensureFullMessage(msg, queueType) {
  if (!msg || !msg.id) return msg;
  if (msg.payload && msg.type && msg._stream_id) return msg;

  try {
    const redis = this.redisManager.redis;

    const getStreamsForType = (type) => {
      if (type === "main") return this._getAllPriorityStreams();
      if (type === "processing") return this._getAllPriorityStreams();
      if (type === "dead") return [this.config.dead_letter_queue_name];
      if (type === "acknowledged") return [this.config.acknowledged_queue_name];
      return [];
    };

    const findByIdInStream = async (streamName, targetId) => {
      const batchSize = 250;
      let start = "-";

      while (true) {
        const entries = await redis.xrange(
          streamName,
          start,
          "+",
          "COUNT",
          batchSize
        );

        if (!entries || entries.length === 0) return null;

        for (const [id, fields] of entries) {
          let json = null;
          for (let i = 0; i < fields.length; i += 2) {
            if (fields[i] === "data") {
              json = fields[i + 1];
              break;
            }
          }
          const parsed = this._deserializeMessage(json);
          if (parsed && parsed.id === targetId) {
            return { streamId: id, streamName, parsed };
          }
        }

        if (entries.length < batchSize) return null;
        const lastId = entries[entries.length - 1]?.[0];
        if (!lastId) return null;
        start = `(${lastId}`;
      }
    };

    const findByIdInStreams = async (streamNames, targetId) => {
      for (const streamName of streamNames) {
        const found = await findByIdInStream(streamName, targetId);
        if (found) return found;
      }
      return null;
    };

    const streamId = msg._stream_id;
    const streamName = msg._stream_name;

    if (streamId && streamName) {
      const range = await redis.xrange(streamName, streamId, streamId);
      if (range && range.length > 0) {
        const [id, fields] = range[0];
        let json = null;
        for (let i = 0; i < fields.length; i += 2) {
          if (fields[i] === "data") {
            json = fields[i + 1];
            break;
          }
        }
        const fullMsg = this._deserializeMessage(json);
        if (fullMsg) {
          return { ...fullMsg, ...msg, _stream_id: id, _stream_name: streamName };
        }
      }
    }

    const streamsToSearch = getStreamsForType(queueType);
    const found = await findByIdInStreams(streamsToSearch, msg.id);
    if (found) {
      return {
        ...found.parsed,
        ...msg,
        _stream_id: found.streamId,
        _stream_name: found.streamName,
      };
    }
  } catch (e) {
    // Ignore errors, return original message
  }
  return msg;
}
