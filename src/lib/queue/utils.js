import { nanoid } from "nanoid";
import { createLogger as createPinoLogger, logger as rootLogger } from "../logger.js";

/**
 * Generates a 10-character URL-safe string using NanoID.
 * @returns {string} A unique ID.
 */
export const generateId = () => nanoid(10);

/**
 * Creates a namespaced logger using Pino.
 * @param {string} namespace - The logger namespace/prefix.
 * @returns {import('pino').Logger} Pino child logger instance with the namespace.
 */
export const createLogger = (namespace) => createPinoLogger(namespace);

/**
 * Default logger instance.
 * Prefer using createLogger() with a namespace for better log organization.
 * @type {import('pino').Logger}
 */
export const logger = rootLogger;
