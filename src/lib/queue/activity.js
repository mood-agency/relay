import { generateId, logger } from "./utils.js";

/**
 * Activity Log Module
 * Logs queue events and detects anomalies for debugging.
 * Uses message_id as correlation key to track full message lifecycle.
 */

/**
 * Logs an activity event to the activity stream.
 * @param {string} action - The action type (enqueue, dequeue, ack, nack, timeout, requeue, dlq, touch, move, delete).
 * @param {Object} messageData - The message data.
 * @param {Object} [context={}] - Additional context for the log entry.
 * @returns {Promise<string|null>} The log entry ID or null if logging is disabled/failed.
 */
export async function logActivity(action, messageData, context = {}) {
  if (!this.config.activity_log_enabled) return null;

  const redis = this.redisManager.redis;
  const now = Date.now() / 1000;
  const messageId = messageData?.id || context.message_id;

  try {
    // Build the log entry
    const logEntry = {
      log_id: `log_${generateId()}`,
      message_id: messageId,
      action,
      timestamp: now,

      // Queue Context
      queue: context.queue || "main",
      source_queue: context.source_queue || null,
      dest_queue: context.dest_queue || null,
      priority: messageData?.priority ?? context.priority ?? 0,
      message_type: messageData?.type || context.message_type || null,

      // Consumer Context
      consumer_id: context.consumer_id || this.config.consumer_name,
      prev_consumer_id: context.prev_consumer_id || null,
      lock_token: context.lock_token || messageData?.lock_token || null,
      prev_lock_token: context.prev_lock_token || null,

      // Attempt/Retry Context
      attempt_count: context.attempt_count ?? messageData?.attempt_count ?? null,
      max_attempts: context.max_attempts ?? messageData?.custom_max_attempts ?? this.config.max_attempts,
      attempts_remaining: null, // Calculated below

      // Timing Measurements
      message_created_at: messageData?.created_at || null,
      message_age_ms: null, // Calculated below
      time_in_queue_ms: context.time_in_queue_ms ?? null,
      processing_time_ms: context.processing_time_ms ?? null,
      total_processing_time_ms: context.total_processing_time_ms ?? null,

      // Performance Metrics
      payload_size_bytes: context.payload_size_bytes ?? null,
      redis_operation_ms: context.redis_operation_ms ?? null,

      // Queue Health Snapshot
      queue_depth: context.queue_depth ?? null,
      processing_depth: context.processing_depth ?? null,
      dlq_depth: context.dlq_depth ?? null,

      // Error Context
      error_reason: context.error_reason || messageData?.last_error || null,
      error_code: context.error_code || null,

      // Trigger/Audit Context
      triggered_by: context.triggered_by || "system",
      user_id: context.user_id || null,
      reason: context.reason || null,

      // Batch Context
      batch_id: context.batch_id || null,
      batch_size: context.batch_size ?? null,

      // Previous Action Reference
      prev_action: context.prev_action || null,
      prev_timestamp: context.prev_timestamp || null,

      // Anomaly (will be filled by detectAnomalies)
      anomaly: null,
    };

    // Calculate derived fields
    if (logEntry.message_created_at) {
      logEntry.message_age_ms = Math.floor((now - logEntry.message_created_at) * 1000);
    }
    if (logEntry.attempt_count !== null && logEntry.max_attempts !== null) {
      logEntry.attempts_remaining = Math.max(0, logEntry.max_attempts - logEntry.attempt_count);
    }

    // Detect anomalies
    const anomaly = await this._detectAnomalies(logEntry);
    if (anomaly) {
      logEntry.anomaly = anomaly;
    }

    // Update consumer stats for burst detection
    if (action === "dequeue" && logEntry.consumer_id) {
      await this._updateConsumerStats(logEntry.consumer_id, now);
    }

    // Serialize and write to stream
    const logJson = JSON.stringify(logEntry);
    const streamId = await redis.xadd(
      this.config.activity_log_stream_name,
      "MAXLEN", "~", this.config.activity_log_max_entries,
      "*",
      "data", logJson
    );

    if (logEntry.anomaly) {
      logger.warn(`Activity anomaly detected: ${logEntry.anomaly.type} - ${logEntry.anomaly.description}`);
    }

    return streamId;
  } catch (e) {
    logger.error(`Failed to log activity: ${e.message}`);
    return null;
  }
}

