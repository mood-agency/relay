import pino from "pino";
import pretty from "pino-pretty";

// Get log level from environment, defaulting to 'info'
// We access process.env directly to avoid circular dependency with env.ts
const LOG_LEVEL = process.env.LOG_LEVEL || "info";
const NODE_ENV = process.env.NODE_ENV || "development";

/**
 * Root Pino logger instance configured for the application.
 * - Uses pino-pretty in development for readable output
 * - Uses JSON format in production for structured logging
 */
export const rootLogger = pino(
  {
    level: LOG_LEVEL,
    // Add base fields that appear in every log
    base: {
      pid: process.pid,
    },
  },
  NODE_ENV === "production" ? undefined : pretty({
    colorize: true,
    translateTime: "SYS:standard",
    ignore: "pid,hostname",
  })
);

/**
 * Creates a child logger with a specific namespace.
 * Child loggers inherit the parent's configuration and add the namespace field.
 *
 * @param namespace - The namespace/module name for the logger
 * @returns A Pino child logger instance
 *
 * @example
 * const logger = createLogger("pg-queue");
 * logger.info({ messageId: "123" }, "Message enqueued");
 * // Output: [INFO] [pg-queue] Message enqueued { messageId: "123" }
 */
export function createLogger(namespace: string) {
  return rootLogger.child({ namespace });
}

/**
 * Default logger instance for general use.
 * Prefer using createLogger() with a namespace for better log organization.
 */
export const logger = rootLogger;

export default rootLogger;
