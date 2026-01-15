import {
  QueueContext,
  QueueMessage,
  PaginatedMessages,
  MessageQueryParams,
  MoveMessagesOptions,
  UpdateMessageOptions,
} from "../types.js";
import { mapMessage, STATUS_MAP } from "../helpers.js";
import {
  AnomalyEvent,
  AnomalyResult,
  DetectionContext,
} from "./anomaly-detectors/types.js";

export class AdminService {
  constructor(
    private ctx: QueueContext,
    private logActivity: (
      action: string,
      message: any,
      context: any
    ) => Promise<number | null>,
    private logActivityBatch: (
      entries: Array<{ action: string; messageData: any; context: any }>
    ) => Promise<void>,
    private runDetection: (
      event: AnomalyEvent,
      context: Omit<DetectionContext, "config">
    ) => Promise<AnomalyResult[]>
  ) {}

  async moveMessages(
    messageIds: string[],
    fromQueue: string,
    toQueue: string,
    options?: MoveMessagesOptions
  ): Promise<number> {
    if (messageIds.length === 0) return 0;

    const targetStatus = STATUS_MAP[toQueue] || toQueue;

    let result;

    if (targetStatus === "processing") {
      const lockedUntil = new Date(
        Date.now() + this.ctx.config.ack_timeout_seconds * 1000
      );
      const consumerId =
        options?.consumerId ||
        (this.ctx.config as any).manual_operation_actor;

      result = await this.ctx.pgManager.query(
        `UPDATE messages SET
          status = $1,
          lock_token = 'lk_' || substr(md5(random()::text || id || clock_timestamp()::text), 1, 10),
          locked_until = $3,
          consumer_id = $4,
          dequeued_at = NOW(),
          attempt_count = attempt_count + 1,
          last_error = COALESCE($5, last_error)
         WHERE id = ANY($2)
         RETURNING *`,
        [
          targetStatus,
          messageIds,
          lockedUntil,
          consumerId,
          options?.errorReason,
        ]
      );
    } else {
      result = await this.ctx.pgManager.query(
        `UPDATE messages SET
          status = $1,
          lock_token = NULL,
          locked_until = NULL,
          consumer_id = CASE WHEN $1 = 'queued' THEN NULL ELSE consumer_id END,
          dequeued_at = CASE WHEN $1 = 'queued' THEN NULL ELSE dequeued_at END,
          last_error = COALESCE($3, last_error)
         WHERE id = ANY($2)
         RETURNING *`,
        [targetStatus, messageIds, options?.errorReason]
      );
    }

    const actorId =
      options?.consumerId || (this.ctx.config as any).manual_operation_actor;

    // Use batch logging for better performance
    if (result.rows.length > 0) {
      const logEntries = result.rows.map((row) => ({
        action: "move",
        messageData: mapMessage(row),
        context: {
          to_queue: toQueue,
          from_queue: fromQueue,
          consumer_id: actorId,
        },
      }));
      await this.logActivityBatch(logEntries);
    }

    const movedCount = result.rowCount || 0;

    // Run bulk operation anomaly detection
    await this.runDetection("bulk_operation", {
      operationType: "move",
      affectedCount: movedCount,
      consumerId: actorId,
      extra: {
        sourceStatus: fromQueue,
        targetStatus: toQueue,
      },
    });

    return movedCount;
  }

