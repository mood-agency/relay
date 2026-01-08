import { logger, generateId } from "./utils.js";
import { MessageMetadata } from "./models.js";

/**
 * Dequeues a message from the queue.
 * @param {number} [timeout=0] - Timeout in seconds.
 * @param {number|null} [ackTimeout=null] - Acknowledgement timeout.
 * @param {string[]|null} [specificStreams=null] - Specific streams to poll.
 * @param {string|null} [type=null] - Optional message type to filter by.
 * @param {string|null} [consumerId=null] - Optional consumer identifier for tracking ownership.
 * @returns {Promise<Object|null>} The dequeued message or null.
 */
export async function dequeueMessage(timeout = 0, ackTimeout = null, specificStreams = null, type = null, consumerId = null) {
  const priorityStreams = specificStreams || this._getAllPriorityStreams(); // Highest priority first
  const timeoutMs = Math.max(0, Math.floor(timeout * 1000));
  const redis = this.redisManager.redis;

  try {
    const deadlineMs = Date.now() + timeoutMs;
    const baseSleepMs = 50;

    if (type) {
      const indexKey = this._getTypeIndexKey(type);
      const manualStream = this._getManualStreamName();
      const locKey = this._getMessageLocationHashKey();
      await this._ensureConsumerGroup(manualStream);

      const lua = `
local indexKey = KEYS[1]
local locKey = KEYS[2]
local manualStream = KEYS[3]

local group = ARGV[1]
local consumer = ARGV[2]
local maxChecks = tonumber(ARGV[3]) or 50

local function ensureGroup()
  local ok, err = pcall(redis.call, 'XGROUP', 'CREATE', manualStream, group, '0', 'MKSTREAM')
  if ok then return end
  if err and string.find(err, 'BUSYGROUP') then return end
end

ensureGroup()

for i = 1, maxChecks do
  repeat
    local popped = redis.call('ZPOPMIN', indexKey, 1)
    if (not popped) or (#popped == 0) then
      return nil
    end

    local messageId = popped[1]
    local loc = redis.call('HGET', locKey, messageId)
    if not loc then
      break -- continue
    end

    local sep = string.find(loc, '|', 1, true)
    if not sep then
      redis.call('HDEL', locKey, messageId)
      break -- continue
    end

    local streamName = string.sub(loc, 1, sep - 1)
    local streamId = string.sub(loc, sep + 1)
    if (not streamName) or (streamName == '') or (not streamId) or (streamId == '') then
      redis.call('HDEL', locKey, messageId)
      break -- continue
    end

    local pendingOk, pendingRes = pcall(redis.call, 'XPENDING', streamName, group, streamId, streamId, 1)
    if pendingOk and type(pendingRes) == 'table' and #pendingRes > 0 then
      redis.call('HDEL', locKey, messageId)
      break -- continue
    end

    local range = redis.call('XRANGE', streamName, streamId, streamId)
    if (not range) or (#range == 0) then
      redis.call('HDEL', locKey, messageId)
      break -- continue
    end

    local fields = range[1][2]
    local data = nil
    if fields then
      for f = 1, #fields, 2 do
        if fields[f] == 'data' then
          data = fields[f + 1]
          break
        end
      end
    end
    if not data then
      redis.call('HDEL', locKey, messageId)
      break -- continue
    end

    local newId = redis.call('XADD', manualStream, '*', 'data', data)
    local delCount = redis.call('XDEL', streamName, streamId)
    if (not delCount) or (tonumber(delCount) == 0) then
      redis.call('XDEL', manualStream, newId)
      break -- continue
    end

    redis.call('HDEL', locKey, messageId)

    local read = redis.call(
      'XREADGROUP',
      'GROUP', group, consumer,
      'COUNT', 1,
      'STREAMS', manualStream, '>'
    )
    return read

  until true
end

return nil
`;

      const findAndMoveByType = async () => {
        const results = await redis.eval(
          lua,
          3,
          indexKey,
          locKey,
          manualStream,
          this.config.consumer_group_name,
          this.config.consumer_name,
          "50"
        );
        if (!results || results.length === 0) return null;
        const [streamEntry] = results;
        if (!streamEntry || streamEntry.length < 2) return null;
        const [streamName, messages] = streamEntry;
        if (!messages || messages.length === 0) return null;
        const [streamId, fields] = messages[0];
        return { streamName, streamId, fields };
      };

      let readResult = await findAndMoveByType();
      
      let sleepMs = baseSleepMs;
      while (!readResult && Date.now() < deadlineMs) {
        await new Promise((resolve) => setTimeout(resolve, sleepMs));
        readResult = await findAndMoveByType();
        sleepMs = Math.min(500, Math.floor(sleepMs * 1.5));
      }

      if (!readResult) return null;
      return this._processReadResult(readResult, ackTimeout, consumerId);
    }

    // Original logic for normal dequeue
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

    return this._processReadResult(readResult, ackTimeout, consumerId);

  } catch (e) {
    if (e.message && e.message.includes("NOGROUP")) {
      // Ensure consumer groups exist for all priority streams
      for (const stream of priorityStreams) {
        await this._ensureConsumerGroup(stream);
      }
      return this.dequeueMessage(timeout, ackTimeout, specificStreams, type, consumerId);
    }
    logger.error(`Error dequeuing message: ${e}`);
    return null;
  }
}

