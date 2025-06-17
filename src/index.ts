import { serve } from '@hono/node-server';
import app from './app';
import env from './config/env';
import { pino } from 'pino';

const logger = pino({
  level: 'debug',
});

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    logger.info(`Server is running on ${env.APP_URL}:${info.port}`);
    logger.info(`Docs: ${env.APP_URL}/api/reference`);
    if (env.NODE_ENV !== 'production') {
      logger.debug({ msg: 'ENVs:', env });
    }
  }
);
