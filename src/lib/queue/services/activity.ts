import {
  QueueContext,
  ActivityLogEntry,
  ActivityLogFilters,
} from "../types.js";
import { createLogger } from "../utils.js";

const logger = createLogger("activity");

export class ActivityService {
  constructor(private ctx: QueueContext) {}

  async logActivity(
    action: string,
    messageData: any,
    context: any
  ): Promise<number | null> {
    if (!this.ctx.config.activity_log_enabled) return null;

    try {
      const enrichedContext = {
        ...context,
        payload: context?.payload ?? messageData?.payload ?? null,
      };

      const result = await this.ctx.pgManager.query(
        `INSERT INTO activity_logs (action, message_id, message_type, consumer_id, context, payload_size, queue_type, queue_name, processing_time_ms, attempt_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          action,
          messageData?.id || null,
          messageData?.type || null,
          context?.consumer_id || null,
          JSON.stringify(enrichedContext),
          context?.payload_size || messageData?.payload_size || null,
          context?.queue_type || null,
          context?.queue_name || messageData?.queue_name || null,
          context?.processing_time_ms || null,
          context?.attempt_count || messageData?.attempt_count || null,
        ]
      );
      return result.rows[0]?.id || null;
    } catch (err) {
      logger.error({ err }, "Failed to log activity");
      return null;
    }
  }

  async logActivityBatch(
    entries: Array<{ action: string; messageData: any; context: any }>
  ): Promise<void> {
    if (!this.ctx.config.activity_log_enabled || entries.length === 0) return;

    try {
      // Build bulk INSERT with multiple VALUES
      const values: any[] = [];
      const placeholders: string[] = [];

      for (let i = 0; i < entries.length; i++) {
        const { action, messageData, context } = entries[i];
        const enrichedContext = {
          ...context,
          payload: context?.payload ?? messageData?.payload ?? null,
        };

        const baseIndex = i * 10;
        placeholders.push(
          `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 9}, $${baseIndex + 10})`
        );

        values.push(
          action,
          messageData?.id || null,
          messageData?.type || null,
          context?.consumer_id || null,
          JSON.stringify(enrichedContext),
          context?.payload_size || messageData?.payload_size || null,
          context?.queue_type || null,
          context?.queue_name || messageData?.queue_name || null,
          context?.processing_time_ms || null,
          context?.attempt_count || messageData?.attempt_count || null
        );
      }

      await this.ctx.pgManager.query(
        `INSERT INTO activity_logs (action, message_id, message_type, consumer_id, context, payload_size, queue_type, queue_name, processing_time_ms, attempt_count)
         VALUES ${placeholders.join(", ")}`,
        values
      );
    } catch (err) {
      logger.error({ err }, "Failed to log activity batch");
    }
  }

  async getActivityLogs(filters: ActivityLogFilters = {}): Promise<{
    logs: any[];
    total: number;
    pagination: {
      total: number;
      limit: number;
      offset: number;
      has_more: boolean;
      hasMore: boolean;
    };
  }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.queueName) {
      conditions.push(`queue_name = $${paramIndex}`);
      params.push(filters.queueName);
      paramIndex++;
    }

    if (filters.action) {
      conditions.push(`action = $${paramIndex}`);
      params.push(filters.action);
      paramIndex++;
    }

    if (filters.messageId) {
      conditions.push(`message_id = $${paramIndex}`);
      params.push(filters.messageId);
      paramIndex++;
    }

    if (filters.consumerId) {
      conditions.push(`consumer_id = $${paramIndex}`);
      params.push(filters.consumerId);
      paramIndex++;
    }

    if (filters.startDate) {
      conditions.push(`created_at >= $${paramIndex}`);
      params.push(new Date(filters.startDate));
      paramIndex++;
    }

    if (filters.endDate) {
      conditions.push(`created_at <= $${paramIndex}`);
      params.push(new Date(filters.endDate));
      paramIndex++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    const [logsResult, countResult] = await Promise.all([
      this.ctx.pgManager.query(
        `SELECT * FROM activity_logs ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, limit, offset]
      ),
      this.ctx.pgManager.query(
        `SELECT COUNT(*) as total FROM activity_logs ${whereClause}`,
        params
      ),
    ]);

    const total = parseInt(countResult.rows[0].total, 10);
    const logs = logsResult.rows.map((row: any) => this.mapActivityLogRow(row));

    return {
      logs,
      total,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + logsResult.rows.length < total,
        hasMore: offset + logsResult.rows.length < total,
      },
    };
  }

  async getMessageHistory(messageId: string): Promise<ActivityLogEntry[]> {
    const result = await this.ctx.pgManager.query(
      `SELECT * FROM activity_logs WHERE message_id = $1 ORDER BY created_at ASC`,
      [messageId]
    );
    return result.rows.map((row: any) => this.mapActivityLogRow(row));
  }

  private mapActivityLogRow(row: any): any {
    const context =
      typeof row.context === "string"
        ? JSON.parse(row.context)
        : row.context || {};

    return {
      log_id: String(row.id),
      message_id: row.message_id,
      action: row.action,
      timestamp: row.created_at
        ? Math.floor(new Date(row.created_at).getTime() / 1000)
        : null,
      queue: row.queue_name || context.queue_name || null,
      source_queue: context.source_queue || context.from_queue || null,
      dest_queue: context.dest_queue || context.to_queue || null,
      priority: context.priority ?? null,
      message_type: row.message_type,
      consumer_id: row.consumer_id,
      prev_consumer_id: context.prev_consumer_id || null,
      lock_token: context.lock_token || null,
      prev_lock_token: context.prev_lock_token || null,
      attempt_count: row.attempt_count,
      max_attempts: context.max_attempts || null,
      attempts_remaining: context.attempts_remaining || null,
      message_created_at: context.message_created_at || null,
      message_age_ms: context.message_age_ms || null,
      time_in_queue_ms: context.time_in_queue_ms || null,
      processing_time_ms: row.processing_time_ms,
      total_processing_time_ms: context.total_processing_time_ms || null,
      payload_size_bytes: row.payload_size,
      redis_operation_ms: context.redis_operation_ms || null,
      queue_depth: context.queue_depth || null,
      processing_depth: context.processing_depth || null,
      dlq_depth: context.dlq_depth || null,
      error_reason: context.error_reason || context.reason || null,
      error_code: context.error_code || null,
      triggered_by: context.triggered_by || "api",
      user_id: context.user_id || null,
      reason: context.reason || null,
      batch_id: context.batch_id || null,
      batch_size: context.batch_size || context.count || null,
      prev_action: context.prev_action || null,
      prev_timestamp: context.prev_timestamp || null,
      payload: context.payload || null,
      anomaly: context.anomaly || null,
    };
  }
}
