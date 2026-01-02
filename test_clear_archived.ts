
import { OptimizedRedisQueue, QueueConfig } from "./src/lib/redis.js";
import env from "./src/config/env.ts";

const queueConfig = {
  redis_host: env.REDIS_HOST,
  redis_port: env.REDIS_PORT,
  redis_db: env.REDIS_DB,
  redis_password: env.REDIS_PASSWORD,
  queue_name: "test_queue",
  processing_queue_name: "test_queue_processing",
  dead_letter_queue_name: "test_queue_dlq",
  archived_queue_name: "test_queue_archived",
  metadata_hash_name: "test_queue_metadata",
  ack_timeout_seconds: 30,
  max_attempts: 3,
  requeue_batch_size: 100,
  max_priority_levels: 10,
  redis_pool_size: 10,
  enable_message_encryption: "false",
  secret_key: null,
  events_channel: "test_queue_events",
};

const queue = new OptimizedRedisQueue(new QueueConfig(queueConfig));

async function test() {
  console.log("Starting test...");

  // 1. Ensure clean state
  await queue.clearAllQueues();
  await queue.clearQueue('archived'); // Just in case clearAllQueues is broken (which we suspect)

  // 2. Add a message directly to archived queue to simulate existing data
  const redis = queue.redisManager.redis;
  const msg = { id: "test-msg-1", type: "test", payload: {}, created_at: Date.now() / 1000 };
  const msgJson = JSON.stringify(msg);
  
  await redis.xadd(queueConfig.archived_queue_name, "*", "data", msgJson);
  console.log("Added message to archived queue.");

  // Verify it's there
  let archivedLen = await redis.xlen(queueConfig.archived_queue_name);
  console.log(`Archived queue length before clear: ${archivedLen}`);

  if (archivedLen === 0) {
    console.error("Failed to setup test state.");
    process.exit(1);
  }

  // 3. Run clearAllQueues
  console.log("Running clearAllQueues...");
  await queue.clearAllQueues();

  // 4. Verify archived queue is empty
  archivedLen = await redis.xlen(queueConfig.archived_queue_name);
  console.log(`Archived queue length after clear: ${archivedLen}`);

  if (archivedLen > 0) {
    console.error("FAIL: Archived queue was not cleared!");
    await queue.disconnect();
    process.exit(1);
  } else {
    console.log("PASS: Archived queue was cleared.");
    await queue.disconnect();
    process.exit(0);
  }
}

test().catch(async (e) => {
  console.error("Test error:", e);
  await queue.disconnect();
  process.exit(1);
});
