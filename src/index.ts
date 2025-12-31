import { serve } from "@hono/node-server";
import app from "./app";
import env from "./config/env";
import { pino } from "pino";
import { queue } from "./routes/queue/queue.handlers";

const logger = pino({
  level: "debug",
});

// Test Redis connection before starting server
import Redis from "ioredis";

const testRedisConnection = async () => {
  const redis = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    password: env.REDIS_PASSWORD || undefined,
    db: env.REDIS_DB,
    family: 0,
  });

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
  const intervalMs = Math.max(
    1000,
    Math.min(5000, Math.floor(env.ACK_TIMEOUT_SECONDS * 1000))
  );

  const tick = async () => {
    try {
      await queue.requeueFailedMessages();
    } catch (error) {
      logger.error({ err: error }, "Overdue requeue worker failed");
    }
  };

  tick();
  const interval = setInterval(tick, intervalMs);
  interval.unref?.();
  logger.info(
    `Overdue requeue worker started (interval=${intervalMs}ms, ackTimeout=${env.ACK_TIMEOUT_SECONDS}s)`
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
