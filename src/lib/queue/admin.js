import { logger, generateId } from "./utils.js";
import { MessageMetadata } from "./models.js";

/**
 * Moves messages between queues.
 * @param {Object[]} messages - Messages to move.
 * @param {string} fromQueue - Source queue name/type.
 * @param {string} toQueue - Destination queue name/type.
 * @param {Object} [options={}] - Options.
 * @returns {Promise<number>} Number of moved messages.
 */
export async function moveMessages(messages, fromQueue, toQueue, options = {}) {
  const errorReason = typeof options?.errorReason === "string" ? options.errorReason.trim() : "";
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
    if (type === 'archived') return this.config.archived_queue_name;
    if (type === 'processing') return this._getPriorityStreamName(priority);
    return this.config.queue_name;
  };

  let movedCount = 0;
  const pipeline = this.redisManager.pipeline();
  const typesKey = this._getTypeIndexTypesKey();
  const locKey = this._getMessageLocationHashKey();
  const destIndexEntries = [];
  let pipelineCmdIndex = 0;

  for (const msg of enrichedMessages) {
    if (!msg || !msg.id) continue;

    if (fromQueue === 'main' && msg.type) {
      const indexKey = this._getTypeIndexKey(msg.type);
      pipeline.zrem(indexKey, msg.id);
      pipeline.hdel(locKey, msg.id);
      pipelineCmdIndex += 2;
    }

    // 1. Remove from Source
    if (fromQueue === 'acknowledged') {
      // For acknowledged queue (Stream), use _stream_id if available
      const streamId = msg._stream_id;
      if (streamId) {
        pipeline.xdel(this.config.acknowledged_queue_name, streamId);
        pipelineCmdIndex++;
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
          // Also remove from pending IDs Set (fast dashboard cache)
          const pendingIdsKey = this._getPendingIdsSetKey();
          pipeline.srem(pendingIdsKey, msg.id);
          pipelineCmdIndex++;
          pipeline.xack(actualStreamName, this.config.consumer_group_name, streamId);
          pipelineCmdIndex++;
        }
        pipeline.xdel(actualStreamName, streamId);
        pipelineCmdIndex++;
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
    } else if (toQueue === 'acknowledged') {
      newMsg.acknowledged_at = Date.now() / 1000;
    } else if (toQueue === 'archived') {
      newMsg.archived_at = Date.now() / 1000;
    } else if (toQueue === 'dead') {
      newMsg.failed_at = Date.now() / 1000;
      newMsg.last_error = errorReason || newMsg.last_error || "Manually moved to Failed Queue";
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

    const xaddCmdIndex = pipelineCmdIndex;
    pipeline.xadd(destQueue, "*", "data", msgJson);
    pipelineCmdIndex++;
    if (toQueue === 'main' && newMsg.type) {
      destIndexEntries.push({ xaddCmdIndex, destQueue, message: newMsg });
    }

    if (toQueue === 'acknowledged') {
      pipeline.xtrim(this.config.acknowledged_queue_name, "MAXLEN", "~", this.config.max_acknowledged_history);
      pipeline.incr(this.config.total_acknowledged_key);
      // Cleanup metadata hash
      pipeline.hdel(this.config.metadata_hash_name, newMsg.id);
      pipelineCmdIndex += 3;
    }

    movedCount++;
  }

  const results = await pipeline.exec();

  if (results && destIndexEntries.length > 0) {
    const indexPipeline = this.redisManager.redis.pipeline();
    let hasIndexOps = false;
    for (const entry of destIndexEntries) {
      const streamId = results[entry.xaddCmdIndex]?.[1];
      const msg = entry.message;
      if (!streamId || !msg?.id || !msg?.type) continue;
      const indexKey = this._getTypeIndexKey(msg.type);
      const ts = Math.floor((msg.created_at || Date.now() / 1000) * 1000);
      const score = this._calculateTypeScore(msg.priority, ts);
      indexPipeline.sadd(typesKey, msg.type);
      indexPipeline.zadd(indexKey, score, msg.id);
      indexPipeline.hset(locKey, msg.id, `${entry.destQueue}|${streamId}`);
      hasIndexOps = true;
    }
    if (hasIndexOps) await indexPipeline.exec();
  }

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
  if (toQueue === 'processing') {
    logger.info(`[MoveToProcessing] Starting auto-dequeue for ${movedCount} messages`);
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

        if (!results || results.length === 0) {
          logger.info(`[MoveToProcessing] No results from xreadgroup, breaking loop`);
          break;
        }
        const [, entries] = results[0] || [];
        if (!entries || entries.length === 0) {
          logger.info(`[MoveToProcessing] No entries in results, breaking loop`);
          break;
        }
        logger.info(`[MoveToProcessing] Got ${entries.length} entries from xreadgroup`);

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
              metadata = new MessageMetadata(msgData.attempt_count || 0, null, msgData.created_at || now);
            }
          } else {
            metadata = new MessageMetadata(msgData.attempt_count || 0, null, msgData.created_at || now);
          }

          metadata.dequeued_at = now;
          metadata.attempt_count += 1;
          // Generate lock_token for split-brain prevention (fencing token)
          metadata.lock_token = generateId();
          // consumer_id is set when dequeued via API with consumerId param

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

          // Store metadata and add to pending IDs Set (for fast dashboard queries)
          const pendingIdsKey = this._getPendingIdsSetKey();
          pipeline2.hset(
            this.config.metadata_hash_name,
            msgData.id,
            JSON.stringify(metadataWithMessage)
          );
          pipeline2.sadd(pendingIdsKey, msgData.id);

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

          // Log silent return to main
          await this.logActivity("requeue", msgData, {
            queue: "main",
            source_queue: "processing",
            dest_queue: "main",
            reason: "Stale message in manual queue during move",
            triggered_by: "system",
          });
        }

        if (processed > 0) {
          logger.info(`[MoveToProcessing] Executing pipeline with ${processed} metadata updates`);
          const pipelineResult = await pipeline2.exec();
          logger.info(`[MoveToProcessing] Pipeline result: ${JSON.stringify(pipelineResult?.slice(0, 3))}`);
        } else {
          logger.warn(`[MoveToProcessing] No messages processed, skipping pipeline exec`);
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
    const movedIds = enrichedMessages.filter(m => m && m.id).map(m => m.id);
    this.publishEvent('move', { from: fromQueue, to: toQueue, count: movedCount, ids: movedIds });

    // Log activity for each moved message
    const batchId = `move_${Date.now()}`;
    for (const msg of enrichedMessages) {
      if (!msg || !msg.id) continue;
      await this.logActivity("move", msg, {
        queue: toQueue,
        source_queue: fromQueue,
        dest_queue: toQueue,
        attempt_count: msg.attempt_count,
        error_reason: errorReason || null,
        batch_id: batchId,
        batch_size: movedCount,
        triggered_by: "admin",
        reason: errorReason || `Manual move from ${fromQueue} to ${toQueue}`,
      });
    }
  }

  return movedCount;
}

