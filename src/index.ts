import { serve } from "@hono/node-server";
import app from "./app";
import { initializeEnv } from "./config/env";
import { pino } from "pino";
import { queue } from "./routes/queue/queue.handlers";

const logger = pino({
  level: "debug",
});

// Test Redis connection before starting server
import Redis from "ioredis";

// Initialize Infisical and start server
(async () => {
  // Initialize environment variables from Infisical (if configured)
  await initializeEnv();
  
  // Import env after initialization to get updated values
  const { default: env } = await import("./config/env");
  
  const testRedisConnection = async () => {
    const redisOptions: Parameters<typeof Redis>[0] = {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD || undefined,
      db: env.REDIS_DB,
      family: 0,
    };
    if (env.REDIS_TLS === "true") {
      redisOptions.tls = {};
    }
    const redis = new Redis(redisOptions);

    try {
      await redis.ping();
      logger.info("Redis connection successful");
    } catch (error) {
      logger.error({ err: error }, "Redis connection failed");
      process.exit(1);
    } finally {
      await redis.quit();
    }
  };

  const startOverdueRequeueWorker = () => {
    const baseIntervalMs = Math.max(
      1000,
      Math.min(5000, Math.floor(env.ACK_TIMEOUT_SECONDS * 1000))
    );
    const maxBackoffMs = 30000; // Max 30 seconds between checks when idle
    let currentIntervalMs = baseIntervalMs;

    const tick = async () => {
      try {
        const requeuedCount = await queue.requeueFailedMessages();

        if (requeuedCount > 0) {
          // Activity detected - reset to base interval
          currentIntervalMs = baseIntervalMs;
        } else {
          // No activity - apply exponential backoff
          currentIntervalMs = Math.min(currentIntervalMs * 1.5, maxBackoffMs);
        }
      } catch (error) {
        logger.error({ err: error }, "Overdue requeue worker failed");
        // On error, use base interval to retry sooner
        currentIntervalMs = baseIntervalMs;
      }

      // Schedule next tick with dynamic interval
      const nextTick = setTimeout(tick, currentIntervalMs);
      nextTick.unref?.();
    };

    // Start the worker
    tick();
    logger.info(
      `Overdue requeue worker started (baseInterval=${baseIntervalMs}ms, maxBackoff=${maxBackoffMs}ms, ackTimeout=${env.ACK_TIMEOUT_SECONDS}s)`
    );
  };
  
  serve(
    {
      fetch: app.fetch,
      port: env.PORT,
    },
    async (info) => {
      logger.info(`Server is running on ${env.APP_URL}:${info.port}`);
      logger.info(`Docs: ${env.APP_URL}/api/reference`);
      if (env.NODE_ENV !== "production") {
        logger.debug({ msg: "ENVs:", env });
      }
      await testRedisConnection();
      startOverdueRequeueWorker();
    }
  );
})();
