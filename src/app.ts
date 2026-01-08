import createApp from "./lib/create-app";
import configureOpenApi from "./lib/configure-open-api";
import queue from "./routes/queue/queue.index";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "fs";
import { join } from "path";
import { apiKeyAuth } from "./middlewares/api-key";

// Create API app without base path
const apiApp = createApp();

// Apply API key authentication middleware to all API routes
// Note: Health check, SSE events, and docs endpoints are excluded from auth
apiApp.use("*", async (c, next) => {
  // Skip auth for health check, SSE events, and documentation endpoints
  // SSE events are read-only and EventSource doesn't support custom headers
  // Docs endpoints should be publicly accessible
  const path = c.req.path;
  if (
    path.endsWith("/health") ||
    path.endsWith("/queue/events") ||
    path.endsWith("/doc") ||
    path.endsWith("/docs") ||
    path.endsWith("/reference")
  ) {
    return next();
  }
  return apiKeyAuth()(c, next);
});


const routes = [queue];
configureOpenApi(apiApp);

routes.forEach((route) => {
  apiApp.route("/", route);
});

// Create main app
const mainApp = createApp();

// Mount API routes at /api (MOUNT THIS FIRST)
mainApp.route('/api', apiApp);

// Root redirect to dashboard
mainApp.get('/', (c) => {
  return c.redirect('/dashboard');
});

// Serve assets from dist
mainApp.use('/assets/*', serveStatic({ root: './dashboard-ui/dist' }));

// Dashboard route - serve index.html
mainApp.get('/dashboard', serveStatic({ path: './dashboard-ui/dist/index.html' }));

// Catch-all for other static files in dist root (like vite.svg, etc)
mainApp.use('/*', serveStatic({ root: './dashboard-ui/dist' }));

export default mainApp;
