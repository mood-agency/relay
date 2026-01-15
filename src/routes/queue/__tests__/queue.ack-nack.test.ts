import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../../config/env')>('../../../config/env');
  return {
    default: { ...actual.default, QUEUE_NAME: 'test_queue' }
  };
});

import { router, testClient, getQueue, setupQueueTests } from './setup';

describe('Queue Routes - Acknowledge & Nack Operations', () => {
  setupQueueTests();

  describe('POST /queue/ack', () => {
    it('should return 200 when a valid message is acknowledged', async () => {
      const message = { type: 'test', payload: { foo: 'bar' } };
      await testClient(router).queue.message.$post({ json: message });
      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      const dequeuedMessage = await dequeueRes.json() as any;

      const ackRes = await testClient(router).queue.ack.$post({
        json: {
          id: dequeuedMessage.id,
          lock_token: dequeuedMessage.lock_token
        }
      });

      expect(ackRes.status).toBe(200);
      expect(await ackRes.json()).toEqual({ message: 'Message acknowledged' });
    });

    it('should return 409 when acknowledging with wrong lock_token', async () => {
      const message = { type: 'test', payload: { foo: 'bar' } };
      await testClient(router).queue.message.$post({ json: message });
      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      const dequeuedMessage = await dequeueRes.json() as any;

      const ackRes = await testClient(router).queue.ack.$post({
        json: {
          id: dequeuedMessage.id,
          lock_token: 'wrong-token-xyz'
        }
      });

      expect(ackRes.status).toBe(409);
    });
  });

  describe('POST /queue/message/:messageId/nack', () => {
    it('should requeue a message when nacked', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'nack-test', payload: { n: 1 } } });

      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      expect(dequeueRes.status).toBe(200);
      const msg = await dequeueRes.json() as any;

      const nackRes = await testClient(router).queue.message[':messageId'].nack.$post({
        param: { messageId: msg.id },
        json: { errorReason: 'Test failure' }
      });

      expect(nackRes.status).toBe(200);

      const dequeue2Res = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      expect(dequeue2Res.status).toBe(200);
      const msg2 = await dequeue2Res.json() as any;
      expect(msg2.id).toBe(msg.id);
      expect(msg2.last_error).toBe('Test failure');
      expect(msg2.attempt_count).toBe(2);
    });

    it('should move to DLQ when nacked and max attempts exceeded', async () => {
      const queue = await getQueue();
      const originalMaxAttempts = queue.config.max_attempts;
      (queue.config as any).max_attempts = 1;

      try {
        await testClient(router).queue.message.$post({ json: { type: 'nack-dlq', payload: {} } });

        const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
        const msg = await dequeueRes.json() as any;

        const nackRes = await testClient(router).queue.message[':messageId'].nack.$post({
          param: { messageId: msg.id },
          json: { errorReason: 'Fatal error' }
        });
        expect(nackRes.status).toBe(200);

        const dlqRes = await testClient(router).queue[':queueType'].messages.$get({
          param: { queueType: 'dead' }
        });
        const dlq = await dlqRes.json() as any;
        expect((dlq.messages || []).length).toBe(1);
        expect(dlq.messages[0].id).toBe(msg.id);
        expect(dlq.messages[0].last_error).toBe('Fatal error');
      } finally {
        (queue.config as any).max_attempts = originalMaxAttempts;
      }
    });
  });

  describe('POST /queue/ack - Lock Validation', () => {
    it('should acknowledge successfully with matching lock_token', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'ack-lock-test', payload: { n: 1 } } });
      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      const msg = await dequeueRes.json() as any;

      const ackRes = await testClient(router).queue.ack.$post({
        json: {
          id: msg.id,
          lock_token: msg.lock_token
        }
      });

      expect(ackRes.status).toBe(200);
      const result = await ackRes.json() as any;
      expect(result.message).toBe('Message acknowledged');
    });

    it('should return 409 when lock_token does not match (stale ACK)', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'stale-ack', payload: { n: 1 } } });
      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      const msg = await dequeueRes.json() as any;

      const ackRes = await testClient(router).queue.ack.$post({
        json: {
          id: msg.id,
          lock_token: 'wrong-token-abc'
        }
      });

      expect(ackRes.status).toBe(409);
      const result = await ackRes.json() as any;
      expect(result.error).toBe('LOCK_LOST');
    });

    it('should still accept ACK without lock_token for backward compatibility', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'no-lock-ack', payload: { n: 1 } } });
      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      const msg = await dequeueRes.json() as any;

      const ackRes = await testClient(router).queue.ack.$post({
        json: {
          id: msg.id
        }
      });

      expect(ackRes.status).toBe(200);
    });
  });
});
