import {
  QueueContext,
  QueueDefinition,
  CreateQueueInput,
  UpdateQueueConfigOptions,
} from "../types.js";
import { getTableName } from "../helpers.js";
import { createLogger } from "../utils.js";

const logger = createLogger("queue-management");

interface CachedQueueConfig {
  queue_type: string;
  max_attempts: number;
  ack_timeout_seconds: number;
  cachedAt: number;
}

export class QueueManagementService {
  private queueConfigCache: Map<string, CachedQueueConfig> = new Map();
  private cacheTTLMs: number = 60000; // 60 second cache TTL

  constructor(
    private ctx: QueueContext,
    private logActivity: (
      action: string,
      message: any,
      context: any
    ) => Promise<number | null>
  ) {}

  async createQueue(input: CreateQueueInput): Promise<QueueDefinition> {
    const {
      name,
      queue_type = "standard",
      ack_timeout_seconds = 30,
      max_attempts = 3,
      partition_interval,
      retention_interval,
      description,
    } = input;

    if (
      queue_type === "partitioned" &&
      (!partition_interval || !retention_interval)
    ) {
      throw new Error(
        "Partitioned queues require partition_interval and retention_interval"
      );
    }

    const result = await this.ctx.pgManager.query<QueueDefinition>(
      `SELECT * FROM create_queue($1, $2, $3, $4, $5, $6, $7)`,
      [
        name,
        queue_type,
        ack_timeout_seconds,
        max_attempts,
        partition_interval || null,
        retention_interval || null,
        description || null,
      ]
    );

    const queue = result.rows[0];
    await this.logActivity("create_queue", null, {
      queue_name: name,
      queue_type,
      consumer_id: (this.ctx.config as any).manual_operation_actor,
    });
    logger.info({ queue_name: name, queue_type }, "Queue created");

    return this.mapQueueDefinition(queue);
  }

  async listQueues(): Promise<QueueDefinition[]> {
    await this.updateQueueStats();

    const result = await this.ctx.pgManager.query<QueueDefinition>(
      `SELECT * FROM queues ORDER BY created_at ASC`
    );

    return result.rows.map((row) => this.mapQueueDefinition(row));
  }

  async getQueueByName(
    name: string,
    options?: { includeStats?: boolean }
  ): Promise<QueueDefinition | null> {
    if (options?.includeStats) {
      await this.updateQueueStats(name);
    }

    const result = await this.ctx.pgManager.query<QueueDefinition>(
      `SELECT * FROM queues WHERE name = $1`,
      [name]
    );

    if (result.rows.length === 0) return null;
    return this.mapQueueDefinition(result.rows[0]);
  }

