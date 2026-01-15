import { createLogger } from "../utils.js";

const logger = createLogger("event-emitter");

export interface QueueMessage {
  id: string;
  type: string;
  priority: number;
  payload: unknown;
  status: string;
  queue_name: string;
  created_at: number;
  attempt_count: number;
}

export interface QueueEvent {
  type: string;
  queue: string;
  timestamp: number;
  payload: Record<string, unknown>;
}

type EventCallback = (event: QueueEvent) => void;

/**
 * EventEmitterService - Polling-based event emitter for SSE
 *
 * This service polls PostgreSQL for changes and emits events to all connected SSE clients.
 * It's designed to work with serverless PostgreSQL (like Neon) which doesn't support LISTEN/NOTIFY reliably.
 *
 * Architecture:
 * - Single polling loop shared by all SSE connections
 * - Tracks message IDs per status to detect new/removed messages
 * - Emits granular events with actual message data for highlights
 */
export class EventEmitterService {
  private listeners: Set<EventCallback> = new Set();
  private pollInterval: NodeJS.Timeout | null = null;
  private lastMessageIds: Map<string, Set<string>> = new Map(); // key: "queue:status", value: Set of message IDs
  private pollIntervalMs: number;
  private queryFn: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  private isPolling = false;

  constructor(
    queryFn: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>,
    pollIntervalMs: number = 1000
  ) {
    this.queryFn = queryFn;
    this.pollIntervalMs = pollIntervalMs;
  }

