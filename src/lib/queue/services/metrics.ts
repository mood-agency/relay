import { QueueContext, QueueStatus, QueueMessage } from "../types.js";
import { mapMessage } from "../helpers.js";

export class MetricsService {
  constructor(private ctx: QueueContext) {}

  async getQueueStatus(
    typeFilter?: string | null,
    includeMessages: boolean = true,
    queueName?: string
  ): Promise<QueueStatus> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (queueName) {
      conditions.push(`queue_name = $${paramIndex}`);
      params.push(queueName);
      paramIndex++;
    }

    if (typeFilter) {
      conditions.push(`type = $${paramIndex}`);
      params.push(typeFilter);
      paramIndex++;
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countsResult = await this.ctx.pgManager.query(
      `
      SELECT
        status,
        priority,
        COUNT(*) as count
      FROM messages
      ${whereClause}
      GROUP BY status, priority
    `,
      params
    );

    const priorities: Record<number, number> = {};
    for (let i = 0; i <= 9; i++) priorities[i] = 0;

    const statusCounts: Record<string, number> = {
      queued: 0,
      processing: 0,
      acknowledged: 0,
      dead: 0,
      archived: 0,
    };

    for (const row of countsResult.rows) {
      statusCounts[row.status] =
        (statusCounts[row.status] || 0) + parseInt(row.count, 10);
      if (row.status === "queued") {
        priorities[row.priority] =
          (priorities[row.priority] || 0) + parseInt(row.count, 10);
      }
    }

    const typesResult = await this.ctx.pgManager.query(
      `SELECT DISTINCT type FROM messages WHERE type IS NOT NULL${queueName ? ` AND queue_name = $1` : ""}`,
      queueName ? [queueName] : []
    );
    const availableTypes = typesResult.rows.map((r) => r.type);

    let mainMessages: QueueMessage[] = [];
    let processingMessages: QueueMessage[] = [];
    let deadMessages: QueueMessage[] = [];
    let acknowledgedMessages: QueueMessage[] = [];
    let archivedMessages: QueueMessage[] = [];

    if (includeMessages) {
      const limit = 1000;

      const filterConditions: string[] = [];
      const filterParams: any[] = [limit];
      let filterParamIndex = 2;

      if (queueName) {
        filterConditions.push(`queue_name = $${filterParamIndex}`);
        filterParams.push(queueName);
        filterParamIndex++;
      }

      if (typeFilter) {
        filterConditions.push(`type = $${filterParamIndex}`);
        filterParams.push(typeFilter);
        filterParamIndex++;
      }

      const filterClause =
        filterConditions.length > 0
          ? ` AND ${filterConditions.join(" AND ")}`
          : "";

      const [main, processing, dead, ack, archived] = await Promise.all([
        this.ctx.pgManager.query<QueueMessage>(
          `SELECT * FROM messages WHERE status = 'queued'${filterClause} ORDER BY priority DESC, created_at LIMIT $1`,
          filterParams
        ),
        this.ctx.pgManager.query<QueueMessage>(
          `SELECT * FROM messages WHERE status = 'processing'${filterClause} ORDER BY dequeued_at DESC LIMIT $1`,
          filterParams
        ),
        this.ctx.pgManager.query<QueueMessage>(
          `SELECT * FROM messages WHERE status = 'dead'${filterClause} ORDER BY created_at DESC LIMIT $1`,
          filterParams
        ),
        this.ctx.pgManager.query<QueueMessage>(
          `SELECT * FROM messages WHERE status = 'acknowledged'${filterClause} ORDER BY acknowledged_at DESC LIMIT $1`,
          filterParams
        ),
        this.ctx.pgManager.query<QueueMessage>(
          `SELECT * FROM messages WHERE status = 'archived'${filterClause} ORDER BY created_at DESC LIMIT $1`,
          filterParams
        ),
      ]);

      mainMessages = main.rows.map((r) => mapMessage(r));
      processingMessages = processing.rows.map((r) => mapMessage(r));
      deadMessages = dead.rows.map((r) => mapMessage(r));
      acknowledgedMessages = ack.rows.map((r) => mapMessage(r));
      archivedMessages = archived.rows.map((r) => mapMessage(r));
    }

    return {
      mainQueue: { length: statusCounts.queued, messages: mainMessages },
      processingQueue: {
        length: statusCounts.processing,
        messages: processingMessages,
      },
      deadLetterQueue: { length: statusCounts.dead, messages: deadMessages },
      acknowledgedQueue: {
        length: statusCounts.acknowledged,
        messages: acknowledgedMessages,
      },
      archivedQueue: {
        length: statusCounts.archived,
        messages: archivedMessages,
      },
      totalAcknowledged: statusCounts.acknowledged,
      availableTypes,
      priorities,
    };
  }

  async getMetrics(): Promise<any> {
    const result = await this.ctx.pgManager.query(`
      SELECT
        status,
        COUNT(*) as count,
        AVG(payload_size) as avg_payload_size,
        MAX(payload_size) as max_payload_size
      FROM (
        SELECT status, payload_size FROM messages
        UNION ALL
        SELECT status, payload_size FROM messages_unlogged
      ) combined
      GROUP BY status
    `);

    const metrics: any = {
      queued: 0,
      processing: 0,
      acknowledged: 0,
      dead: 0,
      archived: 0,
      main_queue_size: 0,
      processing_size: 0,
      processing_queue_size: 0,
      dead_letter_size: 0,
      dead_letter_queue_size: 0,
      acknowledged_size: 0,
      acknowledged_queue_size: 0,
      avg_payload_size: 0,
      max_payload_size: 0,
    };

    for (const row of result.rows) {
      const count = parseInt(row.count, 10);
      metrics[row.status] = count;

      if (row.status === "queued") metrics.main_queue_size = count;
      if (row.status === "processing") {
        metrics.processing_size = count;
        metrics.processing_queue_size = count;
      }
      if (row.status === "dead") {
        metrics.dead_letter_size = count;
        metrics.dead_letter_queue_size = count;
      }
      if (row.status === "acknowledged") {
        metrics.acknowledged_size = count;
        metrics.acknowledged_queue_size = count;
      }

      if (row.avg_payload_size) {
        metrics.avg_payload_size = Math.max(
          metrics.avg_payload_size,
          parseFloat(row.avg_payload_size)
        );
      }
      if (row.max_payload_size) {
        metrics.max_payload_size = Math.max(
          metrics.max_payload_size,
          parseInt(row.max_payload_size, 10)
        );
      }
    }

    return metrics;
  }

  async healthCheck(): Promise<any> {
    const pgHealth = await this.ctx.pgManager.healthCheck();
    return {
      status: pgHealth.ok ? "healthy" : "unhealthy",
      postgres: pgHealth,
    };
  }
}
