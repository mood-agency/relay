import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../../config/env')>('../../../config/env');
  return {
    default: { ...actual.default, QUEUE_NAME: 'test_queue' }
  };
});

import { router, testClient, setupQueueTests } from './setup';

describe('Queue Routes - Message Operations', () => {
  setupQueueTests();

  describe('GET /queue/processing/messages', () => {
    it('should return 200 (empty) when no messages are processing', async () => {
      const res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.messages).toEqual([]);
    });

    it('should return 200 (empty) when messages exist but none are processing', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'test', payload: {} } });

      const res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result.messages).toEqual([]);
    });
  });

  describe('GET /queue/:queueType/messages', () => {
    it('should return 200 with messages from the queue', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'test', payload: { foo: 'bar' } } });

      const res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;
      expect(result).toHaveProperty('messages');
      expect(result).toHaveProperty('pagination');
      expect(result.messages.length).toBeGreaterThan(0);
      expect(result.messages[0].type).toBe('test');
    });

    it('should sort messages by created_at ascending', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'sort-created-test-1', payload: { order: 1 } } });
      await new Promise(resolve => setTimeout(resolve, 50));
      await testClient(router).queue.message.$post({ json: { type: 'sort-created-test-2', payload: { order: 2 } } });
      await new Promise(resolve => setTimeout(resolve, 50));
      await testClient(router).queue.message.$post({ json: { type: 'sort-created-test-3', payload: { order: 3 } } });

      const res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { sortBy: 'created_at', sortOrder: 'asc' }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      const testMsgs = result.messages.filter((m: any) => m.type?.startsWith('sort-created-test-'));
      expect(testMsgs.length).toBeGreaterThanOrEqual(3);

      // created_at is now a Unix timestamp in seconds
      for (let i = 1; i < testMsgs.length; i++) {
        expect(testMsgs[i].created_at).toBeGreaterThanOrEqual(testMsgs[i - 1].created_at);
      }
    });

    it('should sort messages by created_at descending', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'sort-created-desc-1', payload: { order: 1 } } });
      await new Promise(resolve => setTimeout(resolve, 50));
      await testClient(router).queue.message.$post({ json: { type: 'sort-created-desc-2', payload: { order: 2 } } });
      await new Promise(resolve => setTimeout(resolve, 50));
      await testClient(router).queue.message.$post({ json: { type: 'sort-created-desc-3', payload: { order: 3 } } });

      const res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { sortBy: 'created_at', sortOrder: 'desc' }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      const testMsgs = result.messages.filter((m: any) => m.type?.startsWith('sort-created-desc-'));
      expect(testMsgs.length).toBeGreaterThanOrEqual(3);

      // created_at is now a Unix timestamp in seconds
      for (let i = 1; i < testMsgs.length; i++) {
        expect(testMsgs[i].created_at).toBeLessThanOrEqual(testMsgs[i - 1].created_at);
      }
    });

    it('should sort messages by type alphabetically ascending', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'zulu-sort-type', payload: {} } });
      await testClient(router).queue.message.$post({ json: { type: 'alpha-sort-type', payload: {} } });
      await testClient(router).queue.message.$post({ json: { type: 'mike-sort-type', payload: {} } });

      const res = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { sortBy: 'type', sortOrder: 'asc' }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      const testMsgs = result.messages.filter((m: any) => m.type?.endsWith('-sort-type'));
      expect(testMsgs.length).toBeGreaterThanOrEqual(3);

      for (let i = 1; i < testMsgs.length; i++) {
        expect(testMsgs[i].type.localeCompare(testMsgs[i - 1].type)).toBeGreaterThanOrEqual(0);
      }
    });

    it('should sort messages by priority', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'priority-sort-test', priority: 1, payload: { p: 1 } } });
      await testClient(router).queue.message.$post({ json: { type: 'priority-sort-test', priority: 5, payload: { p: 5 } } });
      await testClient(router).queue.message.$post({ json: { type: 'priority-sort-test', priority: 3, payload: { p: 3 } } });

      const resAsc = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { sortBy: 'priority', sortOrder: 'asc', filterType: 'priority-sort-test' }
      });
      expect(resAsc.status).toBe(200);
      const resultAsc = await resAsc.json() as any;

      for (let i = 1; i < resultAsc.messages.length; i++) {
        expect(resultAsc.messages[i].priority).toBeGreaterThanOrEqual(resultAsc.messages[i - 1].priority);
      }

      const resDesc = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { sortBy: 'priority', sortOrder: 'desc', filterType: 'priority-sort-test' }
      });
      expect(resDesc.status).toBe(200);
      const resultDesc = await resDesc.json() as any;

      for (let i = 1; i < resultDesc.messages.length; i++) {
        expect(resultDesc.messages[i].priority).toBeLessThanOrEqual(resultDesc.messages[i - 1].priority);
      }
    });
  });

  describe('Date Range Operations', () => {
    it('should get messages by date range', async () => {
      const start = new Date(Date.now() - 10000).toISOString();

      await testClient(router).queue.message.$post({ json: { type: 'date-test', payload: {} } });

      const end = new Date(Date.now() + 10000).toISOString();

      const res = await testClient(router).queue.messages.$get({
        query: { startTimestamp: start, endTimestamp: end }
      });

      expect(res.status).toBe(200);
      const messages = await res.json() as any;
      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0].type).toBe('date-test');
    });

    it('should remove messages by date range', async () => {
      const start = new Date(Date.now() - 10000).toISOString();

      await testClient(router).queue.message.$post({ json: { type: 'date-delete', payload: {} } });

      const end = new Date(Date.now() + 10000).toISOString();

      const res = await testClient(router).queue.messages.$delete({
        query: { startTimestamp: start, endTimestamp: end }
      });

      expect(res.status).toBe(200);
      const result = await res.json() as any;
      expect(result.message).toContain('messages removed');

      const metricsRes = await testClient(router).queue.metrics.$get();
      const metrics = await metricsRes.json() as any;
      expect(metrics.main_queue_size).toBe(0);
    });
  });

  describe('PUT /queue/message/:messageId', () => {
    it('should update a message successfully', async () => {
      const enqueueRes = await testClient(router).queue.message.$post({ json: { type: 'original', payload: { val: 1 } } });
      const enqueued = await enqueueRes.json() as any;

      const updateRes = await testClient(router).queue.message[':messageId'].$put({
        param: { messageId: enqueued.id },
        query: { queueType: 'main' },
        json: { payload: { val: 2 } }
      });

      expect(updateRes.status).toBe(200);
      const result = await updateRes.json() as any;
      expect(result.success).toBe(true);
      expect(result.data.payload).toEqual({ val: 2 });
    });
  });

  describe('DELETE /queue/message/:messageId', () => {
    it('should delete a message successfully', async () => {
      const enqueueRes = await testClient(router).queue.message.$post({ json: { type: 'to-delete', payload: {} } });
      const enqueued = await enqueueRes.json() as any;

      const deleteRes = await testClient(router).queue.message[':messageId'].$delete({
        param: { messageId: enqueued.id },
        query: { queueType: 'main' }
      });

      expect(deleteRes.status).toBe(200);
      const result = await deleteRes.json() as any;
      expect(result.success).toBe(true);
    });
  });

  describe('POST /queue/messages/delete', () => {
    it('should delete multiple messages successfully', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'del-1', payload: { i: 1 } } });
      await testClient(router).queue.message.$post({ json: { type: 'del-2', payload: { i: 2 } } });
      await testClient(router).queue.message.$post({ json: { type: 'del-3', payload: { i: 3 } } });

      const listRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { limit: '10' }
      });
      const list = await listRes.json() as any;
      const ids = list.messages.map((m: any) => m.id);
      expect(ids.length).toBe(3);

      const deleteRes = await testClient(router).queue.messages['delete'].$post({
        query: { queueType: 'main' },
        json: { messageIds: ids }
      });

      expect(deleteRes.status).toBe(200);
      const result = await deleteRes.json() as any;
      expect(result.success).toBe(true);
      expect(result.deletedCount).toBe(3);

      const afterRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const afterList = await afterRes.json() as any;
      expect(afterList.messages.length).toBe(0);
    });
  });
});
