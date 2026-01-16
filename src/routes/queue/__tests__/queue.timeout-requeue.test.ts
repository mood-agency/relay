import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../../config/env')>('../../../config/env');
  return {
    default: { ...actual.default, QUEUE_NAME: 'test_queue' }
  };
});

import { router, testClient, getQueue, setupQueueTests } from './setup';

describe('Queue Routes - Timeout and Requeue Operations', () => {
  setupQueueTests();

  describe('requeueFailedMessages - Basic Behavior', () => {
    it('should requeue messages with expired locks', async () => {
      const queue = await getQueue();

      await testClient(router).queue.message.$post({
        json: { type: 'timeout-basic', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      // Verify message is in processing
      expect(msg.status).toBe('processing');

      // Simulate timeout
      await queue.pgManager.query(
        `UPDATE messages SET locked_until = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
        [msg.id]
      );

      // Run requeue
      const requeued = await queue.requeueFailedMessages();
      expect(requeued).toBe(1);

      // Verify message is back in main queue
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const main = await mainRes.json() as any;
      expect(main.messages.length).toBe(1);
      expect(main.messages[0].id).toBe(msg.id);
      expect(main.messages[0].status).toBe('queued');
      expect(main.messages[0].last_error).toBe('Timeout - requeued');
    });

    it('should not requeue messages with valid locks', async () => {
      const queue = await getQueue();

      await testClient(router).queue.message.$post({
        json: { type: 'no-timeout', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      await dequeueRes.json();

      // Run requeue without simulating timeout
      const requeued = await queue.requeueFailedMessages();
      expect(requeued).toBe(0);

      // Verify message is still in processing
      const processingRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      const processing = await processingRes.json() as any;
      expect(processing.messages.length).toBe(1);
    });

    it('should increment attempt_count on requeue', async () => {
      const queue = await getQueue();

      await testClient(router).queue.message.$post({
        json: { type: 'attempt-count', payload: { n: 1 } }
      });

      // First dequeue
      const dequeue1Res = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg1 = await dequeue1Res.json() as any;
      expect(msg1.attempt_count).toBe(1);

      // Simulate timeout and requeue
      await queue.pgManager.query(
        `UPDATE messages SET locked_until = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
        [msg1.id]
      );
      await queue.requeueFailedMessages();

      // Second dequeue
      const dequeue2Res = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg2 = await dequeue2Res.json() as any;
      expect(msg2.id).toBe(msg1.id);
      expect(msg2.attempt_count).toBe(2);
    });
  });

  describe('requeueFailedMessages - Max Attempts and DLQ', () => {
    it('should move message to DLQ when max_attempts is exceeded', async () => {
      const queue = await getQueue();

      await testClient(router).queue.message.$post({
        json: { type: 'dlq-max-attempts', payload: { n: 1 } }
      });

      // First attempt
      const dequeue1Res = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg1 = await dequeue1Res.json() as any;
      expect(msg1.attempt_count).toBe(1);

      // Set per-message max_attempts to 2 in the database
      await queue.pgManager.query(
        `UPDATE messages SET max_attempts = 2 WHERE id = $1`,
        [msg1.id]
      );

      // Timeout and requeue
      await queue.pgManager.query(
        `UPDATE messages SET locked_until = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
        [msg1.id]
      );
      await queue.requeueFailedMessages();

      // Second attempt
      const dequeue2Res = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg2 = await dequeue2Res.json() as any;
      expect(msg2.attempt_count).toBe(2);

      // Timeout again - should go to DLQ since attempt_count >= max_attempts (2 >= 2)
      await queue.pgManager.query(
        `UPDATE messages SET locked_until = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
        [msg2.id]
      );
      const requeued = await queue.requeueFailedMessages();
      expect(requeued).toBe(1); // Moved to DLQ counts as requeued

      // Verify message is in DLQ
      const dlqRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'dead' }
      });
      const dlq = await dlqRes.json() as any;
      expect(dlq.messages.length).toBe(1);
      expect(dlq.messages[0].id).toBe(msg1.id);
      expect(dlq.messages[0].status).toBe('dead');
      expect(dlq.messages[0].last_error).toBe('Timeout after max attempts');
    });

    it('should use per-message max_attempts when set', async () => {
      const queue = await getQueue();
      const originalMaxAttempts = queue.config.max_attempts;
      (queue.config as any).max_attempts = 10; // High global max

      try {
        await testClient(router).queue.message.$post({
          json: { type: 'per-msg-max', payload: { n: 1 } }
        });

        // Get the message and set a low max_attempts
        const mainRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' }
        });
        const main = await mainRes.json() as any;
        const msgId = main.messages[0].id;

        await queue.pgManager.query(
          `UPDATE messages SET max_attempts = 1 WHERE id = $1`,
          [msgId]
        );

        // Dequeue
        const dequeueRes = await testClient(router).queue.message.$get({
          query: { timeout: '0' }
        });
        await dequeueRes.json();

        // Timeout - should go to DLQ because per-message max_attempts = 1
        await queue.pgManager.query(
          `UPDATE messages SET locked_until = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
          [msgId]
        );
        await queue.requeueFailedMessages();

        // Verify in DLQ
        const dlqRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'dead' }
        });
        const dlq = await dlqRes.json() as any;
        expect(dlq.messages.length).toBe(1);
      } finally {
        (queue.config as any).max_attempts = originalMaxAttempts;
      }
    });

    it('should use per-message max_attempts from database row', async () => {
      const queue = await getQueue();

      await testClient(router).queue.message.$post({
        json: { type: 'per-msg-max-attempts', payload: { n: 1 } }
      });

      // Dequeue
      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      // Set a low max_attempts in the database (message is at attempt_count = 1)
      await queue.pgManager.query(
        `UPDATE messages SET max_attempts = 1 WHERE id = $1`,
        [msg.id]
      );

      // Timeout - should go to DLQ because attempt_count (1) >= max_attempts (1)
      await queue.pgManager.query(
        `UPDATE messages SET locked_until = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
        [msg.id]
      );
      await queue.requeueFailedMessages();

      // Verify in DLQ
      const dlqRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'dead' }
      });
      const dlq = await dlqRes.json() as any;
      expect(dlq.messages.length).toBe(1);
      expect(dlq.messages[0].id).toBe(msg.id);
    });
  });

  describe('requeueFailedMessages - Batch Processing', () => {
    it('should handle multiple timed-out messages in one batch', async () => {
      const queue = await getQueue();

      // Enqueue multiple messages
      for (let i = 0; i < 5; i++) {
        await testClient(router).queue.message.$post({
          json: { type: 'batch-timeout', payload: { index: i } }
        });
      }

      // Dequeue all
      const messageIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const dequeueRes = await testClient(router).queue.message.$get({
          query: { timeout: '0' }
        });
        const msg = await dequeueRes.json() as any;
        messageIds.push(msg.id);
      }

      // Timeout all
      await queue.pgManager.query(
        `UPDATE messages SET locked_until = NOW() - INTERVAL '10 seconds' WHERE id = ANY($1)`,
        [messageIds]
      );

      // Run requeue
      const requeued = await queue.requeueFailedMessages();
      expect(requeued).toBe(5);

      // Verify all are back in main queue
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const main = await mainRes.json() as any;
      expect(main.messages.length).toBe(5);
    });

    it('should handle mixed requeue and DLQ in one batch', async () => {
      const queue = await getQueue();

      // Create 4 messages
      for (let i = 0; i < 4; i++) {
        await testClient(router).queue.message.$post({
          json: { type: 'mixed-batch', payload: { index: i } }
        });
      }

      // Dequeue all
      const messages: any[] = [];
      for (let i = 0; i < 4; i++) {
        const dequeueRes = await testClient(router).queue.message.$get({
          query: { timeout: '0' }
        });
        const msg = await dequeueRes.json() as any;
        messages.push(msg);
      }

      // Set messages 0 and 1 to have max_attempts = 1 (at attempt_count = 1, they will go to DLQ)
      // Messages 2 and 3 keep higher max_attempts (will be requeued)
      await queue.pgManager.query(
        `UPDATE messages SET max_attempts = 1 WHERE id = ANY($1)`,
        [messages.slice(0, 2).map(m => m.id)]
      );

      // Timeout all
      await queue.pgManager.query(
        `UPDATE messages SET locked_until = NOW() - INTERVAL '10 seconds' WHERE id = ANY($1)`,
        [messages.map(m => m.id)]
      );

      // Run requeue
      const requeued = await queue.requeueFailedMessages();
      expect(requeued).toBe(4);

      // Verify 2 in main queue
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const main = await mainRes.json() as any;
      expect(main.messages.length).toBe(2);

      // Verify 2 in DLQ
      const dlqRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'dead' }
      });
      const dlq = await dlqRes.json() as any;
      expect(dlq.messages.length).toBe(2);
    });
  });

  describe('requeueFailedMessages - Edge Cases', () => {
    it('should handle empty processing queue', async () => {
      const queue = await getQueue();

      const requeued = await queue.requeueFailedMessages();
      expect(requeued).toBe(0);
    });

    it('should clear lock-related fields on requeue', async () => {
      const queue = await getQueue();

      await testClient(router).queue.message.$post({
        json: { type: 'clear-lock-fields', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0', consumerId: 'test-consumer' }
      });
      const msg = await dequeueRes.json() as any;

      // Verify lock fields are set
      expect(msg.lock_token).toBeTruthy();
      expect(msg.consumer_id).toBe('test-consumer');

      // Timeout and requeue
      await queue.pgManager.query(
        `UPDATE messages SET locked_until = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
        [msg.id]
      );
      await queue.requeueFailedMessages();

      // Verify lock fields are cleared
      const result = await queue.pgManager.query(
        `SELECT lock_token, locked_until, consumer_id, dequeued_at FROM messages WHERE id = $1`,
        [msg.id]
      );
      const row = result.rows[0];
      expect(row.lock_token).toBeNull();
      expect(row.locked_until).toBeNull();
      expect(row.consumer_id).toBeNull();
      expect(row.dequeued_at).toBeNull();
    });

    it('should preserve original message data on requeue', async () => {
      const queue = await getQueue();
      const originalPayload = { important: 'data', nested: { value: 42 } };

      await testClient(router).queue.message.$post({
        json: { type: 'preserve-data', payload: originalPayload, priority: 7 }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      // Timeout and requeue
      await queue.pgManager.query(
        `UPDATE messages SET locked_until = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
        [msg.id]
      );
      await queue.requeueFailedMessages();

      // Re-dequeue and verify data preserved
      const dequeue2Res = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg2 = await dequeue2Res.json() as any;

      expect(msg2.type).toBe('preserve-data');
      expect(msg2.payload).toEqual(originalPayload);
      expect(msg2.priority).toBe(7);
    });
  });

  describe('Timeout Prevention with Touch', () => {
    it('should not timeout message that was touched recently', async () => {
      const queue = await getQueue();
      const originalTimeout = queue.config.ack_timeout_seconds;
      (queue.config as any).ack_timeout_seconds = 5;

      try {
        await testClient(router).queue.message.$post({
          json: { type: 'touch-prevent-timeout', payload: { n: 1 } }
        });

        const dequeueRes = await testClient(router).queue.message.$get({
          query: { timeout: '0' }
        });
        const msg = await dequeueRes.json() as any;

        // Touch to extend the lock
        const touchRes = await testClient(router).queue.message[':messageId'].touch.$put({
          param: { messageId: msg.id },
          json: { lock_token: msg.lock_token, extendSeconds: 60 }
        });
        expect(touchRes.status).toBe(200);

        // Run requeue - should not affect the message
        const requeued = await queue.requeueFailedMessages();
        expect(requeued).toBe(0);

        // Verify message is still in processing
        const processingRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'processing' }
        });
        const processing = await processingRes.json() as any;
        expect(processing.messages.length).toBe(1);
        expect(processing.messages[0].id).toBe(msg.id);
      } finally {
        (queue.config as any).ack_timeout_seconds = originalTimeout;
      }
    });
  });
});
