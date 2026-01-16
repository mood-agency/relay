import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../../config/env')>('../../../config/env');
  return {
    default: { ...actual.default, QUEUE_NAME: 'test_queue' }
  };
});

import { router, testClient, getQueue, setupQueueTests } from './setup';

describe('Queue Routes - Bulk Operations', () => {
  setupQueueTests();

  describe('Batch Enqueue', () => {
    it('should enqueue a large batch of messages', async () => {
      const batchSize = 100;
      const messages = Array.from({ length: batchSize }, (_, i) => ({
        type: 'bulk-enqueue',
        payload: { index: i, data: `message-${i}` }
      }));

      const res = await testClient(router).queue.batch.$post({ json: messages });
      expect(res.status).toBe(201);

      const result = await res.json() as any;
      expect(result.message).toContain(`${batchSize}/${batchSize}`);

      // Verify all messages are in queue
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { limit: '200' }
      });
      const main = await mainRes.json() as any;
      expect(main.messages.length).toBe(batchSize);
    }, 30000);

    it('should handle single enqueue with different priorities - highest dequeued first', async () => {
      // Use unique type to filter only our test messages
      const testType = `priority-test-${Date.now()}`;

      // Enqueue messages with different priorities
      await testClient(router).queue.message.$post({
        json: { type: testType, payload: { p: 'low' }, priority: 1 }
      });
      await testClient(router).queue.message.$post({
        json: { type: testType, payload: { p: 'high' }, priority: 10 }
      });
      await testClient(router).queue.message.$post({
        json: { type: testType, payload: { p: 'medium' }, priority: 5 }
      });

      // Dequeue should return highest priority first (10, then 5, then 1)
      // Use type filter to ensure we only get our test messages
      const dequeue1Res = await testClient(router).queue.message.$get({
        query: { timeout: '0', type: testType }
      });
      const msg1 = await dequeue1Res.json() as any;
      expect(msg1.priority).toBe(10);
      expect(msg1.payload.p).toBe('high');

      const dequeue2Res = await testClient(router).queue.message.$get({
        query: { timeout: '0', type: testType }
      });
      const msg2 = await dequeue2Res.json() as any;
      expect(msg2.priority).toBe(5);
      expect(msg2.payload.p).toBe('medium');

      const dequeue3Res = await testClient(router).queue.message.$get({
        query: { timeout: '0', type: testType }
      });
      const msg3 = await dequeue3Res.json() as any;
      expect(msg3.priority).toBe(1);
      expect(msg3.payload.p).toBe('low');
    });
  });

  describe('Bulk Move', () => {
    it('should move a large batch of messages atomically', async () => {
      const batchSize = 50;

      // Enqueue messages
      const messages = Array.from({ length: batchSize }, (_, i) => ({
        type: 'bulk-move',
        payload: { index: i }
      }));
      await testClient(router).queue.batch.$post({ json: messages });

      // Get all messages
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { limit: '100' }
      });
      const main = await mainRes.json() as any;
      expect(main.messages.length).toBe(batchSize);

      // Move all to processing
      const moveRes = await testClient(router).queue.move.$post({
        json: { messages: main.messages, fromQueue: 'main', toQueue: 'processing' }
      });
      expect(moveRes.status).toBe(200);
      const moveResult = await moveRes.json() as any;
      expect(moveResult.movedCount).toBe(batchSize);

      // Verify main is empty
      const mainAfterRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const mainAfter = await mainAfterRes.json() as any;
      expect(mainAfter.messages.length).toBe(0);

      // Verify all in processing
      const processingRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' },
        query: { limit: '100' }
      });
      const processing = await processingRes.json() as any;
      expect(processing.messages.length).toBe(batchSize);
    }, 30000);

    it('should move messages from processing to DLQ with error reason', async () => {
      const batchSize = 20;

      // Enqueue messages
      for (let i = 0; i < batchSize; i++) {
        await testClient(router).queue.message.$post({
          json: { type: 'dlq-bulk', payload: { index: i } }
        });
      }

      // Dequeue all to processing
      const processingMsgs: any[] = [];
      for (let i = 0; i < batchSize; i++) {
        const dequeueRes = await testClient(router).queue.message.$get({
          query: { timeout: '0' }
        });
        const msg = await dequeueRes.json() as any;
        processingMsgs.push(msg);
      }

      // Move all to DLQ
      const moveRes = await testClient(router).queue.move.$post({
        json: {
          messages: processingMsgs,
          fromQueue: 'processing',
          toQueue: 'dead',
          errorReason: 'Bulk DLQ operation'
        }
      });
      expect(moveRes.status).toBe(200);

      // Verify all in DLQ with error reason
      const dlqRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'dead' },
        query: { limit: '50' }
      });
      const dlq = await dlqRes.json() as any;
      expect(dlq.messages.length).toBe(batchSize);
      for (const msg of dlq.messages) {
        expect(msg.last_error).toBe('Bulk DLQ operation');
      }
    }, 30000);
  });

  describe('Bulk Delete', () => {
    it('should delete multiple messages at once', async () => {
      const batchSize = 30;

      // Enqueue messages
      for (let i = 0; i < batchSize; i++) {
        await testClient(router).queue.message.$post({
          json: { type: 'bulk-delete', payload: { index: i } }
        });
      }

      // Get all messages
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { limit: '50' }
      });
      const main = await mainRes.json() as any;
      const messageIds = main.messages.map((m: any) => m.id);

      // Delete all - use the correct endpoint: POST /queue/messages/delete with query queueType
      const deleteRes = await testClient(router).queue.messages.delete.$post({
        query: { queueType: 'main' },
        json: { messageIds }
      });
      expect(deleteRes.status).toBe(200);
      const deleteResult = await deleteRes.json() as any;
      expect(deleteResult.deletedCount).toBe(batchSize);

      // Verify empty
      const mainAfterRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const mainAfter = await mainAfterRes.json() as any;
      expect(mainAfter.messages.length).toBe(0);
    }, 30000);
  });

  describe('Bulk Operations Under Load', () => {
    it('should handle rapid enqueue and dequeue cycles', async () => {
      const cycleCount = 5;
      const messagesPerCycle = 10;

      for (let cycle = 0; cycle < cycleCount; cycle++) {
        // Enqueue batch
        const messages = Array.from({ length: messagesPerCycle }, (_, i) => ({
          type: 'rapid-cycle',
          payload: { cycle, index: i }
        }));
        await testClient(router).queue.batch.$post({ json: messages });

        // Dequeue all with concurrent consumers
        const dequeuePromises = Array.from({ length: messagesPerCycle }, (_, i) =>
          testClient(router).queue.message.$get({
            query: { timeout: '0', consumerId: `consumer-${i}` }
          })
        );
        const results = await Promise.all(dequeuePromises);

        // All should succeed
        const successCount = results.filter(r => r.status === 200).length;
        expect(successCount).toBe(messagesPerCycle);

        // ACK all
        for (const res of results) {
          if (res.status === 200) {
            const msg = await res.json() as any;
            await testClient(router).queue.ack.$post({
              json: { id: msg.id, lock_token: msg.lock_token }
            });
          }
        }
      }

      // Verify queue is empty
      const metricsRes = await testClient(router).queue.metrics.$get();
      const metrics = await metricsRes.json() as any;
      expect(metrics.main_queue_size).toBe(0);
      expect(metrics.processing_queue_size).toBe(0);
    }, 60000);

    it('should maintain data integrity with concurrent bulk operations', async () => {
      // Initial setup
      const messages = Array.from({ length: 30 }, (_, i) => ({
        type: 'integrity-test',
        payload: { index: i, unique: `unique-${i}-${Date.now()}` }
      }));
      await testClient(router).queue.batch.$post({ json: messages });

      // Concurrent operations: move some to processing, some to DLQ
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { limit: '50' }
      });
      const main = await mainRes.json() as any;

      const toProcessing = main.messages.slice(0, 10);
      const toDlq = main.messages.slice(10, 20);
      const toKeep = main.messages.slice(20, 30);

      const operations = [
        testClient(router).queue.move.$post({
          json: { messages: toProcessing, fromQueue: 'main', toQueue: 'processing' }
        }),
        testClient(router).queue.move.$post({
          json: { messages: toDlq, fromQueue: 'main', toQueue: 'dead', errorReason: 'Concurrent test' }
        })
      ];

      const [processingResult, dlqResult] = await Promise.all(operations);

      const processingJson = await processingResult.json() as any;
      const dlqJson = await dlqResult.json() as any;

      expect(processingJson.movedCount).toBe(10);
      expect(dlqJson.movedCount).toBe(10);

      // Verify final state
      const finalMainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const finalMain = await finalMainRes.json() as any;
      expect(finalMain.messages.length).toBe(10);

      const finalProcessingRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      const finalProcessing = await finalProcessingRes.json() as any;
      expect(finalProcessing.messages.length).toBe(10);

      const finalDlqRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'dead' }
      });
      const finalDlq = await finalDlqRes.json() as any;
      expect(finalDlq.messages.length).toBe(10);
    }, 30000);
  });

  describe('Pagination Under Bulk Load', () => {
    it('should correctly paginate through large result sets', async () => {
      const totalMessages = 50;

      // Enqueue many messages
      for (let batch = 0; batch < 5; batch++) {
        const messages = Array.from({ length: 10 }, (_, i) => ({
          type: 'pagination-test',
          payload: { batch, index: i }
        }));
        await testClient(router).queue.batch.$post({ json: messages });
      }

      // Fetch with pagination
      const pageSize = 10;
      const fetchedIds: string[] = [];

      for (let page = 1; page <= 5; page++) {
        const res = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' },
          query: { page: String(page), limit: String(pageSize) }
        });
        const result = await res.json() as any;

        expect(result.messages.length).toBe(pageSize);
        // page may be returned as number or string depending on the handler
        expect(Number(result.pagination.page)).toBe(page);
        expect(result.pagination.total).toBe(totalMessages);
        expect(result.pagination.totalPages).toBe(5);

        fetchedIds.push(...result.messages.map((m: any) => m.id));
      }

      // Verify no duplicates
      const uniqueIds = new Set(fetchedIds);
      expect(uniqueIds.size).toBe(totalMessages);
    }, 30000);

    it('should correctly report hasMore in pagination', async () => {
      // Enqueue 25 messages
      for (let i = 0; i < 25; i++) {
        await testClient(router).queue.message.$post({
          json: { type: 'hasmore-test', payload: { index: i } }
        });
      }

      // Page 1: should have more
      const page1Res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { page: '1', limit: '10' }
      });
      const page1 = await page1Res.json() as any;
      expect(page1.pagination.hasMore).toBe(true);

      // Page 2: should have more
      const page2Res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { page: '2', limit: '10' }
      });
      const page2 = await page2Res.json() as any;
      expect(page2.pagination.hasMore).toBe(true);

      // Page 3: should NOT have more
      const page3Res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { page: '3', limit: '10' }
      });
      const page3 = await page3Res.json() as any;
      expect(page3.pagination.hasMore).toBe(false);
    }, 30000);
  });

  describe('Filtering with Bulk Data', () => {
    it('should filter by type with large dataset', async () => {
      // Enqueue messages of different types
      const types = ['type-a', 'type-b', 'type-c'];
      for (const type of types) {
        const messages = Array.from({ length: 20 }, (_, i) => ({
          type,
          payload: { index: i }
        }));
        await testClient(router).queue.batch.$post({ json: messages });
      }

      // Filter by specific type
      const res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { filterType: 'type-b', limit: '100' }
      });
      const result = await res.json() as any;

      expect(result.messages.length).toBe(20);
      for (const msg of result.messages) {
        expect(msg.type).toBe('type-b');
      }
    }, 30000);

    it('should filter by priority with large dataset', async () => {
      // Enqueue messages with different priorities - use single enqueue to ensure priority is set
      for (let p = 1; p <= 5; p++) {
        for (let i = 0; i < 10; i++) {
          await testClient(router).queue.message.$post({
            json: {
              type: 'priority-filter',
              payload: { priority: p, index: i },
              priority: p
            }
          });
        }
      }

      // Filter by priority 3
      const res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { filterPriority: '3', limit: '100' }
      });
      const result = await res.json() as any;

      expect(result.messages.length).toBe(10);
      for (const msg of result.messages) {
        expect(msg.priority).toBe(3);
      }
    }, 60000);
  });
});
