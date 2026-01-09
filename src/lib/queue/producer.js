import { generateId, logger } from "./utils.js";

/**
 * Enqueues a message to the queue.
 * @param {Object} messageData - The message data.
 * @param {number} [priority=0] - Priority level.
 * @returns {Promise<boolean>} True if successful.
 */
export async function enqueueMessage(messageData, priority = 0) {
  try {
    if (!messageData.id) {
      messageData.id = generateId();
    }
    if (typeof messageData.created_at === "undefined") {
      messageData.created_at = Date.now() / 1000; // seconds timestamp
    }
    messageData.priority = priority;

    const messageJson = this._serializeMessage(messageData);
    const queueName = this._getPriorityStreamName(priority);

    const streamId = await this.redisManager.redis.xadd(queueName, "*", "data", messageJson);

    if (messageData.type) {
      const indexKey = this._getTypeIndexKey(messageData.type);
      const typesKey = this._getTypeIndexTypesKey();
      const locKey = this._getMessageLocationHashKey();
      const ts = Math.floor((messageData.created_at || Date.now() / 1000) * 1000);
      const score = this._calculateTypeScore(priority, ts);
      await this.redisManager.redis
        .multi()
        .sadd(typesKey, messageData.type)
        .zadd(indexKey, score, messageData.id)
        .hset(locKey, messageData.id, `${queueName}|${streamId}`)
          .exec();
    }

    this._stats.enqueued++;
    logger.info(
      `Message enqueued to stream ${queueName}: ${messageData.id} (priority: ${priority})`
    );
    this.publishEvent('enqueue', { count: 1, message: messageData });

    // Calculate payload size
    const payloadSizeBytes = messageData.payload
      ? JSON.stringify(messageData.payload).length
      : 0;

    // Log activity
    await this.logActivity("enqueue", messageData, {
      queue: "main",
      priority,
      payload_size_bytes: payloadSizeBytes,
      triggered_by: "api",
    });

    return true;
  } catch (e) {
    logger.error(`Error enqueuing message ${messageData.id || "N/A"}: ${e}`);
    return false;
  }
}

/**
 * Enqueues a batch of messages.
 * @param {Object[]} messages - Array of messages.
 * @returns {Promise<number>} Number of successfully enqueued messages.
 */
export async function enqueueBatch(messages) {
  let successful = 0;
  if (!messages || messages.length === 0) return 0;

  const pipeline = this.redisManager.pipeline();
  const queueNames = [];
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
    queueNames.push(queueName);

    pipeline.xadd(queueName, "*", "data", messageJson);
  }

  try {
    const results = await pipeline.exec();
    const indexPipeline = this.redisManager.pipeline();
    let hasIndices = false;

    results.forEach((result, i) => {
      if (!result[0]) {
        successful++;
        const streamId = result[1];
        const msg = messages[i];
        if (msg.type) {
          const indexKey = this._getTypeIndexKey(msg.type);
          const typesKey = this._getTypeIndexTypesKey();
          const locKey = this._getMessageLocationHashKey();
          const ts = Math.floor((msg.created_at || Date.now() / 1000) * 1000);
          const score = this._calculateTypeScore(msg.priority, ts);
          indexPipeline.sadd(typesKey, msg.type);
          indexPipeline.zadd(indexKey, score, msg.id);
          indexPipeline.hset(locKey, msg.id, `${queueNames[i]}|${streamId}`);
          hasIndices = true;
        }
      }
    });

    if (hasIndices) {
      await indexPipeline.exec();
    }

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

      // Log activity for batch enqueue
      const batchId = `batch_${generateId()}`;
      for (let i = 0; i < messages.length; i++) {
        if (results[i] && !results[i][0]) {
          const msg = messages[i];
          const payloadSizeBytes = msg.payload
            ? JSON.stringify(msg.payload).length
            : 0;

          await this.logActivity("enqueue", msg, {
            queue: "main",
            priority: msg.priority || 0,
            payload_size_bytes: payloadSizeBytes,
            batch_id: batchId,
            batch_size: successful,
            triggered_by: "api",
          });
        }
      }
    }
    return successful;
  } catch (e) {
    logger.error(`Error in batch enqueue: ${e}`);
    return successful;
  }
}