/**
 * Detects anomalies based on the log entry data.
 * @param {Object} logEntry - The log entry to analyze.
 * @returns {Promise<Object|null>} Anomaly object or null.
 * @private
 */
export async function _detectAnomalies(logEntry) {
  const anomalies = [];

  // === Message Lifecycle Anomalies ===

  // Flash Message: enqueue-to-dequeue < threshold
  if (logEntry.action === "dequeue" && logEntry.time_in_queue_ms !== null) {
    if (logEntry.time_in_queue_ms < this.config.activity_flash_message_threshold_ms) {
      anomalies.push({
        type: "flash_message",
        severity: "info",
        description: `Message dequeued in ${logEntry.time_in_queue_ms}ms (threshold: ${this.config.activity_flash_message_threshold_ms}ms)`,
      });
    }
  }

  // Zombie Message: message_age > threshold on dequeue
  if (logEntry.action === "dequeue" && logEntry.message_age_ms !== null) {
    const zombieThresholdMs = this.config.activity_zombie_message_threshold_hours * 3600 * 1000;
    if (logEntry.message_age_ms > zombieThresholdMs) {
      anomalies.push({
        type: "zombie_message",
        severity: "warning",
        description: `Message was in queue for ${Math.floor(logEntry.message_age_ms / 3600000)} hours before pickup`,
      });
    }
  }

  // Near DLQ: attempts_remaining <= threshold
  if (logEntry.attempts_remaining !== null && logEntry.attempts_remaining <= this.config.activity_near_dlq_threshold) {
    if (logEntry.action === "dequeue" || logEntry.action === "requeue") {
      anomalies.push({
        type: "near_dlq",
        severity: "warning",
        description: `Message has only ${logEntry.attempts_remaining} attempt(s) remaining before DLQ`,
      });
    }
  }

  // DLQ Movement
  if (logEntry.action === "dlq" || (logEntry.action === "move" && logEntry.dest_queue === "dead")) {
    anomalies.push({
      type: "dlq_movement",
      severity: "critical",
      description: `Message moved to DLQ${logEntry.error_reason ? `: ${logEntry.error_reason}` : ""}`,
    });
  }

  // Long Processing Time
  if (logEntry.processing_time_ms !== null) {
    const avgProcessingMs = this.config.ack_timeout_seconds * 1000 * 0.5; // Assume 50% of timeout is "average"
    const longThresholdMs = avgProcessingMs * this.config.activity_long_processing_multiplier;
    if (logEntry.processing_time_ms > longThresholdMs) {
      anomalies.push({
        type: "long_processing",
        severity: "warning",
        description: `Processing took ${logEntry.processing_time_ms}ms (threshold: ${longThresholdMs}ms)`,
      });
    }
  }

  // === Consumer/Lock Anomalies ===

  // Lock Stolen
  if (logEntry.prev_lock_token && logEntry.lock_token && logEntry.prev_lock_token !== logEntry.lock_token) {
    anomalies.push({
      type: "lock_stolen",
      severity: "critical",
      description: `Lock token changed from ${logEntry.prev_lock_token.slice(0, 8)}... to ${logEntry.lock_token.slice(0, 8)}...`,
    });
  }

  // Burst Dequeue
  if (logEntry.action === "dequeue" && logEntry.consumer_id) {
    const isBurst = await this._checkConsumerBurst(logEntry.consumer_id);
    if (isBurst) {
      anomalies.push({
        type: "burst_dequeue",
        severity: "warning",
        description: `Consumer ${logEntry.consumer_id} dequeued ${this.config.activity_burst_threshold_count}+ messages in ${this.config.activity_burst_threshold_seconds}s`,
      });
    }
  }

  // === Admin/Operational Anomalies ===

  // Bulk Operations
  if (logEntry.batch_size !== null && logEntry.batch_size > this.config.activity_bulk_operation_threshold) {
    const severity = logEntry.action === "delete" ? "warning" : "info";
    anomalies.push({
      type: logEntry.action === "delete" ? "bulk_delete" : "bulk_move",
      severity,
      description: `Bulk ${logEntry.action} of ${logEntry.batch_size} messages`,
    });
  }

  // Queue Cleared
  if (logEntry.action === "clear") {
    anomalies.push({
      type: "queue_cleared",
      severity: "critical",
      description: `Queue ${logEntry.queue} was cleared${logEntry.user_id ? ` by ${logEntry.user_id}` : ""}`,
    });
  }

  // Large Payload
  if (logEntry.payload_size_bytes !== null && logEntry.payload_size_bytes > this.config.activity_large_payload_bytes) {
    anomalies.push({
      type: "large_payload",
      severity: "warning",
      description: `Message payload is ${Math.floor(logEntry.payload_size_bytes / 1024)}KB (threshold: ${Math.floor(this.config.activity_large_payload_bytes / 1024)}KB)`,
    });
  }

  // Return the most severe anomaly, or null if none
  if (anomalies.length === 0) return null;

  // Sort by severity (critical > warning > info)
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  anomalies.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // If multiple anomalies, combine them
  if (anomalies.length === 1) {
    return anomalies[0];
  }

  return {
    type: anomalies[0].type,
    severity: anomalies[0].severity,
    description: anomalies.map((a) => a.description).join("; "),
    all_anomalies: anomalies,
  };
}

