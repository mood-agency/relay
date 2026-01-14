import { generateId, logger } from "./utils.js";
import { MessageMetadata } from "./models.js";

/**
 * OPTIMIZATION: Lua script for efficient processing queue fetch
 * This script fetches pending messages, their content, and metadata in a single round-trip
 * instead of multiple XPENDING + N XRANGE + N HGET calls.
 *
 * KEYS[1] = metadata_hash_name
 * ARGV = pairs of (stream_name, consumer_group_name), repeated for each stream
 * Returns: Array of [streamName, msgId, consumer, idle, deliveryCount, msgData, metadata]
 */
export const PROCESSING_QUEUE_LUA_SCRIPT = `
local metadata_key = KEYS[1]
local results = {}
local arg_index = 1

while arg_index < #ARGV do
  local stream_name = ARGV[arg_index]
  local consumer_group = ARGV[arg_index + 1]
  arg_index = arg_index + 2

  -- Get pending entries for this stream (up to 5000)
  local pending = redis.call('XPENDING', stream_name, consumer_group, '-', '+', 5000)

  if pending and #pending > 0 then
    for i, entry in ipairs(pending) do
      local msg_id = entry[1]
      local consumer = entry[2]
      local idle = entry[3]
      local delivery_count = entry[4]

      -- Get the message content
      local msg_data = redis.call('XRANGE', stream_name, msg_id, msg_id)

      if msg_data and #msg_data > 0 then
        local stream_entry = msg_data[1]
        local fields = stream_entry[2]

        -- Extract the 'data' field
        local data_json = nil
        for j = 1, #fields, 2 do
          if fields[j] == 'data' then
            data_json = fields[j + 1]
            break
          end
        end

        if data_json then
          -- Parse to get message ID for metadata lookup
          local ok, parsed = pcall(cjson.decode, data_json)
          local meta_json = nil

          if ok and parsed and parsed.id then
            -- Get metadata
            meta_json = redis.call('HGET', metadata_key, parsed.id)
          end

          table.insert(results, {
            stream_name,
            msg_id,
            consumer,
            idle,
            delivery_count,
            data_json,
            meta_json or ''
          })
        end
      end
    end
  end
end

return results
`;

// Cache for the Lua script SHA
let processingQueueScriptSha = null;

/**
 * Fetches processing queue messages using an optimized Lua script.
 * This reduces N+1 queries to a single round-trip.
 * @returns {Promise<Array>} Array of processing messages with metadata.
 */
export async function getProcessingMessagesOptimized() {
  const redis = this.redisManager.redis;
  const priorityStreams = this._getAllPriorityStreams();

  try {
    // Load the script if not cached
    if (!processingQueueScriptSha) {
      processingQueueScriptSha = await redis.script('LOAD', PROCESSING_QUEUE_LUA_SCRIPT);
    }

    // Build arguments: pairs of (stream_name, consumer_group_name)
    const args = [];
    for (const stream of priorityStreams) {
      args.push(stream, this.config.consumer_group_name);
    }

    // Execute the Lua script
    const results = await redis.evalsha(
      processingQueueScriptSha,
      1, // Number of keys
      this.config.metadata_hash_name, // KEYS[1]
      ...args // ARGV
    );

    if (!results || !Array.isArray(results)) {
      return [];
    }

    // Parse results into message objects
    const messages = [];
    for (const row of results) {
      if (!row || row.length < 6) continue;

      const [streamName, streamId, consumer, idle, deliveryCount, dataJson, metaJson] = row;

      // Parse message data
      const msgData = this._deserializeMessage(dataJson);
      if (!msgData) continue;

      msgData._stream_id = streamId;
      msgData._stream_name = streamName;
      msgData.dequeued_at = (Date.now() - idle) / 1000;
      msgData.processing_started_at = msgData.dequeued_at;
      msgData.attempt_count = deliveryCount;
      msgData.consumer_id = consumer;

      // Parse metadata if available
      if (metaJson) {
        try {
          const meta = JSON.parse(metaJson);
          if (meta.dequeued_at) msgData.dequeued_at = meta.dequeued_at;
          if (meta.processing_started_at) msgData.processing_started_at = meta.processing_started_at;
          if (meta.attempt_count) msgData.attempt_count = meta.attempt_count;
          if (meta.last_error) msgData.last_error = meta.last_error;
          if (meta.custom_ack_timeout) msgData.custom_ack_timeout = meta.custom_ack_timeout;
          if (meta.custom_max_attempts) msgData.custom_max_attempts = meta.custom_max_attempts;
          if (meta.lock_token) msgData.lock_token = meta.lock_token;
          if (meta.consumer_id) msgData.consumer_id = meta.consumer_id;
        } catch (e) {
          // Ignore parse errors
        }
      }

      messages.push(msgData);
    }

    return messages;
  } catch (e) {
    // If script fails (e.g., NOSCRIPT error), reset SHA and fall back
    if (e.message && e.message.includes('NOSCRIPT')) {
      processingQueueScriptSha = null;
    }
    logger.warn(`Lua script failed for processing queue, falling back: ${e.message}`);
    return null; // Return null to signal fallback to standard method
  }
}

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
 * Gets the index key for a specific message type.
 * @param {string} type - The message type.
 * @returns {string} The Redis key for the type index.
 * @private
 */
export function _getTypeIndexKey(type) {
  return `${this.config.queue_name}:type_index:zset:${type}`;
}

export function _getTypeIndexTypesKey() {
  return `${this.config.queue_name}:type_index:types`;
}

export function _getMessageLocationHashKey() {
  return `${this.config.queue_name}:type_index:loc`;
}

/**
 * Gets the Redis Set key for tracking pending (processing) message IDs.
 * This Set is used as a fast cache for dashboard queries, replacing
 * expensive per-message XPENDING calls with a single SMEMBERS lookup.
 * @returns {string} The Redis key for the pending IDs Set.
 * @private
 */
export function _getPendingIdsSetKey() {
  return `${this.config.queue_name}:pending_ids`;
}

/**
 * Calculates the score for the type index ZSet.
 * Lower score = Dequeued first (ZPOPMIN).
 * High priority should come before Low priority.
 * Formula: (MaxPriority - Priority) * 10^14 + Timestamp
 * @param {number} priority - Priority level.
 * @param {number} timestamp - Timestamp in milliseconds.
 * @returns {number} The calculated score.
 * @private
 */
export function _calculateTypeScore(priority, timestamp) {
  const maxP = this.config.max_priority_levels || 10;
  const p = Math.max(0, Math.min(priority || 0, maxP - 1));
  // Invert priority: High priority (large p) -> Small rank
  const rank = maxP - p;
  
  // 10^13 allows up to 900 max_priority_levels without overflow
  // (900 * 10^13 = 9 * 10^15 < MAX_SAFE_INTEGER)
  const multiplier = 10000000000000; 
  
  return (rank * multiplier) + timestamp;
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
    // Mark as existing in cache
    this.markConsumerGroupExists(queueName);
  } catch (e) {
    if (e.message.includes("BUSYGROUP")) {
      // Group already exists, mark in cache
      this.markConsumerGroupExists(queueName);
    } else {
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
