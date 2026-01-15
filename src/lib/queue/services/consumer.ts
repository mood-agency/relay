import {
  QueueContext,
  QueueMessage,
  DequeuedMessage,
  AckResult,
  TouchResult,
} from "../types.js";
import { getTableName, mapMessage } from "../helpers.js";
import { generateId, createLogger } from "../utils.js";
import {
  AnomalyEvent,
  AnomalyResult,
  DetectionContext,
} from "./anomaly-detectors/types.js";

const logger = createLogger("consumer");

interface QueueConfig {
  queue_type: string;
  max_attempts: number;
  ack_timeout_seconds: number;
}

export class ConsumerService {
  constructor(
    private ctx: QueueContext,
    private getQueueConfig: (name: string) => Promise<QueueConfig | null>,
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
    ) => Promise<AnomalyResult[]>,
    private recordAnomalyBatch: (
      entries: Array<{
        type: string;
        severity: string;
        messageId: string | null;
        consumerId: string | null;
        details: any;
      }>
    ) => Promise<void>,
    private updateConsumerStats: (
      consumerId: string,
      action: "dequeue" | "ack" | "fail"
    ) => Promise<void>,
    private checkBurstDequeue: (
      consumerId: string,
      queueName: string
    ) => Promise<void>
  ) {}

  async dequeueMessage(
    timeout: number = 0,
    ackTimeout?: number | null,
    queueName: string = "default",
    type?: string | null,
    consumerId?: string | null
  ): Promise<DequeuedMessage | null> {
    const queueConfig = await this.getQueueConfig(queueName);
    if (!queueConfig) {
      throw new Error(`Queue not found: ${queueName}`);
    }

    const effectiveAckTimeout =
      ackTimeout ||
      this.ctx.config.ack_timeout_seconds ||
      queueConfig.ack_timeout_seconds;
    const lockToken = generateId();
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + effectiveAckTimeout * 1000);

    const tableName = getTableName(queueConfig.queue_type);

    let query: string;
    let params: any[];

    if (type) {
      query = `
        UPDATE ${tableName} SET
          status = 'processing',
          lock_token = $1,
          locked_until = $2,
          consumer_id = $3,
          dequeued_at = NOW(),
          attempt_count = attempt_count + 1
        WHERE id = (
          SELECT id FROM ${tableName}
          WHERE status = 'queued' AND queue_name = $4 AND type = $5
          ORDER BY priority DESC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING *`;
      params = [lockToken, lockedUntil, consumerId, queueName, type];
    } else {
      query = `
        UPDATE ${tableName} SET
          status = 'processing',
          lock_token = $1,
          locked_until = $2,
          consumer_id = $3,
          dequeued_at = NOW(),
          attempt_count = attempt_count + 1
        WHERE id = (
          SELECT id FROM ${tableName}
          WHERE status = 'queued' AND queue_name = $4
          ORDER BY priority DESC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        RETURNING *`;
      params = [lockToken, lockedUntil, consumerId, queueName];
    }

    const startTime = Date.now();
    const timeoutMs = timeout * 1000;

    while (true) {
      const result = await this.ctx.pgManager.query<QueueMessage>(
        query,
        params
      );

      if (result.rows.length > 0) {
        const message = mapMessage(result.rows[0]) as DequeuedMessage;
        message.processing_started_at = Math.floor(Date.now() / 1000);

        await this.updateConsumerStats(consumerId || "unknown", "dequeue");
        await this.checkBurstDequeue(consumerId || "unknown", queueName);

        await this.logActivity("dequeue", message, {
          consumer_id: consumerId,
          attempt_count: message.attempt_count,
          timeout_seconds: effectiveAckTimeout,
        });

        const createdAtMs = (message.created_at as unknown as number) * 1000;
        const timeSinceCreated = Date.now() - createdAtMs;

        // Run dequeue anomaly detection (flash_message, burst_dequeue via registry)
        await this.runDetection("dequeue", {
          message,
          consumerId,
          queueName,
          timeInQueueMs: timeSinceCreated,
        });

        return message;
      }

      if (timeoutMs === 0 || Date.now() - startTime >= timeoutMs) {
        return null;
      }

      const elapsed = Date.now() - startTime;
      const waitTime = Math.min(
        100 * Math.pow(2, Math.floor(elapsed / 1000)),
        1000
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  async acknowledgeMessage(ackPayload: {
    id: string;
    lock_token?: string;
  }): Promise<AckResult> {
    const { id, lock_token } = ackPayload;

    const checkResult = await this.ctx.pgManager.query(
      `SELECT lock_token, status, dequeued_at, consumer_id FROM messages WHERE id = $1`,
      [id]
    );

    if (checkResult.rows.length === 0) {
      return { success: false, error: "Message not found", code: "NOT_FOUND" };
    }

    const msg = checkResult.rows[0];

    if (msg.status !== "processing") {
      return {
        success: false,
        error: `Message is not in processing state (current: ${msg.status})`,
        code: "INVALID_STATE",
      };
    }

    if (lock_token && msg.lock_token !== lock_token) {
      // Run lock_stolen detection via registry
      await this.runDetection("ack", {
        message: { id } as QueueMessage,
        consumerId: msg.consumer_id,
        expectedLockToken: msg.lock_token,
        receivedLockToken: lock_token,
      });
      return {
        success: false,
        error: "Lock token mismatch - message may have been requeued",
        code: "LOCK_LOST",
      };
    }

    const result = await this.ctx.pgManager.query(
      `UPDATE messages SET
        status = 'acknowledged',
        acknowledged_at = NOW(),
        lock_token = NULL,
        locked_until = NULL
       WHERE id = $1 AND status = 'processing'
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: "Failed to acknowledge message",
        code: "UPDATE_FAILED",
      };
    }

    const row = result.rows[0];
    const message = mapMessage(row);
    const processingTimeMs =
      row.acknowledged_at && row.dequeued_at
        ? new Date(row.acknowledged_at).getTime() -
          new Date(row.dequeued_at).getTime()
        : null;

    await this.updateConsumerStats(msg.consumer_id || "unknown", "ack");

    await this.logActivity("acknowledge", message, {
      consumer_id: msg.consumer_id,
      processing_time_ms: processingTimeMs,
    });

    // Run ack anomaly detection (long_processing via registry)
    if (processingTimeMs) {
      await this.runDetection("ack", {
        message,
        consumerId: msg.consumer_id,
        processingTimeMs,
      });
    }

    return true;
  }

  async nackMessage(
    messageId: string,
    lockToken?: string,
    errorReason?: string
  ): Promise<AckResult> {
    const checkResult = await this.ctx.pgManager.query(
      `SELECT lock_token, status, attempt_count, max_attempts, priority, original_priority, consumer_id, queue_name
       FROM messages WHERE id = $1`,
      [messageId]
    );

    if (checkResult.rows.length === 0) {
      return { success: false, error: "Message not found", code: "NOT_FOUND" };
    }

    const msg = checkResult.rows[0];

    if (msg.status !== "processing") {
      return {
        success: false,
        error: `Message is not in processing state (current: ${msg.status})`,
        code: "INVALID_STATE",
      };
    }

    if (lockToken && msg.lock_token !== lockToken) {
      return { success: false, error: "Lock token mismatch", code: "LOCK_LOST" };
    }

    const effectiveMaxAttempts = Math.min(
      msg.max_attempts,
      this.ctx.config.max_attempts
    );
    if (msg.attempt_count >= effectiveMaxAttempts) {
      const result = await this.ctx.pgManager.query(
        `UPDATE messages SET
          status = 'dead',
          lock_token = NULL,
          locked_until = NULL,
          last_error = $2
         WHERE id = $1
         RETURNING *`,
        [messageId, errorReason || "Max attempts exceeded"]
      );

      const dlqMessage = mapMessage(result.rows[0]);

      // Run nack detection for DLQ movement
      await this.runDetection("nack", {
        message: dlqMessage,
        consumerId: msg.consumer_id,
        errorReason: errorReason || "max_attempts_exceeded",
        extra: {
          attemptCount: msg.attempt_count,
          maxAttempts: effectiveMaxAttempts,
          isMovingToDlq: true,
        },
      });

      await this.logActivity("move_to_dlq", dlqMessage, {
        reason: errorReason || "Max attempts exceeded",
        attempt_count: msg.attempt_count,
      });

      return true;
    }

    // Run nack detection for near_dlq warning
    await this.runDetection("nack", {
      message: { id: messageId, queue_name: msg.queue_name } as QueueMessage,
      consumerId: msg.consumer_id,
      errorReason,
      extra: {
        attemptCount: msg.attempt_count,
        maxAttempts: effectiveMaxAttempts,
      },
    });

    const result = await this.ctx.pgManager.query(
      `UPDATE messages SET
        status = 'queued',
        lock_token = NULL,
        locked_until = NULL,
        consumer_id = NULL,
        dequeued_at = NULL,
        last_error = $2,
        priority = COALESCE(original_priority, priority)
       WHERE id = $1
       RETURNING *`,
      [messageId, errorReason]
    );

    await this.logActivity("nack", mapMessage(result.rows[0]), {
      reason: errorReason,
      attempt_count: msg.attempt_count,
      will_retry: true,
    });

    return true;
  }

  async touchMessage(
    messageId: string,
    lockToken: string,
    extendSeconds?: number
  ): Promise<TouchResult> {
    const extension = extendSeconds || this.ctx.config.ack_timeout_seconds;

    const checkResult = await this.ctx.pgManager.query(
      `SELECT id, lock_token, status FROM messages WHERE id = $1`,
      [messageId]
    );

    if (checkResult.rows.length === 0) {
      return { success: false, error: "Message not found", not_found: true };
    }

    const msg = checkResult.rows[0];
    if (msg.status !== "processing") {
      return { success: false, error: "Message not found", not_found: true };
    }

    if (msg.lock_token !== lockToken) {
      return { success: false, error: "Lock token mismatch" };
    }

    const result = await this.ctx.pgManager.query(
      `UPDATE messages SET
        locked_until = NOW() + ($3 || ' seconds')::INTERVAL
       WHERE id = $1 AND lock_token = $2 AND status = 'processing'
       RETURNING locked_until, lock_token`,
      [messageId, lockToken, extension]
    );

    if (result.rows.length === 0) {
      return { success: false, error: "Failed to extend lock" };
    }

    return {
      success: true,
      new_timeout_at: Math.floor(
        result.rows[0].locked_until.getTime() / 1000
      ),
      lock_token: result.rows[0].lock_token,
    };
  }

  async requeueFailedMessages(): Promise<number> {
    const tables = ["messages", "messages_unlogged"];
    let totalRequeued = 0;
    let totalDlq = 0;

    for (const tableName of tables) {
      // Fetch all overdue messages in one query
      const overdueResult = await this.ctx.pgManager.query(
        `SELECT * FROM ${tableName}
         WHERE status = 'processing' AND locked_until < NOW()
         LIMIT $1`,
        [this.ctx.config.requeue_batch_size || 1000]
      );

      if (overdueResult.rows.length === 0) {
        continue;
      }

      // Separate messages into requeue vs DLQ
      const toRequeue: any[] = [];
      const toDlq: any[] = [];
      const zombieAnomalies: Array<{
        type: string;
        severity: string;
        messageId: string | null;
        consumerId: string | null;
        details: any;
      }> = [];
      const dlqAnomalies: Array<{
        type: string;
        severity: string;
        messageId: string | null;
        consumerId: string | null;
        details: any;
      }> = [];
      const requeueLogs: Array<{ action: string; messageData: any; context: any }> = [];
      const dlqLogs: Array<{ action: string; messageData: any; context: any }> = [];

      const zombieMultiplier =
        (this.ctx.config as any).activity_zombie_threshold_multiplier ?? 2;

      for (const row of overdueResult.rows) {
        const message = mapMessage(row);
        const expectedTimeout = row.ack_timeout_seconds * 1000;
        const lockedUntilTime = new Date(row.locked_until).getTime();
        const overdueMs = Date.now() - lockedUntilTime;

        // Check for zombie messages
        if (overdueMs > expectedTimeout * zombieMultiplier) {
          zombieAnomalies.push({
            type: "zombie_message",
            severity: "critical",
            messageId: row.id,
            consumerId: row.consumer_id,
            details: {
              queue_name: row.queue_name,
              overdue_ms: overdueMs,
              expected_timeout_ms: expectedTimeout,
              multiplier: zombieMultiplier,
              attempt_count: row.attempt_count,
              payload: message.payload,
            },
          });
        }

        if (row.attempt_count >= row.max_attempts) {
          // Move to DLQ
          toDlq.push(row);
          dlqAnomalies.push({
            type: "dlq_movement",
            severity: "warning",
            messageId: row.id,
            consumerId: row.consumer_id,
            details: {
              queue_name: row.queue_name,
              reason: "timeout_max_attempts",
              attempt_count: row.attempt_count,
              max_attempts: row.max_attempts,
              payload: message.payload,
            },
          });
          dlqLogs.push({
            action: "timeout_to_dlq",
            messageData: message,
            context: {
              attempt_count: row.attempt_count,
              max_attempts: row.max_attempts,
              consumer_id: (this.ctx.config as any).relay_actor,
              prev_consumer_id: row.consumer_id,
            },
          });
        } else {
          // Requeue to main queue
          toRequeue.push(row);
          requeueLogs.push({
            action: "timeout_requeue",
            messageData: message,
            context: {
              attempt_count: row.attempt_count,
              consumer_id: (this.ctx.config as any).relay_actor,
              prev_consumer_id: row.consumer_id,
            },
          });
        }
      }

      // Batch UPDATE for messages to requeue
      if (toRequeue.length > 0) {
        const requeueIds = toRequeue.map((r) => r.id);
        await this.ctx.pgManager.query(
          `UPDATE ${tableName} SET
            status = 'queued',
            lock_token = NULL,
            locked_until = NULL,
            consumer_id = NULL,
            dequeued_at = NULL,
            last_error = 'Timeout - requeued'
           WHERE id = ANY($1)`,
          [requeueIds]
        );
        totalRequeued += toRequeue.length;
      }

      // Batch UPDATE for messages to DLQ
      if (toDlq.length > 0) {
        const dlqIds = toDlq.map((r) => r.id);
        await this.ctx.pgManager.query(
          `UPDATE ${tableName} SET
            status = 'dead',
            lock_token = NULL,
            locked_until = NULL,
            last_error = 'Timeout after max attempts'
           WHERE id = ANY($1)`,
          [dlqIds]
        );
        totalDlq += toDlq.length;
      }

      // Batch insert anomalies
      if (zombieAnomalies.length > 0) {
        await this.recordAnomalyBatch(zombieAnomalies);
      }
      if (dlqAnomalies.length > 0) {
        await this.recordAnomalyBatch(dlqAnomalies);
      }

      // Batch insert activity logs
      if (requeueLogs.length > 0) {
        await this.logActivityBatch(requeueLogs);
      }
      if (dlqLogs.length > 0) {
        await this.logActivityBatch(dlqLogs);
      }
    }

    if (totalRequeued > 0 || totalDlq > 0) {
      logger.info(
        { requeued: totalRequeued, dlq: totalDlq },
        "Requeued failed messages"
      );
    }

    return totalRequeued + totalDlq;
  }
}