/**
 * Updates consumer statistics for burst detection.
 * @param {string} consumerId - The consumer ID.
 * @param {number} timestamp - Current timestamp in seconds.
 * @private
 */
export async function _updateConsumerStats(consumerId, timestamp) {
  const redis = this.redisManager.redis;
  const statsKey = `${this.config.queue_name}:consumer_stats`;
  const windowSeconds = this.config.activity_burst_threshold_seconds;

  try {
    const existingJson = await redis.hget(statsKey, consumerId);
    let stats = existingJson ? JSON.parse(existingJson) : { timestamps: [] };

    // Add current timestamp
    stats.timestamps.push(timestamp);

    // Remove timestamps outside the window
    const cutoff = timestamp - windowSeconds;
    stats.timestamps = stats.timestamps.filter((t) => t > cutoff);

    // Store updated stats (with TTL via expiration)
    await redis.hset(statsKey, consumerId, JSON.stringify(stats));
    await redis.expire(statsKey, windowSeconds * 2); // TTL for cleanup
  } catch (e) {
    logger.warn(`Failed to update consumer stats: ${e.message}`);
  }
}

/**
 * Checks if a consumer is in burst mode.
 * @param {string} consumerId - The consumer ID.
 * @returns {Promise<boolean>} True if burst detected.
 * @private
 */
export async function _checkConsumerBurst(consumerId) {
  const redis = this.redisManager.redis;
  const statsKey = `${this.config.queue_name}:consumer_stats`;

  try {
    const existingJson = await redis.hget(statsKey, consumerId);
    if (!existingJson) return false;

    const stats = JSON.parse(existingJson);
    return stats.timestamps.length >= this.config.activity_burst_threshold_count;
  } catch (e) {
    return false;
  }
}

/**
 * Gets activity logs with optional filters.
 * @param {Object} [filters={}] - Filter options.
 * @param {string} [filters.message_id] - Filter by message ID.
 * @param {string} [filters.consumer_id] - Filter by consumer ID.
 * @param {string|string[]} [filters.action] - Filter by action(s).
 * @param {boolean} [filters.has_anomaly] - Only entries with anomalies.
 * @param {string} [filters.anomaly_type] - Filter by anomaly type.
 * @param {number} [filters.start_time] - Start timestamp (seconds).
 * @param {number} [filters.end_time] - End timestamp (seconds).
 * @param {number} [filters.limit=100] - Maximum entries to return.
 * @param {number} [filters.offset=0] - Offset for pagination.
 * @returns {Promise<Object>} Paginated activity logs.
 */
