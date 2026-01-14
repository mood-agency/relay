import { logger } from "./utils.js";

/**
 * Ensures consumer groups exist for streams that have messages.
 * This reduces NOGROUP errors by proactively creating groups only when needed.
 * @param {string[]} streams - Array of stream names to check.
 * @returns {Promise<void>}
 * @private
 */
async function _ensureConsumerGroupsForActiveStreams(queue, streams) {
  const redis = queue.redisManager.redis;

  // Check which streams have messages but no known consumer group
  const streamsToCheck = streams.filter(s => !queue.isConsumerGroupKnown(s));
  if (streamsToCheck.length === 0) return;

  // Check stream lengths to see which ones have messages
  const pipeline = redis.pipeline();
  for (const stream of streamsToCheck) {
    pipeline.xlen(stream);
  }
  const results = await pipeline.exec();

  // Create consumer groups only for streams that have messages
  for (let i = 0; i < streamsToCheck.length; i++) {
    const len = results[i]?.[1] || 0;
    if (len > 0) {
      try {
        await queue._ensureConsumerGroup(streamsToCheck[i]);
      } catch (e) {
        // Ignore errors - the stream might not exist yet
      }
    }
  }
}

/**
 * Gets metrics for the queue system.
 * @returns {Promise<Object>} The metrics object.
 */
