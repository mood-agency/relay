import { logger } from 'hono-pino';
import { rootLogger } from '../lib/logger';

export function pinoLogger() {
  return logger({
    pino: rootLogger,
    http: {
      reqId: () => crypto.randomUUID(),
    },
  });
}
