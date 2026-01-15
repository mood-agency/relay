import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../../config/env')>('../../../config/env');
  return {
    default: { ...actual.default, QUEUE_NAME: 'test_queue' }
  };
});

import { router, testClient, setupQueueTests } from './setup';

describe('Queue Routes - Clear Operations', () => {
  setupQueueTests();

  describe('DELETE /queue/clear', () => {
    it('should clear all queues successfully', async () => {
      await testClient(router).queue.message.$post({ json: { type: 't1', payload: {} } });
      await testClient(router).queue.message.$post({ json: { type: 't2', payload: {} } });

      const res = await testClient(router).queue.clear.$delete();
      expect(res.status).toBe(200);

      const metricsRes = await testClient(router).queue.metrics.$get();
      const metrics = await metricsRes.json() as any;
      expect(metrics.main_queue_size).toBe(0);
    });
  });

  describe('DELETE /queue/:queueType/clear', () => {
    it('should clear specific queue successfully', async () => {
      await testClient(router).queue.message.$post({ json: { type: 't1', payload: {} } });

      const res = await testClient(router).queue[':queueType'].clear.$delete({
        param: { queueType: 'main' }
      });
      expect(res.status).toBe(200);

      const metricsRes = await testClient(router).queue.metrics.$get();
      const metrics = await metricsRes.json() as any;
      expect(metrics.main_queue_size).toBe(0);
    });
  });
});
