import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OptimizedRedisQueue, QueueConfig } from '../redis.js';

// Use environment variables or defaults for Redis connection
// Use unique prefixes for all queue-related keys to avoid test pollution
const testConfig = new QueueConfig({
  redis_host: process.env.REDIS_HOST || 'localhost',
  redis_port: parseInt(process.env.REDIS_PORT || '6379'),
  redis_db: parseInt(process.env.REDIS_DB || '0'),
  redis_password: process.env.REDIS_PASSWORD || undefined,
  queue_name: 'metrics_test_queue',
  processing_queue_name: 'metrics_test_queue_processing',
  dead_letter_queue_name: 'metrics_test_queue_dlq',
  acknowledged_queue_name: 'metrics_test_queue_acknowledged',
  archived_queue_name: 'metrics_test_queue_archived',
  total_acknowledged_key: 'metrics_test_queue:stats:total_acknowledged',
  metadata_hash_name: 'metrics_test_queue_metadata',
  consumer_group_name: 'metrics_test_queue_group',
  ack_timeout_seconds: 60,
  max_attempts: 3,
  batch_size: 10,
  redis_pool_size: 1,
  enable_message_encryption: 'false',
  secret_key: 'secret',
});

describe('Metrics Integration Tests', () => {
  let queue: OptimizedRedisQueue;

  beforeEach(async () => {
    queue = new OptimizedRedisQueue(testConfig);
    // Clear any existing test data - delete all keys matching our test prefix
    const keys = await queue.redisManager.redis.keys('metrics_test_queue*');
    if (keys.length > 0) {
      await queue.redisManager.redis.del(...keys);
    }
  });

  afterEach(async () => {
    if (queue && queue.redisManager?.redis?.status === 'ready') {
      // Clean up test data only if connection is ready
      try {
        const keys = await queue.redisManager.redis.keys('metrics_test_queue*');
        if (keys.length > 0) {
          await queue.redisManager.redis.del(...keys);
        }
      } catch (e) {
        // Ignore cleanup errors for disconnected connections
      }
      await queue.redisManager.disconnect();
    }
  });

  describe('getMetrics', () => {
    it('should return correct metrics structure with empty queue', async () => {
      const metrics = await queue.getMetrics();

      expect(metrics).not.toHaveProperty('error');
      expect(metrics.main_queue_size).toBe(0);
      expect(metrics.processing_queue_size).toBe(0);
      expect(metrics.dead_letter_queue_size).toBe(0);
      expect(metrics.total_acknowledged).toBe(0);
      expect(metrics).toHaveProperty('details');
    });

    it('should return correct metrics after enqueuing messages', async () => {
      // Enqueue messages at different priorities
      await queue.enqueueMessage({ type: 'test', payload: { id: 1 } }, 0);
      await queue.enqueueMessage({ type: 'test', payload: { id: 2 } }, 0);
      await queue.enqueueMessage({ type: 'test', payload: { id: 3 } }, 1);

      const metrics = await queue.getMetrics();

      expect(metrics).not.toHaveProperty('error');
      expect(metrics.main_queue_size).toBe(3);
      expect(metrics.processing_queue_size).toBe(0);
      expect(metrics.details.priority_0_queued).toBe(2);
      expect(metrics.details.priority_1_queued).toBe(1);
    });

    it('should track processing queue size after dequeue', async () => {
      // Enqueue and then dequeue a message
      await queue.enqueueMessage({ type: 'test', payload: { id: 1 } }, 0);
      await queue.enqueueMessage({ type: 'test', payload: { id: 2 } }, 0);

      // Dequeue one message (puts it in processing)
      await queue.dequeueMessage();

      const metrics = await queue.getMetrics();

      expect(metrics).not.toHaveProperty('error');
      // getMetrics counts XLEN for all streams - it doesn't exclude processing
      // The processing_queue_size comes from XPENDING
      expect(metrics.main_queue_size).toBe(2); // Both messages still in stream
      expect(metrics.processing_queue_size).toBe(1); // One is in PEL
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when Redis is connected', async () => {
      const health = await queue.healthCheck();

      expect(health.status).toBe('healthy');
      expect(health).toHaveProperty('metrics');
      expect(health).toHaveProperty('redis_ping_ms');
      expect(typeof health.redis_ping_ms).toBe('number');
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue status with empty queues', async () => {
      const status = await queue.getQueueStatus(null, false);

      expect(status.mainQueue.length).toBe(0);
      expect(status.processingQueue.length).toBe(0);
      expect(status.deadLetterQueue.length).toBe(0);
      expect(status.acknowledgedQueue.length).toBe(0);
    });

    it('should return correct counts without messages (includeMessages=false)', async () => {
      // Enqueue some messages
      await queue.enqueueMessage({ type: 'test', payload: { id: 1 } }, 0);
      await queue.enqueueMessage({ type: 'test', payload: { id: 2 } }, 0);
      await queue.enqueueMessage({ type: 'high', payload: { id: 3 } }, 1);

      const status = await queue.getQueueStatus(null, false);

      expect(status.mainQueue.length).toBe(3);
      expect(status.processingQueue.length).toBe(0);
      // When includeMessages=false, messages array should be empty or not present
      expect(status.mainQueue.messages?.length || 0).toBe(0);
    });

    it('should return messages when includeMessages=true', async () => {
      // Enqueue some messages
      await queue.enqueueMessage({ type: 'test', payload: { id: 1 } }, 0);
      await queue.enqueueMessage({ type: 'test', payload: { id: 2 } }, 0);

      const status = await queue.getQueueStatus(null, true);

      expect(status.mainQueue.length).toBe(2);
      expect(status.mainQueue.messages).toHaveLength(2);
      expect(status.mainQueue.messages[0]).toHaveProperty('type', 'test');
      expect(status.mainQueue.messages[0]).toHaveProperty('payload');
    });

    it('should filter out processing messages from main queue', async () => {
      // Enqueue messages
      await queue.enqueueMessage({ type: 'test', payload: { id: 1 } }, 0);
      await queue.enqueueMessage({ type: 'test', payload: { id: 2 } }, 0);
      await queue.enqueueMessage({ type: 'test', payload: { id: 3 } }, 0);

      // Dequeue one message (puts it in processing)
      const dequeued = await queue.dequeueMessage();

      const status = await queue.getQueueStatus(null, true);

      // Main queue should have 2 messages (excluding the one in processing)
      expect(status.mainQueue.length).toBe(2);
      expect(status.mainQueue.messages).toHaveLength(2);

      // Processing queue should have 1 message
      expect(status.processingQueue.length).toBe(1);
      expect(status.processingQueue.messages).toHaveLength(1);
      expect(status.processingQueue.messages[0].id).toBe(dequeued.id);

      // Verify the dequeued message is NOT in main queue messages
      const mainIds = status.mainQueue.messages.map((m: any) => m.id);
      expect(mainIds).not.toContain(dequeued.id);
    });

    it('should show messages in dead letter queue after max attempts', async () => {
      // Create a queue with max_attempts = 1 for quick DLQ testing
      const dlqConfig = new QueueConfig({
        redis_host: process.env.REDIS_HOST || 'localhost',
        redis_port: parseInt(process.env.REDIS_PORT || '6379'),
        redis_db: parseInt(process.env.REDIS_DB || '0'),
        redis_password: process.env.REDIS_PASSWORD || undefined,
        queue_name: 'metrics_dlq_test',
        processing_queue_name: 'metrics_dlq_test_processing',
        dead_letter_queue_name: 'metrics_dlq_test_dlq',
        acknowledged_queue_name: 'metrics_dlq_test_acknowledged',
        archived_queue_name: 'metrics_dlq_test_archived',
        total_acknowledged_key: 'metrics_dlq_test:stats:total_acknowledged',
        metadata_hash_name: 'metrics_dlq_test_metadata',
        consumer_group_name: 'metrics_dlq_test_group',
        max_attempts: 1,
        ack_timeout_seconds: 1,
        batch_size: 10,
        redis_pool_size: 1,
        enable_message_encryption: 'false',
        secret_key: 'secret',
      });
      const dlqQueue = new OptimizedRedisQueue(dlqConfig);

      try {
        // Enqueue a message
        await dlqQueue.enqueueMessage({ type: 'test', payload: { fail: true } }, 0);

        // Dequeue it
        const dequeued = await dlqQueue.dequeueMessage();
        expect(dequeued).not.toBeNull();

        // NACK it (should go to DLQ since max_attempts=1)
        // nackMessage takes (messageId, lockToken, reason)
        await dlqQueue.nackMessage(dequeued.id, dequeued.lock_token, 'Test failure');

        const status = await dlqQueue.getQueueStatus(null, true);

        expect(status.deadLetterQueue.length).toBe(1);
        expect(status.deadLetterQueue.messages).toHaveLength(1);
        expect(status.deadLetterQueue.messages[0].id).toBe(dequeued.id);
      } finally {
        // Cleanup
        const keys = await dlqQueue.redisManager.redis.keys('metrics_dlq_test*');
        if (keys.length > 0) {
          await dlqQueue.redisManager.redis.del(...keys);
        }
        await dlqQueue.redisManager.disconnect();
      }
    });

    it('should show acknowledged messages after ACK', async () => {
      // Enqueue and process a message
      await queue.enqueueMessage({ type: 'test', payload: { id: 1 } }, 0);
      const dequeued = await queue.dequeueMessage();

      // Acknowledge the message - pass the full dequeued message object
      const ackResult = await queue.acknowledgeMessage(dequeued);
      expect(ackResult).toBe(true);

      const status = await queue.getQueueStatus(null, true);

      expect(status.acknowledgedQueue.length).toBe(1);
      expect(status.acknowledgedQueue.messages).toHaveLength(1);
      expect(status.acknowledgedQueue.messages[0].id).toBe(dequeued.id);
      expect(status.mainQueue.length).toBe(0);
      expect(status.processingQueue.length).toBe(0);
    });

    it('should return all messages regardless of type filter when passed to getQueueStatus', async () => {
      // Note: getQueueStatus filters messages for display but still returns all messages
      // from the streams. The type filter affects metadata/display, not the underlying fetch.
      // Enqueue messages of different types
      await queue.enqueueMessage({ type: 'type-a', payload: { id: 1 } }, 0);
      await queue.enqueueMessage({ type: 'type-b', payload: { id: 2 } }, 0);
      await queue.enqueueMessage({ type: 'type-a', payload: { id: 3 } }, 0);

      const status = await queue.getQueueStatus('type-a', true);

      // getQueueStatus returns all messages, filtering happens at a higher level
      expect(status.mainQueue.length).toBe(3);
    });
  });

  describe('pending IDs Set optimization', () => {
    it('should add message ID to pending set on dequeue', async () => {
      await queue.enqueueMessage({ type: 'test', payload: { id: 1 } }, 0);
      const dequeued = await queue.dequeueMessage();

      // Check the pending IDs set
      const pendingIdsKey = queue['_getPendingIdsSetKey']();
      const pendingIds = await queue.redisManager.redis.smembers(pendingIdsKey);

      expect(pendingIds).toContain(dequeued.id);
    });

    it('should remove message ID from pending set on acknowledge', async () => {
      await queue.enqueueMessage({ type: 'test', payload: { id: 1 } }, 0);
      const dequeued = await queue.dequeueMessage();

      // Verify it's in the set
      const pendingIdsKey = queue['_getPendingIdsSetKey']();
      let pendingIds = await queue.redisManager.redis.smembers(pendingIdsKey);
      expect(pendingIds).toContain(dequeued.id);

      // Acknowledge the message - pass the full dequeued message object
      const ackResult = await queue.acknowledgeMessage(dequeued);
      expect(ackResult).toBe(true);

      // Verify it's removed from the set
      pendingIds = await queue.redisManager.redis.smembers(pendingIdsKey);
      expect(pendingIds).not.toContain(dequeued.id);
    });

    it('should remove message ID from pending set on NACK to DLQ', async () => {
      // Create queue with max_attempts=1 so NACK goes to DLQ
      const nackConfig = new QueueConfig({
        redis_host: process.env.REDIS_HOST || 'localhost',
        redis_port: parseInt(process.env.REDIS_PORT || '6379'),
        redis_db: parseInt(process.env.REDIS_DB || '0'),
        redis_password: process.env.REDIS_PASSWORD || undefined,
        queue_name: 'metrics_nack_test',
        processing_queue_name: 'metrics_nack_test_processing',
        dead_letter_queue_name: 'metrics_nack_test_dlq',
        acknowledged_queue_name: 'metrics_nack_test_acknowledged',
        archived_queue_name: 'metrics_nack_test_archived',
        total_acknowledged_key: 'metrics_nack_test:stats:total_acknowledged',
        metadata_hash_name: 'metrics_nack_test_metadata',
        consumer_group_name: 'metrics_nack_test_group',
        max_attempts: 1,
        ack_timeout_seconds: 60,
        batch_size: 10,
        redis_pool_size: 1,
        enable_message_encryption: 'false',
        secret_key: 'secret',
      });
      const nackQueue = new OptimizedRedisQueue(nackConfig);

      try {
        await nackQueue.enqueueMessage({ type: 'test', payload: { id: 1 } }, 0);
        const dequeued = await nackQueue.dequeueMessage();

        const pendingIdsKey = nackQueue['_getPendingIdsSetKey']();

        // Verify it's in the set
        let pendingIds = await nackQueue.redisManager.redis.smembers(pendingIdsKey);
        expect(pendingIds).toContain(dequeued.id);

        // NACK the message (goes to DLQ)
        await nackQueue.nackMessage(dequeued.id, dequeued.lock_token, 'Test failure');

        // Verify it's removed from the set
        pendingIds = await nackQueue.redisManager.redis.smembers(pendingIdsKey);
        expect(pendingIds).not.toContain(dequeued.id);
      } finally {
        const keys = await nackQueue.redisManager.redis.keys('metrics_nack_test*');
        if (keys.length > 0) {
          await nackQueue.redisManager.redis.del(...keys);
        }
        await nackQueue.redisManager.disconnect();
      }
    });

    it('should use pending IDs set to filter main queue efficiently', async () => {
      // Enqueue multiple messages
      await queue.enqueueMessage({ type: 'test', payload: { id: 1 } }, 0);
      await queue.enqueueMessage({ type: 'test', payload: { id: 2 } }, 0);
      await queue.enqueueMessage({ type: 'test', payload: { id: 3 } }, 0);

      // Dequeue two messages
      const dequeued1 = await queue.dequeueMessage();
      const dequeued2 = await queue.dequeueMessage();

      // Get queue status
      const status = await queue.getQueueStatus(null, true);

      // Main queue should only show the non-processing message
      expect(status.mainQueue.length).toBe(1);
      expect(status.mainQueue.messages).toHaveLength(1);

      // Processing queue should have both dequeued messages
      expect(status.processingQueue.length).toBe(2);
      expect(status.processingQueue.messages).toHaveLength(2);

      // Verify the IDs
      const processingIds = status.processingQueue.messages.map((m: any) => m.id);
      expect(processingIds).toContain(dequeued1.id);
      expect(processingIds).toContain(dequeued2.id);

      const mainIds = status.mainQueue.messages.map((m: any) => m.id);
      expect(mainIds).not.toContain(dequeued1.id);
      expect(mainIds).not.toContain(dequeued2.id);
    });
  });
});