/**
 * Gets messages by date range.
 * @param {number} startTimestamp - Start timestamp (ms).
 * @param {number} endTimestamp - End timestamp (ms).
 * @param {number} limit - Limit number of messages.
 * @returns {Promise<Object[]>} Array of messages.
 */
export async function getMessagesByDateRange(startTimestamp, endTimestamp, limit) {
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
      for (let i = 0; i < fields.length; i += 2) if (fields[i] === 'data') json = fields[i + 1];
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

/**
 * Removes messages by date range.
 * @param {number} startTimestamp - Start timestamp (ms).
 * @param {number} endTimestamp - End timestamp (ms).
 * @returns {Promise<number>} Number of removed messages.
 */
export async function removeMessagesByDateRange(startTimestamp, endTimestamp) {
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
      for (let i = 0; i < fields.length; i += 2) if (fields[i] === 'data') json = fields[i + 1];
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
    if (removedFromCurrentQueue > 0) await pipeline.exec();

    if (removedFromCurrentQueue > 0) {
      logger.info(`Removed ${removedFromCurrentQueue} messages from ${queueInfo.type}`);
    }
    totalRemovedCount += removedFromCurrentQueue;
  }
  return totalRemovedCount;
}

/**
 * Deletes multiple messages.
 * @param {string[]} messageIds - IDs of messages to delete.
 * @param {string} queueType - The queue type.
 * @returns {Promise<number>} Number of deleted messages.
 */
