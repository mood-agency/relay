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

  describe('POST /queue/move', () => {
    it('should move a selected message to processing and remove it from main', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'm1', payload: { n: 1 } } });
      await testClient(router).queue.message.$post({ json: { type: 'm2', payload: { n: 2 } } });

      const mainListRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { page: '1', limit: '50', sortBy: 'created_at', sortOrder: 'desc' }
      });
      expect(mainListRes.status).toBe(200);
      const mainList = await mainListRes.json();
      expect(Array.isArray(mainList.messages)).toBe(true);
      expect(mainList.messages.length).toBeGreaterThan(0);

      const selected = mainList.messages[0];
      const toMove = {
        id: selected.id,
        type: selected.type,
        payload: selected.payload,
        priority: selected.priority,
      };

      const moveRes = await testClient(router).queue.move.$post({
        json: { messages: [toMove], fromQueue: 'main', toQueue: 'processing' }
      });
      expect(moveRes.status).toBe(200);
      const moveResult = await moveRes.json();
      expect(moveResult.movedCount).toBe(1);

      const mainListAfterRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { page: '1', limit: '50', sortBy: 'created_at', sortOrder: 'desc' }
      });
      expect(mainListAfterRes.status).toBe(200);
      const mainListAfter = await mainListAfterRes.json();
      const stillInMain = (mainListAfter.messages || []).some((m: any) => m.id === selected.id);
      expect(stillInMain).toBe(false);

      const processingRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      expect(processingRes.status).toBe(200);
      const processing = await processingRes.json();
      const inProcessing = (processing.messages || []).some((m: any) => m.id === selected.id);
      expect(inProcessing).toBe(true);
    }, 15000);

    it('should store errorReason as last_error when moving to DLQ', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'dlq-reason', payload: { n: 1 } } });

      const mainListRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { page: '1', limit: '50', sortBy: 'created_at', sortOrder: 'desc' }
      });
      expect(mainListRes.status).toBe(200);
      const mainList = await mainListRes.json() as any;
      const selected = (mainList.messages || []).find((m: any) => m.type === 'dlq-reason');
      expect(selected).toBeTruthy();

      const errorReason = "Invalid payload schema";
      const moveRes = await testClient(router).queue.move.$post({
        json: { messages: [selected], fromQueue: 'main', toQueue: 'dead', errorReason }
      });
      expect(moveRes.status).toBe(200);

      const deadRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'dead' },
        query: { page: '1', limit: '50', sortBy: 'created_at', sortOrder: 'desc' }
      });
      expect(deadRes.status).toBe(200);
      const deadList = await deadRes.json() as any;
      const deadMsg = (deadList.messages || []).find((m: any) => m.id === selected.id);
      expect(deadMsg).toBeTruthy();
      expect(deadMsg.last_error).toBe(errorReason);
    }, 15000);

    it('should enrich DLQ messages with attempt_count from metadata after manual move', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'dlq-meta', payload: { n: 1 } } });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '1', ackTimeout: '60' }
      });
      expect(dequeueRes.status).toBe(200);
      const dequeued = await dequeueRes.json() as any;

      const moveRes = await testClient(router).queue.move.$post({
        json: { messages: [dequeued], fromQueue: 'processing', toQueue: 'dead' }
      });
      expect(moveRes.status).toBe(200);

      const deadRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'dead' },
        query: { page: '1', limit: '50', sortBy: 'created_at', sortOrder: 'desc' }
      });
      expect(deadRes.status).toBe(200);
      const deadList = await deadRes.json() as any;
      const deadMsg = (deadList.messages || []).find((m: any) => m.id === dequeued.id);
      expect(deadMsg).toBeTruthy();
      expect(deadMsg.attempt_count).toBe(1);
      expect(deadMsg.custom_ack_timeout).toBe(60);
    }, 15000);

    it('should preserve custom ack timeout when moving back to processing', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'timeout-test', payload: { a: 1 } } });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '1', ackTimeout: '90' }
      });
      expect(dequeueRes.status).toBe(200);
      const dequeued = await dequeueRes.json() as any;
      expect(dequeued).toHaveProperty('id');
      expect(dequeued).toHaveProperty('_stream_id');
      expect(dequeued).toHaveProperty('_stream_name');

      const moveToMainRes = await testClient(router).queue.move.$post({
        json: { messages: [dequeued], fromQueue: 'processing', toQueue: 'main' }
      });
      expect(moveToMainRes.status).toBe(200);

      const mainListRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { page: '1', limit: '50', sortBy: 'created_at', sortOrder: 'desc' }
      });
      expect(mainListRes.status).toBe(200);
      const mainList = await mainListRes.json() as any;

      const mainMsg = (mainList.messages || []).find((m: any) => m.id === dequeued.id);
      expect(mainMsg).toBeTruthy();
      expect(mainMsg.attempt_count).toBe(1);

      const moveToProcessingRes = await testClient(router).queue.move.$post({
        json: { messages: [mainMsg], fromQueue: 'main', toQueue: 'processing' }
      });
      expect(moveToProcessingRes.status).toBe(200);

      const metaJson = await queue.redisManager.redis.hget(queue.config.metadata_hash_name, dequeued.id);
      expect(metaJson).toBeTruthy();
      const meta = JSON.parse(metaJson!);
      expect(meta.custom_ack_timeout).toBe(90);

      const processingRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      expect(processingRes.status).toBe(200);
      const processing = await processingRes.json() as any;
      const processingMsg = (processing.messages || []).find((m: any) => m.id === dequeued.id);
      expect(processingMsg).toBeTruthy();
      expect(processingMsg.custom_ack_timeout).toBe(90);
    }, 15000);

    it('should correctly move a batch of messages to processing and preserve IDs even with backlog', async () => {
      // 1. Enqueue 5 messages
      for(let i=0; i<5; i++) {
         await testClient(router).queue.message.$post({ json: { type: 'batch-move', payload: { i } } });
      }

      // 2. Fetch messages to get IDs
      const listRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { limit: '10' }
      });
      const list = await listRes.json();
      const messages = (list.messages || []).filter((m: any) => m.type === 'batch-move');
      
      expect(messages.length).toBe(5);
      
      // Select 2 specific messages (e.g. index 1 and 3)
      // Note: messages are likely sorted by created_at desc (newest first)
      const selected = [messages[1], messages[3]];
      const selectedIds = selected.map((m: any) => m.id);

      // 3. Move them to Processing
      const moveRes = await testClient(router).queue.move.$post({
        json: { messages: selected, fromQueue: 'main', toQueue: 'processing' }
      });
      expect(moveRes.status).toBe(200);
      const moveResult = await moveRes.json();
      expect(moveResult.movedCount).toBe(2);

      // 4. Verify Processing Queue
      const processingRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      expect(processingRes.status).toBe(200);
      const processing = await processingRes.json();
      const processingMessages = processing.messages || [];
      
      // Check count
      expect(processingMessages.length).toBe(2);
      
      // Check IDs match exactly what we selected
      const processingIds = processingMessages.map((m: any) => m.id);
      expect(processingIds.sort()).toEqual(selectedIds.sort());
      
      // Check Metadata (attempt_count should be 1)
      for (const msg of processingMessages) {
          expect(msg.attempt_count).toBeGreaterThanOrEqual(1);
          // Verify we have full message data
          expect(msg.payload).toBeDefined();
          expect(msg.type).toBe('batch-move');
      }
      
      // 5. Verify Main Queue (should have 3 left)
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const main = await mainRes.json();
      // We might have other messages from other tests if flushdb didn't work, but based on beforeEach it should be clean.
      // But let's filter by type to be safe
      const remaining = (main.messages || []).filter((m: any) => m.type === 'batch-move');
      expect(remaining.length).toBe(3);
      
      // Verify none of the selected IDs are in main
      const remainingIds = remaining.map((m: any) => m.id);
      for (const id of selectedIds) {
          expect(remainingIds).not.toContain(id);
      }
    }, 15000);

    it('should correctly move messages to acknowledged and dead letter queues preserving IDs', async () => {
      // 1. Enqueue 5 messages for ACK test
      for(let i=0; i<5; i++) {
         await testClient(router).queue.message.$post({ json: { type: 'batch-ack', payload: { i } } });
      }

      // 2. Fetch messages to get IDs
      let listRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { limit: '10' }
      });
      let list = await listRes.json();
      let messages = (list.messages || []).filter((m: any) => m.type === 'batch-ack');
      
      // Ensure we have enough messages
      expect(messages.length).toBeGreaterThanOrEqual(3);

      const ackTarget = [messages[0], messages[2]];
      const ackTargetIds = ackTarget.map((m: any) => m.id);

      // 3. Move to Acknowledged
      let moveRes = await testClient(router).queue.move.$post({
        json: { messages: ackTarget, fromQueue: 'main', toQueue: 'acknowledged' }
      });
      expect(moveRes.status).toBe(200);
      let moveResult = await moveRes.json();
      expect(moveResult.movedCount).toBe(2);

      // 4. Verify Acknowledged Queue
      const ackRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'acknowledged' }
      });
      const ackQueue = await ackRes.json();
      const ackMessages = (ackQueue.messages || []).filter((m: any) => m.type === 'batch-ack');
      
      expect(ackMessages.length).toBe(2);
      const ackIds = ackMessages.map((m: any) => m.id);
      expect(ackIds.sort()).toEqual(ackTargetIds.sort());
      
      // Check acknowledged_at is set
      for (const msg of ackMessages) {
          expect(msg.acknowledged_at).toBeDefined();
      }

      // --- DLQ Test ---

      // 5. Enqueue 5 messages for DLQ test
      for(let i=0; i<5; i++) {
         await testClient(router).queue.message.$post({ json: { type: 'batch-dlq', payload: { i } } });
      }
      
      listRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { limit: '10' }
      });
      list = await listRes.json();
      messages = (list.messages || []).filter((m: any) => m.type === 'batch-dlq');
      
      // Ensure we have enough messages
      expect(messages.length).toBeGreaterThanOrEqual(5);

      const dlqTarget = [messages[1], messages[4]];
      const dlqTargetIds = dlqTarget.map((m: any) => m.id);

      // 6. Move to DLQ
      moveRes = await testClient(router).queue.move.$post({
        json: { messages: dlqTarget, fromQueue: 'main', toQueue: 'dead' }
      });
      expect(moveRes.status).toBe(200);
      moveResult = await moveRes.json();
      expect(moveResult.movedCount).toBe(2);

      // 7. Verify Dead Letter Queue
      const dlqRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'dead' }
      });
      const dlqQueue = await dlqRes.json();
      const dlqMessages = (dlqQueue.messages || []).filter((m: any) => m.type === 'batch-dlq');
      
      expect(dlqMessages.length).toBe(2);
      const dlqIds = dlqMessages.map((m: any) => m.id);
      expect(dlqIds.sort()).toEqual(dlqTargetIds.sort());

      // Check failed_at is set
      for (const msg of dlqMessages) {
          expect(msg.failed_at).toBeDefined();
          expect(msg.last_error).toBe("Manually moved to DLQ");
      }
    }, 15000);
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
        
        // 2. Dequeue to get ID
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

  // Batch Delete Messages
  describe('POST /queue/messages/delete', () => {
    it('should delete multiple messages successfully', async () => {
      // 1. Enqueue 3 messages
      await testClient(router).queue.message.$post({ json: { type: 'del-1', payload: { i: 1 } } });
      await testClient(router).queue.message.$post({ json: { type: 'del-2', payload: { i: 2 } } });
      await testClient(router).queue.message.$post({ json: { type: 'del-3', payload: { i: 3 } } });

      // 2. Fetch messages to get IDs
      const listRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { limit: '10' }
      });
      const list = await listRes.json();
      const ids = list.messages.map((m: any) => m.id);
      expect(ids.length).toBe(3);

      // 3. Batch Delete
      const deleteRes = await testClient(router).queue.messages['delete'].$post({
        query: { queueType: 'main' },
        json: { messageIds: ids }
      });

      expect(deleteRes.status).toBe(200);
      const result = await deleteRes.json();
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);

      // 4. Verify empty
      const afterRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const afterList = await afterRes.json();
      expect(afterList.messages.length).toBe(0);
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
        const ackRes = await testClient(router).queue.ack.$post({ 
            json: { 
                id: dequeuedMessage.id 
                // Missing _stream_id and _stream_name
            } as any
        });
  
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

    it('should not show processing messages in main when processing exceeds 100', async () => {
      for (let i = 0; i < 150; i++) {
        await testClient(router).queue.message.$post({ json: { type: 'bulk-processing', payload: { i } } });
      }

      const listRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { page: '1', limit: '200', sortBy: 'created_at', sortOrder: 'desc' }
      });
      expect(listRes.status).toBe(200);
      const list = await listRes.json() as any;
      const messages = (list.messages || []).filter((m: any) => m.type === 'bulk-processing');
      expect(messages.length).toBe(150);

      const moveRes = await testClient(router).queue.move.$post({
        json: { messages, fromQueue: 'main', toQueue: 'processing' }
      });
      expect(moveRes.status).toBe(200);

      const statusRes = await testClient(router).queue.status.$get();
      expect(statusRes.status).toBe(200);
      const status = await statusRes.json() as any;

      expect(status.processingQueue.length).toBe(150);
      expect(status.mainQueue.length).toBe(0);

      const mainTypes = (status.mainQueue.messages || []).map((m: any) => m.type);
      expect(mainTypes).not.toContain('bulk-processing');
    }, 30000);
  });

  // Robustness Tests
  describe('Robustness Tests - Retry and DLQ', () => {
    it('should return processing messages even if stream IDs collide across streams', async () => {
        const redis = queue.redisManager.redis;
        const group = (queue.config as any).consumer_group_name;
        const consumer = (queue.config as any).consumer_name;

        const streamA = (queue as any)._getPriorityStreamName(0) as string;
        const streamB = (queue as any)._getManualStreamName() as string;

        await redis.xgroup('CREATE', streamA, group, '0', 'MKSTREAM').catch(() => {});
        await redis.xgroup('CREATE', streamB, group, '0', 'MKSTREAM').catch(() => {});

        const now = Date.now() / 1000;
        const streamId = '1-0';

        await redis.xadd(streamA, streamId, 'data', JSON.stringify({
          id: 'collision-a',
          type: 'collision-test',
          payload: { from: 'A' },
          created_at: now,
          priority: 0
        }));
        await redis.xadd(streamB, streamId, 'data', JSON.stringify({
          id: 'collision-b',
          type: 'collision-test',
          payload: { from: 'B' },
          created_at: now,
          priority: 0
        }));

        await redis.xreadgroup('GROUP', group, consumer, 'COUNT', 10, 'STREAMS', streamA, streamB, '>', '>');

        const res = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'processing' },
          query: { page: '1', limit: '50', sortBy: 'created_at', sortOrder: 'desc' }
        });
        expect(res.status).toBe(200);
        const body = await res.json() as any;
        const ids = (body.messages || []).map((m: any) => m.id);
        expect(ids).toContain('collision-a');
        expect(ids).toContain('collision-b');
    }, 15000);

    it('should not duplicate messages when requeue runs concurrently', async () => {
        const originalTimeout = queue.config.ack_timeout_seconds;
        const originalMaxAttempts = queue.config.max_attempts;

        (queue.config as any).ack_timeout_seconds = 1;
        (queue.config as any).max_attempts = 10;

        try {
            await queue.enqueueMessage({ type: 'concurrent-requeue', payload: { a: 1 } });

            const msg1 = await queue.dequeueMessage(1, 1);
            expect(msg1).not.toBeNull();
            expect(msg1?.id).toBeTruthy();

            await new Promise(resolve => setTimeout(resolve, 1100));

            const results = await Promise.all([
              queue.requeueFailedMessages(),
              queue.requeueFailedMessages(),
              queue.requeueFailedMessages(),
            ]);
            expect(results.reduce((a, b) => a + b, 0)).toBe(1);

            const streams = (queue as any)._getAllPriorityStreams() as string[];
            let occurrences = 0;

            for (const streamName of streams) {
              const entries = await queue.redisManager.redis.xrange(streamName, '-', '+');
              for (const [, fields] of entries) {
                let json: string | null = null;
                for (let i = 0; i < fields.length; i += 2) {
                  if (fields[i] === 'data') {
                    json = fields[i + 1] as any;
                    break;
                  }
                }
                if (!json) continue;
                const parsed = (queue as any)._deserializeMessage(json) as any;
                if (parsed?.id === msg1?.id) occurrences++;
              }
            }

            expect(occurrences).toBe(1);
        } finally {
            (queue.config as any).ack_timeout_seconds = originalTimeout;
            (queue.config as any).max_attempts = originalMaxAttempts;
        }
    }, 15000);

    it('should not duplicate messages when two queue instances requeue concurrently', async () => {
        const originalTimeout = queue.config.ack_timeout_seconds;
        const originalMaxAttempts = queue.config.max_attempts;

        (queue.config as any).ack_timeout_seconds = 1;
        (queue.config as any).max_attempts = 10;

        const queue2 = new OptimizedRedisQueue(testConfig);
        (queue2.config as any).ack_timeout_seconds = 1;
        (queue2.config as any).max_attempts = 10;

        try {
            await queue.enqueueMessage({ type: 'multi-instance-requeue', payload: { a: 1 } });

            const msg1 = await queue.dequeueMessage(1, 1);
            expect(msg1).not.toBeNull();
            expect(msg1?.id).toBeTruthy();

            await new Promise(resolve => setTimeout(resolve, 1100));

            const results = await Promise.all([
              queue.requeueFailedMessages(),
              queue2.requeueFailedMessages(),
            ]);
            expect(results.reduce((a, b) => a + b, 0)).toBe(1);

            const streams = (queue as any)._getAllPriorityStreams() as string[];
            let occurrences = 0;

            for (const streamName of streams) {
              const entries = await queue.redisManager.redis.xrange(streamName, '-', '+');
              for (const [, fields] of entries) {
                let json: string | null = null;
                for (let i = 0; i < fields.length; i += 2) {
                  if (fields[i] === 'data') {
                    json = fields[i + 1] as any;
                    break;
                  }
                }
                if (!json) continue;
                const parsed = (queue as any)._deserializeMessage(json) as any;
                if (parsed?.id === msg1?.id) occurrences++;
              }
            }

            expect(occurrences).toBe(1);
        } finally {
            (queue.config as any).ack_timeout_seconds = originalTimeout;
            (queue.config as any).max_attempts = originalMaxAttempts;
            await queue2.redisManager.disconnect();
        }
    }, 15000);

    it('should retry a message until max attempts and then move to DLQ', async () => {
        // 1. Modify config for the existing queue instance
        // Store original values to restore later
        const originalTimeout = queue.config.ack_timeout_seconds;
        const originalMaxAttempts = queue.config.max_attempts;

        // We cast to any to avoid readonly issues if defined as such
        (queue.config as any).ack_timeout_seconds = 1;
        (queue.config as any).max_attempts = 2;

        try {
            // 2. Enqueue a message
            const payload = { data: 'retry-test' };
            await queue.enqueueMessage({ type: 'retry-job', payload });

            // 3. First Dequeue (Attempt 1)
            // timeout=1s to wait for message, ackTimeout=1s
            const msg1 = await queue.dequeueMessage(1, 1);
            expect(msg1).not.toBeNull();
            expect(msg1?.type).toBe('retry-job');
            
            // Verify attempt count in metadata
            let metadata = await queue.redisManager.redis.hget(
                queue.config.metadata_hash_name, 
                msg1!.id
            );
            expect(JSON.parse(metadata!)).toHaveProperty('attempt_count', 1);

            // 4. Simulate Timeout (Wait 1.1s)
            await new Promise(resolve => setTimeout(resolve, 1100));

            // 5. Trigger Requeue Logic
            const requeuedCount = await queue.requeueFailedMessages();
            expect(requeuedCount).toBe(1); // Should have requeued 1 message

            // 6. Second Dequeue (Attempt 2)
            const msg2 = await queue.dequeueMessage(1, 1);
            expect(msg2).not.toBeNull();
            expect(msg2?.payload).toEqual(payload);
            expect(msg2?.id).toBe(msg1?.id);

            // Verify attempt count
            metadata = await queue.redisManager.redis.hget(
                queue.config.metadata_hash_name, 
                msg2!.id
            );
            expect(JSON.parse(metadata!)).toHaveProperty('attempt_count', 2);

            // 7. Simulate Timeout Again (Wait 1.1s)
            await new Promise(resolve => setTimeout(resolve, 1100));

            // 8. Trigger Requeue Logic (Should move to DLQ now)
            // Because attempt_count (2) >= max_attempts (2)
            await queue.requeueFailedMessages();

            // 9. Verify DLQ
            const dlqMessages = await queue.redisManager.redis.xrange(
                queue.config.dead_letter_queue_name, 
                '-', 
                '+'
            );
            expect(dlqMessages.length).toBe(1);
            
            // Check content of DLQ message
            const [dlqStreamId, dlqFields] = dlqMessages[0];
            const dlqDataStr = dlqFields[1];
            const dlqData = JSON.parse(dlqDataStr);
            expect(dlqData.id).toBe(msg1?.id);
            expect(dlqData.last_error).toContain('Max attempts exceeded');

            // 10. Verify Main Queue is Empty
            const mainMessages = await queue.redisManager.redis.xrange(
                queue.config.queue_name,
                '-',
                '+'
            );
            expect(mainMessages.length).toBe(0);
        } finally {
            // Restore original config
            (queue.config as any).ack_timeout_seconds = originalTimeout;
            (queue.config as any).max_attempts = originalMaxAttempts;
        }
    }, 15000);

    it('should preserve custom_max_attempts on messages moved to DLQ', async () => {
        const originalTimeout = queue.config.ack_timeout_seconds;
        const originalMaxAttempts = queue.config.max_attempts;

        (queue.config as any).ack_timeout_seconds = 1;
        (queue.config as any).max_attempts = 10;

        try {
            const payload = { data: 'custom-attempts-test' };
            await queue.enqueueMessage({ type: 'retry-job', payload, custom_max_attempts: 2 });

            const msg1 = await queue.dequeueMessage(1, 1);
            expect(msg1).not.toBeNull();
            expect(msg1?.id).toBeTruthy();

            await new Promise(resolve => setTimeout(resolve, 1100));
            const requeuedCount = await queue.requeueFailedMessages();
            expect(requeuedCount).toBe(1);

            const msg2 = await queue.dequeueMessage(1, 1);
            expect(msg2).not.toBeNull();
            expect(msg2?.id).toBe(msg1?.id);

            await new Promise(resolve => setTimeout(resolve, 1100));
            await queue.requeueFailedMessages();

            const dlqMessages = await queue.redisManager.redis.xrange(
                queue.config.dead_letter_queue_name,
                '-',
                '+'
            );
            expect(dlqMessages.length).toBe(1);

            const [, dlqFields] = dlqMessages[0];
            const dlqDataStr = dlqFields[1];
            const dlqData = JSON.parse(dlqDataStr);
            expect(dlqData.id).toBe(msg1?.id);
            expect(dlqData.custom_max_attempts).toBe(2);
        } finally {
            (queue.config as any).ack_timeout_seconds = originalTimeout;
            (queue.config as any).max_attempts = originalMaxAttempts;
        }
    }, 15000);
  });
});
