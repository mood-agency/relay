import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { notFound, onError, serveEmojiFavicon } from "stoker/middlewares";
import { defaultHook } from "stoker/openapi";
import { pinoLogger } from "@/middlewares/pino-logger";
import { AppBindings } from "@/config/types";

export function createRouter() {
  return new OpenAPIHono<AppBindings>({
    strict: false,
    defaultHook,
  });
}

export default function createApp() {
  const app = createRouter();
  app.use(serveEmojiFavicon("💬"));
  app.use(pinoLogger());

  app.use(cors());

  app.notFound(notFound);
  app.onError(onError);

  return app;
}
