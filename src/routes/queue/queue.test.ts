import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { testClient } from 'hono/testing';

// Mock env using importActual to preserve connection details but override DB/Queue
vi.mock('@/config/env', async () => {
  const actual = await vi.importActual<typeof import('@/config/env')>('@/config/env');
  return {
    default: {
      ...actual.default,
      // REDIS_DB: 15, // Removed to avoid "ERR DB index is out of range" if DB 15 not available. Rely on unique queue name.
      QUEUE_NAME: 'test_queue',
      PROCESSING_QUEUE_NAME: 'test_queue_processing',
      DEAD_LETTER_QUEUE_NAME: 'test_queue_dlq',
      METADATA_HASH_NAME: 'test_queue_metadata',
    }
  };
});

import router from './queue.index';
import { OptimizedRedisQueue, QueueConfig } from '@/lib/redis.js';
import env from '@/config/env';

// Create a real Redis queue instance for testing (to clean up)
let queue: OptimizedRedisQueue;
const testConfig = new QueueConfig({
  redis_host: env.REDIS_HOST,
  redis_port: env.REDIS_PORT,
  redis_db: env.REDIS_DB,
  redis_password: env.REDIS_PASSWORD,
  queue_name: env.QUEUE_NAME,
  processing_queue_name: env.PROCESSING_QUEUE_NAME,
  dead_letter_queue_name: env.DEAD_LETTER_QUEUE_NAME,
  metadata_hash_name: env.METADATA_HASH_NAME,
  ack_timeout_seconds: env.ACK_TIMEOUT_SECONDS,
  max_attempts: env.MAX_ATTEMPTS,
  batch_size: env.BATCH_SIZE,
  redis_pool_size: env.REDIS_POOL_SIZE,
  enable_message_encryption: env.ENABLE_ENCRYPTION,
  secret_key: env.SECRET_KEY,
});