  /**
   * Get queue config with caching for high-frequency operations.
   * Returns only the fields needed for enqueue/dequeue (no stats).
   * Cache TTL is 60 seconds.
   */
  async getQueueConfig(
    name: string
  ): Promise<{ queue_type: string; max_attempts: number; ack_timeout_seconds: number } | null> {
    const now = Date.now();
    const cached = this.queueConfigCache.get(name);

    if (cached && now - cached.cachedAt < this.cacheTTLMs) {
      return {
        queue_type: cached.queue_type,
        max_attempts: cached.max_attempts,
        ack_timeout_seconds: cached.ack_timeout_seconds,
      };
    }

    const result = await this.ctx.pgManager.query<QueueDefinition>(
      `SELECT queue_type, max_attempts, ack_timeout_seconds FROM queues WHERE name = $1`,
      [name]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    this.queueConfigCache.set(name, {
      queue_type: row.queue_type,
      max_attempts: row.max_attempts,
      ack_timeout_seconds: row.ack_timeout_seconds,
      cachedAt: now,
    });

    return {
      queue_type: row.queue_type,
      max_attempts: row.max_attempts,
      ack_timeout_seconds: row.ack_timeout_seconds,
    };
  }

  /**
   * Invalidate cache for a specific queue (call after config updates).
   */
  invalidateQueueCache(name: string): void {
    this.queueConfigCache.delete(name);
  }

  async updateQueueConfig(
    name: string,
    updates: UpdateQueueConfigOptions
  ): Promise<QueueDefinition | null> {
    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (updates.ack_timeout_seconds !== undefined) {
      setClauses.push(`ack_timeout_seconds = $${paramIndex}`);
      params.push(updates.ack_timeout_seconds);
      paramIndex++;
    }

    if (updates.max_attempts !== undefined) {
      setClauses.push(`max_attempts = $${paramIndex}`);
      params.push(updates.max_attempts);
      paramIndex++;
    }

    if (updates.description !== undefined) {
      setClauses.push(`description = $${paramIndex}`);
      params.push(updates.description);
      paramIndex++;
    }

    if (setClauses.length === 0) return null;

    setClauses.push(`updated_at = NOW()`);
    params.push(name);

    const result = await this.ctx.pgManager.query<QueueDefinition>(
      `UPDATE queues SET ${setClauses.join(", ")} WHERE name = $${paramIndex} RETURNING *`,
      params
    );

    if (result.rows.length === 0) return null;

    await this.logActivity("update_queue", null, {
      queue_name: name,
      updates,
      consumer_id: (this.ctx.config as any).manual_operation_actor,
    });

    // Invalidate cache since config changed
    this.invalidateQueueCache(name);

    return this.mapQueueDefinition(result.rows[0]);
  }

  async deleteQueueByName(
    name: string,
    force: boolean = false
  ): Promise<{ deleted_messages: number }> {
    const queue = await this.getQueueByName(name, { includeStats: true });
    if (!queue) {
      throw new Error(`Queue not found: ${name}`);
    }

    if (!force && (queue.message_count > 0 || queue.processing_count > 0)) {
      throw new Error(
        `Queue has ${queue.message_count + queue.processing_count} messages. Use force=true to delete.`
      );
    }

    await this.ctx.pgManager.query(`SELECT delete_queue($1)`, [name]);

    await this.logActivity("delete_queue", null, {
      queue_name: name,
      force,
      consumer_id: (this.ctx.config as any).manual_operation_actor,
    });
    logger.info({ queue_name: name }, "Queue deleted");

    return {
      deleted_messages:
        queue.message_count + queue.processing_count + queue.dead_count,
    };
  }

  async purgeQueue(name: string, status: string = "all"): Promise<number> {
    const queue = await this.getQueueByName(name, { includeStats: true });
    if (!queue) {
      throw new Error(`Queue not found: ${name}`);
    }

    const tableName = getTableName(queue.queue_type);
    let result;

    if (status === "all") {
      result = await this.ctx.pgManager.query(
        `DELETE FROM ${tableName} WHERE queue_name = $1 RETURNING id`,
        [name]
      );
    } else {
      result = await this.ctx.pgManager.query(
        `DELETE FROM ${tableName} WHERE queue_name = $1 AND status = $2 RETURNING id`,
        [name, status]
      );
    }

    await this.logActivity("purge_queue", null, {
      queue_name: name,
      status,
      deleted_count: result.rowCount,
      consumer_id: (this.ctx.config as any).manual_operation_actor,
    });
    return result.rowCount || 0;
  }

  private async updateQueueStats(queueName?: string): Promise<void> {
    try {
      if (queueName) {
        await this.ctx.pgManager.query(
          `
          UPDATE queues SET
            message_count = (
              SELECT COUNT(*) FROM messages WHERE queue_name = $1 AND status = 'queued'
            ) + (
              SELECT COUNT(*) FROM messages_unlogged WHERE queue_name = $1 AND status = 'queued'
            ),
            processing_count = (
              SELECT COUNT(*) FROM messages WHERE queue_name = $1 AND status = 'processing'
            ) + (
              SELECT COUNT(*) FROM messages_unlogged WHERE queue_name = $1 AND status = 'processing'
            ),
            dead_count = (
              SELECT COUNT(*) FROM messages WHERE queue_name = $1 AND status = 'dead'
            ) + (
              SELECT COUNT(*) FROM messages_unlogged WHERE queue_name = $1 AND status = 'dead'
            ),
            updated_at = NOW()
          WHERE name = $1
        `,
          [queueName]
        );
      } else {
        await this.ctx.pgManager.query(`
          UPDATE queues q SET
            message_count = COALESCE((
              SELECT COUNT(*) FROM messages WHERE queue_name = q.name AND status = 'queued'
            ), 0) + COALESCE((
              SELECT COUNT(*) FROM messages_unlogged WHERE queue_name = q.name AND status = 'queued'
            ), 0),
            processing_count = COALESCE((
              SELECT COUNT(*) FROM messages WHERE queue_name = q.name AND status = 'processing'
            ), 0) + COALESCE((
              SELECT COUNT(*) FROM messages_unlogged WHERE queue_name = q.name AND status = 'processing'
            ), 0),
            dead_count = COALESCE((
              SELECT COUNT(*) FROM messages WHERE queue_name = q.name AND status = 'dead'
            ), 0) + COALESCE((
              SELECT COUNT(*) FROM messages_unlogged WHERE queue_name = q.name AND status = 'dead'
            ), 0),
            updated_at = NOW()
        `);
      }
    } catch (err) {
      logger.error({ err }, "Failed to update queue stats");
    }
  }

  private mapQueueDefinition(row: any): QueueDefinition {
    return {
      name: row.name,
      queue_type: row.queue_type,
      ack_timeout_seconds: row.ack_timeout_seconds,
      max_attempts: row.max_attempts,
      partition_interval: row.partition_interval,
      retention_interval: row.retention_interval,
      description: row.description,
      created_at: row.created_at,
      updated_at: row.updated_at,
      message_count: parseInt(row.message_count, 10) || 0,
      processing_count: parseInt(row.processing_count, 10) || 0,
      dead_count: parseInt(row.dead_count, 10) || 0,
    };
  }
}
