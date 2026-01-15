import {
  QueueContext,
  MessageInput,
  QueueMessage,
} from "../types.js";
import { getTableName, mapMessage } from "../helpers.js";
import { generateId, createLogger } from "../utils.js";
import {
  AnomalyEvent,
  AnomalyResult,
  DetectionContext,
} from "./anomaly-detectors/types.js";

const logger = createLogger("enqueue-buffer");

interface QueueConfig {
  queue_type: string;
  max_attempts: number;
  ack_timeout_seconds: number;
}

interface BufferedMessage {
  messageData: MessageInput;
  priority: number;
  resolve: (message: QueueMessage) => void;
  reject: (error: Error) => void;
}

interface BufferConfig {
  enabled: boolean;
  maxSize: number;
  maxWaitMs: number;
}

/**
 * EnqueueBuffer accumulates individual enqueue requests and flushes them
 * as batch inserts to reduce database roundtrips.
 */
class EnqueueBuffer {
  private buffers: Map<string, BufferedMessage[]> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private flushInProgress: Map<string, Promise<void>> = new Map();

  constructor(
    private config: BufferConfig,
    private enqueueBatchFn: (
      messages: MessageInput[],
      priority: number,
      queueName: string
    ) => Promise<QueueMessage[]>
  ) {}

  async add(messageData: MessageInput, priority: number): Promise<QueueMessage> {
    const queueName = messageData.queue || "default";

    return new Promise<QueueMessage>((resolve, reject) => {
      // Get or create buffer for this queue
      if (!this.buffers.has(queueName)) {
        this.buffers.set(queueName, []);
      }

      const buffer = this.buffers.get(queueName)!;
      buffer.push({ messageData, priority, resolve, reject });

      logger.debug(
        { queueName, bufferSize: buffer.length, maxSize: this.config.maxSize },
        "Message added to buffer"
      );

      // Check if we should flush by size
      if (buffer.length >= this.config.maxSize) {
        this.flush(queueName);
        return;
      }

      // Start timer if this is the first message in buffer
      if (buffer.length === 1 && !this.timers.has(queueName)) {
        const timer = setTimeout(() => {
          this.timers.delete(queueName);
          this.flush(queueName);
        }, this.config.maxWaitMs);

        this.timers.set(queueName, timer);
      }
    });
  }

  private async flush(queueName: string): Promise<void> {
    // If flush is already in progress, wait for it
    const inProgress = this.flushInProgress.get(queueName);
    if (inProgress) {
      await inProgress;
      // After waiting, check if there are more messages to flush
      if (this.buffers.get(queueName)?.length) {
        return this.flush(queueName);
      }
      return;
    }

    const buffer = this.buffers.get(queueName);
    if (!buffer || buffer.length === 0) {
      return;
    }

    // Clear timer if exists
    const timer = this.timers.get(queueName);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(queueName);
    }

    // Take all messages from buffer
    const messagesToFlush = buffer.splice(0);
    this.buffers.set(queueName, []);

    logger.info(
      { queueName, count: messagesToFlush.length },
      "Flushing enqueue buffer"
    );

    // Group messages by priority for batch insert
    const byPriority = new Map<number, BufferedMessage[]>();
    for (const msg of messagesToFlush) {
      if (!byPriority.has(msg.priority)) {
        byPriority.set(msg.priority, []);
      }
      byPriority.get(msg.priority)!.push(msg);
    }

    // Create flush promise
    const flushPromise = (async () => {
      try {
        // Process each priority group
        const priorities = Array.from(byPriority.keys());
        for (const priority of priorities) {
          const messages = byPriority.get(priority)!;
          const inputs = messages.map((m) => m.messageData);

          try {
            const results = await this.enqueueBatchFn(inputs, priority, queueName);

            // Resolve promises for each message
            for (let i = 0; i < messages.length; i++) {
              messages[i].resolve(results[i]);
            }
          } catch (error) {
            // Reject all promises in this priority group
            for (const msg of messages) {
              msg.reject(error as Error);
            }
          }
        }
      } finally {
        this.flushInProgress.delete(queueName);
      }
    })();

    this.flushInProgress.set(queueName, flushPromise);
    await flushPromise;
  }

  /**
   * Force flush all buffers (useful for graceful shutdown)
   */
  async flushAll(): Promise<void> {
    const queueNames = Array.from(this.buffers.keys());
    await Promise.all(queueNames.map((name) => this.flush(name)));
  }
}

