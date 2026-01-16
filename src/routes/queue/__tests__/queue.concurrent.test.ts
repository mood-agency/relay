import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../../config/env')>('../../../config/env');
  return {
    default: { ...actual.default, QUEUE_NAME: 'test_queue' }
  };
});

import { router, testClient, getQueue, setupQueueTests } from './setup';

describe('Queue Routes - Concurrent Operations', () => {
  setupQueueTests();

  describe('Concurrent Dequeue - Race Conditions', () => {
    it('should ensure each message is dequeued by exactly one consumer when multiple consumers dequeue simultaneously', async () => {
      // Enqueue 10 messages
      const messageCount = 10;
      for (let i = 0; i < messageCount; i++) {
        await testClient(router).queue.message.$post({
          json: { type: 'concurrent-test', payload: { index: i } }
        });
      }

      // Verify all messages are in queue
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const main = await mainRes.json() as any;
      expect(main.messages.length).toBe(messageCount);

      // Simulate 10 concurrent consumers trying to dequeue
      const consumerCount = 10;
      const dequeuePromises = Array.from({ length: consumerCount }, (_, i) =>
        testClient(router).queue.message.$get({
          query: { timeout: '0', consumerId: `consumer-${i}` }
        })
      );

      const results = await Promise.all(dequeuePromises);

      // Count successful dequeues
      const successfulDequeues = results.filter(r => r.status === 200);
      const notFoundDequeues = results.filter(r => r.status === 404);

      // All 10 messages should be dequeued exactly once
      expect(successfulDequeues.length).toBe(messageCount);
      expect(notFoundDequeues.length).toBe(0);

      // Verify no duplicate message IDs were dequeued
      const dequeuedMessages = await Promise.all(
        successfulDequeues.map(r => r.json() as any)
      );
      const messageIds = dequeuedMessages.map(m => m.id);
      const uniqueIds = new Set(messageIds);
      expect(uniqueIds.size).toBe(messageCount);

      // Verify each message has a unique lock_token
      const lockTokens = dequeuedMessages.map(m => m.lock_token);
      const uniqueTokens = new Set(lockTokens);
      expect(uniqueTokens.size).toBe(messageCount);
    }, 30000);

    it('should not allow the same message to be dequeued twice even with rapid sequential dequeues', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'single-msg', payload: { value: 'unique' } }
      });

      // Rapid sequential dequeues
      const dequeue1 = await testClient(router).queue.message.$get({
        query: { timeout: '0', consumerId: 'fast-consumer-1' }
      });
      const dequeue2 = await testClient(router).queue.message.$get({
        query: { timeout: '0', consumerId: 'fast-consumer-2' }
      });

      expect(dequeue1.status).toBe(200);
      expect(dequeue2.status).toBe(404);
    });

    it('should handle concurrent ACK attempts on the same message - only one should succeed', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'concurrent-ack', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      // Simulate two concurrent ACK attempts with the same lock_token
      const ackPromises = [
        testClient(router).queue.ack.$post({
          json: { id: msg.id, lock_token: msg.lock_token }
        }),
        testClient(router).queue.ack.$post({
          json: { id: msg.id, lock_token: msg.lock_token }
        })
      ];

      const results = await Promise.all(ackPromises);

      // One should succeed, one should fail (message no longer in processing state)
      const successes = results.filter(r => r.status === 200);
      const failures = results.filter(r => r.status !== 200);

      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);
    });

    it('should handle concurrent NACK attempts on the same message - second should fail after state change', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'concurrent-nack', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      // First NACK - should succeed
      const nack1Res = await testClient(router).queue.message[':messageId'].nack.$post({
        param: { messageId: msg.id },
        json: { errorReason: 'Error from consumer 1', lock_token: msg.lock_token }
      });
      expect(nack1Res.status).toBe(200);

      // Second NACK - should fail because message is no longer in processing state
      const nack2Res = await testClient(router).queue.message[':messageId'].nack.$post({
        param: { messageId: msg.id },
        json: { errorReason: 'Error from consumer 2', lock_token: msg.lock_token }
      });
      expect(nack2Res.status).toBe(404); // Message not in processing state
    });
  });

  describe('Concurrent Touch Operations', () => {
    it('should allow concurrent touch operations on different messages', async () => {
      // Enqueue and dequeue two messages
      await testClient(router).queue.message.$post({
        json: { type: 'touch-multi-1', payload: { n: 1 } }
      });
      await testClient(router).queue.message.$post({
        json: { type: 'touch-multi-2', payload: { n: 2 } }
      });

      const dequeue1Res = await testClient(router).queue.message.$get({
        query: { timeout: '0', consumerId: 'touch-consumer-1' }
      });
      const msg1 = await dequeue1Res.json() as any;

      const dequeue2Res = await testClient(router).queue.message.$get({
        query: { timeout: '0', consumerId: 'touch-consumer-2' }
      });
      const msg2 = await dequeue2Res.json() as any;

      // Concurrent touch on different messages
      const touchPromises = [
        testClient(router).queue.message[':messageId'].touch.$put({
          param: { messageId: msg1.id },
          json: { lock_token: msg1.lock_token }
        }),
        testClient(router).queue.message[':messageId'].touch.$put({
          param: { messageId: msg2.id },
          json: { lock_token: msg2.lock_token }
        })
      ];

      const results = await Promise.all(touchPromises);

      // Both should succeed
      expect(results[0].status).toBe(200);
      expect(results[1].status).toBe(200);
    });

    it('should handle rapid touch operations on the same message', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'rapid-touch', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      // Rapid sequential touches
      const touchResults = [];
      for (let i = 0; i < 5; i++) {
        const res = await testClient(router).queue.message[':messageId'].touch.$put({
          param: { messageId: msg.id },
          json: { lock_token: msg.lock_token }
        });
        touchResults.push(res);
      }

      // All should succeed
      for (const res of touchResults) {
        expect(res.status).toBe(200);
      }
    });
  });

  describe('Concurrent Move Operations', () => {
    it('should handle concurrent moves to different queues atomically', async () => {
      // Enqueue 5 messages
      for (let i = 0; i < 5; i++) {
        await testClient(router).queue.message.$post({
          json: { type: 'concurrent-move', payload: { index: i } }
        });
      }

      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const main = await mainRes.json() as any;
      const messages = main.messages;

      // Try to move different sets of messages concurrently
      const set1 = messages.slice(0, 2);
      const set2 = messages.slice(2, 4);

      const movePromises = [
        testClient(router).queue.move.$post({
          json: { messages: set1, fromQueue: 'main', toQueue: 'processing' }
        }),
        testClient(router).queue.move.$post({
          json: { messages: set2, fromQueue: 'main', toQueue: 'dead', errorReason: 'Manual DLQ' }
        })
      ];

      const results = await Promise.all(movePromises);

      // Both should succeed
      expect(results[0].status).toBe(200);
      expect(results[1].status).toBe(200);

      const result1 = await results[0].json() as any;
      const result2 = await results[1].json() as any;

      expect(result1.movedCount).toBe(2);
      expect(result2.movedCount).toBe(2);

      // Verify messages ended up in correct queues
      const processingRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      const processing = await processingRes.json() as any;
      expect(processing.messages.length).toBe(2);

      const deadRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'dead' }
      });
      const dead = await deadRes.json() as any;
      expect(dead.messages.length).toBe(2);
    }, 15000);
  });
});