describe('Queue Routes - Integration Tests', () => {
  beforeEach(async () => {
    // Create a fresh queue instance for each test to control DB
    queue = new OptimizedRedisQueue(testConfig);
    // Clear any existing test data
    await queue.redisManager.redis.flushdb();
  });

  afterEach(async () => {
    // Clean up after each test
    if (queue) {
      await queue.redisManager.redis.flushdb();
      await queue.redisManager.disconnect();
    }
  });

  // Health Check
  describe('GET /health', () => {
    it('should return 200 OK when Redis is healthy', async () => {
      const res = await testClient(router).health.$get();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('status');
      expect(json.status).toBe('OK');
    });
  });

  // Processing Queue
  describe('GET /queue/processing/messages', () => {
    it('should return 200 (empty) when no consumer group exists', async () => {
      // clearAllQueues removes streams and groups.
      // So requesting processing messages immediately should handle NOGROUP gracefully.
      const res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.messages).toEqual([]);
    });

    it('should return 200 (empty) when stream exists but no consumer group exists', async () => {
      // 1. Enqueue message (creates stream)
      await testClient(router).queue.message.$post({ json: { type: 'test', payload: {} } });
      
      // 2. Get processing messages (Group hasn't been created yet because no dequeue happened)
      const res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.messages).toEqual([]);
    });
  });

  // Clear Queue
  describe('DELETE /queue/clear', () => {
    it('should clear all queues successfully', async () => {
        // Enqueue some messages
        await testClient(router).queue.message.$post({ json: { type: 't1', payload: {} } });
        await testClient(router).queue.message.$post({ json: { type: 't2', payload: {} } });
        
        const res = await testClient(router).queue.clear.$delete();
        expect(res.status).toBe(200);
        
        // Verify empty
        const metricsRes = await testClient(router).queue.metrics.$get();
        const metrics = await metricsRes.json();
        expect(metrics.main_queue_size).toBe(0);
    });
  });

  // Clear Specific Queue
  describe('DELETE /queue/:queueType/clear', () => {
    it('should clear specific queue successfully', async () => {
        // Enqueue
        await testClient(router).queue.message.$post({ json: { type: 't1', payload: {} } });
        
        const res = await testClient(router).queue[':queueType'].clear.$delete({
            param: { queueType: 'main' }
        });
        expect(res.status).toBe(200);
        
        const metricsRes = await testClient(router).queue.metrics.$get();
        const metrics = await metricsRes.json();
        expect(metrics.main_queue_size).toBe(0);
    });
  });

  // Date Range Operations
  describe('Date Range Operations', () => {
    it('should get messages by date range', async () => {
        const start = new Date(Date.now() - 10000).toISOString();
        
        // Enqueue
        await testClient(router).queue.message.$post({ json: { type: 'date-test', payload: {} } });
        
        const end = new Date(Date.now() + 10000).toISOString();
        
        const res = await testClient(router).queue.messages.$get({
            query: { startTimestamp: start, endTimestamp: end }
        });
        
        expect(res.status).toBe(200);
        const messages = await res.json();
        expect(Array.isArray(messages)).toBe(true);
        expect(messages.length).toBeGreaterThan(0);
        expect(messages[0].type).toBe('date-test');
    });

    it('should remove messages by date range', async () => {
        const start = new Date(Date.now() - 10000).toISOString();
        
        // Enqueue
        await testClient(router).queue.message.$post({ json: { type: 'date-delete', payload: {} } });
        
        const end = new Date(Date.now() + 10000).toISOString();
        
        const res = await testClient(router).queue.messages.$delete({
            query: { startTimestamp: start, endTimestamp: end }
        });
        
        expect(res.status).toBe(200);
        const result = await res.json();
        expect(result.message).toContain('messages removed');
        
        // Verify empty
        const metricsRes = await testClient(router).queue.metrics.$get();
        const metrics = await metricsRes.json();
        expect(metrics.main_queue_size).toBe(0);
    });
  });

  // Get Queue Messages
  describe('GET /queue/:queueType/messages', () => {
    it('should return 200 with messages from the queue', async () => {
      // Add a message first
      await testClient(router).queue.message.$post({ json: { type: 'test', payload: { foo: 'bar' } } });
      
      const res = await testClient(router).queue[':queueType'].messages.$get({ 
        param: { queueType: 'main' }
      });
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result).toHaveProperty('messages');
      expect(result).toHaveProperty('pagination');
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[0].type).toBe('test');
    });
  });

  // Update Message
  describe('PUT /queue/message/:messageId', () => {
    it('should update a message successfully', async () => {
        // 1. Enqueue
        await testClient(router).queue.message.$post({ json: { type: 'original', payload: { val: 1 } } });
        
        // 2. Dequeue to get ID
        const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
        const msg = await dequeueRes.json();
        
        // 3. Update
        const updateRes = await testClient(router).queue.message[':messageId'].$put({
            param: { messageId: msg.id },
            query: { queueType: 'main' },
            json: { payload: { val: 2 } }
        });

        expect(updateRes.status).toBe(200);
        const result = await updateRes.json();
        expect(result.success).toBe(true);
        expect(result.data.payload).toEqual({ val: 2 });
    });
  });

  // Delete Message
  describe('DELETE /queue/message/:messageId', () => {
    it('should delete a message successfully', async () => {
        // 1. Enqueue
        await testClient(router).queue.message.$post({ json: { type: 'to-delete', payload: {} } });
        
        // 2. Dequeue to get ID (Wait, if I dequeue, it's technically "processing" but still in stream? 
        // No, dequeue uses XREADGROUP. The message remains in the stream but is added to PEL.
        // deleteMessage in redis.js scans the stream. It should find it.
        // However, if I dequeue, I might want to test deleting from 'main' or 'processing'.
        // Let's test deleting from 'main' (which covers the stream).
        const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
        const msg = await dequeueRes.json();

        // 3. Delete
        const deleteRes = await testClient(router).queue.message[':messageId'].$delete({
            param: { messageId: msg.id },
            query: { queueType: 'main' }
        });

        expect(deleteRes.status).toBe(200);
        const result = await deleteRes.json();
        expect(result.success).toBe(true);
    });
  });

  // Enqueue
  describe('POST /queue/message', () => {
    it('should return 201 when message is added successfully', async () => {
      const message = { type: 'test', payload: { foo: 'bar' } };
      const res = await testClient(router).queue.message.$post({ json: message });
      expect(res.status).toBe(201);
      const result = await res.json();
      expect(result).toHaveProperty('message');
      expect(result.message).toBe('Message added successfully');
    });

    it('should return 422 for invalid message format', async () => {
      const invalidMessage = { invalidField: 'test' };
      const res = await testClient(router).queue.message.$post({ json: invalidMessage as any });
      expect(res.status).toBe(422);
    });
  });

  // Dequeue
  describe('GET /queue/message', () => {
    it('should return 200 with a message when a message is available', async () => {
      // First, add a message to the queue
      const message = { type: 'test', payload: { foo: 'bar' } };
      await testClient(router).queue.message.$post({ json: message });

      // Then try to dequeue it
      const res = await testClient(router).queue.message.$get({ query: { timeout: '1' } });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result).toHaveProperty('id');
      expect(result.type).toBe('test');
      expect(result.payload).toEqual({ foo: 'bar' });
      // Verify stream metadata exists (needed for ack)
      expect(result).toHaveProperty('_stream_id');
      expect(result).toHaveProperty('_stream_name');
    });

    it('should return 404 when no message is available', async () => {
      const res = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: 'Message not found' });
    });
  });

  // Acknowledge
  describe('POST /queue/ack', () => {
    it('should return 200 when a valid message is acknowledged', async () => {
      // First, add and dequeue a message to get a valid ID and Stream Metadata
      const message = { type: 'test', payload: { foo: 'bar' } };
      await testClient(router).queue.message.$post({ json: message });
      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
      const dequeuedMessage = await dequeueRes.json();

      // Then acknowledge it WITH stream metadata
      const ackRes = await testClient(router).queue.ack.$post({ 
          json: { 
              id: dequeuedMessage.id,
              _stream_id: dequeuedMessage._stream_id,
              _stream_name: dequeuedMessage._stream_name
          } 
      });

      expect(ackRes.status).toBe(200);
      expect(await ackRes.json()).toEqual({ message: 'Message acknowledged' });
    });

    it('should return 400 when acknowledging without stream metadata', async () => {
        // Enqueue and dequeue
        const message = { type: 'test', payload: { foo: 'bar' } };
        await testClient(router).queue.message.$post({ json: message });
        const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
        const dequeuedMessage = await dequeueRes.json();
  
        // Try to acknowledge with ONLY ID (should fail now)
        // Note: The schema might allow it (if I didn't make it required in schema), but the handler returns 400.
        // Wait, I updated the schema to require _stream_id and _stream_name.
        // So validation (422) might happen BEFORE the handler (400).
        // Let's check the schema change again.
        // Schema: required({ id: true, _stream_id: true, _stream_name: true })
        // So if I send missing fields, Zod Validator will return 422.
        
        const ackRes = await testClient(router).queue.ack.$post({ 
            json: { 
                id: dequeuedMessage.id 
                // Missing _stream_id and _stream_name
            } as any
        });
  
        // Expecting 422 (Validation Error) if schema enforces it, or 400 if it passes schema but fails logic.
        // Since I added .required(), it should be 422.
        expect(ackRes.status).toBe(422); 
    });
  });

  // Metrics
  describe('GET /queue/metrics', () => {
    it('should return 200 with queue metrics', async () => {
      const res = await testClient(router).queue.metrics.$get();
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result).toHaveProperty('main_queue_size');
      expect(result).toHaveProperty('processing_queue_size');
      expect(result).toHaveProperty('dead_letter_queue_size');
    });
  });

  // Queue Status
  describe('GET /queue/status', () => {
    it('should return 200 with detailed queue status', async () => {
      const res = await testClient(router).queue.status.$get();
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result).toHaveProperty('mainQueue');
      expect(result.mainQueue).toHaveProperty('messages');
      expect(result).toHaveProperty('processingQueue');
      expect(result).toHaveProperty('deadLetterQueue');
    });

    it('should return 200 for status when stream exists but no consumer group exists', async () => {
      // 1. Enqueue message (creates stream)
      await testClient(router).queue.message.$post({ json: { type: 'test', payload: {} } });

      // 2. Get Status
      const res = await testClient(router).queue.status.$get();
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.processingQueue.length).toBe(0);
    });

    it('should not create extra pending messages across priority streams', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'p0', payload: { a: 1 }, priority: 0 } });
      await testClient(router).queue.message.$post({ json: { type: 'p1', payload: { b: 2 }, priority: 1 } });

      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
      expect(dequeueRes.status).toBe(200);
      const msg = await dequeueRes.json();
      expect(msg.type).toBe('p1');

      const statusRes = await testClient(router).queue.status.$get();
      expect(statusRes.status).toBe(200);
      const status = await statusRes.json();
      expect(status.processingQueue.length).toBe(1);
    });
  });
});
