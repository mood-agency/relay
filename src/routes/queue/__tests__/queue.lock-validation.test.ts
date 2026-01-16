import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../../config/env')>('../../../config/env');
  return {
    default: { ...actual.default, QUEUE_NAME: 'test_queue' }
  };
});

import { router, testClient, getQueue, setupQueueTests } from './setup';

describe('Queue Routes - Lock Token Validation', () => {
  setupQueueTests();

  describe('NACK Lock Token Validation', () => {
    it('should reject NACK with wrong lock_token', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'nack-lock-test', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      const nackRes = await testClient(router).queue.message[':messageId'].nack.$post({
        param: { messageId: msg.id },
        json: { errorReason: 'Test error', lock_token: 'wrong-lock-token-xyz' }
      });

      expect(nackRes.status).toBe(409);
      const result = await nackRes.json() as any;
      expect(result.error).toBe('LOCK_LOST');
    });

    it('should allow NACK without lock_token for backward compatibility (potential security risk)', async () => {
      // NOTE: This test documents current behavior - NACK without lock_token succeeds
      // This could be a security concern as any client can NACK any processing message
      await testClient(router).queue.message.$post({
        json: { type: 'nack-no-lock', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      const nackRes = await testClient(router).queue.message[':messageId'].nack.$post({
        param: { messageId: msg.id },
        json: { errorReason: 'Test error' } // No lock_token provided
      });

      // Current behavior: succeeds without lock_token
      expect(nackRes.status).toBe(200);
    });

    it('should reject NACK on message that is not in processing state', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'nack-not-processing', payload: { n: 1 } }
      });

      // Get the message ID without dequeuing
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const main = await mainRes.json() as any;
      const msg = main.messages[0];

      const nackRes = await testClient(router).queue.message[':messageId'].nack.$post({
        param: { messageId: msg.id },
        json: { errorReason: 'Should fail' }
      });

      // Returns 404 because NACK handler returns 404 for non-processing messages
      expect(nackRes.status).toBe(404);
    });

    it('should reject NACK on non-existent message', async () => {
      const nackRes = await testClient(router).queue.message[':messageId'].nack.$post({
        param: { messageId: 'non-existent-message-id' },
        json: { errorReason: 'Should fail' }
      });

      expect(nackRes.status).toBe(404);
    });
  });

  describe('ACK Lock Token Validation', () => {
    it('should reject ACK after lock was stolen (message requeued and re-dequeued)', async () => {
      const queue = await getQueue();

      await testClient(router).queue.message.$post({
        json: { type: 'ack-stolen-lock', payload: { n: 1 } }
      });

      // Worker A dequeues
      const workerARes = await testClient(router).queue.message.$get({
        query: { timeout: '0', consumerId: 'worker-a' }
      });
      const workerAMsg = await workerARes.json() as any;
      const workerAToken = workerAMsg.lock_token;

      // Simulate timeout by setting locked_until to past
      await queue.pgManager.query(
        `UPDATE messages SET locked_until = NOW() - INTERVAL '5 seconds' WHERE id = $1`,
        [workerAMsg.id]
      );

      // Requeue failed messages
      await queue.requeueFailedMessages();

      // Worker B dequeues the same message (now with new lock_token)
      const workerBRes = await testClient(router).queue.message.$get({
        query: { timeout: '0', consumerId: 'worker-b' }
      });
      const workerBMsg = await workerBRes.json() as any;

      // Verify it's the same message with different lock_token
      expect(workerBMsg.id).toBe(workerAMsg.id);
      expect(workerBMsg.lock_token).not.toBe(workerAToken);

      // Worker A tries to ACK with old token - should fail
      const workerAAckRes = await testClient(router).queue.ack.$post({
        json: { id: workerAMsg.id, lock_token: workerAToken }
      });

      expect(workerAAckRes.status).toBe(409);
      const result = await workerAAckRes.json() as any;
      expect(result.error).toBe('LOCK_LOST');

      // Worker B can still ACK
      const workerBAckRes = await testClient(router).queue.ack.$post({
        json: { id: workerBMsg.id, lock_token: workerBMsg.lock_token }
      });

      expect(workerBAckRes.status).toBe(200);
    });

    it('should reject ACK on message that is not in processing state', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'ack-not-processing', payload: { n: 1 } }
      });

      // Get the message ID without dequeuing
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const main = await mainRes.json() as any;
      const msg = main.messages[0];

      const ackRes = await testClient(router).queue.ack.$post({
        json: { id: msg.id, lock_token: 'any-token' }
      });

      // Returns 400 with generic error message (not INVALID_STATE code in response)
      expect(ackRes.status).toBe(400);
    });

    it('should reject ACK on already acknowledged message', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'double-ack', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      // First ACK succeeds
      const ack1Res = await testClient(router).queue.ack.$post({
        json: { id: msg.id, lock_token: msg.lock_token }
      });
      expect(ack1Res.status).toBe(200);

      // Second ACK fails
      const ack2Res = await testClient(router).queue.ack.$post({
        json: { id: msg.id, lock_token: msg.lock_token }
      });
      expect(ack2Res.status).toBe(400);
    });
  });

  describe('Touch Lock Token Validation', () => {
    it('should reject touch after message was requeued and re-dequeued by another worker', async () => {
      const queue = await getQueue();

      await testClient(router).queue.message.$post({
        json: { type: 'touch-stolen-lock', payload: { n: 1 } }
      });

      // Worker A dequeues
      const workerARes = await testClient(router).queue.message.$get({
        query: { timeout: '0', consumerId: 'worker-a' }
      });
      const workerAMsg = await workerARes.json() as any;
      const workerAToken = workerAMsg.lock_token;

      // Simulate timeout
      await queue.pgManager.query(
        `UPDATE messages SET locked_until = NOW() - INTERVAL '5 seconds' WHERE id = $1`,
        [workerAMsg.id]
      );

      // Requeue
      await queue.requeueFailedMessages();

      // Worker B dequeues
      const workerBRes = await testClient(router).queue.message.$get({
        query: { timeout: '0', consumerId: 'worker-b' }
      });
      const workerBMsg = await workerBRes.json() as any;

      // Worker A tries to touch with old token
      const touchRes = await testClient(router).queue.message[':messageId'].touch.$put({
        param: { messageId: workerAMsg.id },
        json: { lock_token: workerAToken }
      });

      expect(touchRes.status).toBe(409);
    });

    it('should reject touch on acknowledged message', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'touch-acked', payload: { n: 1 } }
      });

      const dequeueRes = await testClient(router).queue.message.$get({
        query: { timeout: '0' }
      });
      const msg = await dequeueRes.json() as any;

      // ACK the message
      await testClient(router).queue.ack.$post({
        json: { id: msg.id, lock_token: msg.lock_token }
      });

      // Try to touch
      const touchRes = await testClient(router).queue.message[':messageId'].touch.$put({
        param: { messageId: msg.id },
        json: { lock_token: msg.lock_token }
      });

      expect(touchRes.status).toBe(404);
    });

    it('should reject touch on dead letter message', async () => {
      const queue = await getQueue();
      const originalMaxAttempts = queue.config.max_attempts;
      (queue.config as any).max_attempts = 1;

      try {
        await testClient(router).queue.message.$post({
          json: { type: 'touch-dead', payload: { n: 1 } }
        });

        const dequeueRes = await testClient(router).queue.message.$get({
          query: { timeout: '0' }
        });
        const msg = await dequeueRes.json() as any;

        // NACK to move to DLQ
        await testClient(router).queue.message[':messageId'].nack.$post({
          param: { messageId: msg.id },
          json: { errorReason: 'Force to DLQ' }
        });

        // Try to touch the dead message
        const touchRes = await testClient(router).queue.message[':messageId'].touch.$put({
          param: { messageId: msg.id },
          json: { lock_token: msg.lock_token }
        });

        expect(touchRes.status).toBe(404);
      } finally {
        (queue.config as any).max_attempts = originalMaxAttempts;
      }
    });
  });

  describe('Lock Token Uniqueness', () => {
    it('should generate unique lock tokens for each dequeue of the same message', async () => {
      const queue = await getQueue();

      await testClient(router).queue.message.$post({
        json: { type: 'unique-token', payload: { n: 1 } }
      });

      const tokens: string[] = [];

      // Dequeue, simulate timeout, and re-dequeue multiple times
      for (let i = 0; i < 3; i++) {
        const dequeueRes = await testClient(router).queue.message.$get({
          query: { timeout: '0' }
        });
        const msg = await dequeueRes.json() as any;
        tokens.push(msg.lock_token);

        // Simulate timeout and requeue (except for last iteration)
        if (i < 2) {
          await queue.pgManager.query(
            `UPDATE messages SET locked_until = NOW() - INTERVAL '5 seconds' WHERE id = $1`,
            [msg.id]
          );
          await queue.requeueFailedMessages();
        }
      }

      // All tokens should be unique
      const uniqueTokens = new Set(tokens);
      expect(uniqueTokens.size).toBe(tokens.length);
    });

    it('should generate unique lock tokens for concurrent dequeues of different messages', async () => {
      // Enqueue multiple messages
      for (let i = 0; i < 5; i++) {
        await testClient(router).queue.message.$post({
          json: { type: 'concurrent-unique', payload: { index: i } }
        });
      }

      // Dequeue all concurrently
      const dequeuePromises = Array.from({ length: 5 }, () =>
        testClient(router).queue.message.$get({ query: { timeout: '0' } })
      );

      const results = await Promise.all(dequeuePromises);
      const messages = await Promise.all(
        results.map(r => r.json() as any)
      );

      const lockTokens = messages.map(m => m.lock_token);
      const uniqueTokens = new Set(lockTokens);

      expect(uniqueTokens.size).toBe(5);
    });
  });
});
