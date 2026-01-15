import { nanoid } from "nanoid";

/**
 * Generates a 10-character URL-safe string using NanoID.
 * @returns {string} A unique ID.
 */
export const generateId = () => nanoid(10);

/**
 * Creates a namespaced logger.
 * @param {string} namespace - The logger namespace/prefix.
 * @returns {object} Logger instance with info, error, warn, debug methods.
 */
export const createLogger = (namespace) => ({
  info: (ctx, message) => {
    const msg = typeof ctx === "string" ? ctx : message;
    const data = typeof ctx === "object" ? ctx : null;
    console.log(`[INFO] [${namespace}] ${new Date().toISOString()} - ${msg}`, data ? JSON.stringify(data) : "");
  },
  error: (ctx, message) => {
    const msg = typeof ctx === "string" ? ctx : message;
    const data = typeof ctx === "object" ? ctx : null;
    console.error(`[ERROR] [${namespace}] ${new Date().toISOString()} - ${msg}`, data ? JSON.stringify(data) : "");
  },
  warn: (ctx, message) => {
    const msg = typeof ctx === "string" ? ctx : message;
    const data = typeof ctx === "object" ? ctx : null;
    console.warn(`[WARN] [${namespace}] ${new Date().toISOString()} - ${msg}`, data ? JSON.stringify(data) : "");
  },
  debug: (ctx, message) => {
    const msg = typeof ctx === "string" ? ctx : message;
    const data = typeof ctx === "object" ? ctx : null;
    console.log(`[DEBUG] [${namespace}] ${new Date().toISOString()} - ${msg}`, data ? JSON.stringify(data) : "");
  },
});

/**
 * Simple logger implementation.
 * @namespace logger
 */
export const logger = {
  /**
   * Logs an info message.
   * @param {string} message - The message to log.
   */
  info: (message) =>
    console.log(`[INFO] ${new Date().toISOString()} - ${message}`),

  /**
   * Logs an error message.
   * @param {string} message - The message to log.
   */
  error: (message) =>
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`),

  /**
   * Logs a warning message.
   * @param {string} message - The message to log.
   */
  warn: (message) =>
    console.warn(`[WARN] ${new Date().toISOString()} - ${message}`),

  /**
   * Logs a debug message.
   * @param {string} message - The message to log.
   */
  debug: (message) =>
    console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`),
};
