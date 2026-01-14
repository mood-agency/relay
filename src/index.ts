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
    const overdueCheckIntervalMs = env.OVERDUE_CHECK_INTERVAL_MS;

    const tick = async () => {
      try {
        await queue.requeueFailedMessages();
      } catch (error) {
        logger.error({ err: error }, "Overdue requeue worker failed");
      }

      // Schedule next tick
      const nextTick = setTimeout(tick, overdueCheckIntervalMs);
      nextTick.unref?.();
    };

    // Start the worker
    tick();
    logger.info(
      `Overdue requeue worker started (interval=${overdueCheckIntervalMs}ms, ackTimeout=${env.ACK_TIMEOUT_SECONDS}s)`
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
