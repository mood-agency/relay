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
  // return next();
});

const routes = [queue];
configureOpenApi(apiApp);

routes.forEach((route) => {
  apiApp.route("/", route);
});

// Create main app
const mainApp = createApp();

// Mount API routes at /api (MOUNT THIS FIRST)
mainApp.route("/api", apiApp);

// Root redirect to dashboard
mainApp.get("/", (c) => {
  return c.redirect("/dashboard");
});

// Serve assets from dist
mainApp.use("/assets/*", serveStatic({ root: "./dashboard-ui/dist" }));

// Dashboard route - serve index.html
mainApp.get(
  "/dashboard",
  serveStatic({ path: "./dashboard-ui/dist/index.html" }),
);

// SPA fallback - override notFound to serve index.html for client-side routing
mainApp.notFound(async (c) => {
  const path = c.req.path;

  // Don't serve SPA for API routes - return proper 404
  if (path.startsWith("/api/")) {
    return c.json({ message: `Not Found - ${path}` }, 404);
  }

  // Try to serve static file from dist root first (like vite.svg, favicon.ico)
  const staticFilePath = join(process.cwd(), "dashboard-ui/dist", path);
  try {
    const { statSync } = await import("fs");
    const stat = statSync(staticFilePath);
    if (stat.isFile()) {
      const content = readFileSync(staticFilePath);
      // Set content type based on extension
      const ext = path.split(".").pop()?.toLowerCase();
      const mimeTypes: Record<string, string> = {
        svg: "image/svg+xml",
        ico: "image/x-icon",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        js: "application/javascript",
        css: "text/css",
        json: "application/json",
      };
      const contentType = mimeTypes[ext || ""] || "application/octet-stream";
      return c.body(content, 200, { "Content-Type": contentType });
    }
  } catch {
    // File doesn't exist, fall through to SPA
  }

  // Serve index.html for SPA routing
  try {
    const indexHtml = readFileSync(
      join(process.cwd(), "dashboard-ui/dist/index.html"),
      "utf-8",
    );
    return c.html(indexHtml);
  } catch {
    return c.json(
      { message: "Dashboard not built. Run: pnpm dashboard:build" },
      404,
    );
  }
});

export default mainApp;
