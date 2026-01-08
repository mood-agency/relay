import { logger, generateId } from "./utils.js";
import { MessageMetadata } from "./models.js";

/**
 * Dequeues a message from the queue.
 * @param {number} [timeout=0] - Timeout in seconds.
 * @param {number|null} [ackTimeout=null] - Acknowledgement timeout.
 * @param {string[]|null} [specificStreams=null] - Specific streams to poll.
 * @param {string|null} [consumerId=null] - Identifier of the consumer dequeuing the message.
 * @returns {Promise<Object|null>} The dequeued message or null.
 */
export async function dequeueMessage(timeout = 0, ackTimeout = null, specificStreams = null, consumerId = null) {
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
    
    // Store consumer ID if provided
    if (consumerId) {
      metadata.consumer_id = consumerId;
    }
    
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
      consumer_id: metadata.consumer_id || null,
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
      `Message dequeued: ${messageId} (attempt: ${metadata.attempt_count}) from ${streamName}${consumerId ? ` by consumer: ${consumerId}` : ''}`
    );
    
    // Return message with updated metadata
    return {
      ...messageData,
      attempt_count: metadata.attempt_count,
      dequeued_at: metadata.dequeued_at,
      processing_started_at: metadata.dequeued_at,
      consumer_id: metadata.consumer_id || null
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

/**
 * Acknowledges a message.
 * @param {Object} ackPayload - The message payload to acknowledge.
 * @returns {Promise<boolean>} True if successful.
 */
export async function acknowledgeMessage(ackPayload) {
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

/**
 * Requeues failed messages (messages that timed out).
 * @returns {Promise<number>} Number of requeued messages.
 */
export async function requeueFailedMessages() {
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
            this.config.requeue_batch_size
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

        const processingPipeline = redis.pipeline();
        let operationsInPipeline = 0;

        for (const [msgId, , idleMs] of pending) {
          if (idleMs < 1000) continue;

          const messageData = messageDataMap.get(msgId);

          if (!messageData) {
            processingPipeline.xack(queueName, this.config.consumer_group_name, msgId);
            operationsInPipeline++;
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

            processingPipeline.xadd(this.config.dead_letter_queue_name, "*", "data", dlqJson);
            processingPipeline.xack(queueName, this.config.consumer_group_name, msgId);
            processingPipeline.xdel(queueName, msgId);
            processingPipeline.hdel(this.config.metadata_hash_name, messageData.id);
            
            movedToDlqCount++;
            operationsInPipeline++;
          } else {
            const messageJson = this._serializeMessage(messageData);
            
            processingPipeline.xadd(queueName, "*", "data", messageJson);
            processingPipeline.xack(queueName, this.config.consumer_group_name, msgId);
            processingPipeline.xdel(queueName, msgId);
            
            requeuedCount++;
            operationsInPipeline++;
          }
        }
        
        if (operationsInPipeline > 0) {
           await processingPipeline.exec();
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
