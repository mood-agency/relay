import Redis from "ioredis";
import { nanoid } from "nanoid";

// --- ID Generation Helper ---
// Generates a 10-character URL-safe string using NanoID.
const generateId = () => nanoid(10);

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
    
    // Stream-specific configuration
    this.consumer_group_name = config.consumer_group_name || "queue_group";
    this.consumer_name = config.consumer_name || `consumer-${generateId()}`;

    this.ack_timeout_seconds = parseInt(config.ack_timeout_seconds || "30", 10);
    this.max_attempts = parseInt(config.max_attempts || "3", 10);
    this.batch_size = parseInt(config.batch_size || "100", 10);
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
    processing_duration = 0.0,
    custom_ack_timeout = null,
    custom_max_attempts = null
  ) {
    this.attempt_count = attempt_count;
    this.dequeued_at = dequeued_at; // timestamp in seconds
    this.created_at = created_at; // timestamp in seconds
    this.last_error = last_error;
    this.processing_duration = processing_duration;
    this.custom_ack_timeout = custom_ack_timeout;
    this.custom_max_attempts = custom_max_attempts;
  }

  static fromObject(data) {
    return new MessageMetadata(
      data.attempt_count,
      data.dequeued_at,
      data.created_at,
      data.last_error,
      data.processing_duration,
      data.custom_ack_timeout,
      data.custom_max_attempts
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
    this._subscriber = null;
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

  get subscriber() {
    if (!this._subscriber) {
       // Duplicate the main connection options but for a dedicated subscriber
       const redisOptions = {
        host: this.config.redis_host,
        port: this.config.redis_port,
        db: this.config.redis_db,
        family: 0,
        retryStrategy: (times) => Math.min(times * 50, 2000),
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
      };
      if (this.config.redis_password) {
        redisOptions.password = this.config.redis_password;
      }
      this._subscriber = new Redis(redisOptions);
      this._subscriber.setMaxListeners(0); // Allow unlimited listeners for SSE
      
      this._subscriber.on("connect", () => logger.info("Redis subscriber connected"));
      this._subscriber.on("error", (err) => logger.error(`Redis subscriber error: ${err}`));
    }
    return this._subscriber;
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
    if (this._subscriber) {
      await this._subscriber.quit();
      this._subscriber = null;
      logger.info("Disconnected Redis subscriber.");
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

  async publishEvent(type, payload = {}) {
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

  // Get manual stream name (checked FIRST, used for manual UI moves)
  _getManualStreamName() {
    return `${this.config.queue_name}_manual`;
  }

  // Get stream name for a specific priority level
  _getPriorityStreamName(priority) {
    const maxPriority = this.config.max_priority_levels - 1;
    const clampedPriority = Math.max(0, Math.min(priority, maxPriority));
    if (clampedPriority === 0) {
      return this.config.queue_name; // Base queue for priority 0
    }
    return `${this.config.queue_name}_p${clampedPriority}`;
  }

  // Get all priority stream names (highest priority first for reading)
  _getAllPriorityStreams() {
    // Manual first, then Priority levels
    const streams = [this._getManualStreamName()];
    for (let p = this.config.max_priority_levels - 1; p >= 0; p--) {
      streams.push(this._getPriorityStreamName(p));
    }
    return streams;
  }

  // Get all main queue streams (for operations that need all of them)
  _getAllMainQueueStreams() {
    return this._getAllPriorityStreams();
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

  async _ensureConsumerGroup(queueName) {
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

  async enqueueMessage(messageData, priority = 0, queueNameOverride = null) {
    try {
      if (!messageData.id) {
        messageData.id = generateId();
      }
      if (typeof messageData.created_at === "undefined") {
        messageData.created_at = Date.now() / 1000; // seconds timestamp
      }
      messageData.priority = priority;

      const messageJson = this._serializeMessage(messageData);
      const queueName = queueNameOverride || this._getPriorityStreamName(priority);

      await this.redisManager.redis.xadd(queueName, "*", "data", messageJson);

      this._stats.enqueued++;
      logger.info(
        `Message enqueued to stream ${queueName}: ${messageData.id} (priority: ${priority})`
      );
      this.publishEvent('enqueue', { count: 1, message: messageData });
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
        msg.id = generateId();
      }
      if (typeof msg.created_at === "undefined") {
        msg.created_at = Date.now() / 1000;
      }
      const messageJson = this._serializeMessage(msg);
      const priority = msg.priority || 0;
      const queueName = this._getPriorityStreamName(priority);

      pipeline.xadd(queueName, "*", "data", messageJson);
    }

    try {
      const results = await pipeline.exec();
      results.forEach((result) => {
        if (!result[0]) {
          successful++;
        }
      });

      this._stats.enqueued += successful;
      logger.info(
        `Batch processed: ${successful}/${messages.length} messages enqueued to streams`
      );
      if (successful > 0) {
        // Optimization: For large batches, don't send all message data to avoid clogging the socket.
        // Instead, send a signal to force a refresh.
        if (successful > 50) {
          this.publishEvent('enqueue', { count: successful, force_refresh: true });
        } else {
          this.publishEvent('enqueue', { count: successful, messages: messages });
        }
      }
      return successful;
    } catch (e) {
      logger.error(`Error in batch enqueue: ${e}`);
      return successful;
    }
  }

  async dequeueMessage(timeout = 0, ackTimeout = null, specificStreams = null) {
    const priorityStreams = specificStreams || this._getAllPriorityStreams(); // Highest priority first
    const timeoutMs = Math.max(0, Math.floor(timeout * 1000));

    try {
      const redis = this.redisManager.redis;
      const deadlineMs = Date.now() + timeoutMs;
      const baseSleepMs = 50;

      const readOne = async (streamName) => {
        const args = [
          "GROUP",
          this.config.consumer_group_name,
          this.config.consumer_name,
          "COUNT",
          1,
        ];

        const results = await redis.xreadgroup(
          ...args,
          "STREAMS",
          streamName,
          ">"
        );

        if (!results || results.length === 0) return null;
        const [, messages] = results[0] || [];
        if (!messages || messages.length === 0) return null;

        const [streamId, fields] = messages[0];
        return { streamName, streamId, fields };
      };

      const readOneWithGroupEnsure = async (streamName) => {
        try {
          return await readOne(streamName);
        } catch (e) {
          if (e?.message && e.message.includes("NOGROUP")) {
            await this._ensureConsumerGroup(streamName);
            return await readOne(streamName);
          }
          throw e;
        }
      };

      let readResult = null;

      for (const streamName of priorityStreams) {
        readResult = await readOneWithGroupEnsure(streamName);
        if (readResult) break;
      }

      let sleepMs = baseSleepMs;
      while (!readResult && Date.now() < deadlineMs) {
        for (const streamName of priorityStreams) {
          readResult = await readOneWithGroupEnsure(streamName);
          if (readResult) break;
        }

        if (readResult) break;

        const remainingMs = deadlineMs - Date.now();
        if (remainingMs <= 0) break;
        const waitMs = Math.min(sleepMs, remainingMs);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        sleepMs = Math.min(250, Math.floor(sleepMs * 1.5));
      }

      if (!readResult) {
        return null;
      }

      const { streamName, streamId, fields } = readResult;

      let messageJson = null;
      for (let i = 0; i < fields.length; i += 2) {
        if (fields[i] === "data") {
          messageJson = fields[i + 1];
          break;
        }
      }

      if (!messageJson) {
        // Corrupt message, ack and remove
        await this.redisManager.redis.xack(streamName, this.config.consumer_group_name, streamId);
        await this.redisManager.redis.xdel(streamName, streamId);
        return null;
      }

      const messageData = this._deserializeMessage(messageJson);
      if (!messageData) {
        await this.redisManager.redis.xack(streamName, this.config.consumer_group_name, streamId);
        await this.redisManager.redis.xdel(streamName, streamId);
        logger.warn("Failed to deserialize message from stream, removed.");
        return null;
      }

      const messageId = messageData.id;
      // Attach stream metadata for acknowledgment
      messageData._stream_id = streamId;
      messageData._stream_name = streamName;

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
      
      if (ackTimeout) {
        metadata.custom_ack_timeout = ackTimeout;
      } else if (messageData.custom_ack_timeout) {
        metadata.custom_ack_timeout = messageData.custom_ack_timeout;
      }

      if (
        typeof messageData.custom_max_attempts === "number" &&
        messageData.custom_max_attempts > 0
      ) {
        metadata.custom_max_attempts = messageData.custom_max_attempts;
      }

      // Update metadata (include the full message data for acknowledgment)
      const metadataWithMessage = {
        ...metadata,
        _original_message: {
          type: messageData.type,
          payload: messageData.payload,
          priority: messageData.priority,
          created_at: messageData.created_at,
          custom_ack_timeout: metadata.custom_ack_timeout,
          custom_max_attempts: metadata.custom_max_attempts,
          encryption: messageData.encryption,
          signature: messageData.signature,
        }
      };
      
      await this.redisManager.redis.hset(
        this.config.metadata_hash_name,
        metadataKey,
        JSON.stringify(metadataWithMessage)
      );

      this._stats.dequeued++;
      logger.info(
        `Message dequeued: ${messageId} (attempt: ${metadata.attempt_count}) from ${streamName}`
      );
      
      // Return message with updated metadata
      return {
        ...messageData,
        attempt_count: metadata.attempt_count,
        dequeued_at: metadata.dequeued_at,
        processing_started_at: metadata.dequeued_at
      };

    } catch (e) {
      if (e.message && e.message.includes("NOGROUP")) {
        // Ensure consumer groups exist for all priority streams
        for (const stream of priorityStreams) {
          await this._ensureConsumerGroup(stream);
        }
        return this.dequeueMessage(timeout);
      }
      logger.error(`Error dequeuing message: ${e}`);
      return null;
    }
  }

  async acknowledgeMessage(ackPayload) {
    const messageId = ackPayload.id;
    const streamId = ackPayload._stream_id;
    const streamName = ackPayload._stream_name;

    if (!messageId || !streamId || !streamName) {
      const logger = this.logger || console;
      logger.warn("Cannot acknowledge message: Missing ID or Stream metadata.", { payload: ackPayload });
      return false;
    }

    const logger = this.logger || console;

    try {
      // Fetch the full message data - try metadata first, then stream as fallback
      let fullMessageData = { ...ackPayload };
      
      // If the payload is missing type or payload, try to recover it
      if (!ackPayload.type || !ackPayload.payload) {
        // First, try to get from metadata (stored during dequeue)
        try {
          const metadataJson = await this.redisManager.redis.hget(
            this.config.metadata_hash_name,
            messageId
          );
          
          if (metadataJson) {
            const metadata = JSON.parse(metadataJson);
            if (metadata._original_message) {
              fullMessageData = {
                ...metadata._original_message,
                id: messageId,
                attempt_count: metadata.attempt_count,
              };
              logger.debug(`Recovered full message data from metadata for ${messageId}`);
            }
          }
        } catch (metaError) {
          logger.warn(`Could not fetch message from metadata for ${messageId}: ${metaError.message}`);
        }
        
        // If still missing, try XRANGE as fallback
        if (!fullMessageData.type || !fullMessageData.payload) {
          try {
            const range = await this.redisManager.redis.xrange(streamName, streamId, streamId);
            if (range && range.length > 0) {
              const [, fields] = range[0];
              let messageJson = null;
              for (let i = 0; i < fields.length; i += 2) {
                if (fields[i] === "data") {
                  messageJson = fields[i + 1];
                  break;
                }
              }
              if (messageJson) {
                const parsedMessage = this._deserializeMessage(messageJson);
                if (parsedMessage) {
                  fullMessageData = { ...parsedMessage, id: messageId };
                  logger.debug(`Recovered full message data from stream for ${messageId}`);
                }
              }
            }
          } catch (fetchError) {
            logger.warn(`Could not fetch full message data from stream for ${messageId}: ${fetchError.message}`);
          }
        }
      }

      const pipeline = this.redisManager.pipeline();

      // 1. Acknowledge in Stream
      pipeline.xack(streamName, this.config.consumer_group_name, streamId);
      
      // 2. Remove from Stream (optional, mimics queue behavior)
      pipeline.xdel(streamName, streamId);

      // 3. Add to Acknowledged Queue (Stream) for history
      try {
        const ackMsgData = { ...fullMessageData, acknowledged_at: Date.now() / 1000 };
        // Remove internal fields before saving to history
        delete ackMsgData._stream_id;
        delete ackMsgData._stream_name;
        
        const ackMsgJson = this._serializeMessage(ackMsgData);
        pipeline.xadd(this.config.acknowledged_queue_name, "*", "data", ackMsgJson);
        pipeline.xtrim(this.config.acknowledged_queue_name, "MAXLEN", "~", this.config.max_acknowledged_history);
        pipeline.incr(this.config.total_acknowledged_key);
      } catch (e) {
        logger.warn(`Failed to process message for acknowledged queue: ${e.message}`);
      }

      // 4. Cleanup Metadata
      pipeline.hdel(this.config.metadata_hash_name, messageId);
      // Also cleanup original_json_string field if it exists (legacy cleanup)
      pipeline.hdel(this.config.metadata_hash_name, `${messageId}:original_json_string`);

      const results = await pipeline.exec();
      
      // Check XACK result (first command)
      const xackResult = results[0];
      if (xackResult[0]) {
         logger.error(`Error in XACK for ${messageId}: ${xackResult[0]}`);
         return false;
      }

      if (this._stats && typeof this._stats.acknowledged === 'number') {
        this._stats.acknowledged++;
      }
      logger.info(`Message acknowledged successfully: ${messageId}`);
      this.publishEvent('acknowledge', { id: messageId });
      return true;

    } catch (error) {
      logger.error(`Critical error during message acknowledgment for ID ${messageId}: ${error.message}`);
      return false;
    }
  }

  async requeueFailedMessages() {
    logger.info("Verifying failed messages...");
    const redis = this.redisManager.redis;
    const lockKey = `${this.config.queue_name}:overdue_requeue_lock`;
    const lockToken = generateId();
    const lockTtlMs = 30000;
    const lockOk = await redis.set(lockKey, lockToken, "NX", "PX", lockTtlMs);
    if (!lockOk) return 0;
    const queues = this._getAllPriorityStreams();
    let requeuedCount = 0;
    let movedToDlqCount = 0;
    const currentTime = Date.now() / 1000;

    try {
      for (const queueName of queues) {
        try {
          let pending;
          try {
            pending = await redis.xpending(
              queueName,
              this.config.consumer_group_name,
              "-",
              "+",
              100
            );
          } catch (e) {
            const msg = e?.message || "";
            if (msg.includes("NOGROUP") || msg.includes("no such key")) {
              continue;
            }
            throw e;
          }

          if (!pending || pending.length === 0) continue;

          const pendingIds = pending.map((p) => p[0]);
          const metadataMap = new Map();
          const messageDataMap = new Map();

          if (pendingIds.length > 0) {
            const pipeline = this.redisManager.pipeline();
            pendingIds.forEach((id) => pipeline.xrange(queueName, id, id));
            const ranges = await pipeline.exec();

            const messageIds = [];

            ranges.forEach((result, index) => {
              const streamId = pendingIds[index];
              if (result[1] && result[1].length > 0) {
                const [, fields] = result[1][0];
                let json = null;
                for (let i = 0; i < fields.length; i += 2) {
                  if (fields[i] === "data") {
                    json = fields[i + 1];
                    break;
                  }
                }
                if (json) {
                  const msg = this._deserializeMessage(json);
                  if (msg && msg.id) {
                    messageIds.push(msg.id);
                    messageDataMap.set(streamId, msg);
                  }
                }
              }
            });

            if (messageIds.length > 0) {
              const metadataJsons = await redis.hmget(
                this.config.metadata_hash_name,
                ...messageIds
              );
              messageIds.forEach((msgId, index) => {
                if (metadataJsons[index]) {
                  try {
                    metadataMap.set(msgId, JSON.parse(metadataJsons[index]));
                  } catch {}
                }
              });
            }
          }

          for (const [msgId, , idleMs] of pending) {
            if (idleMs < 1000) continue;

            const messageData = messageDataMap.get(msgId);

            if (!messageData) {
              await redis.xack(queueName, this.config.consumer_group_name, msgId);
              continue;
            }

            let metadata = metadataMap.get(messageData.id);
            let effectiveTimeout = this.config.ack_timeout_seconds;
            let effectiveMaxAttempts = this.config.max_attempts;

            if (metadata) {
              if (metadata.custom_ack_timeout) {
                effectiveTimeout = metadata.custom_ack_timeout;
              }
              if (metadata.custom_max_attempts) {
                effectiveMaxAttempts = metadata.custom_max_attempts;
              }
            } else {
              metadata = {
                attempt_count: 0,
                created_at: messageData.created_at,
                custom_max_attempts: messageData.custom_max_attempts,
              };
              if (metadata.custom_max_attempts) {
                effectiveMaxAttempts = metadata.custom_max_attempts;
              }
            }

            if (idleMs < effectiveTimeout * 1000) continue;

            if (metadata.attempt_count >= effectiveMaxAttempts) {
              if (
                typeof messageData.custom_ack_timeout !== "number" &&
                typeof metadata.custom_ack_timeout === "number"
              ) {
                messageData.custom_ack_timeout = metadata.custom_ack_timeout;
              } else if (
                typeof messageData.custom_ack_timeout !== "number" &&
                typeof metadata._original_message?.custom_ack_timeout === "number"
              ) {
                messageData.custom_ack_timeout =
                  metadata._original_message.custom_ack_timeout;
              }

              if (
                typeof messageData.custom_max_attempts !== "number" &&
                typeof metadata.custom_max_attempts === "number"
              ) {
                messageData.custom_max_attempts = metadata.custom_max_attempts;
              } else if (
                typeof messageData.custom_max_attempts !== "number" &&
                typeof metadata._original_message?.custom_max_attempts === "number"
              ) {
                messageData.custom_max_attempts =
                  metadata._original_message.custom_max_attempts;
              }

              messageData.failed_at = currentTime;
              messageData.last_error = "Max attempts exceeded (Stream)";
              messageData.attempt_count = metadata.attempt_count;
              const dlqJson = this._serializeMessage(messageData);

              const tx = redis.multi();
              tx.xadd(this.config.dead_letter_queue_name, "*", "data", dlqJson);
              tx.xack(queueName, this.config.consumer_group_name, msgId);
              tx.xdel(queueName, msgId);
              tx.hdel(this.config.metadata_hash_name, messageData.id);
              await tx.exec();
              movedToDlqCount++;
            } else {
              const messageJson = this._serializeMessage(messageData);
              const tx = redis.multi();
              tx.xadd(queueName, "*", "data", messageJson);
              tx.xack(queueName, this.config.consumer_group_name, msgId);
              tx.xdel(queueName, msgId);
              await tx.exec();
              requeuedCount++;
            }
          }
        } catch (e) {
          logger.error(`Error processing pending messages for ${queueName}: ${e}`);
        }
      }

      this._stats.requeued += requeuedCount;
      this._stats.failed += movedToDlqCount;

      if (movedToDlqCount > 0)
        this.publishEvent("move_to_dlq", { count: movedToDlqCount });
      if (requeuedCount > 0) this.publishEvent("requeue", { count: requeuedCount });

      return requeuedCount;
    } finally {
      try {
        await redis.eval(
          "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end",
          1,
          lockKey,
          lockToken
        );
      } catch {}
    }
  }

  async _ensureFullMessage(msg, queueType) {
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

  async moveMessages(messages, fromQueue, toQueue) {
    const uniqueMessages = [];
    const seenIds = new Set();
    for (const msg of messages || []) {
      const id = msg?.id;
      if (!id) continue;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      uniqueMessages.push(msg);
    }

    // Fetch full messages if missing payload/type (e.g. from partial UI selection)
    const enrichedMessages = await Promise.all(uniqueMessages.map(m => this._ensureFullMessage(m, fromQueue)));

    // Fetch and merge metadata from Hash to preserve history (attempts, errors)
    // because _ensureFullMessage only gets the static Stream data.
    if (enrichedMessages.length > 0) {
        try {
            const ids = enrichedMessages.map(m => m?.id).filter(Boolean);
            if (ids.length > 0) {
                const metadataJsons = await this.redisManager.redis.hmget(this.config.metadata_hash_name, ...ids);
                enrichedMessages.forEach((msg, i) => {
                    if (msg && metadataJsons[i]) {
                        try {
                            const meta = JSON.parse(metadataJsons[i]);
                            if (meta) {
                                msg.attempt_count = meta.attempt_count;
                                msg.last_error = meta.last_error || msg.last_error;
                                msg.custom_ack_timeout = meta.custom_ack_timeout || msg.custom_ack_timeout;
                                msg.custom_max_attempts = meta.custom_max_attempts || msg.custom_max_attempts;
                            }
                        } catch (e) { /* ignore */ }
                    }
                });
            }
        } catch (e) {
            logger.warn(`Failed to enrich messages with metadata during move: ${e.message}`);
        }
    }
    
    // Helper to get queue name by type
    const getQueueName = (type, priority = 0) => {
        if (type === 'main') return this._getPriorityStreamName(priority);
        if (type === 'dead') return this.config.dead_letter_queue_name;
        if (type === 'acknowledged') return this.config.acknowledged_queue_name;
        if (type === 'processing') return this._getPriorityStreamName(priority);
        return this.config.queue_name;
    };

    let movedCount = 0;
    const pipeline = this.redisManager.pipeline();

    for (const msg of enrichedMessages) {
        if (!msg || !msg.id) continue;

        // 1. Remove from Source
        if (fromQueue === 'acknowledged') {
            // For acknowledged queue (Stream), use _stream_id if available
            const streamId = msg._stream_id;
            if (streamId) {
                pipeline.xdel(this.config.acknowledged_queue_name, streamId);
            } else {
                throw new Error(`Message ${msg.id} not found in acknowledged queue`);
            }
        } else {
            // Stream Source
            const streamId = msg._stream_id;
            if (streamId) {
                const qName = (fromQueue === 'processing') ? this._getPriorityStreamName(msg.priority || 0) : getQueueName(fromQueue, msg.priority);
                // For processing, we use _stream_name if available, otherwise use priority-based stream name
                const actualStreamName = msg._stream_name || qName;

                if (fromQueue === 'processing') {
                    // For processing, we must ACK to remove from PEL, and DEL to remove from Stream.
                    // Wait, usually moving from processing means we want to re-process or fail.
                    // If we move to Main, we are effectively re-queuing.
                    // If we move to DLQ, we are failing.
                    pipeline.xack(actualStreamName, this.config.consumer_group_name, streamId);
                }
                pipeline.xdel(actualStreamName, streamId);
            } else {
                throw new Error(`Message ${msg.id} not found in ${fromQueue} queue`);
            }
        }

        // 2. Add to Destination
        const newMsg = { ...msg };
        // Cleanup internal fields
        delete newMsg._stream_id;
        delete newMsg._stream_name;
        
        // Update metadata based on destination
        if (toQueue === 'main') {
            // Reset processing info if requeuing
            delete newMsg.dequeued_at;
            delete newMsg.processing_started_at;
            // Optionally reset attempt_count? Users usually want retry.
            // But if we reset attempt_count, it might loop forever.
            // Let's keep attempt_count but maybe update it?
            // Actually, if we move to main, we are treating it as a new enqueue but with history.
        } else if (toQueue === 'acknowledged') {
            newMsg.acknowledged_at = Date.now() / 1000;
        } else if (toQueue === 'dead') {
             newMsg.failed_at = Date.now() / 1000;
             newMsg.last_error = newMsg.last_error || "Manually moved to DLQ";
        }

        const msgJson = this._serializeMessage(newMsg);
        
        // All destinations now use Streams
      let destQueue;
      if (toQueue === 'processing') {
           // Use dedicated manual stream for UI moves to ensure isolation from backlog
           destQueue = this._getManualStreamName();
      } else {
           destQueue = getQueueName(toQueue, newMsg.priority);
      }
        
        pipeline.xadd(destQueue, "*", "data", msgJson);
        
        if (toQueue === 'acknowledged') {
            pipeline.xtrim(this.config.acknowledged_queue_name, "MAXLEN", "~", this.config.max_acknowledged_history);
            pipeline.incr(this.config.total_acknowledged_key);
            // Cleanup metadata hash
            pipeline.hdel(this.config.metadata_hash_name, newMsg.id);
        }
        
        movedCount++;
    }

    const results = await pipeline.exec();
    
    // Check for errors in pipeline execution
    if (results) {
        results.forEach(([err, res], index) => {
            if (err) {
                logger.error(`Pipeline error at index ${index}: ${err.message}`);
            }
        });
    }

    // Special handling when moving TO processing queue:
    // We attempt to dequeue (consume) the messages immediately so they appear in the PEL (Processing list).
    //
    // CRITICAL FIX: We now use a dedicated 'manual' stream (queue_manual) for these moves.
    // We explicitly tell dequeueMessage to ONLY check that stream.
    // This prevents us from accidentally dequeuing messages from the 'immediate' or 'main' backlog.
    // Since 'queue_manual' is only used for these UI actions, it should be empty or small,
    // allowing us to find and "process" our specific message without side effects.
    if (toQueue === 'processing') {
      const targetIds = new Set(enrichedMessages.map(m => m.id));
      const maxAttempts = movedCount + 200;
      let dequeuedCount = 0;
      let foundCount = 0;

      const manualStream = this._getManualStreamName();

      while (foundCount < targetIds.size && dequeuedCount < maxAttempts) {
        try {
          const batchCount = Math.min(100, Math.max(1, targetIds.size - foundCount));
          let results;
          try {
            results = await this.redisManager.redis.xreadgroup(
              "GROUP",
              this.config.consumer_group_name,
              this.config.consumer_name,
              "COUNT",
              batchCount,
              "STREAMS",
              manualStream,
              ">"
            );
          } catch (e) {
            if (e?.message && e.message.includes("NOGROUP")) {
              await this._ensureConsumerGroup(manualStream);
              results = await this.redisManager.redis.xreadgroup(
                "GROUP",
                this.config.consumer_group_name,
                this.config.consumer_name,
                "COUNT",
                batchCount,
                "STREAMS",
                manualStream,
                ">"
              );
            } else {
              throw e;
            }
          }

          if (!results || results.length === 0) break;
          const [, entries] = results[0] || [];
          if (!entries || entries.length === 0) break;

          const now = Date.now() / 1000;
          const parsedEntries = [];
          const metaKeys = [];

          for (const [streamId, fields] of entries) {
            let messageJson = null;
            for (let i = 0; i < fields.length; i += 2) {
              if (fields[i] === "data") {
                messageJson = fields[i + 1];
                break;
              }
            }
            if (!messageJson) {
              parsedEntries.push({ streamId, streamName: manualStream, messageData: null });
              continue;
            }
            const messageData = this._deserializeMessage(messageJson);
            if (!messageData || !messageData.id) {
              parsedEntries.push({ streamId, streamName: manualStream, messageData: null });
              continue;
            }
            messageData._stream_id = streamId;
            messageData._stream_name = manualStream;
            parsedEntries.push({ streamId, streamName: manualStream, messageData });
            metaKeys.push(messageData.id);
          }

          const metaValues = metaKeys.length
            ? await this.redisManager.redis.hmget(this.config.metadata_hash_name, ...metaKeys)
            : [];
          const metaById = new Map();
          for (let i = 0; i < metaKeys.length; i++) {
            metaById.set(metaKeys[i], metaValues[i]);
          }

          const pipeline2 = this.redisManager.redis.pipeline();
          let processed = 0;

          for (const entry of parsedEntries) {
            const msgData = entry.messageData;
            dequeuedCount++;
            if (!msgData || !entry.streamId) {
              pipeline2.xack(manualStream, this.config.consumer_group_name, entry.streamId);
              pipeline2.xdel(manualStream, entry.streamId);
              continue;
            }

            let metadata;
            const existingMetaJson = metaById.get(msgData.id);
            if (existingMetaJson) {
              try {
                metadata = MessageMetadata.fromObject(JSON.parse(existingMetaJson));
              } catch {
                metadata = new MessageMetadata(0, null, msgData.created_at || now);
              }
            } else {
              metadata = new MessageMetadata(0, null, msgData.created_at || now);
            }

            metadata.dequeued_at = now;
            metadata.attempt_count += 1;

            if (msgData.custom_ack_timeout) {
              metadata.custom_ack_timeout = msgData.custom_ack_timeout;
            }

            if (
              typeof msgData.custom_max_attempts === "number" &&
              msgData.custom_max_attempts > 0
            ) {
              metadata.custom_max_attempts = msgData.custom_max_attempts;
            }

            const metadataWithMessage = {
              ...metadata,
              _original_message: {
                type: msgData.type,
                payload: msgData.payload,
                priority: msgData.priority,
                created_at: msgData.created_at,
                custom_ack_timeout: metadata.custom_ack_timeout,
                custom_max_attempts: metadata.custom_max_attempts,
                encryption: msgData.encryption,
                signature: msgData.signature,
              },
            };

            pipeline2.hset(
              this.config.metadata_hash_name,
              msgData.id,
              JSON.stringify(metadataWithMessage)
            );

            processed++;

            if (targetIds.has(msgData.id)) {
              foundCount++;
              continue;
            }

            logger.warn(`Found stale message ${msgData.id} in manual queue during move. Returning to main.`);
            const priority = msgData.priority || 0;
            const mainStream = this._getPriorityStreamName(priority);
            const cleanMsg = { ...msgData };
            delete cleanMsg._stream_id;
            delete cleanMsg._stream_name;
            delete cleanMsg.dequeued_at;
            delete cleanMsg.processing_started_at;
            pipeline2.xadd(mainStream, "*", "data", this._serializeMessage(cleanMsg));
            pipeline2.xack(manualStream, this.config.consumer_group_name, entry.streamId);
            pipeline2.xdel(manualStream, entry.streamId);
          }

          if (pipeline2.length > 0) {
            await pipeline2.exec();
          }

          this._stats.dequeued += processed;
        } catch (e) {
          logger.warn(`Failed to auto-dequeue message after move: ${e.message}`);
          break;
        }
      }
      
      if (foundCount < targetIds.size) {
        logger.warn(`Moved ${movedCount} messages to processing (manual), but only dequeued ${foundCount} of them immediately.`);
      }
    }

    if (movedCount > 0) {
      this.publishEvent('move', { from: fromQueue, to: toQueue, count: movedCount });
    }

    return movedCount;
  }

  async getMessagesByDateRange(startTimestamp, endTimestamp, limit) {
    const messages = [];
    
    // Build list of all queues to check (all priority streams + DLQ + acknowledged)
    const queuesToCheck = this._getAllPriorityStreams().map((name, index) => ({
      name,
      type: index === this.config.max_priority_levels - 1 ? "main" : `priority_${this.config.max_priority_levels - 1 - index}`
    }));
    queuesToCheck.push({ name: this.config.dead_letter_queue_name, type: "DLQ" });
    queuesToCheck.push({ name: this.config.acknowledged_queue_name, type: "acknowledged" });

    // Helper to enrich messages with metadata
    const enrichMessages = async (msgs) => {
        if (!msgs || msgs.length === 0) return msgs;
        try {
            const ids = msgs.map(m => m.id);
            const metadataJsons = await this.redisManager.redis.hmget(this.config.metadata_hash_name, ...ids);
            
            for (let i = 0; i < msgs.length; i++) {
                if (metadataJsons[i]) {
                    try {
                        const meta = JSON.parse(metadataJsons[i]);
                        if (meta) {
                            msgs[i].attempt_count = meta.attempt_count;
                            msgs[i].last_error = meta.last_error;
                            msgs[i].custom_ack_timeout = meta.custom_ack_timeout;
                            msgs[i].custom_max_attempts = meta.custom_max_attempts;
                        }
                    } catch (e) { /* ignore */ }
                }
            }
        } catch (e) {
            logger.warn(`Failed to fetch metadata: ${e.message}`);
        }
        return msgs;
    };

    outerLoop:
    for (const queue of queuesToCheck) {
      // All queues now use Streams
      const stream = await this.redisManager.redis.xrange(queue.name, "-", "+");
      const allMessages = stream.map(([id, fields]) => {
          let json = null;
          for(let i=0; i<fields.length; i+=2) if(fields[i]==='data') json=fields[i+1];
          return { json, id };
      });

      for (const { json: messageJson, id: streamId } of allMessages) {
        if (!messageJson) continue;
        try {
          const messageData = this._deserializeMessage(messageJson);
          if (!messageData) continue;
          
          // Attach stream info for reliable moves/deletes
          messageData._stream_id = streamId;
          messageData._stream_name = queue.name;

          const messageTimestamp = messageData.created_at * 1000; // Convert to milliseconds
          if (messageTimestamp >= startTimestamp && messageTimestamp <= endTimestamp) {
            messages.push(messageData);
            if (messages.length >= limit) {
              break outerLoop;
            }
          }
        } catch (e) {
          logger.warn(`Failed to parse message in queue ${queue.name}: ${e}`);
        }
      }
    }

    return await enrichMessages(messages);
  }

  async removeMessagesByDateRange(startTimestamp, endTimestamp) {
    let totalRemovedCount = 0;
    
    // Build list of all queues to check (all priority streams + DLQ + acknowledged)
    const queuesToCheck = this._getAllPriorityStreams().map((name, index) => ({
      name,
      type: index === this.config.max_priority_levels - 1 ? "main" : `priority_${this.config.max_priority_levels - 1 - index}`
    }));
    queuesToCheck.push({ name: this.config.dead_letter_queue_name, type: "DLQ" });
    queuesToCheck.push({ name: this.config.acknowledged_queue_name, type: "acknowledged" });

    for (const queueInfo of queuesToCheck) {
      logger.info(
        `Verifying queue ${queueInfo.type} for deletion by date range`
      );
      
      let removedFromCurrentQueue = 0;
      
      // All queues now use Streams
      const stream = await this.redisManager.redis.xrange(queueInfo.name, "-", "+");
      const pipeline = this.redisManager.pipeline();
      
      for (const [id, fields] of stream) {
          let json = null;
          for(let i=0; i<fields.length; i+=2) if(fields[i]==='data') json=fields[i+1];
          const messageData = this._deserializeMessage(json);
          if (messageData) {
               const createdAt = messageData.created_at * 1000;
               if (createdAt && createdAt >= startTimestamp && createdAt <= endTimestamp) {
                   pipeline.xdel(queueInfo.name, id);
                   // Only XACK for main queues (acknowledged queue doesn't use consumer groups)
                   if (queueInfo.type !== 'acknowledged') {
                       pipeline.xack(queueInfo.name, this.config.consumer_group_name, id);
                   }
                   if (messageData.id) {
                       pipeline.hdel(this.config.metadata_hash_name, messageData.id);
                   }
                   removedFromCurrentQueue++;
              }
          }
      }
      if (pipeline.length > 0) await pipeline.exec();

      if (removedFromCurrentQueue > 0) {
        logger.info(`Removed ${removedFromCurrentQueue} messages from ${queueInfo.type}`);
      }
      totalRemovedCount += removedFromCurrentQueue;
    }
    return totalRemovedCount;
  }

  async getMetrics() {
    try {
      const pipeline = this.redisManager.pipeline();
      const priorityStreams = this._getAllPriorityStreams();
      
      // Queue lengths for all priority streams
      for (const stream of priorityStreams) {
        pipeline.xlen(stream);
      }
      
      // DLQ and Acknowledged queue lengths
      pipeline.xlen(this.config.dead_letter_queue_name);
      pipeline.xlen(this.config.acknowledged_queue_name);
      
      // Stats
      pipeline.get(this.config.total_acknowledged_key);
      pipeline.hlen(this.config.metadata_hash_name);
      
      // Pending (Processing) Counts for all priority streams
      for (const stream of priorityStreams) {
        pipeline.xpending(stream, this.config.consumer_group_name);
      }

      const results = await pipeline.exec();
      
      // Parse priority stream lengths
      let totalMainQueueSize = 0;
      let totalProcessingSize = 0;
      const priorityDetails = {};
      const priorityCount = priorityStreams.length;
      
      for (let i = 0; i < priorityCount; i++) {
        const len = results[i][1] || 0;
        const priority = priorityCount - 1 - i; // Reverse because streams are highest-first
        priorityDetails[`priority_${priority}_queued`] = len;
        totalMainQueueSize += len;
      }
      
      // DLQ and Acknowledged
      const dlqLen = results[priorityCount][1] || 0;
      const ackLen = results[priorityCount + 1][1] || 0;
      const totalAck = parseInt(results[priorityCount + 2][1] || '0', 10);
      const metadataCount = results[priorityCount + 3][1] || 0;
      
      // Parse pending counts for all priority streams
      for (let i = 0; i < priorityCount; i++) {
        const pendingResult = results[priorityCount + 4 + i][1];
        const pendingCount = pendingResult ? pendingResult[0] : 0;
        const priority = priorityCount - 1 - i;
        priorityDetails[`priority_${priority}_processing`] = pendingCount;
        totalProcessingSize += pendingCount;
      }

      const queueMetrics = {
        main_queue_size: totalMainQueueSize,
        processing_queue_size: totalProcessingSize,
        dead_letter_queue_size: dlqLen,
        acknowledged_queue_size: ackLen,
        total_acknowledged: totalAck,
        metadata_count: metadataCount,
        priority_levels: this.config.max_priority_levels,
        // Detailed breakdown by priority
        details: priorityDetails
      };
      return { ...queueMetrics, stats: { ...this._stats } };
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

  async deleteMessages(messageIds, queueType) {
    try {
      const redis = this.redisManager.redis;
      let streamNames = [];

      switch (queueType) {
        case 'main':
          streamNames = this._getAllPriorityStreams();
          break;
        case 'processing':
          streamNames = this._getAllPriorityStreams();
          break;
        case 'dead':
          streamNames = [this.config.dead_letter_queue_name];
          break;
        case 'acknowledged':
          streamNames = [this.config.acknowledged_queue_name];
          break;
        default:
          throw new Error(`Invalid queue type: ${queueType}`);
      }

      const idsToDelete = new Set(messageIds);
      let totalDeleted = 0;
      const pipeline = redis.pipeline();
      // Keep track of found IDs to stop searching if we found all (optional, but streams are disjoint)

      for (const stream of streamNames) {
          // Optimization: If we had stream IDs, we could pipeline XDELs directly.
          // Since we have UUIDs, we must scan.
          // Scanning full stream is expensive. 
          // FUTURE TODO: Use Redis Search or maintain a UUID->StreamID mapping.
          const entries = await redis.xrange(stream, "-", "+");
          for (const [id, fields] of entries) {
              let json = null;
              for(let i=0; i<fields.length; i+=2) if(fields[i]==='data') json=fields[i+1];
              const msg = this._deserializeMessage(json);
              
              if (msg && idsToDelete.has(msg.id)) {
                  pipeline.xdel(stream, id);
                  if (queueType === 'processing') {
                      pipeline.xack(stream, this.config.consumer_group_name, id);
                  }
                  totalDeleted++;
              }
          }
      }
      
      await pipeline.exec();
      
      if (totalDeleted > 0) {
           this.publishEvent('delete', { ids: Array.from(idsToDelete), count: totalDeleted });
      }

      return totalDeleted;
    } catch (error) {
        logger.error(`Error deleting messages: ${error.message}`);
        throw error;
    }
  }

  async deleteMessage(messageId, queueType) {
    try {
      const redis = this.redisManager.redis;
      let streamNames = [];

      switch (queueType) {
        case 'main':
          streamNames = this._getAllPriorityStreams();
          break;
        case 'processing':
          // Processing messages are in the priority streams (but in PEL)
          // To "delete" from processing, we XACK + XDEL from stream.
          streamNames = this._getAllPriorityStreams();
          break;
        case 'dead':
          streamNames = [this.config.dead_letter_queue_name];
          break;
        case 'acknowledged':
          streamNames = [this.config.acknowledged_queue_name];
          break;
        default:
          throw new Error(`Invalid queue type: ${queueType}`);
      }

      // All queues now use Streams
      let deleted = false;
      for (const stream of streamNames) {
          // Scan stream to find message with matching ID in JSON
          // Optimization: XRANGE full scan. For production, Redis Search is better.
          const entries = await redis.xrange(stream, "-", "+");
          for (const [id, fields] of entries) {
              let json = null;
              for(let i=0; i<fields.length; i+=2) if(fields[i]==='data') json=fields[i+1];
              const msg = this._deserializeMessage(json);
              if (msg && msg.id === messageId) {
                  // Found it.
                  const pipeline = redis.pipeline();
                  pipeline.xdel(stream, id);
                  // XACK only for queues with consumer groups (not acknowledged)
                  if (queueType !== 'acknowledged') {
                      pipeline.xack(stream, this.config.consumer_group_name, id);
                  }
                  await pipeline.exec();
                  deleted = true;
                  break;
              }
          }
          if (deleted) break;
      }
      if (!deleted) throw new Error(`Message ${messageId} not found in ${queueType} queue`);

      // Metadata cleanup
      await redis.hdel(this.config.metadata_hash_name, messageId);

      logger.info(`Successfully deleted message ${messageId} from ${queueType} queue`);
      this.publishEvent('delete', { id: messageId, queue: queueType });
      return { success: true, messageId, queueType, message: 'Message deleted successfully' };

    } catch (error) {
      logger.error(`Error deleting message ${messageId} from ${queueType} queue: ${error.message}`);
      throw error;
    }
  }

  async updateMessage(messageId, queueType, updates) {
    try {
      const redis = this.redisManager.redis;
      let streamNames = [];
      
      // Special handling for processing queue - only allow metadata updates (timeout)
      if (queueType === 'processing') {
          // Verify message exists in pending list (optional but good for validation)
          // For efficiency, we might skip full verification or just check metadata.
          // Let's check metadata first as that's what we are updating.
          
          const metadataKey = messageId;
          const existingMetaJson = await redis.hget(this.config.metadata_hash_name, metadataKey);
          
          if (!existingMetaJson) {
              throw new Error(`Message metadata not found for ${messageId} in processing queue`);
          }

          let meta = JSON.parse(existingMetaJson);
          
          // Only update allowed fields for processing messages
          if (updates.custom_ack_timeout !== undefined) {
              meta.custom_ack_timeout = updates.custom_ack_timeout;
              await redis.hset(this.config.metadata_hash_name, metadataKey, JSON.stringify(meta));
              
              logger.info(`Updated custom_ack_timeout for message ${messageId} in processing queue`);
              this.publishEvent('update', { id: messageId, queue: queueType, updates: { custom_ack_timeout: updates.custom_ack_timeout } });
              return {
                  success: true,
                  messageId,
                  queueType,
                  message: 'Message timeout updated successfully',
                  data: { ...updates, id: messageId }
              };
          } else {
              // If no valid updates for processing queue
               return {
                  success: true, // Or false? User might have sent payload update which we ignored.
                  messageId,
                  queueType,
                  message: 'No updatable fields provided for processing message (only timeout can be updated)',
                  data: { id: messageId }
              };
          }
      }

      switch (queueType) {
        case 'main':
          streamNames = this._getAllPriorityStreams();
          break;
        case 'dead':
          streamNames = [this.config.dead_letter_queue_name];
          break;
        default:
          throw new Error(`Cannot update message in ${queueType} queue. Only 'main', 'dead', and 'processing' queues are supported.`);
      }

      let originalMessageData = null;
      let originalStream = null;
      let originalStreamId = null;

      // Find message
      for (const stream of streamNames) {
          const entries = await redis.xrange(stream, "-", "+");
          for (const [id, fields] of entries) {
              let json = null;
              for(let i=0; i<fields.length; i+=2) if(fields[i]==='data') json=fields[i+1];
              const msg = this._deserializeMessage(json);
              if (msg && msg.id === messageId) {
                  originalMessageData = msg;
                  originalStream = stream;
                  originalStreamId = id;
                  break;
              }
          }
          if (originalMessageData) break;
      }

      if (!originalMessageData) {
        throw new Error(`Message with ID ${messageId} not found in ${queueType} queue`);
      }

      const updatedMessageData = { ...originalMessageData, ...updates, id: messageId };
      const updatedMessageJson = this._serializeMessage(updatedMessageData);

      const pipeline = redis.pipeline();
      // Remove old
      pipeline.xdel(originalStream, originalStreamId);
      // Add new (Append to stream)
      // Note: This changes the timestamp/order.
      pipeline.xadd(originalStream, "*", "data", updatedMessageJson);

      await pipeline.exec();

      logger.info(`Successfully updated message ${messageId} in ${queueType} queue`);
      this.publishEvent('update', { id: messageId, queue: queueType, updates });
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

  async getQueueStatus(typeFilter = null, includeMessages = true) {
    try {
      const redis = this.redisManager.redis;
      const pipeline = redis.pipeline();
      const priorityStreams = this._getAllPriorityStreams();
      const priorityCount = priorityStreams.length;

      // Get queue lengths for all priority streams
      for (const stream of priorityStreams) {
        pipeline.xlen(stream);
      }
      
      // DLQ, Acknowledged, and total acknowledged key
      pipeline.xlen(this.config.dead_letter_queue_name);
      pipeline.xlen(this.config.acknowledged_queue_name);
      pipeline.get(this.config.total_acknowledged_key);

      // Get queue contents (limited to 100 items each) for all priority streams
      if (includeMessages) {
        for (const stream of priorityStreams) {
          pipeline.xrevrange(stream, "+", "-", "COUNT", 100);
        }
        pipeline.xrevrange(this.config.dead_letter_queue_name, "+", "-", "COUNT", 100);
        pipeline.xrevrange(this.config.acknowledged_queue_name, "+", "-", "COUNT", 100);
      }

      // Get metadata
      pipeline.hgetall(this.config.metadata_hash_name);
      
      // Get Processing (Pending) for all priority streams
      for (const stream of priorityStreams) {
        pipeline.xpending(stream, this.config.consumer_group_name, "-", "+", 100);
      }

      const results = await pipeline.exec();

      // Parse lengths
      let totalMainLen = 0;
      for (let i = 0; i < priorityCount; i++) {
        totalMainLen += results[i][1] || 0;
      }
      const dlqLen = results[priorityCount][1] || 0;
      const ackLen = results[priorityCount + 1][1] || 0;
      const totalAck = parseInt(results[priorityCount + 2][1] || '0', 10);
      
      // Parse messages from all priority streams
      let mainMessages = [];
      let deadMessages = [];
      let acknowledgedMessages = [];
      let metadata = {};
      let pendingStartIdx;

      // Helper to parse Stream messages
      const parseStreamMessages = (rawMessages, streamName) => {
          if (!rawMessages) return [];
          return rawMessages.map(([id, fields]) => {
              let msgJson = null;
              for(let i=0; i<fields.length; i+=2) {
                  if (fields[i] === 'data') {
                      msgJson = fields[i+1];
                      break;
                  }
              }
              const msg = this._deserializeMessage(msgJson);
              if (msg) {
                  msg._stream_id = id;
                  msg._stream_name = streamName;
              }
              return msg || { id, error: 'Failed to parse' };
          });
      };

      if (includeMessages) {
          const contentStartIdx = priorityCount + 3;
          
          // Collect main messages from all priority streams
          for (let i = 0; i < priorityCount; i++) {
            const streamMsgs = results[contentStartIdx + i][1];
            const streamName = priorityStreams[i];
            mainMessages.push(...parseStreamMessages(streamMsgs, streamName));
          }
          mainMessages = mainMessages.sort((a,b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 100);
          
          const dlqMsgsRaw = results[contentStartIdx + priorityCount][1];
          const ackMsgsRaw = results[contentStartIdx + priorityCount + 1][1];
          metadata = results[contentStartIdx + priorityCount + 2][1];
          
          deadMessages = parseStreamMessages(dlqMsgsRaw, this.config.dead_letter_queue_name);
          acknowledgedMessages = parseStreamMessages(ackMsgsRaw, this.config.acknowledged_queue_name);

          pendingStartIdx = contentStartIdx + priorityCount + 3;
      } else {
          metadata = results[priorityCount + 3][1];
          pendingStartIdx = priorityCount + 4;
      }

      // Processing messages from all priority streams
      const processingMessages = [];
      const pendingToCheck = [];

      for (let i = 0; i < priorityCount; i++) {
        const pendingResult = results[pendingStartIdx + i][1];
        const pending = Array.isArray(pendingResult) ? pendingResult : [];
        const streamName = priorityStreams[i];
        const priority = priorityCount - 1 - i; // Convert index to priority
        
        pending.forEach(([id, consumer, idle, count]) => {
           pendingToCheck.push({ id, streamName, priority, count });
        });
      }

      // Fetch details for pending messages to verify existence (filter out ghosts)
      if (pendingToCheck.length > 0 && includeMessages) {
          const checkPipeline = redis.pipeline();
          pendingToCheck.forEach(p => {
              checkPipeline.xrange(p.streamName, p.id, p.id);
          });
          const checkResults = await checkPipeline.exec();
          
          pendingToCheck.forEach((p, index) => {
               const res = checkResults[index] ? checkResults[index][1] : null;
               // If res is empty array, message does not exist in stream (ghost)
               if (res && res.length > 0) {
                   const [id, fields] = res[0];
                   let msgJson = null;
                   for(let k=0; k<fields.length; k+=2) {
                       if (fields[k] === 'data') {
                           msgJson = fields[k+1];
                           break;
                       }
                   }
                   
                   let msgData = { 
                       id: p.id, 
                       _stream_id: p.id, 
                       _stream_name: p.streamName, 
                       attempt_count: p.count,
                       priority: p.priority
                   };

                   if (msgJson) {
                       const parsed = this._deserializeMessage(msgJson);
                       if (parsed) {
                           // Merge parsed data but preserve stream metadata
                           msgData = { ...msgData, ...parsed, _stream_id: p.id, _stream_name: p.streamName };
                       }
                   }
                   processingMessages.push(msgData);
               }
           });
           
           // Fetch metadata for processing messages to get start times and other details
           if (processingMessages.length > 0) {
               const metaPipeline = redis.pipeline();
               processingMessages.forEach(m => {
                   // Only fetch if we have an ID (which we should from message content or stream ID)
                   // Prefer payload ID if available, otherwise use stream ID?
                   // Metadata is stored by payload ID usually.
                   if (m.id && m.id !== 'See details') {
                        metaPipeline.hget(this.config.metadata_hash_name, m.id);
                   }
               });
               
               const metaResults = await metaPipeline.exec();
               
               let metaIndex = 0;
               processingMessages.forEach(m => {
                   if (m.id && m.id !== 'See details') {
                       const metaRes = metaResults[metaIndex];
                       metaIndex++;
                       
                       if (metaRes && !metaRes[0] && metaRes[1]) {
                           try {
                               const meta = JSON.parse(metaRes[1]);
                               // Merge metadata fields
                               if (meta.processing_started_at) m.processing_started_at = meta.processing_started_at;
                               if (meta.dequeued_at) m.dequeued_at = meta.dequeued_at;
                               if (meta.attempt_count) m.attempt_count = meta.attempt_count; 
                               if (meta.last_error) m.last_error = meta.last_error;
                           } catch (e) {
                               // Ignore parse errors
                           }
                       }
                   }
               });
           }
       }
      
      // Collect types from all stream messages
      const availableTypes = new Set();
      [...mainMessages, ...deadMessages, ...acknowledgedMessages].forEach(m => {
          if (m.type) availableTypes.add(m.type);
      });

      // Filter out messages from mainQueue that are present in processingQueue
      // This prevents "duplication" in the UI status since processing messages are technically still in the stream (mainQueue)
      if (includeMessages && processingMessages.length > 0) {
        const processingStreamIds = new Set(processingMessages.map(m => m._stream_id));
        mainMessages = mainMessages.filter(m => !processingStreamIds.has(m._stream_id));
      }

      const processingLength = includeMessages ? processingMessages.length : pendingToCheck.length;

      // Adjust main queue length to reflect only waiting messages
      const waitingLength = Math.max(0, totalMainLen - processingLength);

      return {
        mainQueue: {
          name: this.config.queue_name,
          length: waitingLength,
          messages: mainMessages,
          priority_levels: this.config.max_priority_levels,
        },
        processingQueue: {
          name: "processing_pending", // Virtual name
          length: processingLength,
          messages: processingMessages,
        },
        deadLetterQueue: {
          name: this.config.dead_letter_queue_name,
          length: dlqLen,
          messages: deadMessages,
        },
        acknowledgedQueue: {
          name: this.config.acknowledged_queue_name,
          length: ackLen,
          messages: acknowledgedMessages,
          total: totalAck
        },
        metadata: {
          totalProcessed: 0, // Harder to calculate with Streams without full scan
          totalFailed: 0,
          totalAcknowledged: totalAck
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
      let rawMessages = [];
      let isStream = true;

      if (queueType === 'main') {
          // Fetch from all priority streams
          const priorityStreams = this._getAllPriorityStreams();

          const getPendingSafe = async (queueName) => {
              try {
                  const res = await redis.xpending(queueName, this.config.consumer_group_name, "-", "+", 1000);
                  return Array.isArray(res) ? res : [];
              } catch (e) {
                  const msg = e.message || '';
                  if (msg.includes('NOGROUP') || msg.includes('no such key')) {
                      return [];
                  }
                  throw e;
              }
          };

          const pendingStreamIds = new Set();
          for (const streamName of priorityStreams) {
              const pending = await getPendingSafe(streamName);
              for (const p of pending) {
                  pendingStreamIds.add(p[0]);
              }
          }
          
          const parse = (msgs, name) => msgs.map(([id, fields]) => {
              let json = null;
              for(let i=0; i<fields.length; i+=2) if(fields[i]==='data') json=fields[i+1];
              const m = this._deserializeMessage(json);
              if(m) { m._stream_id = id; m._stream_name = name; }
              return m;
          }).filter(Boolean);

          for (const streamName of priorityStreams) {
              const streamData = await redis.xrange(streamName, "-", "+");
              rawMessages.push(...parse(streamData, streamName));
          }

          if (pendingStreamIds.size > 0) {
              rawMessages = rawMessages.filter(m => !pendingStreamIds.has(m?._stream_id));
          }

          const ids = rawMessages.map(m => m?.id).filter(Boolean);
          if (ids.length > 0) {
              const metaResults = await redis.hmget(this.config.metadata_hash_name, ...ids);
              rawMessages.forEach((m, index) => {
                  const metaStr = metaResults[index];
                  if (!metaStr) return;
                  try {
                      const meta = JSON.parse(metaStr);
                      if (meta.attempt_count !== undefined) m.attempt_count = meta.attempt_count;
                      if (meta.last_error) m.last_error = meta.last_error;
                      if (meta.custom_ack_timeout) m.custom_ack_timeout = meta.custom_ack_timeout;
                      if (meta.custom_max_attempts) m.custom_max_attempts = meta.custom_max_attempts;
                  } catch (e) {}
              });
          }
          isStream = false; // Already parsed
      } else if (queueType === 'processing') {
          // Fetch pending from all priority streams
          const priorityStreams = this._getAllPriorityStreams();
          
          const getPendingSafe = async (queueName) => {
              try {
                  const res = await redis.xpending(queueName, this.config.consumer_group_name, "-", "+", 1000);
                  return Array.isArray(res) ? res : [];
              } catch (e) {
                  const msg = e.message || '';
                  if (msg.includes('NOGROUP') || msg.includes('no such key')) {
                      return [];
                  }
                  throw e;
              }
          };

          // Collect pending from all priority streams
          const allPending = [];
          const streamPendingMap = new Map(); // Map stream ID to stream name
          
          for (const streamName of priorityStreams) {
              const pending = await getPendingSafe(streamName);
              for (const p of pending) {
                  allPending.push(p);
                  streamPendingMap.set(p[0], streamName);
              }
          }
          
          if (allPending.length === 0) {
              rawMessages = [];
          } else {
              // Fetch full message data for all pending
              const pipeline = redis.pipeline();
              for (const p of allPending) {
                  const streamName = streamPendingMap.get(p[0]);
                  pipeline.xrange(streamName, p[0], p[0]);
              }
              
              const results = await pipeline.exec();
              
              let messagesWithIds = [];
              if (results) {
                  messagesWithIds = results.map((r, i) => {
                      if(!r || !r[1] || !r[1][0]) return null;
                      const [id, fields] = r[1][0];
                      let json = null;
                      for(let j=0; j<fields.length; j+=2) if(fields[j]==='data') json=fields[j+1];
                      const m = this._deserializeMessage(json);
                      
                      const pendingInfo = allPending[i];
                      const idleTime = pendingInfo ? pendingInfo[2] : 0;

                      if(m) { 
                          m._stream_id = id; 
                          m._stream_name = streamPendingMap.get(id);
                          // Calculate dequeued_at from idle time for accurate timeout calculation
                          m.dequeued_at = (Date.now() - idleTime) / 1000;
                          if (!m.processing_started_at) m.processing_started_at = m.dequeued_at;
                      }
                      return m;
                  }).filter(Boolean);

                  // Fetch metadata for all found messages
                  if (messagesWithIds.length > 0) {
                      const metaPipeline = redis.pipeline();
                      messagesWithIds.forEach(m => {
                          metaPipeline.hget(this.config.metadata_hash_name, m.id);
                      });
                      const metaResults = await metaPipeline.exec();
                      
                      // Create a map for pending info for fast lookup
                      const pendingMap = new Map();
                      allPending.forEach(p => pendingMap.set(p[0], { idle: p[2], count: p[3] }));

                      messagesWithIds.forEach((m, index) => {
                          const metaRes = metaResults[index];
                          if (metaRes && !metaRes[0] && metaRes[1]) {
                              try {
                                  const meta = JSON.parse(metaRes[1]);
                                  m.attempt_count = meta.attempt_count;
                                  m.dequeued_at = meta.dequeued_at;
                                  m.processing_started_at = meta.dequeued_at;
                                  m.last_error = meta.last_error;
                                  if (meta.custom_ack_timeout) m.custom_ack_timeout = meta.custom_ack_timeout;
                                  if (meta.custom_max_attempts) m.custom_max_attempts = meta.custom_max_attempts;
                              } catch (e) {
                                  // ignore
                              }
                          } else {
                              const pendingInfo = pendingMap.get(m._stream_id);
                              if (pendingInfo) {
                                  m.attempt_count = pendingInfo.count;
                                  m.dequeued_at = (Date.now() - pendingInfo.idle) / 1000;
                                  m.processing_started_at = m.dequeued_at;
                              }
                          }
                      });
                  }
                  rawMessages = messagesWithIds;
              }
          }
          isStream = false;

      } else if (queueType === 'dead') {
          const stream = await redis.xrange(this.config.dead_letter_queue_name, "-", "+");
          rawMessages = stream.map(([id, fields]) => {
              let json = null;
              for(let i=0; i<fields.length; i+=2) if(fields[i]==='data') json=fields[i+1];
              const m = this._deserializeMessage(json);
              if(m) { m._stream_id = id; m._stream_name = this.config.dead_letter_queue_name; }
              return m;
          }).filter(Boolean);
          const ids = rawMessages.map(m => m?.id).filter(Boolean);
          if (ids.length > 0) {
              const metaResults = await redis.hmget(this.config.metadata_hash_name, ...ids);
              const metaById = new Map();
              ids.forEach((id, index) => metaById.set(id, metaResults[index]));
              rawMessages.forEach((m) => {
                  const metaStr = metaById.get(m?.id);
                  if (!metaStr) return;
                  try {
                      const meta = JSON.parse(metaStr);
                      if (meta.attempt_count !== undefined) m.attempt_count = meta.attempt_count;
                      if (meta.last_error) m.last_error = meta.last_error;
                      const customAckTimeout = meta.custom_ack_timeout ?? meta._original_message?.custom_ack_timeout;
                      const customMaxAttempts = meta.custom_max_attempts ?? meta._original_message?.custom_max_attempts;
                      if (customAckTimeout) m.custom_ack_timeout = customAckTimeout;
                      if (customMaxAttempts) m.custom_max_attempts = customMaxAttempts;
                  } catch (e) {}
              });
          }
          isStream = false;
      } else if (queueType === 'acknowledged') {
          // Stream (now consistent with other queues)
          const stream = await redis.xrange(this.config.acknowledged_queue_name, "-", "+");
          rawMessages = stream.map(([id, fields]) => {
              let json = null;
              for(let i=0; i<fields.length; i+=2) if(fields[i]==='data') json=fields[i+1];
              const m = this._deserializeMessage(json);
              if(m) { m._stream_id = id; m._stream_name = this.config.acknowledged_queue_name; }
              return m;
          }).filter(Boolean);
          isStream = false; // Already parsed
      } else {
          throw new Error(`Invalid queue type: ${queueType}`);
      }

      let messages = rawMessages;

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
      const streams = this._getAllPriorityStreams();

      // Clear all priority streams
      for (const stream of streams) {
        pipeline.del(stream);
      }
      
      // Safety: Explicitly delete potential legacy/ghost streams that might persist
      pipeline.del(`${this.config.queue_name}_processing`);
      if (this.config.processing_queue_name !== `${this.config.queue_name}_processing`) {
          pipeline.del(this.config.processing_queue_name);
      }
      
      // Clear other queues and metadata
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
      const pipeline = this.redisManager.pipeline();
      const priorityStreams = this._getAllPriorityStreams();

      switch (queueType) {
        case 'main':
          // Clear all priority streams
          for (const stream of priorityStreams) {
            pipeline.del(stream);
          }
          break;
        case 'processing':
          // Reset consumer groups for all priority streams
          // This clears the PEL (processing state) but messages remain in streams
          logger.warn("Clearing processing queue resets consumer groups, but messages remain in streams.");
          for (const stream of priorityStreams) {
            pipeline.xgroup("DESTROY", stream, this.config.consumer_group_name);
            pipeline.xgroup("CREATE", stream, this.config.consumer_group_name, "0", "MKSTREAM");
          }
          break;
        case 'dead':
          pipeline.del(this.config.dead_letter_queue_name);
          break;
        case 'acknowledged':
          pipeline.del(this.config.acknowledged_queue_name);
          break;
        default:
          throw new Error(`Cannot clear ${queueType} queue. Invalid queue type.`);
      }

      await pipeline.exec();
      logger.info(`Cleared ${queueType} queue`);
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
    await queue.clearAllQueues();
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

import { fileURLToPath } from 'url';

// Run demo if the script is run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  demoOptimizedQueue().catch((err) => {
    logger.error(`Fatal error in demo: ${err.stack}`);
    process.exit(1);
  });
}

export { OptimizedRedisQueue, QueueConfig, MessageSecurity };
