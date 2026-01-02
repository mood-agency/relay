import { generateId, logger } from "./utils.js";

/**
 * Enqueues a message to the queue.
 * @param {Object} messageData - The message data.
 * @param {number} [priority=0] - Priority level.
 * @param {string|null} [queueNameOverride=null] - Optional queue name override.
 * @returns {Promise<boolean>} True if successful.
 */
export async function enqueueMessage(messageData, priority = 0, queueNameOverride = null) {
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

/**
 * Enqueues a batch of messages.
 * @param {Object[]} messages - Array of messages.
 * @returns {Promise<number>} Number of successfully enqueued messages.
 */
export async function enqueueBatch(messages) {
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
