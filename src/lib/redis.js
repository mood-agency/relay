import Redis from "ioredis";
import crypto from "crypto";
import { v4 as uuidv4 } from "uuid";

// --- Improved Logging Configuration (Simple Console Logger) ---
const logger = {
  info: (message) =>
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`),
  error: (message) =>
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`),
  warn: (message) =>
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`),
  debug: (message) =>
    console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`), // Add debug if needed
};

// --- Configuration with Validation ---
class QueueConfig {
  constructor(config) {
    this.redis_host = config.redis_host || "localhost";
    this.redis_port = parseInt(config.redis_port || "6379", 10);
    this.redis_db = parseInt(config.redis_db || "0", 10);
    this.redis_password = config.redis_password || null;

    this.queue_name = config.queue_name || "queue";
    this.processing_queue_name = config.processing_queue_name || "queue_processing";
    this.dead_letter_queue_name = config.dead_letter_queue_name || "queue_dlq";
    this.acknowledged_queue_name = config.acknowledged_queue_name || "queue_acknowledged";
    this.total_acknowledged_key = config.total_acknowledged_key || "queue:stats:total_acknowledged";
    this.metadata_hash_name = config.metadata_hash_name || "queue_metadata";
    this.acknowledged_queue_name = config.acknowledged_queue_name || "queue_acknowledged";

    this.ack_timeout_seconds = parseInt(config.ack_timeout_seconds || "30", 10);
    this.max_attempts = parseInt(config.max_attempts || "3", 10);
    this.batch_size = parseInt(config.batch_size || "100", 10);
    this.max_acknowledged_history = parseInt(config.max_acknowledged_history || "100", 10);
    this.connection_pool_size = parseInt(config.redis_pool_size || "10", 10); // ioredis handles pooling differently, this is more for reference

    this.enable_message_encryption =
      (config.enable_message_encryption || "false").toLowerCase() === "true";
    this.secret_key = config.secret_key || null;

    this._validate();
  }

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
  }
}

//const config = new QueueConfig();

// --- Data Classes ---
class MessageMetadata {
  constructor(
    attempt_count = 0,
    dequeued_at = null,
    created_at = 0.0,
    last_error = null,
    processing_duration = 0.0
  ) {
    this.attempt_count = attempt_count;
    this.dequeued_at = dequeued_at; // timestamp in seconds
    this.created_at = created_at; // timestamp in seconds
    this.last_error = last_error;
    this.processing_duration = processing_duration;
  }

  static fromObject(data) {
    return new MessageMetadata(
      data.attempt_count,
      data.dequeued_at,
      data.created_at,
      data.last_error,
      data.processing_duration
    );
  }
}

class QueueMessage {
  constructor(id, type, payload, created_at, priority = 0) {
    this.id = id;
    this.type = type;
    this.payload = payload;
    this.created_at = created_at; // timestamp in seconds
    this.priority = priority;
  }

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

// --- Security Utilities ---
class MessageSecurity {
  constructor(secret_key) {
    if (!secret_key)
      throw new Error("Secret key is required for MessageSecurity");
    this.secret_key = Buffer.from(secret_key, "utf-8");
  }

  signMessage(message) {
    const hmac = crypto.createHmac("sha256", this.secret_key);
    hmac.update(message, "utf-8");
    const signature = hmac.digest("hex");
    return `${message}|${signature}`;
  }

  verifyMessage(signedMessage) {
    try {
      const parts = signedMessage.split("|");
      if (parts.length < 2) return null; // Handle cases where there's no pipe

      const signature = parts.pop();
      const message = parts.join("|");

      const hmac = crypto.createHmac("sha256", this.secret_key);
      hmac.update(message, "utf-8");
      const expectedSignature = hmac.digest("hex");

      if (
        crypto.timingSafeEqual(
          Buffer.from(signature, "hex"),
          Buffer.from(expectedSignature, "hex")
        )
      ) {
        return message;
      }
      return null;
    } catch (error) {
      logger.error(`Error verifying message: ${error.message}`);
      return null;
    }
  }
}

// --- Optimized Redis Connection Management ---
class RedisConnectionManager {
  constructor(config) {
    this.config = config;
    this._redis = null;
    this.security =
      config.enable_message_encryption && config.secret_key
        ? new MessageSecurity(config.secret_key)
        : null;
  }

  get redis() {
    if (!this._redis) {
      const redisOptions = {
        host: this.config.redis_host,
        port: this.config.redis_port,
        db: this.config.redis_db,
        family: 0,
        retryStrategy: (times) => Math.min(times * 50, 2000), // Standard retry strategy
        maxRetriesPerRequest: 3, // Corresponds to some level of retry
        enableReadyCheck: true,
        // ioredis handles connection pooling implicitly when sharing a client instance
        // or you can use `new Redis.Cluster([...])` for cluster mode.
        // `max_connections` equivalent is managed by how many client instances you create or by cluster setup.
      };
      if (this.config.redis_password) {
        redisOptions.password = this.config.redis_password;
      }
      this._redis = new Redis(redisOptions);

      this._redis.on("connect", () =>
        logger.info(
          `Connected to Redis at ${this.config.redis_host}:${this.config.redis_port}`
        )
      );
      this._redis.on("error", (err) =>
        logger.error(`Redis connection error: ${err}`)
      );
      this._redis.on("ready", () => logger.info("Redis client ready."));
    }
    return this._redis;
  }

  async testConnection() {
    try {
      await this.redis.ping();
      logger.info(
        `Successfully pinged Redis at ${this.config.redis_host}:${this.config.redis_port}`
      );
    } catch (e) {
      logger.error(`Redis connection test failed: ${e}`);
      throw e;
    }
  }

  pipeline() {
    return this.redis.pipeline();
  }

