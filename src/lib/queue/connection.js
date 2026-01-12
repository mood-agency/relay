import Redis from "ioredis";
import { logger } from "./utils.js";
import { MessageSecurity } from "./security.js";

/**
 * Manages Redis connections and subscribers.
 */
export class RedisConnectionManager {
  /**
   * Creates a new RedisConnectionManager instance.
   * @param {import('./config').QueueConfig} config - The queue configuration.
   */
  constructor(config) {
    this.config = config;
    this._redis = null;
    this._subscriber = null;
    this.security =
      config.enable_message_encryption && config.secret_key
        ? new MessageSecurity(config.secret_key)
        : null;
  }

  /**
   * Gets the main Redis client instance.
   * Initializes it if not already connected.
   * @returns {Redis} The Redis client.
   */
  get redis() {
    if (!this._redis) {
      const redisOptions = {
        host: this.config.redis_host,
        port: this.config.redis_port,
        db: this.config.redis_db,
        family: 0,
        retryStrategy: (times) => Math.min(times * 50, 2000), // Standard retry strategy
        maxRetriesPerRequest: 3, // Corresponds to some level of retry
        enableReadyCheck: true,
        // ioredis handles connection pooling implicitly when sharing a client instance
        // or you can use `new Redis.Cluster([...])` for cluster mode.
        // `max_connections` equivalent is managed by how many client instances you create or by cluster setup.
      };
      if (this.config.redis_password) {
        redisOptions.password = this.config.redis_password;
      }
      if (this.config.redis_tls) {
        redisOptions.tls = {};
      }
      this._redis = new Redis(redisOptions);

      this._redis.on("connect", () =>
        logger.info(
          `Connected to Redis at ${this.config.redis_host}:${this.config.redis_port}`
        )
      );
      this._redis.on("error", (err) =>
        logger.error(`Redis connection error: ${err}`)
      );
      this._redis.on("ready", () => logger.info("Redis client ready."));
    }
    return this._redis;
  }

  /**
   * Gets the Redis subscriber instance.
   * Initializes it if not already connected.
   * @returns {Redis} The Redis subscriber client.
   */
  get subscriber() {
    if (!this._subscriber) {
       // Duplicate the main connection options but for a dedicated subscriber
       const redisOptions = {
        host: this.config.redis_host,
        port: this.config.redis_port,
        db: this.config.redis_db,
        family: 0,
        retryStrategy: (times) => Math.min(times * 50, 2000),
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
      };
      if (this.config.redis_password) {
        redisOptions.password = this.config.redis_password;
      }
      if (this.config.redis_tls) {
        redisOptions.tls = {};
      }
      this._subscriber = new Redis(redisOptions);
      this._subscriber.setMaxListeners(0); // Allow unlimited listeners for SSE
      
      this._subscriber.on("connect", () => logger.info("Redis subscriber connected"));
      this._subscriber.on("error", (err) => logger.error(`Redis subscriber error: ${err}`));
    }
    return this._subscriber;
  }

  /**
   * Tests the Redis connection.
   * @returns {Promise<void>}
   * @throws {Error} If connection fails.
   */
  async testConnection() {
    try {
      await this.redis.ping();
      logger.info(
        `Successfully pinged Redis at ${this.config.redis_host}:${this.config.redis_port}`
      );
    } catch (e) {
      logger.error(`Redis connection test failed: ${e}`);
      throw e;
    }
  }

  /**
   * Creates a Redis pipeline.
   * @returns {import('ioredis').Pipeline} A new pipeline instance.
   */
  pipeline() {
    return this.redis.pipeline();
  }

  /**
   * Disconnects from Redis (both main and subscriber).
   * @returns {Promise<void>}
   */
  async disconnect() {
    if (this._redis) {
      await this._redis.quit();
      this._redis = null;
      logger.info("Disconnected from Redis.");
    }
    if (this._subscriber) {
      await this._subscriber.quit();
      this._subscriber = null;
      logger.info("Disconnected Redis subscriber.");
    }
  }
}