  async getQueueMessages(
    queueType: string,
    params: MessageQueryParams = {}
  ): Promise<PaginatedMessages> {
    const page = params.page || 1;
    const limit = params.limit || 100;
    const offset = (page - 1) * limit;

    const status = STATUS_MAP[queueType] || queueType;

    let whereClause = "status = $1";
    const queryParams: any[] = [status];
    let paramIndex = 2;

    if (params.queueName) {
      whereClause += ` AND queue_name = $${paramIndex}`;
      queryParams.push(params.queueName);
      paramIndex++;
    }

    // Support both params.type (single) and params.filterType (comma-separated multiple)
    const typeFilter = params.filterType || params.type;
    if (typeFilter && typeFilter !== "all") {
      const types = typeFilter.split(",").map((t) => t.trim()).filter(Boolean);
      if (types.length === 1) {
        whereClause += ` AND type = $${paramIndex}`;
        queryParams.push(types[0]);
        paramIndex++;
      } else if (types.length > 1) {
        whereClause += ` AND type = ANY($${paramIndex})`;
        queryParams.push(types);
        paramIndex++;
      }
    }

    if (params.filterPriority) {
      const priority = parseInt(params.filterPriority, 10);
      if (!isNaN(priority)) {
        whereClause += ` AND priority = $${paramIndex}`;
        queryParams.push(priority);
        paramIndex++;
      }
    }

    if (params.filterAttempts) {
      const minAttempts = parseInt(params.filterAttempts, 10);
      if (!isNaN(minAttempts)) {
        whereClause += ` AND attempt_count >= $${paramIndex}`;
        queryParams.push(minAttempts);
        paramIndex++;
      }
    }

    if (params.search) {
      whereClause += ` AND (id ILIKE $${paramIndex} OR payload::text ILIKE $${paramIndex})`;
      queryParams.push(`%${params.search}%`);
      paramIndex++;
    }

    if (params.startDate) {
      whereClause += ` AND created_at >= $${paramIndex}`;
      queryParams.push(new Date(params.startDate));
      paramIndex++;
    }

    if (params.endDate) {
      whereClause += ` AND created_at <= $${paramIndex}`;
      queryParams.push(new Date(params.endDate));
      paramIndex++;
    }

    const sortBy = params.sortBy || "created_at";
    const sortOrder = params.sortOrder?.toUpperCase() === "ASC" ? "ASC" : "DESC";
    const orderClause = `ORDER BY ${sortBy} ${sortOrder}${sortBy !== "created_at" ? ", created_at ASC" : ""}`;

    const countResult = await this.ctx.pgManager.query(
      `SELECT COUNT(*) as total FROM messages WHERE ${whereClause}`,
      queryParams
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const messagesResult = await this.ctx.pgManager.query<QueueMessage>(
      `SELECT * FROM messages WHERE ${whereClause} ${orderClause} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...queryParams, limit, offset]
    );

    const messages = messagesResult.rows.map((row) => mapMessage(row));

    return {
      messages,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + messages.length < total,
      },
    };
  }

  async deleteMessage(
    messageId: string,
    _queueType?: string
  ): Promise<{ success: boolean }> {
    const result = await this.ctx.pgManager.query(
      `DELETE FROM messages WHERE id = $1 RETURNING id`,
      [messageId]
    );

    if (result.rowCount && result.rowCount > 0) {
      await this.logActivity(
        "delete",
        { id: messageId },
        {
          consumer_id: (this.ctx.config as any).manual_operation_actor,
        }
      );
      return { success: true };
    }

    return { success: false };
  }

  async deleteMessages(
    messageIds: string[],
    _queueType?: string
  ): Promise<number> {
    if (messageIds.length === 0) return 0;

    const result = await this.ctx.pgManager.query(
      `DELETE FROM messages WHERE id = ANY($1)`,
      [messageIds]
    );

    const deletedCount = result.rowCount || 0;

    await this.logActivity("bulk_delete", null, {
      count: deletedCount,
      message_ids: messageIds,
      consumer_id: (this.ctx.config as any).manual_operation_actor,
    });

    // Run bulk operation anomaly detection
    await this.runDetection("bulk_operation", {
      operationType: "delete",
      affectedCount: deletedCount,
      consumerId: (this.ctx.config as any).manual_operation_actor,
      extra: {
        sourceStatus: _queueType,
      },
    });

    return deletedCount;
  }

  async updateMessage(
    messageId: string,
    _queueType: string,
    updates: UpdateMessageOptions
  ): Promise<QueueMessage | null> {
    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (updates.payload !== undefined) {
      setClauses.push(`payload = $${paramIndex}`);
      params.push(JSON.stringify(updates.payload));
      paramIndex++;
    }

    if (updates.priority !== undefined) {
      setClauses.push(`priority = $${paramIndex}`);
      params.push(updates.priority);
      paramIndex++;
    }

    if (updates.type !== undefined) {
      setClauses.push(`type = $${paramIndex}`);
      params.push(updates.type);
      paramIndex++;
    }

    if (setClauses.length === 0) return null;

    params.push(messageId);

    const result = await this.ctx.pgManager.query<QueueMessage>(
      `UPDATE messages SET ${setClauses.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
      params
    );

    if (result.rows.length === 0) return null;

    return mapMessage(result.rows[0]);
  }

  async clearQueue(queueType: string): Promise<boolean> {
    const status = STATUS_MAP[queueType] || queueType;

    const countResult = await this.ctx.pgManager.query(
      `SELECT COUNT(*) as count FROM messages WHERE status = $1`,
      [status]
    );
    const clearedCount = parseInt(countResult.rows[0]?.count || "0", 10);

    await this.ctx.pgManager.query(`DELETE FROM messages WHERE status = $1`, [
      status,
    ]);

    await this.logActivity("clear_queue", null, {
      queue_type: queueType,
      cleared_count: clearedCount,
      consumer_id: (this.ctx.config as any).manual_operation_actor,
    });

    // Run bulk operation anomaly detection for queue clear
    if (clearedCount > 0) {
      await this.runDetection("bulk_operation", {
        operationType: "clear",
        affectedCount: clearedCount,
        consumerId: (this.ctx.config as any).manual_operation_actor,
        extra: {
          status: queueType,
        },
      });
    }

    return true;
  }

  async clearAllQueues(): Promise<boolean> {
    await this.ctx.pgManager.query(`TRUNCATE messages`);
    await this.logActivity("clear_all_queues", null, {
      consumer_id: (this.ctx.config as any).manual_operation_actor,
    });
    return true;
  }
}