export class ProducerService {
  private buffer: EnqueueBuffer | null = null;

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
    ) => Promise<AnomalyResult[]>
  ) {
    // Initialize buffer if enabled
    const config = this.ctx.config as any;
    if (config.enqueue_buffer_enabled) {
      logger.info(
        {
          maxSize: config.enqueue_buffer_max_size,
          maxWaitMs: config.enqueue_buffer_max_wait_ms,
        },
        "Enqueue buffering enabled"
      );
      this.buffer = new EnqueueBuffer(
        {
          enabled: true,
          maxSize: config.enqueue_buffer_max_size || 50,
          maxWaitMs: config.enqueue_buffer_max_wait_ms || 100,
        },
        this.enqueueBatchInternal.bind(this)
      );
    }
  }

  async enqueueMessage(
    messageData: MessageInput,
    priority: number = 0
  ): Promise<QueueMessage> {
    // Use buffer if enabled
    if (this.buffer) {
      return this.buffer.add(messageData, priority);
    }

    return this.enqueueMessageDirect(messageData, priority);
  }

  /**
   * Direct enqueue without buffering (used internally and when buffer is disabled)
   */
  private async enqueueMessageDirect(
    messageData: MessageInput,
    priority: number = 0
  ): Promise<QueueMessage> {
    const queueName = messageData.queue || "default";
    const id = messageData.id || generateId();
    const payload = messageData.payload;
    const payloadSize = JSON.stringify(payload).length;

    const queueConfig = await this.getQueueConfig(queueName);
    if (!queueConfig) {
      throw new Error(`Queue not found: ${queueName}`);
    }

    const maxAttempts = messageData.custom_max_attempts || queueConfig.max_attempts;
    const ackTimeout =
      messageData.custom_ack_timeout || queueConfig.ack_timeout_seconds;
    const tableName = getTableName(queueConfig.queue_type);

    const result = await this.ctx.pgManager.query<QueueMessage>(
      `INSERT INTO ${tableName} (id, queue_name, type, payload, priority, max_attempts, ack_timeout_seconds, payload_size, original_priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $5)
       RETURNING *`,
      [
        id,
        queueName,
        messageData.type || null,
        JSON.stringify(payload),
        priority,
        maxAttempts,
        ackTimeout,
        payloadSize,
      ]
    );

    const message = mapMessage(result.rows[0]);

    await this.logActivity("enqueue", message, {
      queue_name: queueName,
      priority,
      payload_size: payloadSize,
      payload,
      consumer_id: messageData.consumerId || null,
    });

    // Run enqueue anomaly detection (large_payload via registry)
    await this.runDetection("enqueue", {
      message,
      queueName,
    });

    return message;
  }

  /**
   * Public batch enqueue - used by API endpoint POST /queue/batch
   */
  async enqueueBatch(
    messages: MessageInput[],
    priority: number = 0,
    queueName: string = "default",
    consumerId?: string
  ): Promise<QueueMessage[]> {
    return this.enqueueBatchInternal(messages, priority, queueName, consumerId);
  }

  /**
   * Internal batch enqueue - used by EnqueueBuffer and public enqueueBatch
   */
  private async enqueueBatchInternal(
    messages: MessageInput[],
    priority: number = 0,
    queueName: string = "default",
    consumerId?: string
  ): Promise<QueueMessage[]> {
    if (messages.length === 0) return [];

    const queueConfig = await this.getQueueConfig(queueName);
    if (!queueConfig) {
      throw new Error(`Queue not found: ${queueName}`);
    }

    const tableName = getTableName(queueConfig.queue_type);

    // Prepare all message data upfront
    const preparedMessages = messages.map((msg) => {
      const id = msg.id || generateId();
      const payload = msg.payload;
      const payloadSize = JSON.stringify(payload).length;
      const maxAttempts = msg.custom_max_attempts || queueConfig.max_attempts;
      const ackTimeout = msg.custom_ack_timeout || queueConfig.ack_timeout_seconds;
      return {
        id,
        queueName,
        type: msg.type || null,
        payload: JSON.stringify(payload),
        priority,
        maxAttempts,
        ackTimeout,
        payloadSize,
        consumerId: msg.consumerId || consumerId,
      };
    });

    // Build bulk INSERT with multiple VALUES (single query)
    const values: any[] = [];
    const placeholders: string[] = [];

    for (let i = 0; i < preparedMessages.length; i++) {
      const msg = preparedMessages[i];
      const baseIndex = i * 8;
      placeholders.push(
        `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7}, $${baseIndex + 8}, $${baseIndex + 5})`
      );
      values.push(
        msg.id,
        msg.queueName,
        msg.type,
        msg.payload,
        msg.priority,
        msg.maxAttempts,
        msg.ackTimeout,
        msg.payloadSize
      );
    }

    const result = await this.ctx.pgManager.query<QueueMessage>(
      `INSERT INTO ${tableName} (id, queue_name, type, payload, priority, max_attempts, ack_timeout_seconds, payload_size, original_priority)
       VALUES ${placeholders.join(", ")}
       RETURNING *`,
      values
    );

    const results = result.rows.map((row) => mapMessage(row));

    // Build activity log entries for bulk logging
    const activityEntries = results.map((message, i) => ({
      action: "enqueue",
      messageData: message,
      context: {
        queue_name: queueName,
        priority,
        payload_size: message.payload_size,
        batch_size: messages.length,
        consumer_id: preparedMessages[i].consumerId || null,
        buffered: this.buffer !== null, // Mark if this came from buffer
      },
    }));

    await this.logActivityBatch(activityEntries);

    // Run bulk operation anomaly detection
    await this.runDetection("bulk_operation", {
      operationType: "enqueue",
      affectedCount: messages.length,
      queueName,
      consumerId,
    });

    return results;
  }

  /**
   * Force flush all buffered messages (for graceful shutdown)
   */
  async flushBuffer(): Promise<void> {
    if (this.buffer) {
      await this.buffer.flushAll();
    }
  }
}
