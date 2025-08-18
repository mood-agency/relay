import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "../lib/create-app";
import { jsonContent } from "stoker/openapi/helpers";

const router = createRouter().openapi(
  createRoute({
    tags: ["index"],
    description: "Redis Queue API Index",
    method: "get",
    path: "/",
    responses: {
      200: jsonContent(
        z.object({
          message: z.string(),
        }),
        "Redis Queue API Index"
      ),
    },
  }),
  (c) => {
    return c.json({
      message: "Redis Queue API Index",
    });
  }
);

export default router;
