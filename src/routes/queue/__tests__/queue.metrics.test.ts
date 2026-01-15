import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../../config/env')>('../../../config/env');
  return {
    default: { ...actual.default, QUEUE_NAME: 'test_queue' }
  };
});

import { router, testClient, setupQueueTests } from './setup';

describe('Queue Routes - Metrics & Status', () => {
  setupQueueTests();

  describe('GET /queue/metrics', () => {
    it('should return 200 with queue metrics', async () => {
      const res = await testClient(router).queue.metrics.$get();
      expect(res.status).toBe(200);
      const result = await res.json() as any;
      expect(result).toHaveProperty('main_queue_size');
      expect(result).toHaveProperty('processing_queue_size');
      expect(result).toHaveProperty('dead_letter_queue_size');
    });
  });

  describe('GET /queue/status', () => {
    it('should return 200 with detailed queue status', async () => {
      const res = await testClient(router).queue.status.$get();
      expect(res.status).toBe(200);
      const result = await res.json() as any;
      expect(result).toHaveProperty('mainQueue');
      expect(result.mainQueue).toHaveProperty('messages');
      expect(result).toHaveProperty('processingQueue');
      expect(result).toHaveProperty('deadLetterQueue');
    });

    it('should not create extra pending messages across priority levels', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'p0', payload: { a: 1 }, priority: 0 } });
      await testClient(router).queue.message.$post({ json: { type: 'p1', payload: { b: 2 }, priority: 1 } });

      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '0' } });
      expect(dequeueRes.status).toBe(200);
      const msg = await dequeueRes.json() as any;
      expect(msg.type).toBe('p1'); // Higher priority should come first

      const statusRes = await testClient(router).queue.status.$get();
      expect(statusRes.status).toBe(200);
      const status = await statusRes.json() as any;
      expect(status.processingQueue.length).toBe(1);
    });
  });

  describe('GET /queue/config', () => {
    it('should return queue configuration', async () => {
      const res = await testClient(router).queue.config.$get();
      expect(res.status).toBe(200);
      const json = await res.json() as any;
      expect(json.ack_timeout_seconds).toBeDefined();
      expect(json.max_attempts).toBeDefined();
    });
  });
});
