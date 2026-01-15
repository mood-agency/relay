import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../../config/env')>('../../../config/env');
  return {
    default: { ...actual.default, QUEUE_NAME: 'test_queue' }
  };
});

import { router, testClient, setupQueueTests, waitForAsync } from './setup';

describe('Queue Routes - Activity Log Endpoints', () => {
  setupQueueTests();

  describe('GET /queue/activity', () => {
    it('should return empty logs when no activity exists', async () => {
      const res = await testClient(router).queue.activity.$get();
      expect(res.status).toBe(200);
      const result = await res.json() as any;
      expect(result).toHaveProperty('logs');
      expect(result).toHaveProperty('pagination');
      expect(result.logs).toEqual([]);
    });

    it('should log enqueue events when messages are added', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'activity-test', payload: { foo: 'bar' } } });

      await waitForAsync();

      const res = await testClient(router).queue.activity.$get({
        query: { action: 'enqueue' }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;
      expect(result.logs.length).toBeGreaterThanOrEqual(1);
      expect(result.logs[0].action).toBe('enqueue');
      expect(result.logs[0].message_type).toBe('activity-test');
    });

    it('should log dequeue events when messages are consumed', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'dequeue-log-test', payload: { n: 1 } } });
      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      expect(dequeueRes.status).toBe(200);
      const msg = await dequeueRes.json() as any;

      await waitForAsync();

      const res = await testClient(router).queue.activity.$get({
        query: { message_id: msg.id }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      const actions = result.logs.map((l: any) => l.action);
      expect(actions).toContain('enqueue');
      expect(actions).toContain('dequeue');
    });

    it('should log ack events when messages are acknowledged', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'ack-log-test', payload: { n: 1 } } });
      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      const msg = await dequeueRes.json() as any;

      await testClient(router).queue.ack.$post({
        json: {
          id: msg.id,
          lock_token: msg.lock_token
        }
      });

      await waitForAsync();

      const res = await testClient(router).queue.activity.$get({
        query: { message_id: msg.id }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      const actions = result.logs.map((l: any) => l.action);
      expect(actions).toContain('acknowledge');
    });

    it('should support pagination', async () => {
      for (let i = 0; i < 5; i++) {
        await testClient(router).queue.message.$post({ json: { type: 'pagination-test', payload: { i } } });
      }

      await waitForAsync();

      const res = await testClient(router).queue.activity.$get({
        query: { limit: '2', offset: '0' }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      expect(result.logs.length).toBeLessThanOrEqual(2);
      expect(result.pagination).toHaveProperty('total');
      expect(result.pagination).toHaveProperty('limit');
      expect(result.pagination).toHaveProperty('offset');
      expect(result.pagination).toHaveProperty('has_more');
    });

    it('should return correctly mapped fields for frontend (log_id, timestamp, queue, payload)', async () => {
      const testPayload = { testKey: 'testValue', nested: { foo: 'bar' } };
      await testClient(router).queue.message.$post({
        json: { type: 'field-mapping-test', payload: testPayload }
      });

      await waitForAsync();

      const res = await testClient(router).queue.activity.$get({
        query: { action: 'enqueue' }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      const logEntry = result.logs.find((l: any) => l.message_type === 'field-mapping-test');
      expect(logEntry).toBeDefined();

      // log_id should be a string (mapped from database id)
      expect(logEntry.log_id).toBeDefined();
      expect(typeof logEntry.log_id).toBe('string');
      expect(logEntry.log_id.length).toBeGreaterThan(0);

      // timestamp should be a number (epoch seconds, mapped from created_at)
      expect(logEntry.timestamp).toBeDefined();
      expect(typeof logEntry.timestamp).toBe('number');
      expect(logEntry.timestamp).toBeGreaterThan(0);
      const nowSeconds = Math.floor(Date.now() / 1000);
      expect(logEntry.timestamp).toBeLessThanOrEqual(nowSeconds + 1);
      expect(logEntry.timestamp).toBeGreaterThan(nowSeconds - 60);

      // queue should be set (mapped from queue_name or context)
      expect(logEntry.queue).toBeDefined();
      expect(logEntry.queue).toBe('default');

      // payload should be included in the response
      expect(logEntry.payload).toBeDefined();
      expect(logEntry.payload).toEqual(testPayload);

      // triggered_by should have a default value
      expect(logEntry.triggered_by).toBeDefined();
      expect(logEntry.triggered_by).toBe('api');

      // action should be preserved
      expect(logEntry.action).toBe('enqueue');

      // message_type should be preserved
      expect(logEntry.message_type).toBe('field-mapping-test');
    });

    it('should return null for optional fields when not present in context', async () => {
      await testClient(router).queue.message.$post({
        json: { type: 'null-fields-test', payload: { simple: true } }
      });

      await waitForAsync();

      const res = await testClient(router).queue.activity.$get({
        query: { action: 'enqueue' }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      const logEntry = result.logs.find((l: any) => l.message_type === 'null-fields-test');
      expect(logEntry).toBeDefined();

      // These fields should be null when not in context
      expect(logEntry.source_queue).toBeNull();
      expect(logEntry.dest_queue).toBeNull();
      expect(logEntry.prev_consumer_id).toBeNull();
      expect(logEntry.error_reason).toBeNull();
      expect(logEntry.batch_id).toBeNull();
    });
  });

  describe('GET /queue/activity/message/:messageId', () => {
    it('should return full message history in chronological order', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'history-test', payload: { test: true } } });
      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      const msg = await dequeueRes.json() as any;

      await testClient(router).queue.ack.$post({
        json: {
          id: msg.id,
          lock_token: msg.lock_token
        }
      });

      await waitForAsync();

      const res = await testClient(router).queue.activity.message[':messageId'].$get({
        param: { messageId: msg.id }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      expect(result.message_id).toBe(msg.id);
      expect(result.history).toBeInstanceOf(Array);
      expect(result.history.length).toBeGreaterThanOrEqual(3);

      // Verify chronological order (oldest first)
      const actions = result.history.map((h: any) => h.action);
      expect(actions[0]).toBe('enqueue');
      expect(actions[1]).toBe('dequeue');
      expect(actions[2]).toBe('acknowledge');
    });

    it('should return empty history for non-existent message', async () => {
      const res = await testClient(router).queue.activity.message[':messageId'].$get({
        param: { messageId: 'non-existent-message-id' }
      });
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      expect(result.message_id).toBe('non-existent-message-id');
      expect(result.history).toEqual([]);
    });
  });

  describe('GET /queue/activity/consumers', () => {
    it('should return consumer statistics', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'consumer-stats-test', payload: {} } });
      await testClient(router).queue.message.$get({ query: { timeout: '0', consumerId: 'test-consumer' } });

      await waitForAsync();

      const res = await testClient(router).queue.activity.consumers.$get();
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      expect(result).toHaveProperty('stats');
    });

    it('should return correct count of unique consumers', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'count-test-1', payload: {} } });
      await testClient(router).queue.message.$post({ json: { type: 'count-test-2', payload: {} } });
      await testClient(router).queue.message.$post({ json: { type: 'count-test-3', payload: {} } });

      await testClient(router).queue.message.$get({ query: { timeout: '0', consumerId: 'worker-alpha' } });
      await testClient(router).queue.message.$get({ query: { timeout: '0', consumerId: 'worker-beta' } });
      await testClient(router).queue.message.$get({ query: { timeout: '0', consumerId: 'worker-alpha' } });

      await waitForAsync();

      const res = await testClient(router).queue.activity.consumers.$get();
      expect(res.status).toBe(200);
      const result = await res.json() as any;

      // stats is a Record<consumerId, { dequeue_count, last_dequeue }>
      expect(typeof result.stats).toBe('object');
      const consumerIds = Object.keys(result.stats);
      expect(consumerIds.length).toBeGreaterThanOrEqual(2);
      expect(consumerIds).toContain('worker-alpha');
      expect(consumerIds).toContain('worker-beta');
    });
  });
});