/**
 * Processes a read result from Redis Stream and returns the message object.
 * @param {Object} readResult - The result from readOne or similar.
 * @param {number|null} [ackTimeout=null] - Acknowledgement timeout.
 * @param {string|null} [consumerId=null] - Optional consumer identifier for tracking ownership.
 * @returns {Promise<Object|null>} The processed message.
 * @private
 */
export async function _processReadResult(readResult, ackTimeout = null, consumerId = null) {
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
  metadata.consumer_id = this.config.consumer_name;
  
  // Generate a unique lock_token for this dequeue (fencing token for split-brain prevention)
  metadata.lock_token = generateId();
  
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

  try {
    if (messageData.type && messageId) {
      const indexKey = this._getTypeIndexKey(messageData.type);
      const locKey = this._getMessageLocationHashKey();
      await this.redisManager.redis
        .multi()
        .zrem(indexKey, messageId)
        .hdel(locKey, messageId)
        .exec();
    }
  } catch {}

  if (this._stats && typeof this._stats.dequeued === 'number') {
    this._stats.dequeued++;
  }
  
  logger.info(
    `Message dequeued: ${messageId} (attempt: ${metadata.attempt_count}, lock: ${metadata.lock_token}) from ${streamName}`
  );
  
  // Return message with updated metadata
  return {
    ...messageData,
    attempt_count: metadata.attempt_count,
    dequeued_at: metadata.dequeued_at,
    processing_started_at: metadata.dequeued_at,
    consumer_id: metadata.consumer_id,
    lock_token: metadata.lock_token
  };
}