export async function getActivityLogs(filters = {}) {
  const redis = this.redisManager.redis;
  const {
    message_id,
    consumer_id,
    action,
    has_anomaly,
    anomaly_type,
    start_time,
    end_time,
    limit = 100,
    offset = 0,
  } = filters;

  try {
    // Build stream range query
    const startId = start_time ? `${Math.floor(start_time * 1000)}-0` : "-";
    const endId = end_time ? `${Math.floor(end_time * 1000)}-99999999999` : "+";

    // Fetch entries (we fetch more than limit to handle filtering)
    const fetchCount = Math.min(5000, (limit + offset) * 5);
    const entries = await redis.xrevrange(
      this.config.activity_log_stream_name,
      endId,
      startId,
      "COUNT",
      fetchCount
    );

    // Parse and filter entries
    let logs = [];
    const actions = action ? (Array.isArray(action) ? action : action.split(",")) : null;

    for (const [streamId, fields] of entries) {
      let json = null;
      for (let i = 0; i < fields.length; i += 2) {
        if (fields[i] === "data") {
          json = fields[i + 1];
          break;
        }
      }
      if (!json) continue;

      try {
        const entry = JSON.parse(json);
        entry._stream_id = streamId;

        // Apply filters
        if (message_id && entry.message_id !== message_id) continue;
        if (consumer_id && entry.consumer_id !== consumer_id) continue;
        if (actions && !actions.includes(entry.action)) continue;
        if (has_anomaly === true && !entry.anomaly) continue;
        if (has_anomaly === false && entry.anomaly) continue;
        if (anomaly_type && entry.anomaly?.type !== anomaly_type) continue;

        logs.push(entry);
      } catch (e) {
        // Skip invalid entries
      }
    }

    // Apply pagination
    const total = logs.length;
    const paginatedLogs = logs.slice(offset, offset + limit);

    return {
      logs: paginatedLogs,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + paginatedLogs.length < total,
      },
    };
  } catch (e) {
    logger.error(`Failed to get activity logs: ${e.message}`);
    throw e;
  }
}

/**
 * Gets the full activity history for a specific message.
 * @param {string} messageId - The message ID.
 * @returns {Promise<Object[]>} Array of activity entries in chronological order.
 */
export async function getMessageHistory(messageId) {
  const { logs } = await this.getActivityLogs({
    message_id: messageId,
    limit: 1000,
  });

  // Return in chronological order (oldest first)
  return logs.reverse();
}

/**
 * Gets all anomalies within a time range.
 * @param {Object} [filters={}] - Filter options.
 * @param {string} [filters.severity] - Filter by severity (info, warning, critical).
 * @param {string} [filters.type] - Filter by anomaly type.
 * @param {number} [filters.start_time] - Start timestamp (seconds).
 * @param {number} [filters.end_time] - End timestamp (seconds).
 * @param {number} [filters.limit=100] - Maximum entries to return.
 * @returns {Promise<Object>} Paginated anomalies.
 */
export async function getAnomalies(filters = {}) {
  const { severity, type, start_time, end_time, limit = 100 } = filters;

  const { logs, pagination } = await this.getActivityLogs({
    has_anomaly: true,
    anomaly_type: type,
    start_time,
    end_time,
    limit: limit * 2, // Fetch more to filter by severity
  });

  let anomalies = logs;

  // Filter by severity if specified
  if (severity) {
    anomalies = anomalies.filter((log) => log.anomaly?.severity === severity);
  }

  // Limit results
  anomalies = anomalies.slice(0, limit);

  // Extract summary
  const summary = {
    total: anomalies.length,
    by_type: {},
    by_severity: { critical: 0, warning: 0, info: 0 },
  };

  for (const log of anomalies) {
    if (log.anomaly) {
      summary.by_type[log.anomaly.type] = (summary.by_type[log.anomaly.type] || 0) + 1;
      summary.by_severity[log.anomaly.severity]++;
    }
  }

  return {
    anomalies,
    summary,
    pagination: {
      ...pagination,
      total: anomalies.length,
    },
  };
}

/**
 * Gets consumer statistics.
 * @param {string} [consumerId] - Optional consumer ID to filter.
 * @returns {Promise<Object>} Consumer statistics.
 */
export async function getConsumerStats(consumerId) {
  const redis = this.redisManager.redis;
  const statsKey = `${this.config.queue_name}:consumer_stats`;

  try {
    if (consumerId) {
      const json = await redis.hget(statsKey, consumerId);
      return json ? JSON.parse(json) : null;
    }

    const allStats = await redis.hgetall(statsKey);
    const result = {};

    for (const [id, json] of Object.entries(allStats || {})) {
      try {
        result[id] = JSON.parse(json);
      } catch (e) {
        // Skip invalid entries
      }
    }

    return result;
  } catch (e) {
    logger.error(`Failed to get consumer stats: ${e.message}`);
    return consumerId ? null : {};
  }
}

/**
 * Gets the activity log stream name.
 * @returns {string} The stream name.
 * @private
 */
export function _getActivityStreamName() {
  return this.config.activity_log_stream_name;
}
