import { serve } from "@hono/node-server";
import app from "./app";
import { initializeEnv } from "./config/env";
import { createLogger } from "./lib/logger";
import { getQueue } from "./routes/queue/queue.handlers";

const logger = createLogger("server");

// Initialize and start server
(async () => {
  // Initialize environment variables from Infisical (if configured)
  await initializeEnv();

  // Import env after initialization to get updated values
  const { default: env } = await import("./config/env");

  const initializeDatabase = async () => {
    try {
      const queue = await getQueue();

      // Initialize database schema (creates tables if they don't exist)
      await queue.pgManager.initializeSchema();
      logger.info("Database schema initialized");

      // Verify connection
      const health = await queue.healthCheck();
      if (health.status === "healthy") {
        logger.info(
          { latency: health.postgres?.latency },
          "PostgreSQL connection successful"
        );
      } else {
        throw new Error(health.postgres?.error || "Connection failed");
      }
    } catch (error) {
      logger.error({ err: error }, "Database initialization failed");
      process.exit(1);
    }
  };

  // Advisory lock ID for distributed requeue worker coordination
  // Only one instance should run the requeue worker at a time
  const REQUEUE_WORKER_LOCK_ID = 12345678;

  const startOverdueRequeueWorker = async () => {
    const overdueCheckIntervalMs = env.OVERDUE_CHECK_INTERVAL_MS;
    const queue = await getQueue();

    logger.info(
      `Overdue requeue worker started (interval=${overdueCheckIntervalMs}ms, ackTimeout=${env.ACK_TIMEOUT_SECONDS}s)`
    );

    const tick = async () => {
      try {
        // Try to acquire advisory lock (non-blocking)
        // This ensures only one instance runs the requeue worker across multiple deployments
        const lockResult = await queue.pgManager.query(
          "SELECT pg_try_advisory_lock($1) as acquired",
          [REQUEUE_WORKER_LOCK_ID]
        );

        if (!lockResult.rows[0]?.acquired) {
          // Another instance has the lock - skip this tick
          logger.debug("Requeue worker lock held by another instance, skipping");
        } else {
          try {
            await queue.requeueFailedMessages();
          } finally {
            // Release the lock after processing
            await queue.pgManager.query(
              "SELECT pg_advisory_unlock($1)",
              [REQUEUE_WORKER_LOCK_ID]
            );
          }
        }
      } catch (error) {
        logger.error({ err: error }, "Overdue requeue worker failed");
      }

      // Schedule next tick
      setTimeout(tick, overdueCheckIntervalMs);
    };

    // Start the first tick immediately
    await tick();
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
      await initializeDatabase();
      await startOverdueRequeueWorker();
    }
  );
})();