export async function getMetrics() {
  try {
    const pipeline = this.redisManager.pipeline();
    const priorityStreams = this._getAllPriorityStreams();
    const priorityCount = priorityStreams.length;

    // Queue lengths for all priority streams
    for (const stream of priorityStreams) {
      pipeline.xlen(stream);
    }

    // DLQ and Acknowledged queue lengths
    pipeline.xlen(this.config.dead_letter_queue_name);
    pipeline.xlen(this.config.acknowledged_queue_name);
    pipeline.xlen(this.config.archived_queue_name);

    // Stats
    pipeline.get(this.config.total_acknowledged_key);
    pipeline.hlen(this.config.metadata_hash_name);

    // Only call XPENDING for streams with known consumer groups (optimization)
    // This avoids NOGROUP errors for streams that haven't been consumed yet
    const streamsWithGroups = [];
    const streamIndexMap = new Map(); // Maps stream index to priority
    for (let i = 0; i < priorityCount; i++) {
      const stream = priorityStreams[i];
      if (this.isConsumerGroupKnown(stream)) {
        streamIndexMap.set(streamsWithGroups.length, i);
        streamsWithGroups.push(stream);
        pipeline.xpending(stream, this.config.consumer_group_name);
      }
    }

    const results = await pipeline.exec();

    // Parse priority stream lengths
    let totalMainQueueSize = 0;
    let totalProcessingSize = 0;
    const priorityDetails = {};

    for (let i = 0; i < priorityCount; i++) {
      const len = results[i][1] || 0;
      const priority = priorityCount - 1 - i; // Reverse because streams are highest-first
      priorityDetails[`priority_${priority}_queued`] = len;
      priorityDetails[`priority_${priority}_processing`] = 0; // Default to 0
      totalMainQueueSize += len;
    }

    // DLQ and Acknowledged
    const dlqLen = results[priorityCount][1] || 0;
    const ackLen = results[priorityCount + 1][1] || 0;
    const archivedLen = results[priorityCount + 2][1] || 0;
    const totalAck = parseInt(results[priorityCount + 3][1] || '0', 10);
    const metadataCount = results[priorityCount + 4][1] || 0;

    // Parse pending counts only for streams we queried
    const pendingStartIdx = priorityCount + 5;
    for (let j = 0; j < streamsWithGroups.length; j++) {
      const result = results[pendingStartIdx + j];
      const originalIndex = streamIndexMap.get(j);
      const priority = priorityCount - 1 - originalIndex;

      if (result && !result[0]) {
        const pendingResult = result[1];
        const pendingCount = pendingResult ? pendingResult[0] : 0;
        priorityDetails[`priority_${priority}_processing`] = pendingCount;
        totalProcessingSize += pendingCount;
      }
    }

    const queueMetrics = {
      main_queue_size: totalMainQueueSize,
      processing_queue_size: totalProcessingSize,
      dead_letter_queue_size: dlqLen,
      acknowledged_queue_size: ackLen,
      archived_queue_size: archivedLen,
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

/**
 * Performs a health check on the queue system.
 * @returns {Promise<Object>} Health status object.
 */
export async function healthCheck() {
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

/**
 * Gets detailed status of queues.
 * @param {string|null} [typeFilter=null] - Optional filter.
 * @param {boolean} [includeMessages=true] - Whether to include messages.
 * @returns {Promise<Object>} Queue status object.
 */
export async function getQueueStatus(typeFilter = null, includeMessages = true) {
  try {
    const redis = this.redisManager.redis;
    const pipeline = redis.pipeline();
    const priorityStreams = this._getAllPriorityStreams();
    const priorityCount = priorityStreams.length;

    // Get queue lengths for all priority streams
    for (const stream of priorityStreams) {
      pipeline.xlen(stream);
    }

    // DLQ, Acknowledged, Archived, and total acknowledged key
    pipeline.xlen(this.config.dead_letter_queue_name);
    pipeline.xlen(this.config.acknowledged_queue_name);
    pipeline.xlen(this.config.archived_queue_name);
    pipeline.get(this.config.total_acknowledged_key);

    // Get Processing (Pending) count summary for all priority streams (lightweight)
    // Only get the summary count, not detailed pending entries
    for (const stream of priorityStreams) {
      pipeline.xpending(stream, this.config.consumer_group_name);
    }

    // For counts-only mode, execute minimal pipeline and return early
    if (!includeMessages) {
      const results = await pipeline.exec();

      // Parse lengths
      let totalMainLen = 0;
      for (let i = 0; i < priorityCount; i++) {
        totalMainLen += results[i][1] || 0;
      }
      const dlqLen = results[priorityCount][1] || 0;
      const ackLen = results[priorityCount + 1][1] || 0;
      const archivedLen = results[priorityCount + 2][1] || 0;
      const totalAck = parseInt(results[priorityCount + 3][1] || '0', 10);

      // Parse pending counts (handle NOGROUP errors gracefully)
      let totalProcessingCount = 0;
      const pendingSummaryStartIdx = priorityCount + 4;
      for (let i = 0; i < priorityCount; i++) {
        const pendingSummary = results[pendingSummaryStartIdx + i];
        // Check for errors (NOGROUP) - first element is error, second is result
        if (pendingSummary && !pendingSummary[0] && Array.isArray(pendingSummary[1])) {
          const pendingCount = Number(pendingSummary[1][0] || 0);
          if (!Number.isNaN(pendingCount)) totalProcessingCount += pendingCount;
          // Mark consumer group as existing if we got a valid response
          if (pendingSummary[1]) {
            this.markConsumerGroupExists(priorityStreams[i]);
          }
        }
        // If pendingSummary[0] is truthy, there was an error (NOGROUP) - treat as 0
      }

      const waitingLength = Math.max(0, totalMainLen - totalProcessingCount);

      return {
        mainQueue: {
          name: this.config.queue_name,
          length: waitingLength,
          priority_levels: this.config.max_priority_levels,
        },
        processingQueue: {
          name: "processing_pending",
          length: totalProcessingCount,
        },
        deadLetterQueue: {
          name: this.config.dead_letter_queue_name,
          length: dlqLen,
        },
        acknowledgedQueue: {
          name: this.config.acknowledged_queue_name,
          length: ackLen,
          total: totalAck,
        },
        archivedQueue: {
          name: this.config.archived_queue_name,
          length: archivedLen,
        },
        metadata: {
          totalProcessed: 0,
          totalFailed: 0,
          totalAcknowledged: totalAck,
        },
        availableTypes: [],
      };
    }

    // Full mode: Get queue contents (limited to 1000 items each) for all priority streams
    for (const stream of priorityStreams) {
      pipeline.xrevrange(stream, "+", "-", "COUNT", 1000);
    }
    pipeline.xrevrange(this.config.dead_letter_queue_name, "+", "-", "COUNT", 1000);
    pipeline.xrevrange(this.config.acknowledged_queue_name, "+", "-", "COUNT", 1000);
    pipeline.xrevrange(this.config.archived_queue_name, "+", "-", "COUNT", 1000);

    // Get metadata (only needed when including messages)
    pipeline.hgetall(this.config.metadata_hash_name);

    // Get detailed Processing (Pending) entries for all priority streams
    for (const stream of priorityStreams) {
      pipeline.xpending(stream, this.config.consumer_group_name, "-", "+", 100);
    }

    const results = await pipeline.exec();

    // Pipeline structure for full mode (includeMessages=true):
    // [0..priorityCount-1]: XLEN for each priority stream
    // [priorityCount]: XLEN DLQ
    // [priorityCount+1]: XLEN Acknowledged
    // [priorityCount+2]: XLEN Archived
    // [priorityCount+3]: GET total_acknowledged_key
    // [priorityCount+4..priorityCount+4+priorityCount-1]: XPENDING summary for each priority stream
    // [priorityCount+4+priorityCount..priorityCount+4+priorityCount+priorityCount-1]: XREVRANGE for each priority stream
    // [priorityCount+4+priorityCount+priorityCount]: XREVRANGE DLQ
    // [priorityCount+4+priorityCount+priorityCount+1]: XREVRANGE Acknowledged
    // [priorityCount+4+priorityCount+priorityCount+2]: XREVRANGE Archived
    // [priorityCount+4+priorityCount+priorityCount+3]: HGETALL metadata
    // [priorityCount+4+priorityCount+priorityCount+4..]: XPENDING detailed for each priority stream

    // Parse lengths
    let totalMainLen = 0;
    for (let i = 0; i < priorityCount; i++) {
      totalMainLen += results[i][1] || 0;
    }
    const dlqLen = results[priorityCount][1] || 0;
    const ackLen = results[priorityCount + 1][1] || 0;
    const archivedLen = results[priorityCount + 2][1] || 0;
    const totalAck = parseInt(results[priorityCount + 3][1] || '0', 10);

    // Parse pending summary counts (same position for full mode)
    // Handle NOGROUP errors gracefully
    const pendingSummaryStartIdx = priorityCount + 4;
    let totalProcessingCount = 0;
    for (let i = 0; i < priorityCount; i++) {
      const pendingSummary = results[pendingSummaryStartIdx + i];
      // Check for errors (NOGROUP) - first element is error, second is result
      if (pendingSummary && !pendingSummary[0] && Array.isArray(pendingSummary[1])) {
        const pendingCount = Number(pendingSummary[1][0] || 0);
        if (!Number.isNaN(pendingCount)) totalProcessingCount += pendingCount;
        // Mark consumer group as existing if we got a valid response
        if (pendingSummary[1]) {
          this.markConsumerGroupExists(priorityStreams[i]);
        }
      }
      // If pendingSummary[0] is truthy, there was an error (NOGROUP) - treat as 0
    }

    // Parse messages from all priority streams
    let mainMessages = [];
    let deadMessages = [];
    let acknowledgedMessages = [];
    let archivedMessages = [];
    let metadata = {};

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

    // Content starts after pending summaries
    const contentStartIdx = pendingSummaryStartIdx + priorityCount;

    // Collect main messages from all priority streams
    for (let i = 0; i < priorityCount; i++) {
      const streamMsgs = results[contentStartIdx + i][1];
      const streamName = priorityStreams[i];
      mainMessages.push(...parseStreamMessages(streamMsgs, streamName));
    }
    mainMessages = mainMessages.sort((a,b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 100);

    const dlqMsgsRaw = results[contentStartIdx + priorityCount][1];
    const ackMsgsRaw = results[contentStartIdx + priorityCount + 1][1];
    const archivedMsgsRaw = results[contentStartIdx + priorityCount + 2][1];
    metadata = results[contentStartIdx + priorityCount + 3][1];

    deadMessages = parseStreamMessages(dlqMsgsRaw, this.config.dead_letter_queue_name);
    acknowledgedMessages = parseStreamMessages(ackMsgsRaw, this.config.acknowledged_queue_name);
    archivedMessages = parseStreamMessages(archivedMsgsRaw, this.config.archived_queue_name);

    // Detailed pending entries start after metadata
    const pendingDetailStartIdx = contentStartIdx + priorityCount + 4;

    // Processing messages from all priority streams
    // Handle NOGROUP errors gracefully for detailed pending
    const processingMessages = [];
    const pendingToCheck = [];

    for (let i = 0; i < priorityCount; i++) {
      const result = results[pendingDetailStartIdx + i];
      // Check for NOGROUP error - first element is error
      if (result[0]) {
        // Error occurred (likely NOGROUP) - skip this stream
        continue;
      }
      const pendingResult = result[1];
      const pending = Array.isArray(pendingResult) ? pendingResult : [];
      const streamName = priorityStreams[i];
      const priority = priorityCount - 1 - i; // Convert index to priority

      pending.forEach(([id, consumer, idle, count]) => {
         pendingToCheck.push({ id, streamName, priority, count });
      });
    }

    // Fetch details for pending messages to verify existence (filter out ghosts)
    if (pendingToCheck.length > 0) {
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

    // OPTIMIZATION: Filter out messages from mainQueue that are present in processingQueue
    // Uses pending IDs Set instead of per-message XPENDING calls (N calls → 1 call)
    if (mainMessages.length > 0) {
      const pendingIdsKey = this._getPendingIdsSetKey();
      const pendingMessageIds = new Set(await redis.smembers(pendingIdsKey));

      if (pendingMessageIds.size > 0) {
        mainMessages = mainMessages.filter(m => !pendingMessageIds.has(m?.id));
      }
    }

    const processingLength = totalProcessingCount;

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
      archivedQueue: {
        name: this.config.archived_queue_name,
        length: archivedLen,
        messages: archivedMessages,
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
