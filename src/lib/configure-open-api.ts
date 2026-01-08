import type { AppOpenAPI } from "../config/types";
import { apiReference } from "@scalar/hono-api-reference";
import env from "../config/env";

export default function configureOpenApi(app: AppOpenAPI) {
  const openApiSpec = {
    openapi: "3.1.0",
    info: {
      title: "Redis Queue API",
      version: "1.0.0",
    },
  };
  app.doc("/doc", openApiSpec);
  app.doc("/docs", openApiSpec);
  app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
    type: "http",
    scheme: "bearer",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "APIKey", {
    type: "apiKey",
    in: "header",
    name: "X-API-KEY",
  });
  app.get(
    "/reference",
    apiReference({
      url: "/api/doc",
      theme: "kepler",
      metaData: {
        title: "Redis Queue API",
        version: "1.0.0",
      },
      defaultHttpClient: {
        targetKey: "node",
        clientKey: "fetch",
      },
      authentication: {
        preferredSecurityScheme: "APIKey",
        apiKey: {
          token: env.SECRET_KEY || "",
        },
      },
    })
  );
}
