import { z } from "zod";
import { config } from "dotenv";
import { expand } from "dotenv-expand";

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

let env: env;

try {
  env = EnvSchema.parse(process.env);
} catch (e) {
  const error = e as z.ZodError;
  console.error(
    "❌ Invalid environment variables",
    error.flatten().fieldErrors
  );
  if (process.env.NODE_ENV !== "test") {
    process.exit(1);
  }
  env = EnvSchema.parse({});
}

export default env;
