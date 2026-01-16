import pg from "pg";
import { createLogger } from "./utils.js";

const logger = createLogger("pg-connection");

export interface PgConnectionConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number; // pool size (total or write pool if read pool is configured)
  maxRead?: number; // read pool size (optional, enables read/write separation)
  ssl?: boolean;
}

export class PgConnectionManager {
  private writePool: pg.Pool;
  private readPool: pg.Pool | null = null;
  private listenerClient: pg.Client | null = null;
  private listeners: Map<string, Set<(payload: string) => void>> = new Map();
  public config: PgConnectionConfig;

  constructor(config: PgConnectionConfig) {
    this.config = config;

    const basePoolConfig = {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      // Prevent deadlocks from hanging forever
      statement_timeout: 30000, // 30 seconds
      lock_timeout: 10000, // 10 seconds
    };

    // Write pool (priority operations: enqueue, dequeue, ack)
    this.writePool = new pg.Pool({
      ...basePoolConfig,
      max: config.max || 10,
    });

    this.writePool.on("error", (err) => {
      logger.error({ err }, "Unexpected error on write pool client");
    });

    // Read pool (optional, for dashboard queries, metrics, logs)
    if (config.maxRead && config.maxRead > 0) {
      this.readPool = new pg.Pool({
        ...basePoolConfig,
        max: config.maxRead,
      });

      this.readPool.on("error", (err) => {
        logger.error({ err }, "Unexpected error on read pool client");
      });

      logger.info(
        { writePool: config.max || 10, readPool: config.maxRead },
        "Initialized with separate read/write pools"
      );
    }
  }

  /**
   * @deprecated Use query() instead. This getter is for backwards compatibility.
   */
  private get pool(): pg.Pool {
    return this.writePool;
  }

  /**
   * Execute a query on the write pool.
   * Use this for all write operations (INSERT, UPDATE, DELETE)
   * and for read operations that require strong consistency.
   */
  async query<T extends pg.QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<pg.QueryResult<T>> {
    const start = Date.now();
    const result = await this.writePool.query<T>(text, params);
    const duration = Date.now() - start;
    if (duration > 100) {
      logger.debug({ text: text.substring(0, 100), duration, rows: result.rowCount }, "Slow query");
    }
    return result;
  }

  /**
   * Execute a query on the read pool (if configured) or fall back to write pool.
   * Use this for read-only queries like dashboard data, metrics, logs.
   * These queries won't block critical write operations.
   */
  async queryRead<T extends pg.QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<pg.QueryResult<T>> {
    const pool = this.readPool || this.writePool;
    const start = Date.now();
    const result = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    if (duration > 100) {
      logger.debug({ text: text.substring(0, 100), duration, rows: result.rowCount, pool: this.readPool ? "read" : "write" }, "Slow read query");
    }
    return result;
  }

  async getClient(): Promise<pg.PoolClient> {
    return this.writePool.connect();
  }

  async getReadClient(): Promise<pg.PoolClient> {
    return (this.readPool || this.writePool).connect();
  }

  async transaction<T>(
    fn: (client: pg.PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.writePool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async subscribe(
    channel: string,
    callback: (payload: string) => void
  ): Promise<() => void> {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(callback);

    // Create listener client if not exists
    if (!this.listenerClient) {
      logger.info("Creating new PostgreSQL listener client");
      this.listenerClient = new pg.Client({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      });

      await this.listenerClient.connect();
      logger.info("PostgreSQL listener client connected successfully");

      this.listenerClient.on("notification", (msg) => {
        logger.info({ channel: msg.channel, payloadLength: msg.payload?.length }, "Received PostgreSQL notification");
        const listeners = this.listeners.get(msg.channel);
        if (listeners && msg.payload) {
          logger.info({ channel: msg.channel, listenerCount: listeners.size }, "Forwarding to listeners");
          for (const listener of listeners) {
            try {
              listener(msg.payload);
            } catch (err) {
              logger.error({ err, channel: msg.channel }, "Error in notification listener");
            }
          }
        } else {
          logger.warn({ channel: msg.channel, hasListeners: !!listeners, hasPayload: !!msg.payload }, "No listeners or no payload");
        }
      });

      this.listenerClient.on("error", (err) => {
        logger.error({ err }, "Listener client error");
      });
    }

    // Subscribe to channel
    await this.listenerClient.query(`LISTEN ${channel}`);
    logger.info({ channel }, "Subscribed to PostgreSQL channel");

    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(channel);
      if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) {
          this.listenerClient?.query(`UNLISTEN ${channel}`).catch(() => {});
          this.listeners.delete(channel);
        }
      }
    };
  }

  async notify(channel: string, payload: object): Promise<void> {
    const payloadStr = JSON.stringify(payload);
    await this.query("SELECT pg_notify($1, $2)", [channel, payloadStr]);
  }

  async disconnect(): Promise<void> {
    if (this.listenerClient) {
      await this.listenerClient.end();
      this.listenerClient = null;
    }
    if (this.readPool) {
      await this.readPool.end();
    }
    await this.writePool.end();
    logger.info("PostgreSQL connection pools closed");
  }

  async healthCheck(): Promise<{ ok: boolean; latency?: number; error?: string; pools?: { write: boolean; read: boolean } }> {
    const start = Date.now();
    try {
      await this.query("SELECT 1");
      const writeOk = true;
      let readOk = true;

      if (this.readPool) {
        try {
          await this.readPool.query("SELECT 1");
        } catch {
          readOk = false;
        }
      }

      return {
        ok: writeOk && readOk,
        latency: Date.now() - start,
        pools: { write: writeOk, read: readOk },
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async initializeSchema(): Promise<void> {
    const fs = await import("fs");
    const path = await import("path");

    const schemaPath = path.join(__dirname, "schema.sql");

    const schema = fs.readFileSync(schemaPath, "utf-8");

    // Schema uses CREATE TABLE IF NOT EXISTS, so it's safe to run multiple times
    await this.query(schema);
    logger.info("PostgreSQL schema initialized");
  }
}
