import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../../config/env')>('../../../config/env');
  return {
    default: { ...actual.default, QUEUE_NAME: 'test_queue' }
  };
});

import { router, testClient, setupQueueTests, enqueueMessage } from './setup';

describe('Queue Routes - Dequeue Operations', () => {
  setupQueueTests();

  describe('GET /queue/message', () => {
    it('should return 200 with a message when a message is available', async () => {
      const message = { type: 'test', payload: { foo: 'bar' } };
      await testClient(router).queue.message.$post({ json: message });

      const res = await testClient(router).queue.message.$get({ query: { timeout: '0' } });

      expect(res.status).toBe(200);
      const result = await res.json() as any;
      expect(result).toHaveProperty('id');
      expect(result.type).toBe('test');
      expect(result.payload).toEqual({ foo: 'bar' });
      expect(result).toHaveProperty('lock_token');
    });

    it('should return 404 when no message is available', async () => {
      const res = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: 'Message not found' });
    });

    it('should track the correct worker name (consumer_id) when passed as parameter', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'worker-test', payload: { n: 1 } } });

      const workerName = 'my-worker-1';
      const res = await testClient(router).queue.message.$get({
        query: { timeout: '0', consumerId: workerName }
      });

      expect(res.status).toBe(200);
      const result = await res.json() as any;
      expect(result.consumer_id).toBe(workerName);
    });

    it('should track different worker names for different dequeues', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'multi-worker', payload: { n: 1 } } });
      await testClient(router).queue.message.$post({ json: { type: 'multi-worker', payload: { n: 2 } } });

      const res1 = await testClient(router).queue.message.$get({
        query: { timeout: '0', consumerId: 'worker-1' }
      });
      expect(res1.status).toBe(200);
      const msg1 = await res1.json() as any;
      expect(msg1.consumer_id).toBe('worker-1');

      const res2 = await testClient(router).queue.message.$get({
        query: { timeout: '0', consumerId: 'worker-2' }
      });
      expect(res2.status).toBe(200);
      const msg2 = await res2.json() as any;
      expect(msg2.consumer_id).toBe('worker-2');

      const processingRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      expect(processingRes.status).toBe(200);
      const processing = await processingRes.json() as any;

      const processingMessages = processing.messages || [];
      expect(processingMessages.length).toBe(2);

      const worker1Msg = processingMessages.find((m: any) => m.id === msg1.id);
      const worker2Msg = processingMessages.find((m: any) => m.id === msg2.id);

      expect(worker1Msg?.consumer_id).toBe('worker-1');
      expect(worker2Msg?.consumer_id).toBe('worker-2');
    }, 15000);

    it('should have null consumer_id when no consumerId is passed', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'no-consumer', payload: { n: 1 } } });

      const res = await testClient(router).queue.message.$get({ query: { timeout: '0' } });

      expect(res.status).toBe(200);
      const result = await res.json() as any;
      expect(result.consumer_id).toBeNull();
    });
  });

  describe('GET /queue/message?type=...', () => {
    it('should dequeue only messages of the specified type', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'type-a', payload: { id: 1 } } });
      await testClient(router).queue.message.$post({ json: { type: 'type-b', payload: { id: 2 } } });
      await testClient(router).queue.message.$post({ json: { type: 'type-a', payload: { id: 3 } } });

      const res = await testClient(router).queue.message.$get({
        query: { type: 'type-b' }
      });
      expect(res.status).toBe(200);
      const message = await res.json() as any;
      expect(message.type).toBe('type-b');
      expect(message.payload.id).toBe(2);

      const processingRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      const processing = await processingRes.json() as any;
      expect(processing.messages.some((m: any) => m.id === message.id)).toBe(true);

      const res2 = await testClient(router).queue.message.$get({
        query: { type: 'type-a' }
      });
      expect(res2.status).toBe(200);
      const message2 = await res2.json() as any;
      expect(message2.type).toBe('type-a');
      expect(message2.payload.id).toBe(1);
    }, 15000);

    it('should dequeue higher priority messages first within the same type', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'priority-test', payload: { id: 'low', p: 0 }, priority: 0 }
      });

      await testClient(router).queue.message.$post({
        json: { type: 'priority-test', payload: { id: 'high', p: 5 }, priority: 5 }
      });

      const res1 = await testClient(router).queue.message.$get({
        query: { type: 'priority-test' }
      });
      expect(res1.status).toBe(200);
      const msg1 = await res1.json() as any;

      expect(msg1.priority).toBe(5);
      expect(msg1.payload.id).toBe('high');

      const res2 = await testClient(router).queue.message.$get({
        query: { type: 'priority-test' }
      });
      expect(res2.status).toBe(200);
      const msg2 = await res2.json() as any;

      expect(msg2.priority).toBe(0);
      expect(msg2.payload.id).toBe('low');
    }, 15000);

    it('should return 404 when no message of the specified type exists', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'type-a', payload: { id: 1 } } });

      const res = await testClient(router).queue.message.$get({
        query: { type: 'type-non-existent', timeout: '0' }
      });
      expect(res.status).toBe(404);
    }, 15000);
  });

  describe('Priority Queue', () => {
    it('should dequeue higher priority messages first', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'low', payload: { p: 'low' }, priority: 1 }
      });
      await testClient(router).queue.message.$post({
        json: { type: 'high', payload: { p: 'high' }, priority: 9 }
      });
      await testClient(router).queue.message.$post({
        json: { type: 'medium', payload: { p: 'medium' }, priority: 5 }
      });

      const res1 = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      const msg1 = await res1.json() as any;
      expect(msg1.priority).toBe(9);

      const res2 = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      const msg2 = await res2.json() as any;
      expect(msg2.priority).toBe(5);

      const res3 = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      const msg3 = await res3.json() as any;
      expect(msg3.priority).toBe(1);
    });
  });
});
