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

// Dashboard route handler
const serveDashboard = (c: any) => {
  try {
    // Try multiple possible paths for the dashboard file
    const possiblePaths = [
      join(process.cwd(), 'public', 'dashboard.html'),  // Development
      join(__dirname, '..', 'public', 'dashboard.html'), // Production (dist folder)
      join(process.cwd(), 'dist', 'public', 'dashboard.html'), // Alternative production path
    ];
    
    let dashboardContent = '';
    
    for (const path of possiblePaths) {
      try {
        dashboardContent = readFileSync(path, 'utf-8');
        break;
      } catch (err) {
        // Continue to next path
      }
    }
    
    if (!dashboardContent) {
      return c.text('Dashboard file not found. Tried paths: ' + possiblePaths.join(', '), 404);
    }
    
    return c.html(dashboardContent);
  } catch (error) {
    return c.text('Dashboard error: ' + (error as Error).message, 500);
  }
};

// Dashboard routes - handle both /dashboard and /dashboard.html
mainApp.get('/dashboard', serveDashboard);
mainApp.get('/dashboard.html', serveDashboard);

// Root redirect to dashboard
mainApp.get('/', (c) => {
  return c.redirect('/dashboard');
});

// Mount API routes at /api
mainApp.route('/api', apiApp);

export default mainApp;
