import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { testClient } from 'hono/testing';

// Mock env using importActual to preserve connection details but override DB/Queue
vi.mock('../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../config/env')>('../../config/env');
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
import { queue as apiQueue } from './queue.handlers';
import { OptimizedRedisQueue, QueueConfig } from '../../lib/redis.js';
import env from '../../config/env';
  
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

  // Dequeue by Type
  describe('GET /queue/message?type=...', () => {
    it('should dequeue only messages of the specified type', async () => {
      // 1. Enqueue messages of different types
      await testClient(router).queue.message.$post({ json: { type: 'type-a', payload: { id: 1 } } });
      await testClient(router).queue.message.$post({ json: { type: 'type-b', payload: { id: 2 } } });
      await testClient(router).queue.message.$post({ json: { type: 'type-a', payload: { id: 3 } } });

      // 2. Dequeue by type-b
      const res = await testClient(router).queue.message.$get({
        query: { type: 'type-b' }
      });
      expect(res.status).toBe(200);
      const message = await res.json();
      expect(message.type).toBe('type-b');
      expect(message.payload.id).toBe(2);

      // 3. Verify type-b is moved to processing (via PEL in test context)
      const processingRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      const processing = await processingRes.json();
      expect(processing.messages.some((m: any) => m.id === message.id)).toBe(true);

      // 4. Dequeue again by type-a
      const res2 = await testClient(router).queue.message.$get({
        query: { type: 'type-a' }
      });
      expect(res2.status).toBe(200);
      const message2 = await res2.json();
      expect(message2.type).toBe('type-a');
      expect(message2.payload.id).toBe(1); // Should be the first type-a
    }, 15000);

    it('should dequeue higher priority messages first within the same type', async () => {
      // 1. Enqueue Low Priority (p=0) - Old
      await testClient(router).queue.message.$post({ 
        json: { type: 'priority-test', payload: { id: 'low', p: 0 }, priority: 0 } 
      });

      // 2. Enqueue High Priority (p=5) - New
      await testClient(router).queue.message.$post({ 
        json: { type: 'priority-test', payload: { id: 'high', p: 5 }, priority: 5 } 
      });

      // 3. Dequeue
      const res1 = await testClient(router).queue.message.$get({
        query: { type: 'priority-test' }
      });
      expect(res1.status).toBe(200);
      const msg1 = await res1.json();
      
      // Expect High Priority First
      expect(msg1.priority).toBe(5);
      expect(msg1.payload.id).toBe('high');

      // 4. Dequeue Next
      const res2 = await testClient(router).queue.message.$get({
        query: { type: 'priority-test' }
      });
      expect(res2.status).toBe(200);
      const msg2 = await res2.json();
      
      expect(msg2.priority).toBe(0);
      expect(msg2.payload.id).toBe('low');
    }, 15000);

    it('should return 404 when no message of the specified type exists', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'type-a', payload: { id: 1 } } });

      const res = await testClient(router).queue.message.$get({
        query: { type: 'type-non-existent', timeout: 1 } // 1 second timeout
      });
      expect(res.status).toBe(404);
    }, 15000);
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

    it('should sort messages by created_at ascending', async () => {
      // Add messages with slight delay to ensure different timestamps
      await testClient(router).queue.message.$post({ json: { type: 'sort-created-test-1', payload: { order: 1 } } });
      await new Promise(resolve => setTimeout(resolve, 50));
      await testClient(router).queue.message.$post({ json: { type: 'sort-created-test-2', payload: { order: 2 } } });
      await new Promise(resolve => setTimeout(resolve, 50));
      await testClient(router).queue.message.$post({ json: { type: 'sort-created-test-3', payload: { order: 3 } } });

      // Get messages sorted by created_at ascending (oldest first)
      const res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { sortBy: 'created_at', sortOrder: 'asc' }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      // Filter to our test messages
      const testMsgs = result.messages.filter((m: any) => m.type?.startsWith('sort-created-test-'));
      expect(testMsgs.length).toBeGreaterThanOrEqual(3);

      // Verify ascending order (each created_at should be >= previous)
      for (let i = 1; i < testMsgs.length; i++) {
        expect(testMsgs[i].created_at).toBeGreaterThanOrEqual(testMsgs[i - 1].created_at);
      }
    });

    it('should sort messages by created_at descending', async () => {
      // Add messages with slight delay
      await testClient(router).queue.message.$post({ json: { type: 'sort-created-desc-1', payload: { order: 1 } } });
      await new Promise(resolve => setTimeout(resolve, 50));
      await testClient(router).queue.message.$post({ json: { type: 'sort-created-desc-2', payload: { order: 2 } } });
      await new Promise(resolve => setTimeout(resolve, 50));
      await testClient(router).queue.message.$post({ json: { type: 'sort-created-desc-3', payload: { order: 3 } } });

      // Get messages sorted by created_at descending (newest first)
      const res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { sortBy: 'created_at', sortOrder: 'desc' }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      // Filter to our test messages
      const testMsgs = result.messages.filter((m: any) => m.type?.startsWith('sort-created-desc-'));
      expect(testMsgs.length).toBeGreaterThanOrEqual(3);

      // Verify descending order (each created_at should be <= previous)
      for (let i = 1; i < testMsgs.length; i++) {
        expect(testMsgs[i].created_at).toBeLessThanOrEqual(testMsgs[i - 1].created_at);
      }
    });

    it('should sort messages by type alphabetically ascending', async () => {
      // Add messages with different types
      await testClient(router).queue.message.$post({ json: { type: 'zulu-sort-type', payload: {} } });
      await testClient(router).queue.message.$post({ json: { type: 'alpha-sort-type', payload: {} } });
      await testClient(router).queue.message.$post({ json: { type: 'mike-sort-type', payload: {} } });

      // Get messages sorted by type ascending
      const res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { sortBy: 'type', sortOrder: 'asc' }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      // Filter to our test messages
      const testMsgs = result.messages.filter((m: any) => m.type?.endsWith('-sort-type'));
      expect(testMsgs.length).toBeGreaterThanOrEqual(3);

      // Verify alphabetical ascending order
      for (let i = 1; i < testMsgs.length; i++) {
        expect(testMsgs[i].type.localeCompare(testMsgs[i - 1].type)).toBeGreaterThanOrEqual(0);
      }
    });

    it('should sort messages by type alphabetically descending', async () => {
      // Add messages with different types
      await testClient(router).queue.message.$post({ json: { type: 'zulu-sort-type-desc', payload: {} } });
      await testClient(router).queue.message.$post({ json: { type: 'alpha-sort-type-desc', payload: {} } });
      await testClient(router).queue.message.$post({ json: { type: 'mike-sort-type-desc', payload: {} } });

      // Get messages sorted by type descending
      const res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { sortBy: 'type', sortOrder: 'desc' }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      // Filter to our test messages
      const testMsgs = result.messages.filter((m: any) => m.type?.endsWith('-sort-type-desc'));
      expect(testMsgs.length).toBeGreaterThanOrEqual(3);

      // Verify alphabetical descending order
      for (let i = 1; i < testMsgs.length; i++) {
        expect(testMsgs[i].type.localeCompare(testMsgs[i - 1].type)).toBeLessThanOrEqual(0);
      }
    });

    it('should sort messages by priority', async () => {
      // Add messages with different priorities
      await testClient(router).queue.message.$post({ json: { type: 'priority-sort-test', priority: 1, payload: { p: 1 } } });
      await testClient(router).queue.message.$post({ json: { type: 'priority-sort-test', priority: 5, payload: { p: 5 } } });
      await testClient(router).queue.message.$post({ json: { type: 'priority-sort-test', priority: 3, payload: { p: 3 } } });

      // Get messages sorted by priority ascending
      const resAsc = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { sortBy: 'priority', sortOrder: 'asc', filterType: 'priority-sort-test' }
      });
      expect(resAsc.status).toBe(200);
      const resultAsc = await resAsc.json() as any;

      // Verify ascending order
      for (let i = 1; i < resultAsc.messages.length; i++) {
        expect(resultAsc.messages[i].priority).toBeGreaterThanOrEqual(resultAsc.messages[i - 1].priority);
      }

      // Get messages sorted by priority descending
      const resDesc = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { sortBy: 'priority', sortOrder: 'desc', filterType: 'priority-sort-test' }
      });
      expect(resDesc.status).toBe(200);
      const resultDesc = await resDesc.json() as any;

      // Verify descending order
      for (let i = 1; i < resultDesc.messages.length; i++) {
        expect(resultDesc.messages[i].priority).toBeLessThanOrEqual(resultDesc.messages[i - 1].priority);
      }
    });

    it('should sort messages by id', async () => {
      // Add a few messages with a unique type for this test run
      const testType = `id-sort-main-${Date.now()}`;
      await testClient(router).queue.message.$post({ json: { type: testType, payload: { n: 1 } } });
      await testClient(router).queue.message.$post({ json: { type: testType, payload: { n: 2 } } });
      await testClient(router).queue.message.$post({ json: { type: testType, payload: { n: 3 } } });

      // Get messages sorted by id ascending
      const resAsc = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { sortBy: 'id', sortOrder: 'asc', filterType: testType }
      });
      expect(resAsc.status).toBe(200);
      const resultAsc = await resAsc.json() as any;

      expect(resultAsc.messages.length).toBe(3);

      // The messages should be sorted by id - verify by comparing to manually sorted
      const idsAsc = resultAsc.messages.map((m: any) => m.id);
      const sortedAsc = [...idsAsc].sort((a: string, b: string) => a < b ? -1 : a > b ? 1 : 0);
      expect(idsAsc).toEqual(sortedAsc);

      // Get messages sorted by id descending
      const resDesc = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { sortBy: 'id', sortOrder: 'desc', filterType: testType }
      });
      expect(resDesc.status).toBe(200);
      const resultDesc = await resDesc.json() as any;

      expect(resultDesc.messages.length).toBe(3);

      // The messages should be sorted by id descending
      const idsDesc = resultDesc.messages.map((m: any) => m.id);
      const sortedDesc = [...idsDesc].sort((a: string, b: string) => a > b ? -1 : a < b ? 1 : 0);
      expect(idsDesc).toEqual(sortedDesc);
    });

    // Acknowledged queue sorting tests
    describe('acknowledged queue sorting', () => {
      // Helper function to create acknowledged messages
      async function createAcknowledgedMessage(type: string, priority: number = 0) {
        // Enqueue
        await testClient(router).queue.message.$post({
          json: { type, priority, payload: { type, priority } }
        });

        // Dequeue
        const dequeueRes = await testClient(router).queue.message.$get({
          query: { timeout: '1', type }
        });
        if (dequeueRes.status !== 200) return null;

        const msg = await dequeueRes.json() as any;

        // Acknowledge
        await testClient(router).queue.ack.$post({
          json: {
            id: msg.id,
            _stream_id: msg._stream_id,
            _stream_name: msg._stream_name
          }
        });

        return msg;
      }

      it('should sort acknowledged messages by id', async () => {
        // Create acknowledged messages with a unique type for this test run
        const testType = `ack-id-sort-${Date.now()}`;
        await createAcknowledgedMessage(testType);
        await createAcknowledgedMessage(testType);
        await createAcknowledgedMessage(testType);

        // Get messages sorted by id ascending, filtered by type (use higher limit to ensure we get all)
        const resAsc = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'acknowledged' },
          query: { sortBy: 'id', sortOrder: 'asc', filterType: testType, limit: '100' }
        });
        expect(resAsc.status).toBe(200);
        const resultAsc = await resAsc.json() as any;

        expect(resultAsc.messages.length).toBe(3);

        // Verify ascending order - the filtered results should be sorted
        for (let i = 1; i < resultAsc.messages.length; i++) {
          expect(resultAsc.messages[i].id.localeCompare(resultAsc.messages[i - 1].id)).toBeGreaterThanOrEqual(0);
        }

        // Get messages sorted by id descending, filtered by type
        const resDesc = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'acknowledged' },
          query: { sortBy: 'id', sortOrder: 'desc', filterType: testType, limit: '100' }
        });
        expect(resDesc.status).toBe(200);
        const resultDesc = await resDesc.json() as any;

        expect(resultDesc.messages.length).toBe(3);

        // Verify descending order
        for (let i = 1; i < resultDesc.messages.length; i++) {
          expect(resultDesc.messages[i].id.localeCompare(resultDesc.messages[i - 1].id)).toBeLessThanOrEqual(0);
        }
      });

      it('should sort acknowledged messages by type', async () => {
        // Create acknowledged messages with different types (all ending with same suffix for filtering)
        await createAcknowledgedMessage('zulu-ack-type-test');
        await createAcknowledgedMessage('alpha-ack-type-test');
        await createAcknowledgedMessage('mike-ack-type-test');

        // Get all messages then filter (type sort with filter doesn't work well for different types)
        const resAsc = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'acknowledged' },
          query: { sortBy: 'type', sortOrder: 'asc' }
        });
        expect(resAsc.status).toBe(200);
        const resultAsc = await resAsc.json() as any;
        const testMsgsAsc = resultAsc.messages.filter((m: any) => m.type?.endsWith('-ack-type-test'));

        expect(testMsgsAsc.length).toBeGreaterThanOrEqual(3);

        // Verify alphabetical ascending order
        for (let i = 1; i < testMsgsAsc.length; i++) {
          expect(testMsgsAsc[i].type.localeCompare(testMsgsAsc[i - 1].type)).toBeGreaterThanOrEqual(0);
        }

        // Get messages sorted by type descending
        const resDesc = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'acknowledged' },
          query: { sortBy: 'type', sortOrder: 'desc' }
        });
        expect(resDesc.status).toBe(200);
        const resultDesc = await resDesc.json() as any;
        const testMsgsDesc = resultDesc.messages.filter((m: any) => m.type?.endsWith('-ack-type-test'));

        expect(testMsgsDesc.length).toBeGreaterThanOrEqual(3);

        // Verify alphabetical descending order
        for (let i = 1; i < testMsgsDesc.length; i++) {
          expect(testMsgsDesc[i].type.localeCompare(testMsgsDesc[i - 1].type)).toBeLessThanOrEqual(0);
        }
      });

      it('should sort acknowledged messages by priority', async () => {
        // Create acknowledged messages with different priorities
        await createAcknowledgedMessage('ack-priority-sort', 1);
        await createAcknowledgedMessage('ack-priority-sort', 5);
        await createAcknowledgedMessage('ack-priority-sort', 3);

        // Get messages sorted by priority ascending
        const resAsc = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'acknowledged' },
          query: { sortBy: 'priority', sortOrder: 'asc', filterType: 'ack-priority-sort' }
        });
        expect(resAsc.status).toBe(200);
        const resultAsc = await resAsc.json() as any;

        // Verify ascending order
        for (let i = 1; i < resultAsc.messages.length; i++) {
          expect(resultAsc.messages[i].priority).toBeGreaterThanOrEqual(resultAsc.messages[i - 1].priority);
        }

        // Get messages sorted by priority descending
        const resDesc = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'acknowledged' },
          query: { sortBy: 'priority', sortOrder: 'desc', filterType: 'ack-priority-sort' }
        });
        expect(resDesc.status).toBe(200);
        const resultDesc = await resDesc.json() as any;

        // Verify descending order
        for (let i = 1; i < resultDesc.messages.length; i++) {
          expect(resultDesc.messages[i].priority).toBeLessThanOrEqual(resultDesc.messages[i - 1].priority);
        }
      });

      it('should sort acknowledged messages by attempt_count', async () => {
        // Create acknowledged messages with a unique type
        const testType = 'ack-attempts-sort-test';
        await createAcknowledgedMessage(testType);
        await createAcknowledgedMessage(testType);
        await createAcknowledgedMessage(testType);

        // Get messages sorted by attempt_count ascending, filtered by type
        const resAsc = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'acknowledged' },
          query: { sortBy: 'attempt_count', sortOrder: 'asc', filterType: testType }
        });
        expect(resAsc.status).toBe(200);
        const resultAsc = await resAsc.json() as any;

        expect(resultAsc.messages.length).toBeGreaterThanOrEqual(3);

        // Verify ascending order (all should have attempt_count = 1)
        for (let i = 1; i < resultAsc.messages.length; i++) {
          expect(resultAsc.messages[i].attempt_count).toBeGreaterThanOrEqual(resultAsc.messages[i - 1].attempt_count);
        }

        // Get messages sorted by attempt_count descending, filtered by type
        const resDesc = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'acknowledged' },
          query: { sortBy: 'attempt_count', sortOrder: 'desc', filterType: testType }
        });
        expect(resDesc.status).toBe(200);
        const resultDesc = await resDesc.json() as any;

        expect(resultDesc.messages.length).toBeGreaterThanOrEqual(3);

        // Verify descending order
        for (let i = 1; i < resultDesc.messages.length; i++) {
          expect(resultDesc.messages[i].attempt_count).toBeLessThanOrEqual(resultDesc.messages[i - 1].attempt_count);
        }
      });
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
          expect(msg.last_error).toBe("Manually moved to Failed Queue");
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

    it('should track the correct worker name (consumer_id) when passed as parameter', async () => {
      // 1. Enqueue a message
      await testClient(router).queue.message.$post({ json: { type: 'worker-test', payload: { n: 1 } } });

      // 2. Dequeue with a specific consumerId
      const workerName = 'my-worker-1';
      const res = await testClient(router).queue.message.$get({ 
        query: { timeout: '1', consumerId: workerName } 
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      
      // 3. Verify consumer_id is returned in the response
      expect(result.consumer_id).toBe(workerName);
      
      // 4. Verify consumer_id is stored in metadata
      const metadataJson = await queue.redisManager.redis.hget(
        queue.config.metadata_hash_name,
        result.id
      );
      expect(metadataJson).toBeTruthy();
      const metadata = JSON.parse(metadataJson!);
      expect(metadata.consumer_id).toBe(workerName);
    });

    it('should track different worker names for different dequeues', async () => {
      // 1. Enqueue two messages
      await testClient(router).queue.message.$post({ json: { type: 'multi-worker', payload: { n: 1 } } });
      await testClient(router).queue.message.$post({ json: { type: 'multi-worker', payload: { n: 2 } } });

      // 2. Dequeue with worker-1
      const res1 = await testClient(router).queue.message.$get({ 
        query: { timeout: '1', consumerId: 'worker-1' } 
      });
      expect(res1.status).toBe(200);
      const msg1 = await res1.json();
      expect(msg1.consumer_id).toBe('worker-1');

      // 3. Dequeue with worker-2
      const res2 = await testClient(router).queue.message.$get({ 
        query: { timeout: '1', consumerId: 'worker-2' } 
      });
      expect(res2.status).toBe(200);
      const msg2 = await res2.json();
      expect(msg2.consumer_id).toBe('worker-2');

      // 4. Verify processing queue shows correct consumer_ids
      const processingRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      expect(processingRes.status).toBe(200);
      const processing = await processingRes.json();
      
      const processingMessages = processing.messages || [];
      expect(processingMessages.length).toBe(2);
      
      const worker1Msg = processingMessages.find((m: any) => m.id === msg1.id);
      const worker2Msg = processingMessages.find((m: any) => m.id === msg2.id);
      
      expect(worker1Msg?.consumer_id).toBe('worker-1');
      expect(worker2Msg?.consumer_id).toBe('worker-2');
    }, 15000);

    it('should have null consumer_id when no consumerId is passed', async () => {
      // 1. Enqueue a message
      await testClient(router).queue.message.$post({ json: { type: 'no-consumer', payload: { n: 1 } } });

      // 2. Dequeue WITHOUT consumerId
      const res = await testClient(router).queue.message.$get({ query: { timeout: '1' } });

      expect(res.status).toBe(200);
      const result = await res.json();
      
      // 3. consumer_id should be null (not a random generated ID)
      expect(result.consumer_id).toBeNull();
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

  // Nack Message
  describe('POST /queue/message/:messageId/nack', () => {
    it('should requeue a message when nacked', async () => {
      // 1. Enqueue
      await testClient(router).queue.message.$post({ json: { type: 'nack-test', payload: { n: 1 } } });
      
      // 2. Dequeue
      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
      expect(dequeueRes.status).toBe(200);
      const msg = await dequeueRes.json();
      
      // 3. Nack
      const nackRes = await testClient(router).queue.message[':messageId'].nack.$post({
        param: { messageId: msg.id },
        json: { errorReason: 'Test failure' }
      });
      
      expect(nackRes.status).toBe(200);
      
      // 4. Verify it's back in queue
      const dequeue2Res = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
      expect(dequeue2Res.status).toBe(200);
      const msg2 = await dequeue2Res.json();
      expect(msg2.id).toBe(msg.id);
      expect(msg2.last_error).toBe('Test failure');
      
      // Verify attempt count increased
      // First dequeue -> attempt=1.
      // Nack -> keeps metadata attempt=1.
      // Second dequeue -> attempt=2.
      expect(msg2.attempt_count).toBe(2);
    });

    it('should move to DLQ when nacked and max attempts exceeded', async () => {
       // Mock config for max attempts on the API queue instance
       const originalMaxAttempts = apiQueue.config.max_attempts;
       (apiQueue.config as any).max_attempts = 1;

       try {
         await testClient(router).queue.message.$post({ json: { type: 'nack-dlq', payload: {} } });
         
         const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
         const msg = await dequeueRes.json();
         // attempt = 1. max = 1.
         // If we nack now, it should check attempt_count (1) >= max (1) -> DLQ.
         
         const nackRes = await testClient(router).queue.message[':messageId'].nack.$post({
            param: { messageId: msg.id },
            json: { errorReason: 'Fatal error' }
         });
         expect(nackRes.status).toBe(200);

         // Verify in DLQ
         const dlqRes = await testClient(router).queue[':queueType'].messages.$get({
            param: { queueType: 'dead' }
         });
         const dlq = await dlqRes.json();
         expect((dlq.messages || []).length).toBe(1);
         expect(dlq.messages[0].id).toBe(msg.id);
         expect(dlq.messages[0].last_error).toBe('Fatal error');
       } finally {
         (apiQueue.config as any).max_attempts = originalMaxAttempts;
       }
    });
  });

  // Split Brain Prevention - Touch and Lock Validation (using lock_token)
  describe('Split Brain Prevention - Touch and Lock Validation', () => {
    describe('PUT /queue/message/:messageId/touch', () => {
      it('should extend the lock timeout successfully with lock_token', async () => {
        // 1. Enqueue and dequeue a message
        await testClient(router).queue.message.$post({ json: { type: 'touch-test', payload: { n: 1 } } });
        const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
        expect(dequeueRes.status).toBe(200);
        const msg = await dequeueRes.json();
        
        // Verify lock_token is returned
        expect(msg.lock_token).toBeDefined();
        expect(typeof msg.lock_token).toBe('string');
        
        // 2. Touch the message with correct lock_token
        const touchRes = await testClient(router).queue.message[':messageId'].touch.$put({
          param: { messageId: msg.id },
          json: { lock_token: msg.lock_token }
        });
        
        expect(touchRes.status).toBe(200);
        const result = await touchRes.json();
        expect(result.message).toBe('Lock extended successfully');
        expect(result.new_timeout_at).toBeGreaterThan(Date.now() / 1000);
        expect(result.extended_by).toBeGreaterThan(0);
        expect(result.lock_token).toBe(msg.lock_token);
      });

      it('should return 409 when lock_token does not match (lock lost)', async () => {
        // 1. Enqueue and dequeue a message
        await testClient(router).queue.message.$post({ json: { type: 'touch-conflict', payload: { n: 1 } } });
        const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
        expect(dequeueRes.status).toBe(200);
        const msg = await dequeueRes.json();
        
        // 2. Try to touch with wrong lock_token (simulating stale worker)
        const touchRes = await testClient(router).queue.message[':messageId'].touch.$put({
          param: { messageId: msg.id },
          json: { lock_token: 'wrong-token-xyz' }
        });
        
        expect(touchRes.status).toBe(409);
        const result = await touchRes.json();
        expect(result.error).toBe('LOCK_LOST');
      });

      it('should return 404 when message is not in processing', async () => {
        // Try to touch a non-existent message
        const touchRes = await testClient(router).queue.message[':messageId'].touch.$put({
          param: { messageId: 'non-existent-id' },
          json: { lock_token: 'any-token' }
        });
        
        expect(touchRes.status).toBe(404);
      });

      it('should allow multiple touch calls to keep extending the lock', async () => {
        // 1. Enqueue and dequeue
        await testClient(router).queue.message.$post({ json: { type: 'multi-touch', payload: { n: 1 } } });
        const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
        const msg = await dequeueRes.json();
        
        // 2. First touch
        const touch1Res = await testClient(router).queue.message[':messageId'].touch.$put({
          param: { messageId: msg.id },
          json: { lock_token: msg.lock_token }
        });
        expect(touch1Res.status).toBe(200);
        const touch1 = await touch1Res.json();
        
        // 3. Second touch (should still work with same lock_token)
        const touch2Res = await testClient(router).queue.message[':messageId'].touch.$put({
          param: { messageId: msg.id },
          json: { lock_token: msg.lock_token }
        });
        expect(touch2Res.status).toBe(200);
        const touch2 = await touch2Res.json();
        
        // The new timeout should be later than the first
        expect(touch2.new_timeout_at).toBeGreaterThanOrEqual(touch1.new_timeout_at);
      });
    });

    describe('POST /queue/ack - Lock Validation', () => {
      it('should acknowledge successfully with matching lock_token', async () => {
        // 1. Enqueue and dequeue
        await testClient(router).queue.message.$post({ json: { type: 'ack-lock-test', payload: { n: 1 } } });
        const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
        const msg = await dequeueRes.json();
        
        // 2. Acknowledge with lock_token (lock validation)
        const ackRes = await testClient(router).queue.ack.$post({
          json: {
            id: msg.id,
            _stream_id: msg._stream_id,
            _stream_name: msg._stream_name,
            lock_token: msg.lock_token
          }
        });
        
        expect(ackRes.status).toBe(200);
        const result = await ackRes.json();
        expect(result.message).toBe('Message acknowledged');
      });

      it('should return 409 when lock_token does not match (stale ACK)', async () => {
        // 1. Enqueue and dequeue
        await testClient(router).queue.message.$post({ json: { type: 'stale-ack', payload: { n: 1 } } });
        const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
        const msg = await dequeueRes.json();
        
        // 2. Try to acknowledge with wrong lock_token
        const ackRes = await testClient(router).queue.ack.$post({
          json: {
            id: msg.id,
            _stream_id: msg._stream_id,
            _stream_name: msg._stream_name,
            lock_token: 'wrong-token-abc' // Wrong - simulating stale worker
          }
        });
        
        expect(ackRes.status).toBe(409);
        const result = await ackRes.json();
        expect(result.error).toBe('LOCK_LOST');
      });

      it('should still accept ACK without lock_token for backward compatibility', async () => {
        // 1. Enqueue and dequeue
        await testClient(router).queue.message.$post({ json: { type: 'no-lock-ack', payload: { n: 1 } } });
        const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
        const msg = await dequeueRes.json();
        
        // 2. Acknowledge WITHOUT lock_token (backward compatible)
        const ackRes = await testClient(router).queue.ack.$post({
          json: {
            id: msg.id,
            _stream_id: msg._stream_id,
            _stream_name: msg._stream_name
            // No lock_token - should still work
          }
        });
        
        expect(ackRes.status).toBe(200);
      });
    });

    describe('Split Brain Scenario Simulation', () => {
      it('should reject ACK from slow worker after message was re-queued (different lock_token)', async () => {
        // This test simulates the split brain scenario:
        // 1. Worker A dequeues message (gets lock_token_A)
        // 2. Message times out and is re-queued
        // 3. Worker B dequeues the same message (gets NEW lock_token_B)
        // 4. Worker A tries to ACK with lock_token_A (should be rejected)

        const originalTimeout = apiQueue.config.ack_timeout_seconds;
        (apiQueue.config as any).ack_timeout_seconds = 1;

        try {
          // 1. Enqueue a message
          await testClient(router).queue.message.$post({ json: { type: 'split-brain', payload: { test: 1 } } });

          // 2. Worker A dequeues (gets lock_token_A)
          const workerADequeue = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
          expect(workerADequeue.status).toBe(200);
          const workerAMsg = await workerADequeue.json();
          expect(workerAMsg.lock_token).toBeDefined();
          
          // Store Worker A's lock_token
          const workerALockToken = workerAMsg.lock_token;

          // 3. Simulate timeout - wait for message to be considered stale
          await new Promise(resolve => setTimeout(resolve, 1100));
          
          // 4. Trigger requeue
          const requeueCount = await apiQueue.requeueFailedMessages();
          expect(requeueCount).toBe(1);

          // 5. Worker B dequeues the re-queued message (gets NEW lock_token)
          const workerBDequeue = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
          expect(workerBDequeue.status).toBe(200);
          const workerBMsg = await workerBDequeue.json();
          expect(workerBMsg.id).toBe(workerAMsg.id); // Same message
          expect(workerBMsg.lock_token).not.toBe(workerALockToken); // Different lock_token!

          // 6. Worker A (slow) tries to ACK with old lock_token - should be REJECTED
          const workerAAck = await testClient(router).queue.ack.$post({
            json: {
              id: workerAMsg.id,
              _stream_id: workerBMsg._stream_id,
              _stream_name: workerBMsg._stream_name,
              lock_token: workerALockToken // OLD lock_token
            }
          });
          
          expect(workerAAck.status).toBe(409);
          const workerAResult = await workerAAck.json();
          expect(workerAResult.error).toBe('LOCK_LOST');

          // 7. Worker B can still ACK successfully with its lock_token
          const workerBAck = await testClient(router).queue.ack.$post({
            json: {
              id: workerBMsg.id,
              _stream_id: workerBMsg._stream_id,
              _stream_name: workerBMsg._stream_name,
              lock_token: workerBMsg.lock_token // Current lock_token
            }
          });
          
          expect(workerBAck.status).toBe(200);

        } finally {
          (apiQueue.config as any).ack_timeout_seconds = originalTimeout;
        }
      }, 15000);

      it('should allow touch to prevent timeout during heavy processing', async () => {
        const originalTimeout = apiQueue.config.ack_timeout_seconds;
        (apiQueue.config as any).ack_timeout_seconds = 2;

        try {
          // 1. Enqueue and dequeue
          await testClient(router).queue.message.$post({ json: { type: 'heavy-task', payload: { size: 'large' } } });
          const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
          const msg = await dequeueRes.json();

          // 2. Simulate heavy processing with periodic touch
          // Wait 1.5 seconds (would timeout at 2s without touch)
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // 3. Touch to extend the lock
          const touchRes = await testClient(router).queue.message[':messageId'].touch.$put({
            param: { messageId: msg.id },
            json: { lock_token: msg.lock_token }
          });
          expect(touchRes.status).toBe(200);

          // 4. Wait another 1.5 seconds (total 3s, would have timed out without touch)
          await new Promise(resolve => setTimeout(resolve, 1500));

          // 5. Trigger requeue check - should NOT requeue because we touched
          const requeueCount = await apiQueue.requeueFailedMessages();
          expect(requeueCount).toBe(0);

          // 6. ACK should still work with same lock_token
          const ackRes = await testClient(router).queue.ack.$post({
            json: {
              id: msg.id,
              _stream_id: msg._stream_id,
              _stream_name: msg._stream_name,
              lock_token: msg.lock_token
            }
          });
          expect(ackRes.status).toBe(200);

        } finally {
          (apiQueue.config as any).ack_timeout_seconds = originalTimeout;
        }
      }, 15000);
    });
  });

  // Activity Log Tests
  describe('Activity Log Endpoints', () => {
    describe('GET /queue/activity', () => {
      it('should return empty logs when no activity exists', async () => {
        const res = await testClient(router).queue.activity.$get();
        expect(res.status).toBe(200);
        const result = await res.json();
        expect(result).toHaveProperty('logs');
        expect(result).toHaveProperty('pagination');
        expect(result.logs).toEqual([]);
      });

      it('should log enqueue events when messages are added', async () => {
        // Enqueue a message
        await testClient(router).queue.message.$post({ json: { type: 'activity-test', payload: { foo: 'bar' } } });

        // Wait briefly for async logging
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get activity logs
        const res = await testClient(router).queue.activity.$get({
          query: { action: 'enqueue' }
        });
        expect(res.status).toBe(200);
        const result = await res.json();
        expect(result.logs.length).toBeGreaterThanOrEqual(1);
        expect(result.logs[0].action).toBe('enqueue');
        expect(result.logs[0].message_type).toBe('activity-test');
      });

      it('should log dequeue events when messages are consumed', async () => {
        // Enqueue and dequeue a message
        await testClient(router).queue.message.$post({ json: { type: 'dequeue-log-test', payload: { n: 1 } } });
        const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
        expect(dequeueRes.status).toBe(200);
        const msg = await dequeueRes.json();

        // Wait briefly for async logging
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get activity logs filtered by message_id
        const res = await testClient(router).queue.activity.$get({
          query: { message_id: msg.id }
        });
        expect(res.status).toBe(200);
        const result = await res.json();
        
        const actions = result.logs.map((l: any) => l.action);
        expect(actions).toContain('enqueue');
        expect(actions).toContain('dequeue');
      });

      it('should log ack events when messages are acknowledged', async () => {
        // Enqueue, dequeue, and acknowledge
        await testClient(router).queue.message.$post({ json: { type: 'ack-log-test', payload: { n: 1 } } });
        const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
        const msg = await dequeueRes.json();
        
        await testClient(router).queue.ack.$post({
          json: {
            id: msg.id,
            _stream_id: msg._stream_id,
            _stream_name: msg._stream_name,
            lock_token: msg.lock_token
          }
        });

        // Wait briefly for async logging
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get activity logs
        const res = await testClient(router).queue.activity.$get({
          query: { message_id: msg.id }
        });
        expect(res.status).toBe(200);
        const result = await res.json();
        
        const actions = result.logs.map((l: any) => l.action);
        expect(actions).toContain('ack');
      });

      it('should filter logs by action type', async () => {
        // Create some activity
        await testClient(router).queue.message.$post({ json: { type: 'filter-test', payload: {} } });
        await testClient(router).queue.message.$get({ query: { timeout: '1' } });

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        // Filter by enqueue only
        const res = await testClient(router).queue.activity.$get({
          query: { action: 'enqueue' }
        });
        expect(res.status).toBe(200);
        const result = await res.json();
        
        // All returned logs should be enqueue actions
        for (const log of result.logs) {
          expect(log.action).toBe('enqueue');
        }
      });

      it('should filter logs by has_anomaly', async () => {
        // Enqueue and dequeue quickly (might trigger flash_message anomaly)
        await testClient(router).queue.message.$post({ json: { type: 'anomaly-filter-test', payload: {} } });
        await testClient(router).queue.message.$get({ query: { timeout: '1' } });

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get logs with anomalies
        const res = await testClient(router).queue.activity.$get({
          query: { has_anomaly: 'true' }
        });
        expect(res.status).toBe(200);
        const result = await res.json();
        
        // All returned logs should have anomaly
        for (const log of result.logs) {
          expect(log.anomaly).not.toBeNull();
        }
      });

      it('should support pagination', async () => {
        // Create multiple messages
        for (let i = 0; i < 5; i++) {
          await testClient(router).queue.message.$post({ json: { type: 'pagination-test', payload: { i } } });
        }

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get with limit
        const res = await testClient(router).queue.activity.$get({
          query: { limit: '2', offset: '0' }
        });
        expect(res.status).toBe(200);
        const result = await res.json();
        
        expect(result.logs.length).toBeLessThanOrEqual(2);
        expect(result.pagination).toHaveProperty('total');
        expect(result.pagination).toHaveProperty('limit');
        expect(result.pagination).toHaveProperty('offset');
        expect(result.pagination).toHaveProperty('has_more');
      });
    });

    describe('GET /queue/activity/message/:messageId', () => {
      it('should return full message history in chronological order', async () => {
        // Create a message with full lifecycle: enqueue -> dequeue -> ack
        await testClient(router).queue.message.$post({ json: { type: 'history-test', payload: { test: true } } });
        const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
        const msg = await dequeueRes.json();
        
        await testClient(router).queue.ack.$post({
          json: {
            id: msg.id,
            _stream_id: msg._stream_id,
            _stream_name: msg._stream_name,
            lock_token: msg.lock_token
          }
        });

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get message history
        const res = await testClient(router).queue.activity.message[':messageId'].$get({
          param: { messageId: msg.id }
        });
        expect(res.status).toBe(200);
        const result = await res.json();
        
        expect(result.message_id).toBe(msg.id);
        expect(result.history).toBeInstanceOf(Array);
        expect(result.history.length).toBeGreaterThanOrEqual(3); // enqueue, dequeue, ack
        
        // Verify chronological order (oldest first)
        const actions = result.history.map((h: any) => h.action);
        expect(actions[0]).toBe('enqueue');
        expect(actions[1]).toBe('dequeue');
        expect(actions[2]).toBe('ack');
        
        // Verify timestamps are in order
        for (let i = 1; i < result.history.length; i++) {
          expect(result.history[i].timestamp).toBeGreaterThanOrEqual(result.history[i-1].timestamp);
        }
      });

      it('should return empty history for non-existent message', async () => {
        const res = await testClient(router).queue.activity.message[':messageId'].$get({
          param: { messageId: 'non-existent-message-id' }
        });
        expect(res.status).toBe(200);
        const result = await res.json();
        
        expect(result.message_id).toBe('non-existent-message-id');
        expect(result.history).toEqual([]);
      });
    });

    describe('GET /queue/activity/anomalies', () => {
      it('should detect dlq_movement anomaly when message moves to DLQ', async () => {
        // Create and move message to DLQ
        await testClient(router).queue.message.$post({ json: { type: 'dlq-anomaly-test', payload: {} } });
        
        const listRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' },
          query: { filterType: 'dlq-anomaly-test' }
        });
        const list = await listRes.json();
        const msg = list.messages[0];

        // Move to DLQ
        await testClient(router).queue.move.$post({
          json: { messages: [msg], fromQueue: 'main', toQueue: 'dead', errorReason: 'Test DLQ move' }
        });

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get anomalies
        const res = await testClient(router).queue.activity.anomalies.$get();
        expect(res.status).toBe(200);
        const result = await res.json();
        
        expect(result).toHaveProperty('anomalies');
        expect(result).toHaveProperty('summary');
        
        // Should have dlq_movement anomaly
        const dlqAnomalies = result.anomalies.filter((a: any) => 
          a.anomaly?.type === 'dlq_movement' || a.anomaly?.type?.includes('dlq')
        );
        expect(dlqAnomalies.length).toBeGreaterThanOrEqual(1);
      });

      it('should filter anomalies by severity', async () => {
        // Create activity that might generate anomalies
        await testClient(router).queue.message.$post({ json: { type: 'severity-test', payload: {} } });
        
        const listRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' }
        });
        const list = await listRes.json();
        if (list.messages.length > 0) {
          await testClient(router).queue.move.$post({
            json: { messages: [list.messages[0]], fromQueue: 'main', toQueue: 'dead' }
          });
        }

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get only critical anomalies
        const res = await testClient(router).queue.activity.anomalies.$get({
          query: { severity: 'critical' }
        });
        expect(res.status).toBe(200);
        const result = await res.json();
        
        // All returned anomalies should be critical
        for (const log of result.anomalies) {
          if (log.anomaly) {
            expect(log.anomaly.severity).toBe('critical');
          }
        }
      });

      it('should return summary with counts by type and severity', async () => {
        // Create some activity
        await testClient(router).queue.message.$post({ json: { type: 'summary-test', payload: {} } });
        await testClient(router).queue.message.$get({ query: { timeout: '1' } });

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        const res = await testClient(router).queue.activity.anomalies.$get();
        expect(res.status).toBe(200);
        const result = await res.json();

        expect(result.summary).toHaveProperty('total');
        expect(result.summary).toHaveProperty('by_type');
        expect(result.summary).toHaveProperty('by_severity');
        expect(result.summary.by_severity).toHaveProperty('critical');
        expect(result.summary.by_severity).toHaveProperty('warning');
        expect(result.summary.by_severity).toHaveProperty('info');
      });

      it('should filter anomalies by action type', async () => {
        // Create DLQ movement anomaly via move action
        await testClient(router).queue.message.$post({ json: { type: 'action-filter-test', payload: {} } });

        const listRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' },
          query: { filterType: 'action-filter-test' }
        });
        const list = await listRes.json();
        const msg = list.messages[0];

        // Move to DLQ (this creates a 'move' action with dlq_movement anomaly)
        await testClient(router).queue.move.$post({
          json: { messages: [msg], fromQueue: 'main', toQueue: 'dead', errorReason: 'Test action filter' }
        });

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get anomalies filtered by 'move' action
        const res = await testClient(router).queue.activity.anomalies.$get({
          query: { action: 'move' }
        });
        expect(res.status).toBe(200);
        const result = await res.json();

        // All returned anomalies should be from 'move' actions
        for (const log of result.anomalies) {
          expect(log.action).toBe('move');
        }

        // Should have at least one anomaly (the dlq_movement)
        expect(result.anomalies.length).toBeGreaterThanOrEqual(1);
      });

      it('should filter anomalies by anomaly type', async () => {
        // Create DLQ movement anomaly
        await testClient(router).queue.message.$post({ json: { type: 'type-filter-test', payload: {} } });

        const listRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' },
          query: { filterType: 'type-filter-test' }
        });
        const list = await listRes.json();
        const msg = list.messages[0];

        // Move to DLQ to create dlq_movement anomaly
        await testClient(router).queue.move.$post({
          json: { messages: [msg], fromQueue: 'main', toQueue: 'dead', errorReason: 'Test type filter' }
        });

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get anomalies filtered by 'dlq_movement' type
        const res = await testClient(router).queue.activity.anomalies.$get({
          query: { type: 'dlq_movement' }
        });
        expect(res.status).toBe(200);
        const result = await res.json();

        // All returned anomalies should be dlq_movement type
        for (const log of result.anomalies) {
          expect(log.anomaly?.type).toBe('dlq_movement');
        }

        // Should have at least one anomaly
        expect(result.anomalies.length).toBeGreaterThanOrEqual(1);
      });

      it('should filter anomalies by both action and type', async () => {
        // Create DLQ movement anomaly via move action
        await testClient(router).queue.message.$post({ json: { type: 'combo-filter-test', payload: {} } });

        const listRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' },
          query: { filterType: 'combo-filter-test' }
        });
        const list = await listRes.json();
        const msg = list.messages[0];

        // Move to DLQ
        await testClient(router).queue.move.$post({
          json: { messages: [msg], fromQueue: 'main', toQueue: 'dead', errorReason: 'Test combo filter' }
        });

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get anomalies filtered by both action='move' and type='dlq_movement'
        const res = await testClient(router).queue.activity.anomalies.$get({
          query: { action: 'move', type: 'dlq_movement' }
        });
        expect(res.status).toBe(200);
        const result = await res.json();

        // All returned anomalies should match both filters
        for (const log of result.anomalies) {
          expect(log.action).toBe('move');
          expect(log.anomaly?.type).toBe('dlq_movement');
        }

        // Should have at least one anomaly
        expect(result.anomalies.length).toBeGreaterThanOrEqual(1);
      });

      it('should return empty results when filtering by non-matching action', async () => {
        // Create DLQ movement anomaly (which is a 'move' action)
        await testClient(router).queue.message.$post({ json: { type: 'empty-action-test', payload: {} } });

        const listRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' },
          query: { filterType: 'empty-action-test' }
        });
        const list = await listRes.json();
        const msg = list.messages[0];

        await testClient(router).queue.move.$post({
          json: { messages: [msg], fromQueue: 'main', toQueue: 'dead' }
        });

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get anomalies filtered by 'touch' action (should not match dlq_movement)
        const res = await testClient(router).queue.activity.anomalies.$get({
          query: { action: 'touch' }
        });
        expect(res.status).toBe(200);
        const result = await res.json();

        // Should not return any anomalies with 'touch' action (dlq_movement is from 'move')
        const touchAnomalies = result.anomalies.filter((a: any) => a.action === 'touch');
        expect(touchAnomalies.length).toBe(0);
      });

      it('should sort anomalies by timestamp - asc vs desc comparison', async () => {
        const testId = Date.now();
        // Create multiple DLQ movement anomalies with delay between them for distinct timestamps
        for (let i = 0; i < 3; i++) {
          await testClient(router).queue.message.$post({ json: { type: `sort-ts-compare-${testId}-${i}`, payload: { order: i } } });
          const listRes = await testClient(router).queue[':queueType'].messages.$get({
            param: { queueType: 'main' },
            query: { filterType: `sort-ts-compare-${testId}-${i}` }
          });
          const list = await listRes.json();
          const msg = list.messages[0];
          await testClient(router).queue.move.$post({
            json: { messages: [msg], fromQueue: 'main', toQueue: 'dead', errorReason: `Test ${i}` }
          });
          // Delay to ensure distinct timestamps
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Wait for activity logs
        await new Promise(resolve => setTimeout(resolve, 100));

        // Fetch BOTH asc and desc with same filter to get same dataset
        const resAsc = await testClient(router).queue.activity.anomalies.$get({
          query: { sort_by: 'timestamp', sort_order: 'asc' }
        });
        const resDesc = await testClient(router).queue.activity.anomalies.$get({
          query: { sort_by: 'timestamp', sort_order: 'desc' }
        });

        expect(resAsc.status).toBe(200);
        expect(resDesc.status).toBe(200);

        const resultAsc = await resAsc.json();
        const resultDesc = await resDesc.json();

        // Filter to only our test anomalies
        const ascAnomalies = resultAsc.anomalies.filter((a: any) =>
          a.anomaly?.type === 'dlq_movement' && a.message_type?.startsWith(`sort-ts-compare-${testId}`)
        );
        const descAnomalies = resultDesc.anomalies.filter((a: any) =>
          a.anomaly?.type === 'dlq_movement' && a.message_type?.startsWith(`sort-ts-compare-${testId}`)
        );

        // Verify we have our 3 test anomalies in both
        expect(ascAnomalies.length).toBe(3);
        expect(descAnomalies.length).toBe(3);

        // THE KEY TEST: first item in asc should equal last item in desc (and vice versa)
        expect(ascAnomalies[0].log_id).toBe(descAnomalies[2].log_id);
        expect(ascAnomalies[2].log_id).toBe(descAnomalies[0].log_id);

        // Verify asc order internally
        expect(ascAnomalies[0].timestamp).toBeLessThan(ascAnomalies[1].timestamp);
        expect(ascAnomalies[1].timestamp).toBeLessThan(ascAnomalies[2].timestamp);

        // Verify desc order internally
        expect(descAnomalies[0].timestamp).toBeGreaterThan(descAnomalies[1].timestamp);
        expect(descAnomalies[1].timestamp).toBeGreaterThan(descAnomalies[2].timestamp);
      });

      it('should sort anomalies by severity', async () => {
        // We need to create anomalies with different severities
        // dlq_movement = critical, flash_message = info/warning

        // Create a DLQ movement anomaly (critical)
        await testClient(router).queue.message.$post({ json: { type: 'sort-severity-test-1', payload: {} } });
        let listRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' },
          query: { filterType: 'sort-severity-test-1' }
        });
        let list = await listRes.json();
        let msg = list.messages[0];
        await testClient(router).queue.move.$post({
          json: { messages: [msg], fromQueue: 'main', toQueue: 'dead', errorReason: 'Test severity' }
        });

        // Create another DLQ movement anomaly with delay
        await new Promise(resolve => setTimeout(resolve, 50));
        await testClient(router).queue.message.$post({ json: { type: 'sort-severity-test-2', payload: {} } });
        listRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' },
          query: { filterType: 'sort-severity-test-2' }
        });
        list = await listRes.json();
        msg = list.messages[0];
        await testClient(router).queue.move.$post({
          json: { messages: [msg], fromQueue: 'main', toQueue: 'dead', errorReason: 'Test severity 2' }
        });

        // Wait for activity logs
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get anomalies sorted by severity ascending (info first, then warning, then critical)
        const resAsc = await testClient(router).queue.activity.anomalies.$get({
          query: { sort_by: 'severity', sort_order: 'asc' }
        });
        expect(resAsc.status).toBe(200);
        const resultAsc = await resAsc.json();

        // Get anomalies sorted by severity descending (critical first)
        const resDesc = await testClient(router).queue.activity.anomalies.$get({
          query: { sort_by: 'severity', sort_order: 'desc' }
        });
        expect(resDesc.status).toBe(200);
        const resultDesc = await resDesc.json();

        // Verify sorting - ascending should have lower severity first
        const severityOrder: Record<string, number> = { info: 1, warning: 2, critical: 3 };

        for (let i = 1; i < resultAsc.anomalies.length; i++) {
          const prevSev = severityOrder[resultAsc.anomalies[i - 1].anomaly?.severity] || 0;
          const currSev = severityOrder[resultAsc.anomalies[i].anomaly?.severity] || 0;
          expect(currSev).toBeGreaterThanOrEqual(prevSev);
        }

        // Verify descending - higher severity first
        for (let i = 1; i < resultDesc.anomalies.length; i++) {
          const prevSev = severityOrder[resultDesc.anomalies[i - 1].anomaly?.severity] || 0;
          const currSev = severityOrder[resultDesc.anomalies[i].anomaly?.severity] || 0;
          expect(currSev).toBeLessThanOrEqual(prevSev);
        }
      });

      it('should sort anomalies by type alphabetically', async () => {
        // Create anomalies that might have different types
        // dlq_movement type
        await testClient(router).queue.message.$post({ json: { type: 'sort-type-test-1', payload: {} } });
        let listRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' },
          query: { filterType: 'sort-type-test-1' }
        });
        let list = await listRes.json();
        let msg = list.messages[0];
        await testClient(router).queue.move.$post({
          json: { messages: [msg], fromQueue: 'main', toQueue: 'dead', errorReason: 'Test type sort' }
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        // Another dlq_movement
        await testClient(router).queue.message.$post({ json: { type: 'sort-type-test-2', payload: {} } });
        listRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' },
          query: { filterType: 'sort-type-test-2' }
        });
        list = await listRes.json();
        msg = list.messages[0];
        await testClient(router).queue.move.$post({
          json: { messages: [msg], fromQueue: 'main', toQueue: 'dead', errorReason: 'Test type sort 2' }
        });

        // Wait for activity logs
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get anomalies sorted by type ascending
        const resAsc = await testClient(router).queue.activity.anomalies.$get({
          query: { sort_by: 'type', sort_order: 'asc' }
        });
        expect(resAsc.status).toBe(200);
        const resultAsc = await resAsc.json();

        // Verify alphabetical ordering ascending
        for (let i = 1; i < resultAsc.anomalies.length; i++) {
          const prevType = resultAsc.anomalies[i - 1].anomaly?.type || '';
          const currType = resultAsc.anomalies[i].anomaly?.type || '';
          expect(currType.localeCompare(prevType)).toBeGreaterThanOrEqual(0);
        }

        // Get anomalies sorted by type descending
        const resDesc = await testClient(router).queue.activity.anomalies.$get({
          query: { sort_by: 'type', sort_order: 'desc' }
        });
        expect(resDesc.status).toBe(200);
        const resultDesc = await resDesc.json();

        // Verify alphabetical ordering descending
        for (let i = 1; i < resultDesc.anomalies.length; i++) {
          const prevType = resultDesc.anomalies[i - 1].anomaly?.type || '';
          const currType = resultDesc.anomalies[i].anomaly?.type || '';
          expect(currType.localeCompare(prevType)).toBeLessThanOrEqual(0);
        }
      });

      it('should sort anomalies by action', async () => {
        // Create anomalies with 'move' action (DLQ movement)
        await testClient(router).queue.message.$post({ json: { type: 'sort-action-test-1', payload: {} } });
        let listRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' },
          query: { filterType: 'sort-action-test-1' }
        });
        let list = await listRes.json();
        let msg = list.messages[0];
        await testClient(router).queue.move.$post({
          json: { messages: [msg], fromQueue: 'main', toQueue: 'dead', errorReason: 'Test action sort' }
        });

        await new Promise(resolve => setTimeout(resolve, 50));

        await testClient(router).queue.message.$post({ json: { type: 'sort-action-test-2', payload: {} } });
        listRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' },
          query: { filterType: 'sort-action-test-2' }
        });
        list = await listRes.json();
        msg = list.messages[0];
        await testClient(router).queue.move.$post({
          json: { messages: [msg], fromQueue: 'main', toQueue: 'dead', errorReason: 'Test action sort 2' }
        });

        // Wait for activity logs
        await new Promise(resolve => setTimeout(resolve, 100));

        // Get anomalies sorted by action ascending
        const resAsc = await testClient(router).queue.activity.anomalies.$get({
          query: { sort_by: 'action', sort_order: 'asc' }
        });
        expect(resAsc.status).toBe(200);
        const resultAsc = await resAsc.json();

        // Verify alphabetical ordering ascending
        for (let i = 1; i < resultAsc.anomalies.length; i++) {
          const prevAction = resultAsc.anomalies[i - 1].action || '';
          const currAction = resultAsc.anomalies[i].action || '';
          expect(currAction.localeCompare(prevAction)).toBeGreaterThanOrEqual(0);
        }

        // Get anomalies sorted by action descending
        const resDesc = await testClient(router).queue.activity.anomalies.$get({
          query: { sort_by: 'action', sort_order: 'desc' }
        });
        expect(resDesc.status).toBe(200);
        const resultDesc = await resDesc.json();

        // Verify alphabetical ordering descending
        for (let i = 1; i < resultDesc.anomalies.length; i++) {
          const prevAction = resultDesc.anomalies[i - 1].action || '';
          const currAction = resultDesc.anomalies[i].action || '';
          expect(currAction.localeCompare(prevAction)).toBeLessThanOrEqual(0);
        }
      });
    });

    describe('GET /queue/activity/consumers', () => {
      it('should return consumer statistics', async () => {
        // Create some dequeue activity to generate consumer stats
        await testClient(router).queue.message.$post({ json: { type: 'consumer-stats-test', payload: {} } });
        await testClient(router).queue.message.$get({ query: { timeout: '1' } });

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        const res = await testClient(router).queue.activity.consumers.$get();
        expect(res.status).toBe(200);
        const result = await res.json();
        
        expect(result).toHaveProperty('stats');
      });

      it('should filter by consumer_id', async () => {
        // Create some activity
        await testClient(router).queue.message.$post({ json: { type: 'consumer-filter-test', payload: {} } });
        await testClient(router).queue.message.$get({ query: { timeout: '1' } });

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        const consumerName = queue.config.consumer_name;
        const res = await testClient(router).queue.activity.consumers.$get({
          query: { consumer_id: consumerName }
        });
        expect(res.status).toBe(200);
        const result = await res.json();

        expect(result).toHaveProperty('stats');
      });

      it('should return correct count of unique consumers', async () => {
        // Create messages and dequeue with different consumer IDs
        await testClient(router).queue.message.$post({ json: { type: 'count-test-1', payload: {} } });
        await testClient(router).queue.message.$post({ json: { type: 'count-test-2', payload: {} } });
        await testClient(router).queue.message.$post({ json: { type: 'count-test-3', payload: {} } });

        // Dequeue with different consumer IDs
        await testClient(router).queue.message.$get({ query: { timeout: '1', consumerId: 'worker-alpha' } });
        await testClient(router).queue.message.$get({ query: { timeout: '1', consumerId: 'worker-beta' } });
        await testClient(router).queue.message.$get({ query: { timeout: '1', consumerId: 'worker-alpha' } }); // Same as first

        // Wait briefly for activity logs to be written
        await new Promise(resolve => setTimeout(resolve, 100));

        const res = await testClient(router).queue.activity.consumers.$get();
        expect(res.status).toBe(200);
        const result = await res.json();

        // Should have exactly 2 unique consumers (worker-alpha and worker-beta)
        const consumerCount = Object.keys(result.stats).length;
        expect(consumerCount).toBe(2);

        // Verify consumer names are present
        expect(result.stats).toHaveProperty('worker-alpha');
        expect(result.stats).toHaveProperty('worker-beta');

        // Verify worker-alpha has 2 dequeues (first and third messages)
        expect(result.stats['worker-alpha'].dequeue_count).toBe(2);
        // Verify worker-beta has 1 dequeue
        expect(result.stats['worker-beta'].dequeue_count).toBe(1);
      });

      it('should show consumer count increase from 0 to 1 after first dequeue', async () => {
        // 1. Verify no consumers exist initially
        const initialRes = await testClient(router).queue.activity.consumers.$get();
        expect(initialRes.status).toBe(200);
        const initialResult = await initialRes.json();
        const initialCount = Object.keys(initialResult.stats).length;
        expect(initialCount).toBe(0);

        // 2. Enqueue a message
        await testClient(router).queue.message.$post({ json: { type: 'first-consumer-test', payload: { data: 'test' } } });

        // 3. Dequeue with a specific consumer name
        const dequeueRes = await testClient(router).queue.message.$get({
          query: { timeout: '1', consumerId: 'my-first-worker' }
        });
        expect(dequeueRes.status).toBe(200);

        // Wait for activity logs
        await new Promise(resolve => setTimeout(resolve, 100));

        // 4. Verify consumer count is now 1 and name matches
        const afterRes = await testClient(router).queue.activity.consumers.$get();
        expect(afterRes.status).toBe(200);
        const afterResult = await afterRes.json();

        const afterCount = Object.keys(afterResult.stats).length;
        expect(afterCount).toBe(1);

        // Verify the consumer name is correct
        expect(afterResult.stats).toHaveProperty('my-first-worker');
        expect(afterResult.stats['my-first-worker'].dequeue_count).toBe(1);
        expect(afterResult.stats['my-first-worker'].last_dequeue).toBeGreaterThan(0);
      });
    });

    describe('Anomaly Detection Scenarios', () => {
      it('should detect near_dlq anomaly when message has few attempts remaining', async () => {
        // Set max_attempts low temporarily
        const originalMaxAttempts = apiQueue.config.max_attempts;
        (apiQueue.config as any).max_attempts = 2;

        try {
          // Enqueue and dequeue (attempt 1)
          await testClient(router).queue.message.$post({ json: { type: 'near-dlq-test', payload: {} } });
          const dequeue1 = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
          const msg1 = await dequeue1.json();

          // Nack to requeue
          await testClient(router).queue.message[':messageId'].nack.$post({
            param: { messageId: msg1.id },
            json: { errorReason: 'First failure' }
          });

          // Dequeue again (attempt 2) - should trigger near_dlq
          const dequeue2 = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
          expect(dequeue2.status).toBe(200);

          // Wait briefly
          await new Promise(resolve => setTimeout(resolve, 100));

          // Check for near_dlq anomaly
          const res = await testClient(router).queue.activity.$get({
            query: { message_id: msg1.id, has_anomaly: 'true' }
          });
          expect(res.status).toBe(200);
          const result = await res.json();
          
          const nearDlqAnomalies = result.logs.filter((l: any) => 
            l.anomaly?.type === 'near_dlq'
          );
          expect(nearDlqAnomalies.length).toBeGreaterThanOrEqual(1);
        } finally {
          (apiQueue.config as any).max_attempts = originalMaxAttempts;
        }
      }, 15000);

      it('should log bulk operations with batch context', async () => {
        // Enqueue multiple messages
        for (let i = 0; i < 3; i++) {
          await testClient(router).queue.message.$post({ json: { type: 'bulk-log-test', payload: { i } } });
        }

        // Get messages and delete them in bulk
        const listRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' }
        });
        const list = await listRes.json();
        const bulkMessages = list.messages.filter((m: any) => m.type === 'bulk-log-test');
        const ids = bulkMessages.map((m: any) => m.id);

        await testClient(router).queue.messages['delete'].$post({
          query: { queueType: 'main' },
          json: { messageIds: ids }
        });

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check activity logs for delete actions
        const res = await testClient(router).queue.activity.$get({
          query: { action: 'delete' }
        });
        expect(res.status).toBe(200);
        const result = await res.json();
        
        // Should have delete logs
        const deleteLogs = result.logs.filter((l: any) => l.action === 'delete');
        expect(deleteLogs.length).toBeGreaterThanOrEqual(1);
        
        // Check batch_id is present
        const logsWithBatch = deleteLogs.filter((l: any) => l.batch_id !== null);
        expect(logsWithBatch.length).toBeGreaterThanOrEqual(1);
      });

      it('should log clear queue operations', async () => {
        // Add a message
        await testClient(router).queue.message.$post({ json: { type: 'clear-log-test', payload: {} } });

        // Clear the main queue
        await testClient(router).queue[':queueType'].clear.$delete({
          param: { queueType: 'main' }
        });

        // Wait briefly
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check for clear action in logs
        const res = await testClient(router).queue.activity.$get({
          query: { action: 'clear' }
        });
        expect(res.status).toBe(200);
        const result = await res.json();
        
        const clearLogs = result.logs.filter((l: any) => l.action === 'clear');
        expect(clearLogs.length).toBeGreaterThanOrEqual(1);
        expect(clearLogs[0].triggered_by).toBe('admin');
      });
    });
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