/**
 * Acknowledges a message.
 * @param {Object} ackPayload - The message payload to acknowledge.
 * @returns {Promise<boolean|{success: boolean, error?: string}>} True if successful, or object with error if lock validation fails.
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
    // Lock validation (Fencing Token): If lock_token is provided, verify it matches
    if (ackPayload.lock_token !== undefined) {
      const metadataJson = await this.redisManager.redis.hget(
        this.config.metadata_hash_name,
        messageId
      );
      
      if (metadataJson) {
        const metadata = JSON.parse(metadataJson);
        if (metadata.lock_token !== ackPayload.lock_token) {
          logger.warn(`ACK rejected for ${messageId}: lock_token mismatch (expected ${metadata.lock_token}, got ${ackPayload.lock_token}) - Lock was lost`);
          return { success: false, error: "LOCK_LOST" };
        }
      }
      // If metadata doesn't exist, the message might have already been processed or expired
      // We'll continue with the ACK attempt and let Redis handle it
    }

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
        } catch (streamError) {
          logger.warn(`Could not fetch message from stream for ${messageId}: ${streamError.message}`);
        }
      }
    }

    const pipeline = this.redisManager.pipeline();

    // 1. Acknowledge in Consumer Group
    pipeline.xack(streamName, this.config.consumer_group_name, streamId);

    // 2. Remove from Source Stream
    pipeline.xdel(streamName, streamId);

    // 3. Add to Acknowledged Queue (Stream)
    // We want to store a lightweight version or full version? 
    // Usually full version so we can inspect history.
    try {
      const ackMsgData = {
        ...fullMessageData,
        acknowledged_at: Date.now() / 1000
      };
      // Clean up internal fields before archiving
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
        const requeueIndexEntries = [];
        let pipelineCmdIndex = 0;
        let operationsInPipeline = 0;

        for (const [msgId, , idleMs] of pending) {
          if (idleMs < 1000) continue;

          const messageData = messageDataMap.get(msgId);

          if (!messageData) {
            processingPipeline.xack(queueName, this.config.consumer_group_name, msgId);
            pipelineCmdIndex++;
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

          // Use dequeued_at from metadata if available (may have been updated by touch),
          // otherwise fall back to idleMs from XPENDING
          let elapsedMs = idleMs;
          if (metadata && typeof metadata.dequeued_at === 'number') {
            elapsedMs = (currentTime - metadata.dequeued_at) * 1000;
          }

          if (elapsedMs < effectiveTimeout * 1000) continue;

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
            pipelineCmdIndex++;
            processingPipeline.xack(queueName, this.config.consumer_group_name, msgId);
            pipelineCmdIndex++;
            processingPipeline.xdel(queueName, msgId);
            pipelineCmdIndex++;
            processingPipeline.hdel(this.config.metadata_hash_name, messageData.id);
            pipelineCmdIndex++;
            
            movedToDlqCount++;
            operationsInPipeline++;
          } else {
            const messageJson = this._serializeMessage(messageData);
            
            const xaddCmdIndex = pipelineCmdIndex;
            processingPipeline.xadd(queueName, "*", "data", messageJson);
            pipelineCmdIndex++;
            requeueIndexEntries.push({ xaddCmdIndex, queueName, messageData });
            processingPipeline.xack(queueName, this.config.consumer_group_name, msgId);
            pipelineCmdIndex++;
            processingPipeline.xdel(queueName, msgId);
            pipelineCmdIndex++;
            
            requeuedCount++;
            operationsInPipeline++;
          }
        }
        
        if (operationsInPipeline > 0) {
           const execResults = await processingPipeline.exec();
           if (execResults && requeueIndexEntries.length > 0) {
             const typesKey = this._getTypeIndexTypesKey();
             const locKey = this._getMessageLocationHashKey();
             const indexPipeline = redis.pipeline();
             let hasIndexOps = false;

             for (const entry of requeueIndexEntries) {
               const streamId = execResults[entry.xaddCmdIndex]?.[1];
               const msg = entry.messageData;
               if (!streamId || !msg?.id || !msg?.type) continue;
               const indexKey = this._getTypeIndexKey(msg.type);
               const score = Math.floor((msg.created_at || Date.now() / 1000) * 1000);
               indexPipeline.sadd(typesKey, msg.type);
               indexPipeline.zadd(indexKey, score, msg.id);
               indexPipeline.hset(locKey, msg.id, `${entry.queueName}|${streamId}`);
               hasIndexOps = true;
             }

             if (hasIndexOps) {
               await indexPipeline.exec();
             }
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

/**
 * Negative acknowledgement of a message.
 * @param {string} messageId - The message ID (UUID).
 * @param {string} [errorReason] - Optional error reason.
 * @returns {Promise<boolean>} True if successful.
 */
export async function nackMessage(messageId, errorReason) {
  // 1. Find message location
  // We assume it's in a priority stream (main/processing)
  const foundMsg = await this._ensureFullMessage({ id: messageId }, 'processing');

  if (!foundMsg || !foundMsg._stream_id || !foundMsg._stream_name) {
    const logger = this.logger || console;
    logger.warn(`Cannot nack message ${messageId}: Not found in active streams.`);
    return false;
  }

  const { _stream_name: streamName, _stream_id: streamId } = foundMsg;

  // 2. Get/Update Metadata
  const metadataKey = messageId;
  let metadata;
  const existingMetadataJson = await this.redisManager.redis.hget(
    this.config.metadata_hash_name,
    metadataKey
  );

  if (existingMetadataJson) {
    metadata = MessageMetadata.fromObject(JSON.parse(existingMetadataJson));
  } else {
    // Fallback if metadata missing
    metadata = new MessageMetadata(0, null, foundMsg.created_at);
  }

  // Check constraints
  let maxAttempts = this.config.max_attempts;
  if (metadata.custom_max_attempts) maxAttempts = metadata.custom_max_attempts;
  else if (foundMsg.custom_max_attempts)
    maxAttempts = foundMsg.custom_max_attempts;

  const pipeline = this.redisManager.pipeline();

  // 3. Apply Retry Policy
  if (metadata.attempt_count >= maxAttempts) {
    // Move to DLQ
    foundMsg.failed_at = Date.now() / 1000;
    foundMsg.last_error = errorReason || "NACK: Max attempts exceeded";
    foundMsg.attempt_count = metadata.attempt_count;

    // Clean internal fields
    const dlqMsg = { ...foundMsg };
    delete dlqMsg._stream_id;
    delete dlqMsg._stream_name;

    pipeline.xadd(
      this.config.dead_letter_queue_name,
      "*",
      "data",
      this._serializeMessage(dlqMsg)
    );
    pipeline.xack(streamName, this.config.consumer_group_name, streamId);
    pipeline.xdel(streamName, streamId);
    pipeline.hdel(this.config.metadata_hash_name, messageId);

    // Cleanup index
    if (foundMsg.type) {
      const indexKey = this._getTypeIndexKey(foundMsg.type);
      const locKey = this._getMessageLocationHashKey();
      pipeline.zrem(indexKey, messageId);
      pipeline.hdel(locKey, messageId);
    }

    await pipeline.exec();
    this.publishEvent("move_to_dlq", { count: 1, id: messageId });
    const logger = this.logger || console;
    logger.info(`Message ${messageId} moved to DLQ (NACK)`);
  } else {
    // Requeue (Back of queue)
    foundMsg.last_error = errorReason || "NACK: Requeued";

    const requeueMsg = { ...foundMsg };
    delete requeueMsg._stream_id;
    delete requeueMsg._stream_name;
    delete requeueMsg.dequeued_at;
    delete requeueMsg.processing_started_at;

    const msgJson = this._serializeMessage(requeueMsg);

    pipeline.xadd(streamName, "*", "data", msgJson);
    pipeline.xack(streamName, this.config.consumer_group_name, streamId);
    pipeline.xdel(streamName, streamId);

    const results = await pipeline.exec();

    // Update index if needed
    const newStreamId = results[0][1]; // Result of XADD
    if (foundMsg.type && newStreamId) {
      const indexPipeline = this.redisManager.redis.pipeline();
      const locKey = this._getMessageLocationHashKey();
      indexPipeline.hset(locKey, messageId, `${streamName}|${newStreamId}`);
      await indexPipeline.exec();
    }

    this.publishEvent("requeue", { count: 1, id: messageId });
    const logger = this.logger || console;
    logger.info(`Message ${messageId} requeued (NACK)`);
  }

  return true;
}

