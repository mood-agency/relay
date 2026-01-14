import { RedisConnectionManager } from "./connection.js";
import * as helpers from "./helpers.js";
import * as producer from "./producer.js";
import * as consumer from "./consumer.js";
import * as admin from "./admin.js";
import * as metrics from "./metrics.js";
import * as activity from "./activity.js";

/**
 * Optimized Redis Queue implementation using Streams.
 * This class composes functionality from various modules to keep code modular.
 */
export class OptimizedRedisQueue {
  /**
   * Creates a new OptimizedRedisQueue instance.
   * @param {import('./config').QueueConfig} config - The queue configuration.
   */
  constructor(config) {
    this.config = config;
    this.redisManager = new RedisConnectionManager(config);
    this._stats = {
      enqueued: 0,
      dequeued: 0,
      acknowledged: 0,
      failed: 0,
      requeued: 0,
    };
    // Cache for consumer group existence (reduces NOGROUP errors)
    this._consumerGroupsExist = new Set();
  }

  /**
   * Marks a consumer group as existing (called after successful creation or first use).
   * @param {string} streamName - The stream name.
   */
  markConsumerGroupExists(streamName) {
    this._consumerGroupsExist.add(streamName);
  }

  /**
   * Checks if a consumer group is known to exist.
   * @param {string} streamName - The stream name.
   * @returns {boolean} True if the group is known to exist.
   */
  isConsumerGroupKnown(streamName) {
    return this._consumerGroupsExist.has(streamName);
  }

  /**
   * Clears the consumer group cache (useful for testing or reconnection).
   */
  clearConsumerGroupCache() {
    this._consumerGroupsExist.clear();
  }
}

// Attach methods to prototype to maintain the original API surface
Object.assign(OptimizedRedisQueue.prototype, helpers);
Object.assign(OptimizedRedisQueue.prototype, producer);
Object.assign(OptimizedRedisQueue.prototype, consumer);
Object.assign(OptimizedRedisQueue.prototype, admin);
Object.assign(OptimizedRedisQueue.prototype, metrics);
Object.assign(OptimizedRedisQueue.prototype, activity);