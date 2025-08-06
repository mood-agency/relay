import { z } from "zod/v4";
import { config } from "dotenv";
import { expand } from "dotenv-expand";

expand(config());

export const EnvSchema = z.object({
  // General
  NODE_ENV: z
    .enum(["development", "production", "local", "test"])
    .default("development"),
  APP_URL: z.string().optional().default("http://localhost"),
  PORT: z.coerce.number().default(3000),

  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  // Redis
  REDIS_HOST: z.string().default("localhost"),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().nullable(),
  REDIS_DB: z.coerce.number().default(0),
  REDIS_POOL_SIZE: z.coerce.number().default(10),
  
  // Queue Configuration
  QUEUE_NAME: z.string().default("queue"),
  PROCESSING_QUEUE_NAME: z.string().default("queue_processing"),
  DEAD_LETTER_QUEUE_NAME: z.string().default("queue_dlq"),
  ARCHIVE_QUEUE_NAME: z.string().default("queue_archive"),
  METADATA_HASH_NAME: z.string().default("queue_metadata"),
  
  ACK_TIMEOUT_SECONDS: z.coerce.number().default(30),
  MAX_ATTEMPTS: z.coerce.number().default(3),
  BATCH_SIZE: z.coerce.number().default(100),
  ENABLE_ENCRYPTION: z.string().default("false"),
  SECRET_KEY: z.string().optional().nullable(),
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
