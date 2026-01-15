import { QueueContext, Anomaly, AnomalyFilters } from "../types.js";
import { createLogger } from "../utils.js";
import {
  AnomalyDetectorRegistry,
  AnomalyEvent,
  AnomalyResult,
  DetectionContext,
  createRegistryWithBuiltInDetectors,
} from "./anomaly-detectors/index.js";

const logger = createLogger("anomaly");

export class AnomalyService {
  private consumerStatsCache: Map<
    string,
    { lastDequeue: number; count: number }
  > = new Map();

  private registry: AnomalyDetectorRegistry;

  constructor(private ctx: QueueContext) {
    // Initialize with all built-in detectors
    this.registry = createRegistryWithBuiltInDetectors();
  }

  /**
   * Get the anomaly detector registry for custom configuration
   */
  getRegistry(): AnomalyDetectorRegistry {
    return this.registry;
  }

  /**
   * Run all enabled detectors for a specific event and record any detected anomalies
   * @returns Array of recorded anomalies
   */
  async runDetection(
    event: AnomalyEvent,
    context: Omit<DetectionContext, "config">
  ): Promise<AnomalyResult[]> {
    const fullContext: DetectionContext = {
      ...context,
      config: this.ctx.config,
    };

    const results = await this.registry.runDetectors(event, fullContext);

    // Record all detected anomalies
    if (results.length > 0) {
      await this.recordAnomalyBatch(
        results.map((r) => ({
          type: r.type,
          severity: r.severity,
          messageId: r.messageId ?? null,
          consumerId: r.consumerId ?? null,
          details: r.details,
        }))
      );
    }

    return results;
  }

