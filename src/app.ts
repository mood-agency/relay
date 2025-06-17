import createApp from "@/lib/create-app";
import configureOpenApi from "@/lib/configure-open-api";
import queue from "@/routes/queue/queue.index";
const app = createApp().basePath("/api");

const routes = [queue];
configureOpenApi(app);

routes.forEach((route) => {
  app.route("/", route);
});

export default app;
