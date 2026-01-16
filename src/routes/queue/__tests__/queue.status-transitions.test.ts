import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../../config/env')>('../../../config/env');
  return {
    default: { ...actual.default, QUEUE_NAME: 'test_queue' }
  };
});

import { router, testClient, getQueue, setupQueueTests } from './setup';

describe('Queue Routes - Status Transitions', () => {
  setupQueueTests();

  describe('Valid Status Transitions', () => {
    it('queued -> processing (via dequeue)', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'transition-queued-processing', payload: { n: 1 } }
      });

      // Verify initial state
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const main = await mainRes.json() as any;
      expect(main.messages[0].status).toBe('queued');

      // Dequeue
      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;
      expect(msg.status).toBe('processing');
    });

    it('processing -> acknowledged (via ack)', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'transition-processing-ack', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;
      expect(msg.status).toBe('processing');

      // ACK
      await testClient(router).queue.ack.$post({
        json: { id: msg.id, lock_token: msg.lock_token }
      });

      // Verify acknowledged state
      const queue = await getQueue();
      const result = await queue.pgManager.query(
        `SELECT status FROM messages WHERE id = $1`,
        [msg.id]
      );
      expect(result.rows[0].status).toBe('acknowledged');
    });

    it('processing -> queued (via nack with retries remaining)', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'transition-processing-queued', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;
      expect(msg.status).toBe('processing');

      // NACK
      await testClient(router).queue.message[':messageId'].nack.$post({
        param: { messageId: msg.id },
        json: { errorReason: 'Retry please' }
      });

      // Verify queued state
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const main = await mainRes.json() as any;
      expect(main.messages[0].status).toBe('queued');
    });

    it('processing -> dead (via nack with max_attempts exceeded)', async () => {
      const queue = await getQueue();
      const originalMaxAttempts = queue.config.max_attempts;
      (queue.config as any).max_attempts = 1;

      try {
        await testClient(router).queue.message.$post({
          json: { type: 'transition-processing-dead', payload: { n: 1 } }
        });

        const dequeueRes = await testClient(router).queue.message.$get({
          query: { timeout: '0' }
        });
        const msg = await dequeueRes.json() as any;

        // NACK - should go to DLQ
        await testClient(router).queue.message[':messageId'].nack.$post({
          param: { messageId: msg.id },
          json: { errorReason: 'Fatal error' }
        });

        // Verify dead state
        const dlqRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'dead' }
        });
        const dlq = await dlqRes.json() as any;
        expect(dlq.messages[0].status).toBe('dead');
      } finally {
        (queue.config as any).max_attempts = originalMaxAttempts;
      }
    });

    it('processing -> queued (via timeout requeue)', async () => {
      const queue = await getQueue();

      await testClient(router).queue.message.$post({
        json: { type: 'transition-timeout-queued', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      // Simulate timeout
      await queue.pgManager.query(
        `UPDATE messages SET locked_until = NOW() - INTERVAL '10 seconds' WHERE id = $1`,
        [msg.id]
      );
      await queue.requeueFailedMessages();

      // Verify queued state
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const main = await mainRes.json() as any;
      expect(main.messages[0].status).toBe('queued');
    });
  });

  describe('Move Operations - Status Transitions', () => {
    it('queued -> processing (via move)', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'move-queued-processing', payload: { n: 1 } }
      });

      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const main = await mainRes.json() as any;
      const msg = main.messages[0];

      // Move to processing
      await testClient(router).queue.move.$post({
        json: { messages: [msg], fromQueue: 'main', toQueue: 'processing' }
      });

      // Verify processing state with lock_token set
      const processingRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      const processing = await processingRes.json() as any;
      expect(processing.messages[0].status).toBe('processing');
      expect(processing.messages[0].lock_token).toBeTruthy();
    });

    it('queued -> dead (via move to DLQ)', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'move-queued-dead', payload: { n: 1 } }
      });

      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const main = await mainRes.json() as any;
      const msg = main.messages[0];

      // Move to DLQ
      await testClient(router).queue.move.$post({
        json: { messages: [msg], fromQueue: 'main', toQueue: 'dead', errorReason: 'Manual DLQ' }
      });

      // Verify dead state
      const dlqRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'dead' }
      });
      const dlq = await dlqRes.json() as any;
      expect(dlq.messages[0].status).toBe('dead');
      expect(dlq.messages[0].last_error).toBe('Manual DLQ');
    });

    it('dead -> queued (retry from DLQ)', async () => {
      const queue = await getQueue();
      const originalMaxAttempts = queue.config.max_attempts;
      (queue.config as any).max_attempts = 1;

      try {
        await testClient(router).queue.message.$post({
          json: { type: 'dlq-retry', payload: { n: 1 } }
        });

        // Dequeue and NACK to DLQ
        const dequeueRes = await testClient(router).queue.message.$get({
          query: { timeout: '0' }
        });
        const msg = await dequeueRes.json() as any;
        await testClient(router).queue.message[':messageId'].nack.$post({
          param: { messageId: msg.id },
          json: { errorReason: 'Fatal error' }
        });

        // Move from DLQ back to main
        const dlqRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'dead' }
        });
        const dlq = await dlqRes.json() as any;
        const dlqMsg = dlq.messages[0];

        await testClient(router).queue.move.$post({
          json: { messages: [dlqMsg], fromQueue: 'dead', toQueue: 'main' }
        });

        // Verify queued state
        const mainRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'main' }
        });
        const main = await mainRes.json() as any;
        expect(main.messages[0].status).toBe('queued');
      } finally {
        (queue.config as any).max_attempts = originalMaxAttempts;
      }
    });

    it('processing -> queued (cancel processing via move)', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'cancel-processing', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      // Move from processing back to main
      await testClient(router).queue.move.$post({
        json: { messages: [msg], fromQueue: 'processing', toQueue: 'main' }
      });

      // Verify queued state with lock cleared
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const main = await mainRes.json() as any;
      expect(main.messages[0].status).toBe('queued');
      expect(main.messages[0].lock_token).toBeNull();
    });

    it('processing -> dead (force to DLQ via move)', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'force-dlq', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      // Move to DLQ
      await testClient(router).queue.move.$post({
        json: { messages: [msg], fromQueue: 'processing', toQueue: 'dead', errorReason: 'Forced DLQ' }
      });

      // Verify dead state
      const dlqRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'dead' }
      });
      const dlq = await dlqRes.json() as any;
      expect(dlq.messages[0].status).toBe('dead');
    });
  });

  describe('Invalid/Edge Case Transitions', () => {
    it('should not allow dequeue of non-queued messages', async () => {
      // All queued messages were already processed - dequeue should return 404
      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      expect(dequeueRes.status).toBe(404);
    });

    it('should reject ACK on acknowledged message', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'double-ack-test', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      // First ACK
      await testClient(router).queue.ack.$post({
        json: { id: msg.id, lock_token: msg.lock_token }
      });

      // Second ACK - should fail
      const ack2Res = await testClient(router).queue.ack.$post({
        json: { id: msg.id, lock_token: msg.lock_token }
      });
      expect(ack2Res.status).toBe(400);
    });

    it('should reject NACK on dead message', async () => {
      const queue = await getQueue();

      await testClient(router).queue.message.$post({
        json: { type: 'nack-dead', payload: { n: 1 } }
      });

      // Dequeue
      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      // Set max_attempts = 1 so NACK moves to DLQ
      await queue.pgManager.query(
        `UPDATE messages SET max_attempts = 1 WHERE id = $1`,
        [msg.id]
      );

      // NACK to DLQ
      await testClient(router).queue.message[':messageId'].nack.$post({
        param: { messageId: msg.id },
        json: { errorReason: 'Fatal' }
      });

      // Try to NACK again - should fail (message in dead state)
      const nack2Res = await testClient(router).queue.message[':messageId'].nack.$post({
        param: { messageId: msg.id },
        json: { errorReason: 'Should fail' }
      });
      // Returns 404 because message is not in processing state
      expect(nack2Res.status).toBe(404);
    });

    it('should correctly track attempt_count through multiple requeues', async () => {
      const queue = await getQueue();
      const originalMaxAttempts = queue.config.max_attempts;
      (queue.config as any).max_attempts = 5;

      try {
        await testClient(router).queue.message.$post({
          json: { type: 'attempt-tracking', payload: { n: 1 } }
        });

        // Multiple dequeue/nack cycles
        for (let i = 1; i <= 3; i++) {
          const dequeueRes = await testClient(router).queue.message.$get({
            query: { timeout: '0' }
          });
          const msg = await dequeueRes.json() as any;
          expect(msg.attempt_count).toBe(i);

          await testClient(router).queue.message[':messageId'].nack.$post({
            param: { messageId: msg.id },
            json: { errorReason: `Attempt ${i} failed` }
          });
        }
      } finally {
        (queue.config as any).max_attempts = originalMaxAttempts;
      }
    });
  });

  describe('Message Metadata Through Transitions', () => {
    it('should set dequeued_at when transitioning to processing', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'dequeued-at-test', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      // Verify dequeued_at is set and is a valid timestamp
      expect(msg.dequeued_at).toBeTruthy();
      // dequeued_at could be Unix seconds or milliseconds - just verify it's a reasonable value
      const dequeuedAtMs = msg.dequeued_at > 1e12 ? msg.dequeued_at : msg.dequeued_at * 1000;
      const now = Date.now();
      // Allow 5 minutes window for clock skew between app and database
      expect(dequeuedAtMs).toBeGreaterThan(now - 300000);
      expect(dequeuedAtMs).toBeLessThan(now + 300000);
    });

    it('should set acknowledged_at when transitioning to acknowledged', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'acked-at-test', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      const beforeAck = Date.now();
      await testClient(router).queue.ack.$post({
        json: { id: msg.id, lock_token: msg.lock_token }
      });
      const afterAck = Date.now();

      const queue = await getQueue();
      const result = await queue.pgManager.query(
        `SELECT acknowledged_at FROM messages WHERE id = $1`,
        [msg.id]
      );
      const acknowledgedAt = new Date(result.rows[0].acknowledged_at).getTime();

      expect(acknowledgedAt).toBeGreaterThanOrEqual(beforeAck - 1000);
      expect(acknowledgedAt).toBeLessThanOrEqual(afterAck + 1000);
    });

    it('should clear dequeued_at when transitioning back to queued', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'clear-dequeued-at', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;
      expect(msg.dequeued_at).toBeTruthy();

      // NACK to requeue
      await testClient(router).queue.message[':messageId'].nack.$post({
        param: { messageId: msg.id },
        json: { errorReason: 'Requeue' }
      });

      const queue = await getQueue();
      const result = await queue.pgManager.query(
        `SELECT dequeued_at FROM messages WHERE id = $1`,
        [msg.id]
      );
      expect(result.rows[0].dequeued_at).toBeNull();
    });
  });
});