export async function deleteMessages(messageIds, queueType) {
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

    for (const stream of streamNames) {
      const entries = await redis.xrange(stream, "-", "+");
      for (const [id, fields] of entries) {
        let json = null;
        for (let i = 0; i < fields.length; i += 2) if (fields[i] === 'data') json = fields[i + 1];
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
      this.publishEvent('delete', { ids: Array.from(idsToDelete), count: totalDeleted, queue: queueType });

      // Log activity for bulk delete
      const batchId = `delete_${Date.now()}`;
      for (const msgId of idsToDelete) {
        await this.logActivity("delete", { id: msgId }, {
          queue: queueType,
          batch_id: batchId,
          batch_size: totalDeleted,
          triggered_by: "admin",
          reason: "Bulk delete",
        });
      }
    }

    return totalDeleted;
  } catch (error) {
    logger.error(`Error deleting messages: ${error.message}`);
    throw error;
  }
}

/**
 * Deletes a single message.
 * @param {string} messageId - ID of message to delete.
 * @param {string} queueType - The queue type.
 * @returns {Promise<Object>} Result object.
 */
export async function deleteMessage(messageId, queueType) {
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
    let foundMessage = null;

    for (const stream of streamNames) {
      // Scan stream to find message with matching ID in JSON
      const entries = await redis.xrange(stream, "-", "+");
      for (const [id, fields] of entries) {
        let json = null;
        for (let i = 0; i < fields.length; i += 2) if (fields[i] === 'data') json = fields[i + 1];
        const msg = this._deserializeMessage(json);
        if (msg && msg.id === messageId) {
          // Found it.
          foundMessage = msg;
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
    const pipeline = redis.pipeline();
    pipeline.hdel(this.config.metadata_hash_name, messageId);

    // Type Index cleanup
    if (foundMessage && foundMessage.type) {
      const indexKey = this._getTypeIndexKey(foundMessage.type);
      const locKey = this._getMessageLocationHashKey();
      pipeline.zrem(indexKey, messageId);
      pipeline.hdel(locKey, messageId);
    }

    await pipeline.exec();


    logger.info(`Successfully deleted message ${messageId} from ${queueType} queue`);
    this.publishEvent('delete', { id: messageId, queue: queueType });

    // Log activity for single delete
    await this.logActivity("delete", foundMessage || { id: messageId }, {
      queue: queueType,
      triggered_by: "admin",
      reason: "Manual delete",
    });

    return { success: true, messageId, queueType, message: 'Message deleted successfully' };

  } catch (error) {
    logger.error(`Error deleting message ${messageId} from ${queueType} queue: ${error.message}`);
    throw error;
  }
}

/**
 * Updates a message.
 * @param {string} messageId - ID of message to update.
 * @param {string} queueType - Queue type.
 * @param {Object} updates - Updates to apply.
 * @returns {Promise<Object>} Result object.
 */
export async function updateMessage(messageId, queueType, updates) {
  try {
    const redis = this.redisManager.redis;
    let streamNames = [];

    // Special handling for processing queue - only allow metadata updates (timeout)
    if (queueType === 'processing') {
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
        return {
          success: true,
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
      case 'archived':
        streamNames = [this.config.archived_queue_name];
        break;
      default:
        throw new Error(`Cannot update message in ${queueType} queue. Only 'main', 'dead', 'archived', and 'processing' queues are supported.`);
    }

    let originalMessageData = null;
    let originalStream = null;
    let originalStreamId = null;

    // Find message
    for (const stream of streamNames) {
      const entries = await redis.xrange(stream, "-", "+");
      for (const [id, fields] of entries) {
        let json = null;
        for (let i = 0; i < fields.length; i += 2) if (fields[i] === 'data') json = fields[i + 1];
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

    // BREAK PIPELINE: We need the new stream ID to update the index.
    // So we delete first, then add.

    // 1. Delete old
    const deletePipeline = redis.pipeline();
    deletePipeline.xdel(originalStream, originalStreamId);
    if (originalMessageData.type) {
      const oldIndexKey = this._getTypeIndexKey(originalMessageData.type);
      const locKey = this._getMessageLocationHashKey();
      deletePipeline.zrem(oldIndexKey, messageId);
      deletePipeline.hdel(locKey, messageId);
    }
    await deletePipeline.exec();

    // 2. Add new
    const newStreamId = await redis.xadd(originalStream, "*", "data", updatedMessageJson);

    // 3. Update index for new
    if (updatedMessageData.type) {
      const newIndexKey = this._getTypeIndexKey(updatedMessageData.type);
      const typesKey = this._getTypeIndexTypesKey();
      const locKey = this._getMessageLocationHashKey();
      const ts = Math.floor((updatedMessageData.created_at || Date.now() / 1000) * 1000);
      const score = this._calculateTypeScore(updatedMessageData.priority, ts);

      const indexPipeline = redis.pipeline();
      indexPipeline.sadd(typesKey, updatedMessageData.type);
      indexPipeline.zadd(newIndexKey, score, messageId);
      indexPipeline.hset(locKey, messageId, `${originalStream}|${newStreamId}`);
      await indexPipeline.exec();
    }

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

/**
 * Gets paginated messages from a queue.
 * @param {string} queueType - Queue type.
 * @param {Object} [params={}] - Filter and sort params.
 * @returns {Promise<Object>} Paginated result.
 */
export async function getQueueMessages(queueType, params = {}) {
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
      search,
      cursor  // OPTIMIZATION: Support cursor-based pagination
    } = params;

    const redis = this.redisManager.redis;
    let rawMessages = [];

    if (queueType === 'main') {
      let priorityStreams = this._getAllPriorityStreams();
      if (filterPriority !== undefined && filterPriority !== '') {
        const p = parseInt(filterPriority);
        priorityStreams = [this._getPriorityStreamName(p)];
      }

      // OPTIMIZATION: Use pending IDs Set instead of multiple XPENDING calls
      // This reduces 11+ XPENDING queries to 1 SMEMBERS query
      const pendingIdsKey = this._getPendingIdsSetKey();
      const pendingMessageIds = new Set(await redis.smembers(pendingIdsKey));

      const parse = (msgs, name) => msgs.map(([id, fields]) => {
        let json = null;
        for (let i = 0; i < fields.length; i += 2) if (fields[i] === 'data') json = fields[i + 1];
        const m = this._deserializeMessage(json);
        if (m) { m._stream_id = id; m._stream_name = name; }
        return m;
      }).filter(Boolean);

      // OPTIMIZATION: Use type index for single-type filter queries
      // This dramatically reduces scan size for filtered queries (5000 → exact match count)
      const useTypeIndex = filterType && filterType !== 'all' && !filterType.includes(',') && !search;

      if (useTypeIndex) {
        // Use the type index for efficient single-type filtering
        const indexKey = this._getTypeIndexKey(filterType);
        const locKey = this._getMessageLocationHashKey();

        // Get message IDs from type index (already sorted by priority + timestamp)
        const useRev = sortOrder === 'desc';
        const fetchCount = (page * limit) + 100;

        let messageIds;
        if (useRev) {
          messageIds = await redis.zrevrange(indexKey, 0, fetchCount - 1);
        } else {
          messageIds = await redis.zrange(indexKey, 0, fetchCount - 1);
        }

        if (messageIds.length > 0) {
          // Get locations for these message IDs
          const locations = await redis.hmget(locKey, ...messageIds);

          // Build a pipeline to fetch all messages in one round-trip
          const pipeline = redis.pipeline();
          const locationMap = new Map();

          for (let i = 0; i < messageIds.length; i++) {
            const loc = locations[i];
            if (!loc) continue;
            const [streamName, streamId] = loc.split('|');
            if (!streamName || !streamId) continue;
            locationMap.set(messageIds[i], { streamName, streamId });
            pipeline.xrange(streamName, streamId, streamId);
          }

          const results = await pipeline.exec();
          let resultIndex = 0;

          for (const msgId of messageIds) {
            const loc = locationMap.get(msgId);
            if (!loc) continue;

            const result = results[resultIndex];
            resultIndex++;

            if (!result || result[0] || !result[1] || result[1].length === 0) continue;

            const [streamId, fields] = result[1][0];
            let json = null;
            for (let j = 0; j < fields.length; j += 2) {
              if (fields[j] === 'data') {
                json = fields[j + 1];
                break;
              }
            }

            const m = this._deserializeMessage(json);
            if (m) {
              m._stream_id = streamId;
              m._stream_name = loc.streamName;
              rawMessages.push(m);
            }
          }
        }

        // Filter out pending messages
        if (pendingMessageIds.size > 0) {
          rawMessages = rawMessages.filter(m => !pendingMessageIds.has(m?.id));
        }
      } else {
        // Standard stream scan approach
        const hasHeavyFilters = search || filterType || startDate || endDate || filterAttempts;
        const fetchCount = hasHeavyFilters ? 5000 : (page * limit) + 100;
        const useRev = sortOrder === 'desc';
        const method = useRev ? 'xrevrange' : 'xrange';
        const start = useRev ? '+' : '-';
        const end = useRev ? '-' : '+';

        const streamDataResults = await Promise.all(priorityStreams.map(name =>
          redis[method](name, start, end, 'COUNT', fetchCount)
        ));
        streamDataResults.forEach((streamData, index) => {
          rawMessages.push(...parse(streamData, priorityStreams[index]));
        });

        // Filter out messages that are currently being processed (in pending IDs Set)
        if (pendingMessageIds.size > 0) {
          rawMessages = rawMessages.filter(m => !pendingMessageIds.has(m?.id));
        }
      }

      // Apply filters BEFORE loading metadata and sorting for performance
      let messagesToProcess = rawMessages;
      // Skip type filter if we already used type index
      if (!useTypeIndex && filterType && filterType !== 'all') {
        const types = filterType.split(',');
        messagesToProcess = messagesToProcess.filter(m => types.includes(m.type));
      }
      if (filterPriority !== undefined && filterPriority !== '') {
        messagesToProcess = messagesToProcess.filter(m => m.priority === parseInt(filterPriority));
      }
      if (filterAttempts !== undefined && filterAttempts !== '') {
        messagesToProcess = messagesToProcess.filter(m => (m.attempt_count || 0) >= parseInt(filterAttempts));
      }
      if (startDate) {
        const start = new Date(startDate).getTime() / 1000;
        messagesToProcess = messagesToProcess.filter(m => m.created_at >= start);
      }
      if (endDate) {
        const end = new Date(endDate).getTime() / 1000;
        messagesToProcess = messagesToProcess.filter(m => m.created_at <= end);
      }
      if (search) {
        const searchLower = search.toLowerCase();
        messagesToProcess = messagesToProcess.filter(m =>
          m.id.toLowerCase().includes(searchLower) ||
          (m.payload && JSON.stringify(m.payload).toLowerCase().includes(searchLower))
        );
      }

      const ids = messagesToProcess.map(m => m?.id).filter(Boolean);
      if (ids.length > 0) {
        const metaResults = await redis.hmget(this.config.metadata_hash_name, ...ids);
        messagesToProcess.forEach((m, index) => {
          const metaStr = metaResults[index];
          if (!metaStr) return;
          try {
            const meta = JSON.parse(metaStr);
            if (meta.attempt_count !== undefined) m.attempt_count = meta.attempt_count;
            if (meta.last_error) m.last_error = meta.last_error;
            if (meta.custom_ack_timeout) m.custom_ack_timeout = meta.custom_ack_timeout;
            if (meta.custom_max_attempts) m.custom_max_attempts = meta.custom_max_attempts;
          } catch (e) { }
        });
      }
      rawMessages = messagesToProcess;
    } else if (queueType === 'processing') {
      // OPTIMIZATION: Try Lua script first for single round-trip fetch
      const luaMessages = await this.getProcessingMessagesOptimized();

      if (luaMessages !== null) {
        // Lua script succeeded
        rawMessages = luaMessages;
      } else {
        // Fallback to standard multi-query approach
        const priorityStreams = this._getAllPriorityStreams();

        const getPendingSafe = async (queueName) => {
          try {
            const res = await redis.xpending(queueName, this.config.consumer_group_name, "-", "+", 5000);
            return Array.isArray(res) ? res : [];
          } catch (e) {
            const msg = e.message || '';
            if (msg.includes('NOGROUP') || msg.includes('no such key')) {
              return [];
            }
            throw e;
          }
        };

        const allPending = [];

        for (const streamName of priorityStreams) {
          const pending = await getPendingSafe(streamName);
          for (const p of pending) {
            allPending.push({ pending: p, streamName });
          }
        }

        if (allPending.length === 0) {
          rawMessages = [];
        } else {
          const pipeline = redis.pipeline();
          for (const item of allPending) {
            const streamName = item.streamName;
            const msgId = item.pending?.[0];
            pipeline.xrange(streamName, msgId, msgId);
          }

          const results = await pipeline.exec();

          let messagesWithIds = [];
          if (results) {
            messagesWithIds = results.map((r, i) => {
              if (!r || !r[1] || !r[1][0]) return null;
              const [id, fields] = r[1][0];
              let json = null;
              for (let j = 0; j < fields.length; j += 2) if (fields[j] === 'data') json = fields[j + 1];
              const m = this._deserializeMessage(json);

              const pendingInfo = allPending[i]?.pending;
              const streamName = allPending[i]?.streamName;
              const idleTime = pendingInfo ? pendingInfo[2] : 0;

              if (m) {
                m._stream_id = id;
                m._stream_name = streamName;
                m.dequeued_at = (Date.now() - idleTime) / 1000;
                if (!m.processing_started_at) m.processing_started_at = m.dequeued_at;
              }
              return m;
            }).filter(Boolean);

            if (messagesWithIds.length > 0) {
              const metaPipeline = redis.pipeline();
              messagesWithIds.forEach(m => {
                metaPipeline.hget(this.config.metadata_hash_name, m.id);
              });
              const metaResults = await metaPipeline.exec();

              const pendingMap = new Map();
              allPending.forEach(item => {
                const p = item.pending;
                const streamName = item.streamName;
                if (!p || !streamName) return;
                // p = [streamId, consumer, idleMs, deliveryCount]
                pendingMap.set(`${streamName}|${p[0]}`, { idle: p[2], count: p[3], consumer: p[1] });
              });

              messagesWithIds.forEach((m, index) => {
                const metaRes = metaResults[index];
                const pendingInfo = pendingMap.get(`${m._stream_name}|${m._stream_id}`);

                if (metaRes && !metaRes[0] && metaRes[1]) {
                  try {
                    const meta = JSON.parse(metaRes[1]);
                    m.attempt_count = meta.attempt_count;
                    m.dequeued_at = meta.dequeued_at;
                    m.processing_started_at = meta.dequeued_at;
                    m.last_error = meta.last_error;
                    if (meta.custom_ack_timeout) m.custom_ack_timeout = meta.custom_ack_timeout;
                    if (meta.custom_max_attempts) m.custom_max_attempts = meta.custom_max_attempts;
                    // Include lock_token for split-brain prevention
                    if (meta.lock_token) m.lock_token = meta.lock_token;
                    // Use consumer_id from metadata if available, otherwise from XPENDING
                    m.consumer_id = meta.consumer_id || (pendingInfo ? pendingInfo.consumer : null);
                    logger.info(`[GetProcessing] Message ${m.id}: dequeued_at=${m.dequeued_at}, custom_ack_timeout=${m.custom_ack_timeout} (from metadata)`);
                } catch (e) {
                  logger.warn(`[GetProcessing] Failed to parse metadata for ${m.id}: ${e.message}`);
                }
              } else {
                if (pendingInfo) {
                  m.attempt_count = pendingInfo.count;
                  m.dequeued_at = (Date.now() - pendingInfo.idle) / 1000;
                  m.processing_started_at = m.dequeued_at;
                  m.consumer_id = pendingInfo.consumer;
                  logger.info(`[GetProcessing] Message ${m.id}: dequeued_at=${m.dequeued_at} (from pendingInfo fallback)`);
                } else {
                  logger.warn(`[GetProcessing] Message ${m.id}: No metadata AND no pendingInfo! dequeued_at=${m.dequeued_at}`);
                }
              }
            });
          }
          rawMessages = messagesWithIds;
        }
      }
      } // End of Lua fallback else block

    } else if (queueType === 'dead') {
      const hasHeavyFilters = search || filterType || startDate || endDate || filterAttempts;
      const fetchCount = hasHeavyFilters ? 5000 : (page * limit) + 100;
      const useRev = sortOrder === 'desc';
      const method = useRev ? 'xrevrange' : 'xrange';
      const start = useRev ? '+' : '-';
      const end = useRev ? '-' : '+';

      const stream = await redis[method](this.config.dead_letter_queue_name, start, end, 'COUNT', fetchCount);
      rawMessages = stream.map(([id, fields]) => {
        let json = null;
        for (let i = 0; i < fields.length; i += 2) if (fields[i] === 'data') json = fields[i + 1];
        const m = this._deserializeMessage(json);
        if (m) { m._stream_id = id; m._stream_name = this.config.dead_letter_queue_name; }
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
          } catch (e) { }
        });
      }
    } else if (queueType === 'acknowledged') {
      const hasHeavyFilters = search || filterType || startDate || endDate || filterAttempts;
      const fetchCount = hasHeavyFilters ? 5000 : (page * limit) + 100;
      const useRev = sortOrder === 'desc';
      const method = useRev ? 'xrevrange' : 'xrange';
      const start = useRev ? '+' : '-';
      const end = useRev ? '-' : '+';

      const stream = await redis[method](this.config.acknowledged_queue_name, start, end, 'COUNT', fetchCount);
      rawMessages = stream.map(([id, fields]) => {
        let json = null;
        for (let i = 0; i < fields.length; i += 2) if (fields[i] === 'data') json = fields[i + 1];
        const m = this._deserializeMessage(json);
        if (m) { m._stream_id = id; m._stream_name = this.config.acknowledged_queue_name; }
        return m;
      }).filter(Boolean);
    } else if (queueType === 'archived') {
      const hasHeavyFilters = search || filterType || startDate || endDate || filterAttempts;
      const fetchCount = hasHeavyFilters ? 5000 : (page * limit) + 100;
      const useRev = sortOrder === 'desc';
      const method = useRev ? 'xrevrange' : 'xrange';
      const start = useRev ? '+' : '-';
      const end = useRev ? '-' : '+';

      const stream = await redis[method](this.config.archived_queue_name, start, end, 'COUNT', fetchCount);
      rawMessages = stream.map(([id, fields]) => {
        let json = null;
        for (let i = 0; i < fields.length; i += 2) if (fields[i] === 'data') json = fields[i + 1];
        const m = this._deserializeMessage(json);
        if (m) { m._stream_id = id; m._stream_name = this.config.archived_queue_name; }
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
          } catch (e) { }
        });
      }
    } else {
      throw new Error(`Invalid queue type: ${queueType}`);
    }

    let messages = rawMessages;

    // Filter (Skip if already filtered in main queue block)
    if (queueType !== 'main') {
      if (filterType && filterType !== 'all') {
        const types = filterType.split(',');
        messages = messages.filter(m => types.includes(m.type));
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
            queueType === 'acknowledged' ? m.acknowledged_at :
              queueType === 'archived' ? m.archived_at : m.created_at;
          return ts >= start;
        });
      }
      if (endDate) {
        const end = new Date(endDate).getTime() / 1000;
        messages = messages.filter(m => {
          const ts = queueType === 'processing' ? m.processing_started_at :
            queueType === 'acknowledged' ? m.acknowledged_at :
              queueType === 'archived' ? m.archived_at : m.created_at;
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
    let total = messages.length;

    // If no complex filters are applied, we can get the real total count from Redis
    const hasComplexFilters = (search && search.trim() !== "") ||
      (filterType && filterType !== "all") ||
      (filterAttempts !== undefined && filterAttempts !== "") ||
      startDate || endDate;

    if (!hasComplexFilters) {
      try {
        if (queueType === "main") {
          let targetStreams = this._getAllPriorityStreams();
          if (filterPriority !== undefined && filterPriority !== "") {
            targetStreams = [this._getPriorityStreamName(parseInt(filterPriority))];
          }

          const streamCounts = await Promise.all(targetStreams.map(name => redis.xlen(name)));
          const pendingPromises = targetStreams.map(name =>
            redis.xpending(name, this.config.consumer_group_name).catch(() => [0])
          );
          const pendingResults = await Promise.all(pendingPromises);

          const totalInStreams = streamCounts.reduce((a, b) => a + b, 0);
          const totalPending = pendingResults.reduce((a, b) => a + (parseInt(b[0]) || 0), 0);
          total = Math.max(0, totalInStreams - totalPending);
        } else if (queueType === "processing") {
          const priorityStreams = this._getAllPriorityStreams();
          const pendingPromises = priorityStreams.map(name =>
            redis.xpending(name, this.config.consumer_group_name).catch(() => [0])
          );
          const pendingResults = await Promise.all(pendingPromises);
          total = pendingResults.reduce((a, b) => a + (parseInt(b[0]) || 0), 0);
        } else if (queueType === "dead") {
          total = await redis.xlen(this.config.dead_letter_queue_name);
        } else if (queueType === "acknowledged") {
          total = await redis.xlen(this.config.acknowledged_queue_name);
        } else if (queueType === "archived") {
          total = await redis.xlen(this.config.archived_queue_name);
        }
      } catch (e) {
        logger.warn(`Failed to get accurate total count: ${e.message}`);
        // Fallback to messages.length already in 'total'
      }
    }

    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const paginatedMessages = messages.slice(startIndex, startIndex + parseInt(limit));

    // OPTIMIZATION: Generate cursor for cursor-based pagination
    // The cursor is the last message's stream_id, allowing direct seeking on next page
    const lastMessage = paginatedMessages[paginatedMessages.length - 1];
    const nextCursor = lastMessage?._stream_id || null;

    return {
      messages: paginatedMessages,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages,
        // Cursor-based pagination support
        nextCursor,
        hasMore: startIndex + paginatedMessages.length < total,
      },
    };

  } catch (error) {
    logger.error(`Error getting queue messages: ${error.message}`);
    throw error;
  }
}

/**
 * Clears all queues and metadata.
 * @returns {Promise<boolean>} True if successful.
 */
export async function clearAllQueues() {
  try {
    const redis = this.redisManager.redis;
    const pipeline = this.redisManager.pipeline();
    const streams = this._getAllPriorityStreams();
    const typesKey = this._getTypeIndexTypesKey();
    const locKey = this._getMessageLocationHashKey();
    let knownTypes = [];
    try {
      knownTypes = await redis.smembers(typesKey);
    } catch { }

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
    pipeline.del(this.config.archived_queue_name);
    pipeline.del(this.config.total_acknowledged_key);
    pipeline.del(this.config.metadata_hash_name);
    pipeline.del(locKey);
    pipeline.del(typesKey);
    // Clear pending IDs Set (dashboard cache)
    const pendingIdsKey = this._getPendingIdsSetKey();
    pipeline.del(pendingIdsKey);
    for (const t of knownTypes) {
      if (!t) continue;
      pipeline.del(this._getTypeIndexKey(t));
    }

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

    // Log activity for clear all
    await this.logActivity("clear", {}, {
      queue: "all",
      triggered_by: "admin",
      reason: "All queues cleared",
    });

    return true;
  } catch (error) {
    logger.error(`Error clearing all queues: ${error.message}`);
    throw error;
  }
}

/**
 * Clears activity logs and consumer stats.
 * @returns {Promise<boolean>} True if successful.
 */
export async function clearActivityLogs() {
  try {
    const pipeline = this.redisManager.pipeline();

    // Clear activity logs and stats
    pipeline.del(this.config.activity_log_stream_name);
    pipeline.del(`${this.config.queue_name}:consumer_burst`);
    pipeline.del(`${this.config.queue_name}:consumer_stats`);

    await pipeline.exec();

    logger.info("Activity logs and consumer stats cleared.");
    return true;
  } catch (error) {
    logger.error(`Error clearing activity logs: ${error.message}`);
    throw error;
  }
}

/**
 * Clears a specific queue.
 * @param {string} queueType - Queue type to clear.
 * @returns {Promise<boolean>} True if successful.
 */
export async function clearQueue(queueType) {
  try {
    const redis = this.redisManager.redis;
    const pipeline = this.redisManager.pipeline();
    const priorityStreams = this._getAllPriorityStreams();
    const typesKey = this._getTypeIndexTypesKey();
    const locKey = this._getMessageLocationHashKey();

    const pendingIdsKey = this._getPendingIdsSetKey();

    switch (queueType) {
      case 'main':
        // Clear all priority streams
        for (const stream of priorityStreams) {
          pipeline.del(stream);
        }
        // Clear pending IDs Set (all processing messages are gone)
        pipeline.del(pendingIdsKey);
        {
          let knownTypes = [];
          try {
            knownTypes = await redis.smembers(typesKey);
          } catch { }
          pipeline.del(locKey);
          pipeline.del(typesKey);
          for (const t of knownTypes) {
            if (!t) continue;
            pipeline.del(this._getTypeIndexKey(t));
          }
        }
        break;
      case 'processing':
        // Reset consumer groups for all priority streams
        logger.warn("Clearing processing queue resets consumer groups, but messages remain in streams.");
        for (const stream of priorityStreams) {
          pipeline.xgroup("DESTROY", stream, this.config.consumer_group_name);
          pipeline.xgroup("CREATE", stream, this.config.consumer_group_name, "0", "MKSTREAM");
        }
        // Clear pending IDs Set (no more processing messages)
        pipeline.del(pendingIdsKey);
        break;
      case 'dead':
        pipeline.del(this.config.dead_letter_queue_name);
        break;
      case 'archived':
        pipeline.del(this.config.archived_queue_name);
        break;
      case 'acknowledged':
        pipeline.del(this.config.acknowledged_queue_name);
        break;
      default:
        throw new Error(`Cannot clear ${queueType} queue. Invalid queue type.`);
    }

    await pipeline.exec();
    logger.info(`Cleared ${queueType} queue`);

    // Log activity for clear specific queue
    await this.logActivity("clear", {}, {
      queue: queueType,
      triggered_by: "admin",
      reason: `Queue ${queueType} cleared`,
    });

    return true;
  } catch (error) {
    logger.error(`Error clearing ${queueType} queue: ${error.message}`);
    throw error;
  }
}

/**
 * Disconnects the queue connection.
 * @returns {Promise<void>}
 */
export async function disconnect() {
  await this.redisManager.disconnect();
}
