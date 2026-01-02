import { nanoid } from "nanoid";

/**
 * Generates a 10-character URL-safe string using NanoID.
 * @returns {string} A unique ID.
 */
export const generateId = () => nanoid(10);

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