/**
 * Extends the lock/visibility timeout for a message in processing.
 * This is used as a "heartbeat" or "keep-alive" mechanism to prevent
 * the message from being re-queued while a slow worker is still processing it.
 * 
 * @param {string} messageId - The message ID (UUID).
 * @param {number} attemptCount - The attempt_count received when the message was dequeued (fencing token).
 * @param {number} [extendSeconds] - Optional seconds to extend. Defaults to ack_timeout_seconds.
 * @returns {Promise<{success: boolean, error?: string, new_timeout_at?: number}>} Result object.
 */
/**
 * Extends the lock/visibility timeout for a message in processing.
 * This is used as a "heartbeat" or "keep-alive" mechanism to prevent
 * the message from being re-queued while a slow worker is still processing it.
 * 
 * @param {string} messageId - The message ID (UUID).
 * @param {string} lockToken - The lock_token received when the message was dequeued (fencing token).
 * @param {number} [extendSeconds] - Optional seconds to extend. Defaults to ack_timeout_seconds.
 * @returns {Promise<{success: boolean, error?: string, new_timeout_at?: number, lock_token?: string}>} Result object.
 */
export async function touchMessage(messageId, lockToken, extendSeconds) {
  const redis = this.redisManager.redis;

  try {
    // 1. Get metadata from hash
    const metadataJson = await redis.hget(this.config.metadata_hash_name, messageId);

    if (!metadataJson) {
      logger.warn(`Touch failed for ${messageId}: Message not found in metadata (not in processing)`);
      return { success: false, error: "NOT_FOUND" };
    }

    const metadata = JSON.parse(metadataJson);

    // 2. Verify lock_token matches (fencing token validation)
    if (metadata.lock_token !== lockToken) {
      logger.warn(`Touch failed for ${messageId}: lock_token mismatch (expected ${metadata.lock_token}, got ${lockToken})`);
      return { success: false, error: "LOCK_LOST" };
    }

    // 3. Reset dequeued_at to now (extends visibility timeout)
    const now = Date.now() / 1000;
    metadata.dequeued_at = now;

    await redis.hset(this.config.metadata_hash_name, messageId, JSON.stringify(metadata));

    // Calculate new timeout deadline
    const effectiveTimeout = metadata.custom_ack_timeout || this.config.ack_timeout_seconds;
    const newTimeoutAt = now + effectiveTimeout;

    logger.info(`Touch successful for ${messageId}: lock extended until ${new Date(newTimeoutAt * 1000).toISOString()}`);

    return {
      success: true,
      new_timeout_at: newTimeoutAt,
      extended_by: effectiveTimeout,
      lock_token: metadata.lock_token
    };

  } catch (error) {
    logger.error(`Error during touch for ${messageId}: ${error.message}`);
    return { success: false, error: "INTERNAL_ERROR" };
  }
}