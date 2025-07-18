import createApp from "@/lib/create-app";
import configureOpenApi from "@/lib/configure-open-api";
import queue from "@/routes/queue/queue.index";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync } from "fs";
import { join } from "path";

// Create API app without base path
const apiApp = createApp();

const routes = [queue];
configureOpenApi(apiApp);

routes.forEach((route) => {
  apiApp.route("/", route);
});

// Create main app
const mainApp = createApp();

// Serve static files from public directory
mainApp.use('/public/*', serveStatic({ root: './' }));

// Dashboard route
mainApp.get('/dashboard', (c) => {
  try {
    const dashboardPath = join(process.cwd(), 'public', 'dashboard.html');
    const dashboardContent = readFileSync(dashboardPath, 'utf-8');
    return c.html(dashboardContent);
  } catch (error) {
    return c.text('Dashboard not found', 404);
  }
});

// Root redirect to dashboard
mainApp.get('/', (c) => {
  return c.redirect('/dashboard');
});

// Mount API routes at /api
mainApp.route('/api', apiApp);

export default mainApp;