  async disconnect() {
    if (this._redis) {
      await this._redis.quit();
      this._redis = null;
      logger.info("Disconnected from Redis.");
    }
  }
}

// --- Optimized Queue System ---
class OptimizedRedisQueue {
  constructor(config) {
    this.config = config;
    this.redisManager = new RedisConnectionManager(config);
    this._stats = {
      enqueued: 0,
      dequeued: 0,
      acknowledged: 0,
      failed: 0,
      requeued: 0,
    };
  }

  _serializeMessage(message) {
    let messageJson = JSON.stringify(message);
    if (this.redisManager.security) {
      messageJson = this.redisManager.security.signMessage(messageJson);
    }
    return messageJson;
  }

  _deserializeMessage(messageJson) {
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

  async enqueueMessage(messageData, priority = 0) {
    try {
      if (!messageData.id) {
        messageData.id = uuidv4();
      }
      if (typeof messageData.created_at === "undefined") {
        messageData.created_at = Date.now() / 1000; // seconds timestamp
      }
      messageData.priority = priority;

      const messageJson = this._serializeMessage(messageData);

      if (priority > 0) {
        await this.redisManager.redis.lpush(
          this.config.queue_name,
          messageJson
        );
      } else {
        await this.redisManager.redis.rpush(
          this.config.queue_name,
          messageJson
        );
      }

      this._stats.enqueued++;
      logger.info(
        `Message enqueued: ${messageData.id} (priority: ${priority})`
      );
      return true;
    } catch (e) {
      logger.error(`Error enqueuing message ${messageData.id || "N/A"}: ${e}`);
      return false;
    }
  }

  async enqueueBatch(messages) {
    let successful = 0;
    if (!messages || messages.length === 0) return 0;

    const pipeline = this.redisManager.pipeline();
    for (const msg of messages) {
      if (!msg.id) {
        msg.id = uuidv4();
      }
      if (typeof msg.created_at === "undefined") {
        msg.created_at = Date.now() / 1000;
      }
      const messageJson = this._serializeMessage(msg);
      const priority = msg.priority || 0;

      if (priority > 0) {
        pipeline.lpush(this.config.queue_name, messageJson);
      } else {
        pipeline.rpush(this.config.queue_name, messageJson);
      }
    }

    try {
      const results = await pipeline.exec();
      // Each successful push command in ioredis pipeline returns the new length of the list.
      // We count how many operations were successful (didn't throw an error in the result array).
      results.forEach((result) => {
        if (!result[0]) {
          // result[0] is error, result[1] is value
          successful++;
        }
      });

      this._stats.enqueued += successful;
      logger.info(
        `Batch processed: ${successful}/${messages.length} messages enqueued`
      );
      return successful;
    } catch (e) {
      logger.error(`Error in batch enqueue: ${e}`);
      return successful; // return count of those that might have succeeded before error
    }
  }

  async dequeueMessage(timeout = 0) {
    try {
      const messageJson = await this.redisManager.redis.brpoplpush(
        this.config.queue_name,
        this.config.processing_queue_name,
        timeout
      );

      if (!messageJson) {
        return null;
      }

      const messageData = this._deserializeMessage(messageJson);
      if (!messageData) {
        // Potentially move to DLQ or log an error if deserialization fails after signature check
        // For now, just returning null as the Python version implies
        await this.redisManager.redis.lrem(
          this.config.processing_queue_name,
          1,
          messageJson
        ); // Clean up bad message
        logger.warn(
          "Failed to deserialize message from processing queue, removed."
        );
        return null;
      }

      const messageId = messageData.id;
      if (!messageId) {
        logger.warn("Message without ID found in processing queue");
        return messageData; // Or handle differently
      }

      const currentTime = Date.now() / 1000;
      const metadataKey = messageId;

      let metadata;
      const existingMetadataJson = await this.redisManager.redis.hget(
        this.config.metadata_hash_name,
        metadataKey
      );

      if (existingMetadataJson) {
        metadata = MessageMetadata.fromObject(JSON.parse(existingMetadataJson));
      } else {
        metadata = new MessageMetadata(
          0,
          null,
          messageData.created_at || currentTime
        );
      }

      metadata.dequeued_at = currentTime;
      metadata.attempt_count += 1;

      // Store both the metadata and the original JSON string for acknowledgment
      const originalJsonStringField = `${messageId}:original_json_string`;
      await this.redisManager.redis.hset(
        this.config.metadata_hash_name,
        metadataKey,
        JSON.stringify(metadata)
      );
      await this.redisManager.redis.hset(
        this.config.metadata_hash_name,
        originalJsonStringField,
        messageJson
      );

      this._stats.dequeued++;
      logger.info(
        `Message dequeued: ${messageId} (attempt: ${metadata.attempt_count})`
      );
      return messageData;
    } catch (e) {
      logger.error(`Error dequeuing message: ${e}`);
      return null;
    }
  }

  async acknowledgeMessage(ackPayload) { // ackPayload is e.g., { id: "message-uuid" }
    const messageId = ackPayload.id;
    if (!messageId) {
      // Ensure 'logger' is available in this scope (e.g., this.logger or imported)
      // For now, using console.warn as a placeholder if logger is not this.logger
      const logger = this.logger || console;
      logger.warn("Cannot acknowledge message: ID is missing in payload.", { payload: ackPayload });
      return false;
    }

    const logger = this.logger || console; // Use this.logger if available, else console

    try {
      // STEP 1: Retrieve the original serialized message string.
      // This is THE MOST CRITICAL part and depends on your dequeue logic.
      //
      // HYPOTHETICAL: Assume that when a message is dequeued and added to the
      // `processing_queue_name`, its original exact serialized string is ALSO stored
      // in the metadata hash (this.config.metadata_hash_name) under a specific field.
      // For this example, let's call this field `${messageId}:original_json_string`.
      // YOU MUST VERIFY OR IMPLEMENT THIS STORAGE LOGIC IN YOUR DEQUEUE PROCESS.

      const originalJsonStringField = `${messageId}:original_json_string`; // Example field name
      const originalMessageJson = await this.redisManager.redis.hget(this.config.metadata_hash_name, originalJsonStringField);

      if (!originalMessageJson) {
        logger.warn(
          `Original serialized message JSON not found in metadata for ID ${messageId} (field: ${originalJsonStringField}). ` +
          `Cannot perform LREM. Message might be already processed, timed out, or field not stored.`,
          { messageId }
        );
        // Attempt to clean up any potentially orphaned main metadata entry for this ID.
        await this.redisManager.redis.hdel(this.config.metadata_hash_name, messageId);
        return false; // Acknowledgment cannot proceed as intended.
      }

      // STEP 2: Perform the removal using the retrieved original serialized message.
      const pipeline = this.redisManager.pipeline();

      // Add to Acknowledged Queue and cleanup
      try {
        const ackMsgData = this._deserializeMessage(originalMessageJson);
        if (ackMsgData) {
          ackMsgData.acknowledged_at = Date.now() / 1000;
          const ackMsgJson = this._serializeMessage(ackMsgData);
          pipeline.lpush(this.config.acknowledged_queue_name, ackMsgJson);
          pipeline.ltrim(this.config.acknowledged_queue_name, 0, this.config.max_acknowledged_history - 1);
          pipeline.incr(this.config.total_acknowledged_key);
        } else {
          // Fallback if deserialization fails (shouldn't happen if original is valid)
          pipeline.lpush(this.config.acknowledged_queue_name, originalMessageJson);
          pipeline.ltrim(this.config.acknowledged_queue_name, 0, this.config.max_acknowledged_history - 1);
          pipeline.incr(this.config.total_acknowledged_key);
        }
      } catch (e) {
        logger.warn(`Failed to process message for acknowledged queue: ${e.message}`);
        // Ensure we still try to move something to ack queue even if processing fails
        pipeline.lpush(this.config.acknowledged_queue_name, originalMessageJson);
      }

      // Command 1: Remove the message from the processing queue using its exact original string
      pipeline.lrem(this.config.processing_queue_name, 1, originalMessageJson);
      // Command 2: Remove the main metadata entry for the message ID
      pipeline.hdel(this.config.metadata_hash_name, messageId);
      // Command 3: Remove the field that stored the original JSON string from metadata
      pipeline.hdel(this.config.metadata_hash_name, originalJsonStringField);

      const results = await pipeline.exec();

      // Check LREM result (first command in pipeline)
      // results is an array of [error, data] tuples for each command
      const lremCmdResult = results[0];
      const lremError = lremCmdResult[0];
      const removedCount = lremCmdResult[1];

      if (lremError) {
        logger.error(`Error in LREM command for message ${messageId}: ${lremError.message || lremError}`, { messageId, error: lremError });
        return false;
      }

      if (removedCount > 0) {
        if (this._stats && typeof this._stats.acknowledged === 'number') {
          this._stats.acknowledged++;
        }
        logger.info(`Message acknowledged successfully: ${messageId}`, { messageId });
        return true;
      } else {
        logger.warn(
          `Message ${messageId} (original JSON found) was not present in processing queue for LREM. ` +
          `It might have been processed/timed out concurrently. Metadata (id: ${messageId}, field: ${originalJsonStringField}) was targeted for cleanup.`,
          { messageId }
        );
        return false;
      }
    } catch (error) {
      logger.error(`Critical error during message acknowledgment for ID ${messageId}: ${error.message}`, {
        messageId,
        error: { message: error.message, stack: error.stack },
      });
      return false;
    }
  }

  async requeueFailedMessages() {
    logger.info("Verifying failed messages...");
    const currentTime = Date.now() / 1000;
    let requeuedCount = 0;
    let movedToDlqCount = 0;

    try {
      const processingMessagesJson = await this.redisManager.redis.lrange(
        this.config.processing_queue_name,
        0,
        this.config.batch_size - 1
      );

      if (!processingMessagesJson || processingMessagesJson.length === 0) {
        return 0;
      }

      const pipeline = this.redisManager.pipeline();

      for (const messageJson of processingMessagesJson) {
        const messageData = this._deserializeMessage(messageJson);
        if (!messageData) {
          logger.warn(
            `Could not deserialize message for requeue check: ${messageJson.substring(
              0,
              50
            )}... removing.`
          );
          pipeline.lrem(this.config.processing_queue_name, 1, messageJson);
          continue;
        }

        const messageId = messageData.id;
        if (!messageId) {
          logger.warn(
            `Message without ID found during requeue check: ${JSON.stringify(
              messageData
            )}. Removing.`
          );
          pipeline.lrem(this.config.processing_queue_name, 1, messageJson);
          continue;
        }

        const metadataJson = await this.redisManager.redis.hget(
          this.config.metadata_hash_name,
          messageId
        );
        let metadata;
        if (metadataJson) {
          try {
            metadata = MessageMetadata.fromObject(JSON.parse(metadataJson));
          } catch (parseError) {
            logger.warn(
              `Could not parse metadata for ${messageId}, assuming new: ${parseError}`
            );
            metadata = new MessageMetadata(
              0,
              null,
              messageData.created_at || currentTime,
              "Metadata parse error"
            );
          }
        } else {
          // No metadata, might be an orphaned message. Requeue with attempt 1 or DLQ.
          logger.warn(
            `No metadata for ${messageId}, assuming first attempt for requeue logic.`
          );
          metadata = new MessageMetadata(
            0,
            currentTime,
            messageData.created_at || currentTime,
            "Missing metadata"
          );
          // Ensure dequeued_at is set for timeout check logic to apply immediately if it's old
        }

        if (
          metadata.dequeued_at &&
          currentTime - metadata.dequeued_at > this.config.ack_timeout_seconds
        ) {
          if (metadata.attempt_count >= this.config.max_attempts) {
            logger.warn(
              `Message ${messageId} exceeded max attempts (${metadata.attempt_count}), moving to DLQ.`
            );
            // Enrich message with failure details before moving to DLQ
            const dlqMessage = { ...messageData };
            dlqMessage.failed_at = currentTime;
            dlqMessage.attempt_count = metadata.attempt_count;
            dlqMessage.last_error = "Max attempts exceeded";
            const dlqMessageJson = this._serializeMessage(dlqMessage);

            pipeline.lrem(this.config.processing_queue_name, 1, messageJson);
            pipeline.rpush(this.config.dead_letter_queue_name, dlqMessageJson);
            pipeline.hdel(this.config.metadata_hash_name, messageId); // Clean metadata for DLQ'd message
            movedToDlqCount++;
          } else {
            logger.info(
              `Message ${messageId} timed out, requeueing (attempt ${metadata.attempt_count + 1
              }).`
            );
            pipeline.lrem(this.config.processing_queue_name, 1, messageJson);
            pipeline.rpush(this.config.queue_name, messageJson); // Requeue to main queue

            // Reset dequeued_at, keep attempt_count (it's incremented on dequeue)
            // The Python version resets metadata, here we'll update for next dequeue
            // metadata.dequeued_at = null; // Will be set on next dequeue
            // metadata.attempt_count is already incremented by dequeue. If requeueing, it means this attempt failed.
            // The next dequeue will increment it again. So, we don't modify attempt_count here.
            // The Python code creates new metadata with the old attempt count. Here, we let dequeue handle it.
            // For consistency with Python's logic of resetting metadata upon requeue:
            const newRequeueMetadata = new MessageMetadata(
              metadata.attempt_count,
              null,
              metadata.created_at,
              "Requeued due to timeout"
            );
            pipeline.hset(
              this.config.metadata_hash_name,
              messageId,
              JSON.stringify(newRequeueMetadata)
            );
            requeuedCount++;
          }
        }
      }

      if (pipeline.length > 0) {
        await pipeline.exec();
      }

      this._stats.requeued += requeuedCount;
      this._stats.failed += movedToDlqCount;

      if (requeuedCount > 0) logger.info(`Requeued ${requeuedCount} messages.`);
      if (movedToDlqCount > 0)
        logger.warn(`Moved ${movedToDlqCount} messages to DLQ.`);

      return requeuedCount;
    } catch (e) {
      logger.error(`Error in requeueFailedMessages: ${e}`);
      return 0;
    }
  }

  async getMessagesByDateRange(startTimestamp, endTimestamp, limit) {
    const messages = [];
    const queuesToCheck = [
      { name: this.config.queue_name, type: "main" },
      { name: this.config.processing_queue_name, type: "processing" },
      { name: this.config.dead_letter_queue_name, type: "DLQ" },
    ];

    for (const queue of queuesToCheck) {
      const allMessages = await this.redisManager.redis.lrange(queue.name, 0, -1);
      for (const messageJson of allMessages) {
        try {
          const messageData = JSON.parse(messageJson);
          const messageTimestamp = messageData.created_at * 1000; // Convert to milliseconds
          if (messageTimestamp >= startTimestamp && messageTimestamp <= endTimestamp) {
            messages.push(messageData);
            if (messages.length >= limit) {
              return messages;
            }
          }
        } catch (e) {
          logger.warn(`Failed to parse message in queue ${queue.name}: ${e}`);
        }
      }
    }

    return messages;
  }

  async removeMessagesByDateRange(startTimestamp, endTimestamp) {
    let totalRemovedCount = 0;
    const queuesToCheck = [
      { name: this.config.queue_name, type: "main" },
      { name: this.config.processing_queue_name, type: "processing" },
      { name: this.config.dead_letter_queue_name, type: "DLQ" },
    ];

    for (const queueInfo of queuesToCheck) {
      logger.info(
        `Verifying queue ${queueInfo.type
        } for deletion by date range (${new Date(
          startTimestamp * 1000
        ).toISOString()} - ${new Date(endTimestamp * 1000).toISOString()})`
      );
      let removedFromCurrentQueue = 0;
      let offset = 0;
      try {
        while (true) {
          const messagesJson = await this.redisManager.redis.lrange(
            queueInfo.name,
            offset,
            offset + this.config.batch_size - 1
          );

          if (!messagesJson || messagesJson.length === 0) {
            break; // No more messages or end of list for non-blocking lrange behavior
          }

          const pipeline = this.redisManager.pipeline();
          let foundInBatch = 0;

          for (const messageJson of messagesJson) {
            const messageData = this._deserializeMessage(messageJson);
            if (!messageData) {
              // If message is undecipherable, can't check date. Decide if to remove or skip.
              // For safety, skipping undecipherable messages in date range removal.
              offset++; // If not removing, increment offset to avoid infinite loop on bad message
              continue;
            }
            foundInBatch++;

            const createdAt = messageData.created_at; // Assuming this is in seconds
            if (
              createdAt &&
              createdAt >= startTimestamp &&
              createdAt <= endTimestamp
            ) {
              pipeline.lrem(queueInfo.name, 1, messageJson);
              if (
                messageData.id &&
                queueInfo.name === this.config.processing_queue_name
              ) {
                pipeline.hdel(this.config.metadata_hash_name, messageData.id);
              }
              removedFromCurrentQueue++;
            } else {
              // If not removing this specific message, and lrange is used with static offsets,
              // we need to increment the offset for the next batch correctly.
              // However, lrem shifts indices, so processing in batches and re-fetching is safer.
            }
          }

          if (pipeline.length > 0) {
            await pipeline.exec();
          }

          // If we processed messages but didn't remove all of them,
          // the next offset should be based on what's left.
          // Simplest for lrange is to just fetch next batch from current 'offset'.
          // If all messages in the fetched batch were removed, offset effectively stays same for next fetch.
          // If some were not removed, they are now at earlier indices.
          // A more robust way is to iterate with LLEN and LINDEX/LPOP if order matters and changes are frequent.
          // Given LREM, the list shrinks. Iterating with a fixed offset and batch size is okay if we expect removals.
          // If no messages were found in the batch that matched, we must advance the offset.
          if (foundInBatch === 0 && messagesJson.length > 0) {
            // Processed a batch, but nothing matched criteria to remove
            offset += messagesJson.length;
          } else if (messagesJson.length < this.config.batch_size) {
            break; // Reached end of list
          }
          // If items were removed, the list is shorter. The next lrange from the same offset will get new items.
          // If no items were removed from the current batch, and it was a full batch, advance offset.
          else if (
            pipeline.length === 0 &&
            messagesJson.length === this.config.batch_size
          ) {
            offset += this.config.batch_size;
          }
          // If pipeline.length > 0, items were removed, so the next lrange(queue, offset, ...) will correctly fetch.
        }
        if (removedFromCurrentQueue > 0) {
          logger.info(
            `Removed ${removedFromCurrentQueue} messages from ${queueInfo.type}`
          );
        }
        totalRemovedCount += removedFromCurrentQueue;
      } catch (e) {
        logger.error(`Error removing messages from ${queueInfo.type}: ${e}`);
      }
    }
    return totalRemovedCount;
  }

  async getMetrics() {
    try {
      const pipeline = this.redisManager.pipeline();
      pipeline.llen(this.config.queue_name);
      pipeline.llen(this.config.processing_queue_name);
      pipeline.llen(this.config.dead_letter_queue_name);
      pipeline.llen(this.config.acknowledged_queue_name);
      pipeline.get(this.config.total_acknowledged_key);
      pipeline.hlen(this.config.metadata_hash_name);
      const results = await pipeline.exec();

      const queueMetrics = {
        main_queue_size: results[0][1],
        processing_queue_size: results[1][1],
        dead_letter_queue_size: results[2][1],
        acknowledged_queue_size: results[3][1],
        total_acknowledged: parseInt(results[4][1] || '0', 10),
        metadata_count: results[5][1],
      };
      return { ...queueMetrics, stats: { ...this._stats } }; // Return a copy of stats
    } catch (e) {
      logger.error(`Error getting metrics: ${e}`);
      return { error: e.toString() };
    }
  }

  async healthCheck() {
    try {
      const startTime = Date.now();
      await this.redisManager.redis.ping();
      const pingTime = Date.now() - startTime;
      const metrics = await this.getMetrics();
      return {
        status: "healthy",
        redis_ping_ms: pingTime,
        metrics: metrics,
        timestamp: Date.now() / 1000,
      };
    } catch (e) {
      return {
        status: "unhealthy",
        error: e.toString(),
        timestamp: Date.now() / 1000,
      };
    }
  }

  async deleteMessage(messageId, queueType) {
    try {
      const redis = this.redisManager.redis;
      let queueName;

      // Determine which queue to delete from
      switch (queueType) {
        case 'main':
          queueName = this.config.queue_name;
          break;
        case 'processing':
          queueName = this.config.processing_queue_name;
          break;
        case 'dead':
          queueName = this.config.dead_letter_queue_name;
          break;
        case 'acknowledged':
          queueName = this.config.acknowledged_queue_name;
          break;
        default:
          throw new Error(`Invalid queue type: ${queueType}`);
      }

      // Get all messages from the queue
      const messages = await redis.lrange(queueName, 0, -1);

      // Find the message to delete
      let messageIndex = -1;
      let messageToDelete = null;

      for (let i = 0; i < messages.length; i++) {
        const parsed = this._deserializeMessage(messages[i]);
        if (parsed && parsed.id === messageId) {
          messageIndex = i;
          messageToDelete = messages[i];
          break;
        }
      }

      if (messageIndex === -1) {
        throw new Error(`Message with ID ${messageId} not found in ${queueType} queue`);
      }

      // Remove the message from the queue
      // Use LREM to remove the specific message
      const removed = await redis.lrem(queueName, 1, messageToDelete);

      if (removed === 0) {
        throw new Error(`Failed to remove message ${messageId} from ${queueType} queue`);
      }

      // Also remove from metadata if it exists
      await redis.hdel(this.config.metadata_hash_name, messageId);

      logger.info(`Successfully deleted message ${messageId} from ${queueType} queue`);

      return {
        success: true,
        messageId,
        queueType,
        message: 'Message deleted successfully'
      };

    } catch (error) {
      logger.error(`Error deleting message ${messageId} from ${queueType} queue: ${error.message}`);
      throw error;
    }
  }

  async updateMessage(messageId, queueType, updates) {
    try {
      const redis = this.redisManager.redis;
      let queueName;

      // Determine which queue to update
      // We only allow updating Main and Dead Letter queues
      switch (queueType) {
        case 'main':
          queueName = this.config.queue_name;
          break;
        case 'dead':
          queueName = this.config.dead_letter_queue_name;
          break;
        default:
          throw new Error(`Cannot update message in ${queueType} queue. Only 'main' and 'dead' queues are supported.`);
      }

      // Get all messages from the queue
      const messages = await redis.lrange(queueName, 0, -1);

      // Find the message to update
      let messageIndex = -1;
      let originalMessageJson = null;
      let originalMessageData = null;

      for (let i = 0; i < messages.length; i++) {
        const parsed = this._deserializeMessage(messages[i]);
        if (parsed && parsed.id === messageId) {
          messageIndex = i;
          originalMessageJson = messages[i];
          originalMessageData = parsed;
          break;
        }
      }

      if (messageIndex === -1) {
        throw new Error(`Message with ID ${messageId} not found in ${queueType} queue`);
      }

      // Create updated message data
      const updatedMessageData = {
        ...originalMessageData,
        ...updates,
        id: messageId // Ensure ID remains the same
      };

      // Serialize updated message
      const updatedMessageJson = this._serializeMessage(updatedMessageData);

      const pipeline = redis.pipeline();

      // Remove the old message
      pipeline.lrem(queueName, 1, originalMessageJson);

      // Add the new message
      // If it's a priority update or we want to maintain order, we should be careful.
      // For simplicity, we'll push it to the list.
      // If updating priority, we might want to respect it (L/R push).
      // If just updating payload, ideally we'd put it back in the same spot, but Redis Lists don't support easy "replace at index" if the list changed.
      // Given this is a queue, re-enqueuing (moving to back or front) is often acceptable or even desired (re-prioritize).
      // However, for "Edit", users might expect it to stay in place.
      // To stay in place: LSET index value. But we need the index.
      // We found the index above, but it might have changed if concurrent ops happened.
      // But let's try LSET if we can trust the index for a split second, OR just re-enqueue.
      // Re-enqueuing is safer against race conditions with LREM.
      // Let's stick to remove + push.
      
      if (updatedMessageData.priority > 0) {
        pipeline.lpush(queueName, updatedMessageJson);
      } else {
        pipeline.rpush(queueName, updatedMessageJson);
      }

      const results = await pipeline.exec();
      
      // Check LREM result
      if (results[0][0]) { // Error in LREM
         throw results[0][0];
      }
      if (results[0][1] === 0) { // 0 removed
         throw new Error("Message was processed or moved before update could complete.");
      }

      logger.info(`Successfully updated message ${messageId} in ${queueType} queue`);

      return {
        success: true,
        messageId,
        queueType,
        message: 'Message updated successfully',
        data: updatedMessageData
      };

    } catch (error) {
      logger.error(`Error updating message ${messageId} in ${queueType} queue: ${error.message}`);
      throw error;
    }
  }

  async getQueueStatus(typeFilter = null) {
    try {
      const redis = this.redisManager.redis;
      const pipeline = redis.pipeline();

      // Get queue lengths
      pipeline.llen(this.config.queue_name);
      pipeline.llen(this.config.processing_queue_name);
      pipeline.llen(this.config.dead_letter_queue_name);
      pipeline.llen(this.config.acknowledged_queue_name);
      pipeline.get(this.config.total_acknowledged_key);

      // Get queue contents (limited to 100 items each)
      pipeline.lrange(this.config.queue_name, 0, 99);
      pipeline.lrange(this.config.processing_queue_name, 0, 99);
      pipeline.lrange(this.config.dead_letter_queue_name, 0, 99);
      pipeline.lrange(this.config.acknowledged_queue_name, 0, 99);

      // Get metadata for processed/failed counts
      pipeline.hgetall(this.config.metadata_hash_name);

      const results = await pipeline.exec();

      const [mainLen, procLen, dlqLen, ackLen, totalAck, mainMsgs, procMsgs, dlqMsgs, ackMsgs, metadata] = results.map(r => r[1]);

      // Parse messages and collect available types
      const availableTypes = new Set();
      const parseMessages = (messages) => {
        const parsed = messages.map(msg => {
          const parsedMsg = this._deserializeMessage(msg);
          if (parsedMsg && parsedMsg.type) {
            availableTypes.add(parsedMsg.type);
          }
          return parsedMsg || { error: 'Failed to parse message' };
        });

        // Filter by type if specified
        if (typeFilter) {
          return parsed.filter(msg => msg.type === typeFilter);
        }
        return parsed;
      };

      // Count processed and failed messages from metadata
      let totalProcessed = 0;
      let totalFailed = 0;

      if (metadata) {
        Object.values(metadata).forEach(metaStr => {
          try {
            const meta = JSON.parse(metaStr);
            if (meta.attempt_count >= this.config.max_attempts) {
              totalFailed++;
            } else if (meta.dequeued_at) {
              totalProcessed++;
            }
          } catch (e) {
            // Skip invalid metadata
          }
        });
      }

      const mainMessages = parseMessages(mainMsgs || []);
      
      // Create a metadata lookup map for easier access
      const metadataMap = {};
      if (metadata) {
        Object.entries(metadata).forEach(([key, metaStr]) => {
          try {
             // Skip if key looks like "original_json_string" (contains :)
             if (!key.includes(':')) {
                metadataMap[key] = JSON.parse(metaStr);
             }
          } catch (e) {
            // ignore parse error
          }
        });
      }

      // Helper to enrich messages with metadata
      const enrichMessages = (messages) => {
        return messages.map(msg => {
          if (msg && msg.id && metadataMap[msg.id]) {
            const meta = metadataMap[msg.id];
            return {
              ...msg,
              processing_started_at: meta.dequeued_at,
              attempt_count: meta.attempt_count,
            };
          }
          return msg;
        });
      };

      const processingMessages = enrichMessages(parseMessages(procMsgs || []));
      const deadMessages = enrichMessages(parseMessages(dlqMsgs || []));
      const acknowledgedMessages = parseMessages(ackMsgs || []);

      return {
        mainQueue: {
          name: this.config.queue_name,
          length: typeFilter ? mainMessages.length : (mainLen || 0),
          messages: mainMessages,
        },
        processingQueue: {
          name: this.config.processing_queue_name,
          length: typeFilter ? processingMessages.length : (procLen || 0),
          messages: processingMessages,
        },
        deadLetterQueue: {
          name: this.config.dead_letter_queue_name,
          length: typeFilter ? deadMessages.length : (dlqLen || 0),
          messages: deadMessages,
        },
        acknowledgedQueue: {
          name: this.config.acknowledged_queue_name,
          length: typeFilter ? acknowledgedMessages.length : (ackLen || 0),
          messages: acknowledgedMessages,
          total: parseInt(totalAck || '0', 10)
        },
        metadata: {
          totalProcessed,
          totalFailed,
          totalAcknowledged: parseInt(totalAck || '0', 10)
        },
        availableTypes: Array.from(availableTypes).sort(),
      };
    } catch (error) {
      logger.error(`Error getting queue status: ${error.message}`);
      throw error;
    }
  }

  async getQueueMessages(queueType, params = {}) {
    try {
      const { 
        page = 1, 
        limit = 10, 
        sortBy = 'created_at', 
        sortOrder = 'desc', 
        filterType, 
        filterPriority, 
        filterAttempts, 
        startDate, 
        endDate, 
        search 
      } = params;

      const redis = this.redisManager.redis;
      let queueName;

      switch (queueType) {
        case 'main': queueName = this.config.queue_name; break;
        case 'processing': queueName = this.config.processing_queue_name; break;
        case 'dead': queueName = this.config.dead_letter_queue_name; break;
        case 'acknowledged': queueName = this.config.acknowledged_queue_name; break;
        default: throw new Error(`Invalid queue type: ${queueType}`);
      }

      // Fetch ALL messages to filter/sort (Redis List limitation)
      // For production with millions of messages, this should be replaced by Redis Search or ZSETS
      const rawMessages = await redis.lrange(queueName, 0, -1);
      
      // Get metadata if needed for filtering/sorting by fields in metadata
      let metadataMap = {};
      if (queueType === 'processing' || queueType === 'dead' || sortBy === 'processing_started_at' || sortBy === 'attempt_count') {
          const allMeta = await redis.hgetall(this.config.metadata_hash_name);
          Object.entries(allMeta).forEach(([key, val]) => {
              if (!key.includes(':')) {
                  try { metadataMap[key] = JSON.parse(val); } catch(e) {}
              }
          });
      }

      let messages = rawMessages.map(msg => {
          const parsed = this._deserializeMessage(msg);
          if (parsed) {
              // Initialize default values for schema validation, preserving existing values if present
            parsed.attempt_count = parsed.attempt_count || 0;
            parsed.dequeued_at = parsed.dequeued_at || null;
            parsed.last_error = parsed.last_error || null;
            parsed.processing_duration = parsed.processing_duration || 0;
            parsed.processing_started_at = parsed.processing_started_at || null;

              if (parsed.id && metadataMap[parsed.id]) {
                  const meta = metadataMap[parsed.id];
                  parsed.processing_started_at = meta.dequeued_at;
                  parsed.dequeued_at = meta.dequeued_at;
                  parsed.attempt_count = meta.attempt_count;
                  parsed.last_error = meta.last_error;
                  parsed.processing_duration = meta.processing_duration || 0;
              }
          }
          return parsed;
      }).filter(Boolean);

      // Filter
      if (filterType && filterType !== 'all') {
          messages = messages.filter(m => m.type === filterType);
      }
      if (filterPriority !== undefined && filterPriority !== '') {
          messages = messages.filter(m => m.priority === parseInt(filterPriority));
      }
      if (filterAttempts !== undefined && filterAttempts !== '') {
          messages = messages.filter(m => (m.attempt_count || 0) >= parseInt(filterAttempts));
      }
      if (startDate) {
          const start = new Date(startDate).getTime() / 1000;
          messages = messages.filter(m => {
             const ts = queueType === 'processing' ? m.processing_started_at : 
                        queueType === 'acknowledged' ? m.acknowledged_at : m.created_at;
             return ts >= start;
          });
      }
      if (endDate) {
          const end = new Date(endDate).getTime() / 1000;
          messages = messages.filter(m => {
             const ts = queueType === 'processing' ? m.processing_started_at : 
                        queueType === 'acknowledged' ? m.acknowledged_at : m.created_at;
             return ts <= end;
          });
      }
      if (search) {
          const searchLower = search.toLowerCase();
          messages = messages.filter(m => 
              m.id.toLowerCase().includes(searchLower) ||
              (m.payload && JSON.stringify(m.payload).toLowerCase().includes(searchLower)) ||
              (m.error_message && m.error_message.toLowerCase().includes(searchLower))
          );
      }

      // Sort
      messages.sort((a, b) => {
          let valA = a[sortBy];
          let valB = b[sortBy];
          
          // Handle specific fields
          if (sortBy === 'payload') {
              valA = JSON.stringify(valA);
              valB = JSON.stringify(valB);
          }
          
          if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
          if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
          return 0;
      });

      // Pagination
      const total = messages.length;
      const totalPages = Math.ceil(total / limit);
      const startIndex = (page - 1) * limit;
      const paginatedMessages = messages.slice(startIndex, startIndex + parseInt(limit));

      return {
          messages: paginatedMessages,
          pagination: {
              total,
              page: parseInt(page),
              limit: parseInt(limit),
              totalPages
          }
      };

    } catch (error) {
      logger.error(`Error getting queue messages: ${error.message}`);
      throw error;
    }
  }

  async clearAllQueues() {
    try {
      const pipeline = this.redisManager.pipeline();

      // Clear all queues and metadata
      pipeline.del(this.config.queue_name);
      pipeline.del(this.config.processing_queue_name);
      pipeline.del(this.config.dead_letter_queue_name);
      pipeline.del(this.config.acknowledged_queue_name);
      pipeline.del(this.config.total_acknowledged_key);
      pipeline.del(this.config.metadata_hash_name);

      await pipeline.exec();

      // Reset internal stats
      this._stats = {
        enqueued: 0,
        dequeued: 0,
        acknowledged: 0,
        failed: 0,
        requeued: 0,
      };

      logger.info("All queues and metadata cleared.");
      return true;
    } catch (error) {
      logger.error(`Error clearing all queues: ${error.message}`);
      throw error;
    }
  }

  async clearQueue(queueType) {
    try {
      let queueName;
      const pipeline = this.redisManager.pipeline();

      switch (queueType) {
        case 'main':
          queueName = this.config.queue_name;
          break;
        case 'processing':
          queueName = this.config.processing_queue_name;
          break;
        case 'dead':
          queueName = this.config.dead_letter_queue_name;
          break;
        case 'acknowledged':
          queueName = this.config.acknowledged_queue_name;
          break;
        default:
          throw new Error(`Cannot clear ${queueType} queue. Invalid queue type.`);
      }

      pipeline.del(queueName);
      
      await pipeline.exec();
      logger.info(`Cleared ${queueType} queue (${queueName})`);
      return true;
    } catch (error) {
      logger.error(`Error clearing ${queueType} queue: ${error.message}`);
      throw error;
    }
  }

  async disconnect() {
    await this.redisManager.disconnect();
  }
}

// --- Optimized Usage Example ---
async function demoOptimizedQueue() {
  logger.info("=== Starting Optimized Queue System Demo (Node.js) ===");
  const queue = new OptimizedRedisQueue(config);

  try {
    await queue.redisManager.testConnection(); // Test connection first

    logger.info("Cleaning queues for demo...");
    const p = queue.redisManager.pipeline();
    p.del(config.queue_name);
    p.del(config.processing_queue_name);
    p.del(config.dead_letter_queue_name);
    p.del(config.metadata_hash_name);
    p.del(config.acknowledged_queue_name);
    p.del(config.total_acknowledged_key);
    await p.exec();
    logger.info("Queues cleaned for demo.");

    logger.info("\n--- Demo: Batch Enqueueing ---");
    const messages = [];
    for (let i = 0; i < 10; i++) {
      messages.push({
        // id will be auto-generated by enqueueBatch if not provided
        type: "email_send",
        payload: { recipient: `user${i}@example.com` },
        priority: i < 3 ? 1 : 0, // First 3 with priority
      });
    }
    const enqueued = await queue.enqueueBatch(messages);
    logger.info(`Batch enqueued: ${enqueued} messages`);

    logger.info("\n--- Demo: Message Processing ---");
    let processed = 0;
    for (let i = 0; i < 5; i++) {
      // Try to process 5 messages
      const message = await queue.dequeueMessage(1); // 1 second timeout
      if (message) {
        const msgId = message.id || "N/A";
        logger.info(`Processing: ${msgId}, Priority: ${message.priority}`);

        await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate processing

        if (
          message.payload &&
          message.payload.recipient === "user2@example.com"
        ) {
          // Check specific message for simulated failure
          logger.warn(`Simulating failure for ${msgId}`);
          // Do not acknowledge, it should be requeued later
        } else {
          await queue.acknowledgeMessage(message);
        }
        processed++;
      } else {
        logger.info("No message to process, or timeout.");
      }
    }
    logger.info(`Attempted to process ${processed} messages initially.`);

    logger.info("\n--- Demo: Requeue Failed Messages ---");
    logger.info(
      `Waiting ${config.ack_timeout_seconds + 1} seconds for timeout...`
    );
    await new Promise((resolve) =>
      setTimeout(resolve, (config.ack_timeout_seconds + 1) * 1000)
    );
    const requeued = await queue.requeueFailedMessages();
    logger.info(
      `Messages requeued/moved to DLQ after timeout check: ${requeued} (requeued to main)`
    );

    // Try processing again to see if the failed message is picked up
    logger.info("\n--- Demo: Processing messages after requeue ---");
    let processedAfterRequeue = 0;
    for (let i = 0; i < 5; i++) {
      // Try to process up to 5 more messages
      const message = await queue.dequeueMessage(1);
      if (message) {
        const msgId = message.id || "N/A";
        logger.info(`Processing (post-requeue): ${msgId}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
        await queue.acknowledgeMessage(message);
        processedAfterRequeue++;
      } else {
        logger.info("No more messages after requeue check or timeout.");
        break;
      }
    }
    logger.info(`Processed ${processedAfterRequeue} messages after requeue.`);

    logger.info("\n--- Demo: System Metrics ---");
    const metrics = await queue.getMetrics();
    logger.info(`Current metrics: ${JSON.stringify(metrics, null, 2)}`);

    logger.info("\n--- Demo: Health Check ---");
    const health = await queue.healthCheck();
    logger.info(`Health status: ${JSON.stringify(health, null, 2)}`);
  } catch (error) {
    logger.error(`Error in demo: ${error.stack}`);
  } finally {
    await queue.disconnect();
    logger.info("\n=== Demo Completed (Node.js) ===");
  }
}

// Run demo if the script is run directly
if (require.main === module) {
  demoOptimizedQueue().catch((err) => {
    logger.error(`Fatal error in demo: ${err.stack}`);
    process.exit(1);
  });
}

export { OptimizedRedisQueue, QueueConfig, MessageSecurity };
