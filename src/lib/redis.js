import Redis from "ioredis";
import crypto from "crypto";

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
    this.archive_queue_name = config.archive_queue_name || "queue_archive";
    this.metadata_hash_name = config.metadata_hash_name || "queue_metadata";
    this.id_counter_key = config.id_counter_key || "queue_id_counter";

    this.ack_timeout_seconds = parseInt(config.ack_timeout_seconds || "30", 10);
    this.max_attempts = parseInt(config.max_attempts || "3", 10);
    this.batch_size = parseInt(config.batch_size || "100", 10);
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

  async _generateIncrementalId() {
    try {
      const id = await this.redisManager.redis.incr(this.config.id_counter_key);
      return id.toString();
    } catch (e) {
      logger.error(`Error generating incremental ID: ${e}`);
      throw e;
    }
  }

  async setIdCounterStartValue(startValue) {
    try {
      await this.redisManager.redis.set(this.config.id_counter_key, startValue - 1);
      logger.info(`ID counter start value set to ${startValue}`);
    } catch (e) {
      logger.error(`Error setting ID counter start value: ${e}`);
      throw e;
    }
  }

  async enqueueMessage(messageData, priority = 0) {
    try {
      if (!messageData.id) {
        messageData.id = await this._generateIncrementalId();
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

    // Generate IDs for messages that don't have them
    for (const msg of messages) {
      if (!msg.id) {
        msg.id = await this._generateIncrementalId();
      }
    }

    const pipeline = this.redisManager.pipeline();
    for (const msg of messages) {
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
            pipeline.lrem(this.config.processing_queue_name, 1, messageJson);
            pipeline.rpush(this.config.dead_letter_queue_name, messageJson);
            pipeline.hdel(this.config.metadata_hash_name, messageId); // Clean metadata for DLQ'd message
            movedToDlqCount++;
          } else {
            logger.info(
              `Message ${messageId} timed out, requeueing (attempt ${
                metadata.attempt_count + 1
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
        `Verifying queue ${
          queueInfo.type
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
      pipeline.hlen(this.config.metadata_hash_name);
      const results = await pipeline.exec();

      const queueMetrics = {
        main_queue_size: results[0][1],
        processing_queue_size: results[1][1],
        dead_letter_queue_size: results[2][1],
        metadata_count: results[3][1],
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

  async archiveMessage(messageJson, queueType, reason = 'archived') {
    try {
      const redis = this.redisManager.redis;
      const messageData = this._deserializeMessage(messageJson);
      
      if (!messageData) {
        throw new Error('Failed to deserialize message for archiving');
      }
      
      // Add archive metadata
      const archivedMessage = {
        ...messageData,
        archived_at: Date.now() / 1000,
        archived_from: queueType,
        archive_reason: reason
      };
      
      // Serialize and add to archive queue
      const archivedMessageJson = this._serializeMessage(archivedMessage);
      await redis.rpush(this.config.archive_queue_name, archivedMessageJson);
      
      logger.info(`Message ${messageData.id} archived from ${queueType} queue (reason: ${reason})`);
      
      return {
        success: true,
        messageId: messageData.id,
        queueType,
        reason,
        message: 'Message archived successfully'
      };
      
    } catch (error) {
      logger.error(`Error archiving message: ${error.message}`);
      throw error;
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
        case 'archive':
          queueName = this.config.archive_queue_name;
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
      
      // For non-archive queues, move to archive first
      if (queueType !== 'archive') {
        await this.archiveMessage(messageToDelete, queueType, 'deleted');
      }
      
      // Remove the message from the queue
      const removed = await redis.lrem(queueName, 1, messageToDelete);
      
      if (removed === 0) {
        throw new Error(`Failed to remove message ${messageId} from ${queueType} queue`);
      }
      
      // Also remove from metadata if it exists (for processing queue)
      if (queueType === 'processing') {
        await redis.hdel(this.config.metadata_hash_name, messageId);
        await redis.hdel(this.config.metadata_hash_name, `${messageId}:original_json_string`);
      }
      
      const action = queueType === 'archive' ? 'permanently deleted' : 'archived';
      logger.info(`Successfully ${action} message ${messageId} from ${queueType} queue`);
      
      return {
        success: true,
        messageId,
        queueType,
        message: `Message ${action} successfully`
      };
      
    } catch (error) {
      logger.error(`Error deleting message ${messageId} from ${queueType} queue: ${error.message}`);
      throw error;
    }
  }

  async clearQueue(queueType) {
    try {
      const redis = this.redisManager.redis;
      let queueName;
      
      // Determine which queue to clear
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
        case 'archive':
          queueName = this.config.archive_queue_name;
          break;
        default:
          throw new Error(`Invalid queue type: ${queueType}`);
      }
      
      // Get the current queue length for reporting
      const currentLength = await redis.llen(queueName);
      
      if (currentLength === 0) {
        logger.info(`${queueType} queue is already empty`);
        return {
          success: true,
          queueType,
          clearedCount: 0,
          message: `${queueType} queue was already empty`
        };
      }
      
      // For non-archive queues, move messages to archive before clearing
      if (queueType !== 'archive') {
        const messages = await redis.lrange(queueName, 0, -1);
        const pipeline = redis.pipeline();
        
        // Archive all messages
        for (const messageJson of messages) {
          const messageData = this._deserializeMessage(messageJson);
          if (messageData) {
            const archivedMessage = {
              ...messageData,
              archived_at: Date.now() / 1000,
              archived_from: queueType,
              archive_reason: 'queue_cleared'
            };
            const archivedMessageJson = this._serializeMessage(archivedMessage);
            pipeline.rpush(this.config.archive_queue_name, archivedMessageJson);
          }
        }
        
        // Clear the original queue
        pipeline.del(queueName);
        
        // For processing queue, clean up metadata
        if (queueType === 'processing') {
          const messageIds = [];
          for (const messageJson of messages) {
            const parsed = this._deserializeMessage(messageJson);
            if (parsed && parsed.id) {
              messageIds.push(parsed.id);
              messageIds.push(`${parsed.id}:original_json_string`);
            }
          }
          if (messageIds.length > 0) {
            pipeline.hdel(this.config.metadata_hash_name, ...messageIds);
          }
        }
        
        await pipeline.exec();
        
        logger.info(`Successfully cleared ${queueType} queue and archived ${currentLength} messages`);
        
        return {
          success: true,
          queueType,
          clearedCount: currentLength,
          message: `${queueType} queue cleared successfully (${currentLength} messages archived)`
        };
      } else {
        // For archive queue, permanently delete messages
        await redis.del(queueName);
        
        logger.info(`Successfully permanently deleted ${currentLength} messages from archive queue`);
        
        return {
          success: true,
          queueType,
          clearedCount: currentLength,
          message: `Archive queue cleared successfully (${currentLength} messages permanently deleted)`
        };
      }
      
    } catch (error) {
      logger.error(`Error clearing ${queueType} queue: ${error.message}`);
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
      pipeline.llen(this.config.archive_queue_name);
      
      // Get all queue contents (for proper pagination we need all messages)
      pipeline.lrange(this.config.queue_name, 0, -1);
      pipeline.lrange(this.config.processing_queue_name, 0, -1);
      pipeline.lrange(this.config.dead_letter_queue_name, 0, -1);
      pipeline.lrange(this.config.archive_queue_name, 0, -1);
      
      // Get metadata for processed/failed counts
      pipeline.hgetall(this.config.metadata_hash_name);
      
      const results = await pipeline.exec();
      
      const [mainLen, procLen, dlqLen, archiveLen, mainMsgs, procMsgs, dlqMsgs, archiveMsgs, metadata] = results.map(r => r[1]);
      
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
      const processingMessages = parseMessages(procMsgs || []);
      const deadMessages = parseMessages(dlqMsgs || []);
      const archiveMessages = parseMessages(archiveMsgs || []);
      
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
        archiveQueue: {
          name: this.config.archive_queue_name,
          length: typeFilter ? archiveMessages.length : (archiveLen || 0),
          messages: archiveMessages,
        },

        metadata: {
          totalProcessed,
          totalFailed,
        },
        availableTypes: Array.from(availableTypes).sort(),
      };
    } catch (error) {
      logger.error(`Error getting queue status: ${error.message}`);
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
    p.del(config.archive_queue_name);
    p.del(config.metadata_hash_name);
    p.del(config.id_counter_key);
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
