import { z } from "zod";
import { config } from "dotenv";
import { expand } from "dotenv-expand";
import { InfisicalSDK } from "@infisical/sdk";

// Load dotenv as fallback for local development
expand(config());

export const EnvSchema = z.object({
  // General
  NODE_ENV: z
    .enum(["development", "production", "local", "test"])
    .default("development"),
  APP_URL: z.string().optional().default("http://localhost"),
  PORT: z.coerce.number().default(3001),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),


  // Redis
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().nullable(),
  REDIS_DB: z.coerce.number().default(0),
  REDIS_POOL_SIZE: z.coerce.number().default(10),
  REDIS_TLS: z.string().default("false"),

  // Postgres
  DATABASE_URL: z.string().default("postgresql://postgres:postgres@localhost:5432/queue_db"),
  PG_POOL_SIZE: z.coerce.number().default(10),

  
  // Queue Configuration
  QUEUE_NAME: z.string().default("queue"),
  // These names might be less relevant with a single table, but useful for filtering/logic compatibility
  PROCESSING_QUEUE_NAME: z.string().default("queue_processing"),
  DEAD_LETTER_QUEUE_NAME: z.string().default("queue_dlq"),
  ARCHIVED_QUEUE_NAME: z.string().default("queue_archived"),
  METADATA_HASH_NAME: z.string().default("queue_metadata"),
  
  ACK_TIMEOUT_SECONDS: z.coerce.number().default(30),
  MAX_ATTEMPTS: z.coerce.number().default(3),
  REQUEUE_BATCH_SIZE: z.coerce.number().default(100),
  MAX_PRIORITY_LEVELS: z.coerce.number().default(10),
  ENABLE_ENCRYPTION: z.string().default("false"),
  SECRET_KEY: z.string().optional().nullable(),
  EVENTS_CHANNEL: z.string().default("queue_events"),
});

export type env = z.infer<typeof EnvSchema>;

/**
 * Loads environment variables from Infisical if configured, otherwise uses dotenv/local env
 */
async function loadInfisicalSecrets(): Promise<Record<string, string>> {
  const infisicalClientId = process.env.INFISICAL_CLIENT_ID;
  const infisicalClientSecret = process.env.INFISICAL_CLIENT_SECRET;
  const infisicalProjectId = process.env.INFISICAL_PROJECT_ID;
  const infisicalEnvironment = process.env.INFISICAL_ENVIRONMENT || "dev";

  // If Infisical is not configured, return empty object (will use dotenv/process.env)
  if (!infisicalClientId || !infisicalClientSecret || !infisicalProjectId) {
    return {};
  }

  try {
    const client = new InfisicalSDK();

    await client.auth().universalAuth.login({
      clientId: infisicalClientId,
      clientSecret: infisicalClientSecret,
    });

    const response = await client.secrets().listSecrets({
      projectId: infisicalProjectId,
      environment: infisicalEnvironment,
      secretPath: "/",
    });

    // Handle response structure - could be array or object with secrets array
    const secrets = Array.isArray(response) ? response : (response?.secrets || []);

    // Convert Infisical secrets to key-value pairs
    const secretsMap: Record<string, string> = {};
    for (const secret of secrets) {
      if (secret?.secretKey && secret?.secretValue) {
        secretsMap[secret.secretKey] = secret.secretValue;
      }
    }

    console.log(`✅ Loaded ${Object.keys(secretsMap).length} secrets from Infisical`);
    return secretsMap;
  } catch (error) {
    console.warn("⚠️ Failed to load secrets from Infisical, falling back to local env:", error);
    return {};
  }
}

// Initialize environment variables
let envCache: env | null = null;
let envInitialized = false;

/**
 * Get the current environment configuration
 * This always parses from process.env to ensure we have the latest values
 */
function getEnv(): env {
  try {
    return EnvSchema.parse(process.env);
  } catch (e) {
    const error = e as z.ZodError;
    // If we have a cache and Infisical is configured, use cache (Infisical might not be loaded yet)
    if (envCache && process.env.INFISICAL_TOKEN) {
      return envCache;
    }
    // Otherwise, this is a real error
    if (process.env.NODE_ENV !== "test") {
      console.error(
        "❌ Invalid environment variables",
        error.flatten().fieldErrors
      );
      process.exit(1);
    }
    return EnvSchema.parse({});
  }
}

/**
 * Initialize environment variables (async)
 * Call this at application startup before using env
 */
export async function initializeEnv(): Promise<void> {
  if (envInitialized) {
    return;
  }

  // Load secrets from Infisical
  const infisicalSecrets = await loadInfisicalSecrets();

  // Update process.env with Infisical secrets (Infisical takes precedence)
  for (const [key, value] of Object.entries(infisicalSecrets)) {
    process.env[key] = value;
  }

  // Validate and cache
  try {
    envCache = EnvSchema.parse(process.env);
    envInitialized = true;
  } catch (e) {
    const error = e as z.ZodError;
    console.error(
      "❌ Invalid environment variables",
      error.flatten().fieldErrors
    );
    if (process.env.NODE_ENV !== "test") {
      process.exit(1);
    }
    envCache = EnvSchema.parse({});
    envInitialized = true;
  }
}

// Initial parse and cache
try {
  envCache = EnvSchema.parse(process.env);
} catch (e) {
  const error = e as z.ZodError;
  // Only exit if not in test mode and Infisical is not configured
  // (If Infisical is configured, initializeEnv will handle validation)
  if (process.env.NODE_ENV !== "test" && !process.env.INFISICAL_TOKEN) {
    console.error(
      "❌ Invalid environment variables",
      error.flatten().fieldErrors
    );
    process.exit(1);
  }
  envCache = EnvSchema.parse({});
}

// Export env as a Proxy that always gets fresh values from process.env
// This ensures that after initializeEnv updates process.env, all imports see the new values
export default new Proxy({} as env, {
  get(_target, prop: string | symbol) {
    const currentEnv = getEnv();
    return currentEnv[prop as keyof env];
  },
  ownKeys() {
    return Object.keys(getEnv());
  },
  has(_target, prop: string | symbol) {
    return prop in getEnv();
  },
  getOwnPropertyDescriptor(_target, prop: string | symbol) {
    const currentEnv = getEnv();
    if (prop in currentEnv) {
      return {
        enumerable: true,
        configurable: true,
        value: currentEnv[prop as keyof env],
      };
    }
    return undefined;
  },
}) as env;
