import pg from 'pg';
import { createLogger } from './logger.js';

const { Pool } = pg;
const logger = createLogger('db');

// Singleton pool instance
let pool = null;

/**
 * Initializes the Postgres connection pool.
 * @param {Object} config - The database configuration.
 * @param {string} config.connectionString - The connection string.
 * @param {number} [config.max=10] - The max pool size.
 */
export function initDB(config) {
  if (pool) {
    return pool;
  }

  pool = new Pool({
    connectionString: config.connectionString,
    max: config.max || 10,
  });

  pool.on('error', (err, client) => {
    logger.error({ err }, 'Unexpected error on idle client');
    // Don't exit process, let the pool handle it or reconnect
  });

  logger.info({ max: config.max || 10 }, 'Initialized Postgres pool');
  return pool;
}

/**
 * Gets the existing pool instance.
 * @returns {import('pg').Pool} The pool instance.
 */
export function getPool() {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initDB first.');
  }
  return pool;
}

/**
 * Closes the pool.
 */
export async function closeDB() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Postgres pool closed');
  }
}

/**
 * Helper to run a query.
 * @param {string} text - The query text.
 * @param {Array} params - The query parameters.
 * @returns {Promise<import('pg').QueryResult>} The query result.
 */
export async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

/**
 * Helper to get a client from the pool (for transactions).
 * @returns {Promise<import('pg').PoolClient>} The pool client.
 */
export async function getClient() {
  const p = getPool();
  return p.connect();
}