  /**
   * Subscribe to queue events
   * Returns an unsubscribe function
   */
  subscribe(callback: EventCallback): () => void {
    this.listeners.add(callback);
    logger.info({ listenerCount: this.listeners.size }, "New SSE listener subscribed");

    // Start polling if this is the first listener
    if (this.listeners.size === 1) {
      this.startPolling();
    }

    return () => {
      this.listeners.delete(callback);
      logger.info({ listenerCount: this.listeners.size }, "SSE listener unsubscribed");

      // Stop polling if no more listeners
      if (this.listeners.size === 0) {
        this.stopPolling();
      }
    };
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: QueueEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        logger.error({ err }, "Error in event listener");
      }
    }
  }

  /**
   * Start the polling loop
   */
  private startPolling(): void {
    if (this.pollInterval) return;

    logger.info({ intervalMs: this.pollIntervalMs }, "Starting event polling");

    // Do an initial poll immediately (silent, just to build initial state)
    this.poll(true).catch(err => logger.error({ err }, "Initial poll failed"));

    this.pollInterval = setInterval(() => {
      this.poll(false).catch(err => logger.error({ err }, "Poll failed"));
    }, this.pollIntervalMs);
  }

  /**
   * Stop the polling loop
   */
  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      this.lastMessageIds.clear();
      logger.info("Stopped event polling");
    }
  }

  /**
   * Poll PostgreSQL for changes
   * @param silent If true, don't emit events (used for initial state building)
   */
  private async poll(silent: boolean = false): Promise<void> {
    if (this.isPolling) return; // Prevent overlapping polls
    this.isPolling = true;

    try {
      // Get recent messages with their IDs and basic info
      // We limit to recent messages to avoid memory issues
      // Note: Using ::float8 instead of ::bigint because pg driver returns bigint as string
      const result = await this.queryFn(`
        SELECT
          id,
          type,
          priority,
          payload,
          status,
          queue_name,
          EXTRACT(EPOCH FROM created_at)::float8 as created_at,
          attempt_count
        FROM messages
        WHERE created_at > NOW() - INTERVAL '5 minutes'
        ORDER BY created_at DESC
        LIMIT 500
      `);

      const currentMessages = result.rows as QueueMessage[];

      // Build current snapshot: Map of "queue:status" -> Set of message IDs
      const currentSnapshot = new Map<string, Set<string>>();
      const messageById = new Map<string, QueueMessage>();

      for (const msg of currentMessages) {
        const key = `${msg.queue_name}:${msg.status}`;
        if (!currentSnapshot.has(key)) {
          currentSnapshot.set(key, new Set());
        }
        currentSnapshot.get(key)!.add(msg.id);
        messageById.set(msg.id, msg);
      }

      // Compare with last snapshot and emit events (unless silent)
      if (!silent && this.lastMessageIds.size > 0) {
        this.detectChanges(currentSnapshot, messageById);
      }

      this.lastMessageIds = currentSnapshot;
    } catch (err) {
      logger.error({ err }, "Failed to poll for changes");
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Detect changes between snapshots and emit appropriate events
   */
  private detectChanges(
    currentSnapshot: Map<string, Set<string>>,
    messageById: Map<string, QueueMessage>
  ): void {
    const allKeys = new Set([...this.lastMessageIds.keys(), ...currentSnapshot.keys()]);

    for (const key of allKeys) {
      const [queueName, status] = key.split(":");
      const oldIds = this.lastMessageIds.get(key) || new Set();
      const newIds = currentSnapshot.get(key) || new Set();

      // Find new messages (in current but not in previous)
      const addedIds: string[] = [];
      for (const id of newIds) {
        if (!oldIds.has(id)) {
          addedIds.push(id);
        }
      }

      // Find removed messages (in previous but not in current)
      const removedIds: string[] = [];
      for (const id of oldIds) {
        if (!newIds.has(id)) {
          removedIds.push(id);
        }
      }

      // Emit events for new messages
      if (addedIds.length > 0) {
        const newMessages = addedIds
          .map(id => messageById.get(id))
          .filter((m): m is QueueMessage => m !== undefined);

        const event: QueueEvent = {
          type: this.getEventTypeForAdd(status),
          queue: queueName,
          timestamp: Date.now(),
          payload: {
            status,
            count: addedIds.length,
            ids: addedIds,
            messages: newMessages.map(m => ({
              id: m.id,
              type: m.type,
              priority: m.priority,
              payload: m.payload,
              // Ensure created_at is a number (pg driver may return bigint as string)
              created_at: typeof m.created_at === 'string' ? parseFloat(m.created_at) : m.created_at,
              attempt_count: m.attempt_count,
            })),
            force_refresh: false, // Allow incremental updates with highlight
          },
        };

        logger.debug({ type: event.type, queue: queueName, count: addedIds.length }, "Emitting add event");
        this.emit(event);
      }

      // Emit events for removed messages
      if (removedIds.length > 0) {
        const event: QueueEvent = {
          type: this.getEventTypeForRemove(status),
          queue: queueName,
          timestamp: Date.now(),
          payload: {
            status,
            count: removedIds.length,
            ids: removedIds,
            force_refresh: false,
          },
        };

        logger.debug({ type: event.type, queue: queueName, count: removedIds.length }, "Emitting remove event");
        this.emit(event);
      }
    }
  }

  /**
   * Determine event type for added messages based on status
   */
  private getEventTypeForAdd(status: string): string {
    switch (status) {
      case "queued":
        return "enqueue";
      case "processing":
        return "dequeue";
      case "acknowledged":
        return "acknowledge";
      case "dead":
        return "move_to_dlq";
      case "archived":
        return "archive";
      default:
        return "update";
    }
  }

  /**
   * Determine event type for removed messages based on status
   */
  private getEventTypeForRemove(status: string): string {
    switch (status) {
      case "queued":
        return "dequeue"; // Message left queued state
      case "processing":
        return "processed"; // Message left processing state
      case "dead":
        return "requeue"; // Message left dead state
      case "acknowledged":
        return "archive"; // Message left acknowledged state
      default:
        return "delete";
    }
  }

  /**
   * Manually trigger an event (useful for operations that need immediate notification)
   */
  triggerEvent(event: QueueEvent): void {
    logger.debug({ event }, "Manually triggered event");
    this.emit(event);
  }

  /**
   * Force a poll (useful after operations that should trigger immediate updates)
   */
  async forcePoll(): Promise<void> {
    await this.poll(false);
  }

  /**
   * Get current listener count
   */
  getListenerCount(): number {
    return this.listeners.size;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stopPolling();
    this.listeners.clear();
    this.lastMessageIds.clear();
  }
}