  async recordAnomaly(
    type: string,
    severity: string,
    messageId: string | null,
    consumerId: string | null,
    details: any
  ): Promise<void> {
    try {
      const queueName = details?.queue_name || null;
      await this.ctx.pgManager.query(
        `INSERT INTO anomalies (type, severity, message_id, consumer_id, queue_name, details)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [type, severity, messageId, consumerId, queueName, JSON.stringify(details)]
      );
    } catch (err) {
      logger.error({ err }, "Failed to record anomaly");
    }
  }

  async recordAnomalyBatch(
    entries: Array<{
      type: string;
      severity: string;
      messageId: string | null;
      consumerId: string | null;
      details: any;
    }>
  ): Promise<void> {
    if (entries.length === 0) return;

    try {
      const values: any[] = [];
      const placeholders: string[] = [];

      for (let i = 0; i < entries.length; i++) {
        const { type, severity, messageId, consumerId, details } = entries[i];
        const queueName = details?.queue_name || null;
        const baseIndex = i * 6;
        placeholders.push(
          `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6})`
        );
        values.push(
          type,
          severity,
          messageId,
          consumerId,
          queueName,
          JSON.stringify(details)
        );
      }

      await this.ctx.pgManager.query(
        `INSERT INTO anomalies (type, severity, message_id, consumer_id, queue_name, details)
         VALUES ${placeholders.join(", ")}`,
        values
      );
    } catch (err) {
      logger.error({ err }, "Failed to record anomaly batch");
    }
  }

  async getAnomalies(filters: AnomalyFilters = {}): Promise<{
    anomalies: any[];
    summary: {
      total: number;
      by_type: Record<string, number>;
      by_severity: { critical: number; warning: number; info: number };
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

    if (filters.type) {
      conditions.push(`type = $${paramIndex}`);
      params.push(filters.type);
      paramIndex++;
    }

    if (filters.severity) {
      conditions.push(`severity = $${paramIndex}`);
      params.push(filters.severity);
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

    const [anomaliesResult, countResult, typeCountsResult, severityCountsResult] =
      await Promise.all([
        this.ctx.pgManager.query<Anomaly>(
          `SELECT * FROM anomalies ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          [...params, limit, offset]
        ),
        this.ctx.pgManager.query(
          `SELECT COUNT(*) as total FROM anomalies ${whereClause}`,
          params
        ),
        this.ctx.pgManager.query<{ type: string; count: string }>(
          `SELECT type, COUNT(*) as count FROM anomalies ${whereClause} GROUP BY type`,
          params
        ),
        this.ctx.pgManager.query<{ severity: string; count: string }>(
          `SELECT severity, COUNT(*) as count FROM anomalies ${whereClause} GROUP BY severity`,
          params
        ),
      ]);

    const by_type: Record<string, number> = {};
    for (const row of typeCountsResult.rows) {
      by_type[row.type] = parseInt(row.count, 10);
    }

    const by_severity = { critical: 0, warning: 0, info: 0 };
    for (const row of severityCountsResult.rows) {
      const sev = row.severity as keyof typeof by_severity;
      if (sev in by_severity) {
        by_severity[sev] = parseInt(row.count, 10);
      }
    }

    const mappedAnomalies = anomaliesResult.rows.map((row: any) => {
      const details =
        typeof row.details === "string"
          ? JSON.parse(row.details)
          : row.details || {};
      return {
        log_id: String(row.id),
        message_id: row.message_id,
        action: details.action || null,
        timestamp: row.created_at
          ? Math.floor(new Date(row.created_at).getTime() / 1000)
          : null,
        queue: details.queue_name || null,
        consumer_id: row.consumer_id,
        payload: details.payload || null,
        anomaly: {
          type: row.type,
          severity: row.severity,
          description: this.getAnomalyDescription(row.type, row.severity, details),
          threshold: details.threshold,
          actual:
            details.actual ||
            details.payload_size ||
            details.processing_time_ms ||
            details.time_in_queue_ms,
        },
      };
    });

    return {
      anomalies: mappedAnomalies,
      summary: {
        total: parseInt(countResult.rows[0].total, 10),
        by_type,
        by_severity,
      },
    };
  }

  async getConsumerStats(consumerId?: string): Promise<any> {
    try {
      if (consumerId) {
        const result = await this.ctx.pgManager.query(
          `SELECT * FROM consumer_stats WHERE consumer_id = $1`,
          [consumerId]
        );
        return result.rows[0] || null;
      }

      const result = await this.ctx.pgManager.query(
        `SELECT * FROM consumer_stats ORDER BY total_dequeued DESC`
      );
      return result.rows;
    } catch (err: any) {
      if (err.message?.includes("deadlock")) {
        console.warn(
          "Deadlock detected in getConsumerStats, returning empty result"
        );
        return consumerId ? null : [];
      }
      throw err;
    }
  }

  async clearActivityLogs(): Promise<boolean> {
    await this.ctx.pgManager.query(
      `TRUNCATE activity_logs, anomalies, consumer_stats`
    );
    return true;
  }

  async updateConsumerStats(
    consumerId: string,
    action: "dequeue" | "ack" | "fail"
  ): Promise<void> {
    try {
      const now = new Date();

      if (action === "dequeue") {
        await this.ctx.pgManager.query(
          `INSERT INTO consumer_stats (consumer_id, total_dequeued, last_dequeue_at, recent_dequeue_times, updated_at)
           VALUES ($1, 1, $2, ARRAY[$2::timestamptz], $2)
           ON CONFLICT (consumer_id) DO UPDATE SET
             total_dequeued = consumer_stats.total_dequeued + 1,
             last_dequeue_at = $2,
             recent_dequeue_times = (ARRAY[$2::timestamptz] || consumer_stats.recent_dequeue_times)[1:100],
             updated_at = $2`,
          [consumerId, now]
        );
      } else if (action === "ack") {
        await this.ctx.pgManager.query(
          `UPDATE consumer_stats SET
             total_acknowledged = total_acknowledged + 1,
             last_ack_at = $2,
             updated_at = $2
           WHERE consumer_id = $1`,
          [consumerId, now]
        );
      } else if (action === "fail") {
        await this.ctx.pgManager.query(
          `UPDATE consumer_stats SET
             total_failed = total_failed + 1,
             updated_at = $2
           WHERE consumer_id = $1`,
          [consumerId, now]
        );
      }
    } catch (err: any) {
      if (!err.message?.includes("deadlock")) {
        logger.error(
          { err, consumerId, action },
          "Failed to update consumer stats"
        );
      }
    }
  }

  async checkBurstDequeue(
    consumerId: string,
    queueName: string
  ): Promise<void> {
    try {
      const burstThresholdCount =
        (this.ctx.config as any).activity_burst_threshold_count ?? 50;
      const burstThresholdSeconds =
        (this.ctx.config as any).activity_burst_threshold_seconds ?? 5;

      const result = await this.ctx.pgManager.query(
        `SELECT recent_dequeue_times FROM consumer_stats WHERE consumer_id = $1`,
        [consumerId]
      );

      if (result.rows.length === 0 || !result.rows[0].recent_dequeue_times) {
        return;
      }

      const recentTimes: Date[] = result.rows[0].recent_dequeue_times;
      const windowStart = new Date(Date.now() - burstThresholdSeconds * 1000);

      const dequeuersInWindow = recentTimes.filter(
        (t) => new Date(t) >= windowStart
      ).length;

      if (dequeuersInWindow >= burstThresholdCount) {
        const recentAnomalyResult = await this.ctx.pgManager.query(
          `SELECT id FROM anomalies
           WHERE type = 'burst_dequeue'
           AND consumer_id = $1
           AND created_at > NOW() - ($2 || ' seconds')::INTERVAL
           LIMIT 1`,
          [consumerId, burstThresholdSeconds]
        );

        if (recentAnomalyResult.rows.length === 0) {
          await this.recordAnomaly("burst_dequeue", "warning", null, consumerId, {
            queue_name: queueName,
            dequeue_count: dequeuersInWindow,
            window_seconds: burstThresholdSeconds,
            threshold: burstThresholdCount,
          });
        }
      }
    } catch (err) {
      logger.error({ err }, "Failed to check burst dequeue");
    }
  }

  private getAnomalyDescription(
    type: string,
    severity: string,
    details: any
  ): string {
    switch (type) {
      case "large_payload":
        return `Payload size (${details.payload_size || "unknown"} bytes) exceeds threshold (${details.threshold || 10000} bytes)`;
      case "flash_message":
        return `Message was dequeued very quickly after enqueue (${details.time_in_queue_ms || "unknown"}ms)`;
      case "long_processing":
        return `Processing time (${details.processing_time_ms || "unknown"}ms) exceeds threshold (${details.threshold_ms || 30000}ms)`;
      case "lock_stolen":
        return `Lock token mismatch - message may have been requeued by another consumer`;
      case "bulk_enqueue":
        return `Bulk enqueue of ${details.count || "many"} messages`;
      case "bulk_delete":
        return `Bulk delete of ${details.count || "many"} messages`;
      case "bulk_move":
        return `Bulk move of ${details.count || "many"} messages`;
      case "zombie_message":
        return `Message stuck in processing state beyond expected timeout`;
      case "near_dlq":
        return `Message approaching max retry attempts`;
      case "dlq_movement":
        return `Message moved to dead letter queue`;
      case "burst_dequeue":
        return `High rate of dequeue operations detected`;
      case "queue_cleared":
        return `Queue was cleared`;
      default:
        return `${type.replace(/_/g, " ")} anomaly detected`;
    }
  }
}
