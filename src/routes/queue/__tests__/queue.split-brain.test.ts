import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../../config/env')>('../../../config/env');
  return {
    default: { ...actual.default, QUEUE_NAME: 'test_queue' }
  };
});

import { router, testClient, getQueue, setupQueueTests } from './setup';

describe('Queue Routes - Split Brain Prevention', () => {
  setupQueueTests();

  describe('PUT /queue/message/:messageId/touch', () => {
    it('should extend the lock timeout successfully with lock_token', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'touch-test', payload: { n: 1 } } });
      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      expect(dequeueRes.status).toBe(200);
      const msg = await dequeueRes.json() as any;

      expect(msg.lock_token).toBeDefined();
      expect(typeof msg.lock_token).toBe('string');

      const touchRes = await testClient(router).queue.message[':messageId'].touch.$put({
        param: { messageId: msg.id },
        json: { lock_token: msg.lock_token }
      });

      expect(touchRes.status).toBe(200);
      const result = await touchRes.json() as any;
      expect(result.message).toBe('Lock extended successfully');
      expect(result.new_timeout_at).toBeGreaterThan(Date.now() / 1000);
      expect(result.lock_token).toBe(msg.lock_token);
    });

    it('should return 409 when lock_token does not match (lock lost)', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'touch-conflict', payload: { n: 1 } } });
      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      expect(dequeueRes.status).toBe(200);
      const msg = await dequeueRes.json() as any;

      const touchRes = await testClient(router).queue.message[':messageId'].touch.$put({
        param: { messageId: msg.id },
        json: { lock_token: 'wrong-token-xyz' }
      });

      expect(touchRes.status).toBe(409);
      const result = await touchRes.json() as any;
      expect(result.error).toBe('LOCK_LOST');
    });

    it('should return 404 when message is not in processing', async () => {
      const touchRes = await testClient(router).queue.message[':messageId'].touch.$put({
        param: { messageId: 'non-existent-id' },
        json: { lock_token: 'any-token' }
      });

      expect(touchRes.status).toBe(404);
    });

    it('should allow multiple touch calls to keep extending the lock', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'multi-touch', payload: { n: 1 } } });
      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      const msg = await dequeueRes.json() as any;

      const touch1Res = await testClient(router).queue.message[':messageId'].touch.$put({
        param: { messageId: msg.id },
        json: { lock_token: msg.lock_token }
      });
      expect(touch1Res.status).toBe(200);
      const touch1 = await touch1Res.json() as any;

      const touch2Res = await testClient(router).queue.message[':messageId'].touch.$put({
        param: { messageId: msg.id },
        json: { lock_token: msg.lock_token }
      });
      expect(touch2Res.status).toBe(200);
      const touch2 = await touch2Res.json() as any;

      expect(touch2.new_timeout_at).toBeGreaterThanOrEqual(touch1.new_timeout_at);
    });
  });

  describe('Split Brain Scenario Simulation', () => {
    it('should reject ACK from slow worker after message was re-queued (different lock_token)', async () => {
      const queue = await getQueue();

      // Ensure clean state - clear any leftover messages
      await testClient(router).queue.clear.$delete();

      // 1. Enqueue a message
      await testClient(router).queue.message.$post({ json: { type: 'split-brain', payload: { test: 1 } } });

      // 2. Worker A dequeues (gets lock_token_A)
      const workerADequeue = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      expect(workerADequeue.status).toBe(200);
      const workerAMsg = await workerADequeue.json() as any;
      expect(workerAMsg.lock_token).toBeDefined();

      // Store Worker A's lock_token
      const workerALockToken = workerAMsg.lock_token;

      // 3. Simulate timeout by setting locked_until to the past
      // This avoids clock skew issues between local time and PostgreSQL server time
      await queue.pgManager.query(
        `UPDATE messages SET locked_until = NOW() - INTERVAL '5 seconds' WHERE id = $1`,
        [workerAMsg.id]
      );

      // Verify the message is now considered overdue
      const msgState = await queue.pgManager.query(
        `SELECT id, status, locked_until < NOW() as is_overdue FROM messages WHERE id = $1`,
        [workerAMsg.id]
      );
      expect(msgState.rows[0].is_overdue).toBe(true);

      // 4. Trigger requeue
      const requeueCount = await queue.requeueFailedMessages();
      expect(requeueCount).toBe(1);

      // 5. Worker B dequeues the re-queued message (gets NEW lock_token)
      const workerBDequeue = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      expect(workerBDequeue.status).toBe(200);
      const workerBMsg = await workerBDequeue.json() as any;
      expect(workerBMsg.id).toBe(workerAMsg.id); // Same message
      expect(workerBMsg.lock_token).not.toBe(workerALockToken); // Different lock_token!

      // 6. Worker A (slow) tries to ACK with old lock_token - should be REJECTED
      const workerAAck = await testClient(router).queue.ack.$post({
        json: {
          id: workerAMsg.id,
          lock_token: workerALockToken // OLD lock_token
        }
      });

      expect(workerAAck.status).toBe(409);
      const workerAResult = await workerAAck.json() as any;
      expect(workerAResult.error).toBe('LOCK_LOST');

      // 7. Worker B can still ACK successfully with its lock_token
      const workerBAck = await testClient(router).queue.ack.$post({
        json: {
          id: workerBMsg.id,
          lock_token: workerBMsg.lock_token // Current lock_token
        }
      });

      expect(workerBAck.status).toBe(200);
    });

    it('should allow touch to prevent timeout during heavy processing', async () => {
      const queue = await getQueue();
      const originalTimeout = queue.config.ack_timeout_seconds;
      (queue.config as any).ack_timeout_seconds = 2;

      try {
        // 1. Enqueue and dequeue
        await testClient(router).queue.message.$post({ json: { type: 'heavy-task', payload: { size: 'large' } } });
        const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
        const msg = await dequeueRes.json() as any;

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
        const requeueCount = await queue.requeueFailedMessages();
        expect(requeueCount).toBe(0);

        // 6. ACK should still work with same lock_token
        const ackRes = await testClient(router).queue.ack.$post({
          json: {
            id: msg.id,
            lock_token: msg.lock_token
          }
        });
        expect(ackRes.status).toBe(200);

      } finally {
        (queue.config as any).ack_timeout_seconds = originalTimeout;
      }
    }, 15000);
  });
});
