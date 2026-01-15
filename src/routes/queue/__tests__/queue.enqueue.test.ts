import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../../config/env')>('../../../config/env');
  return {
    default: { ...actual.default, QUEUE_NAME: 'test_queue' }
  };
});

import { router, testClient, setupQueueTests } from './setup';

describe('Queue Routes - Enqueue Operations', () => {
  setupQueueTests();

  describe('POST /queue/message', () => {
    it('should return 201 when message is added successfully', async () => {
      const message = { type: 'test', payload: { foo: 'bar' } };
      const res = await testClient(router).queue.message.$post({ json: message });
      expect(res.status).toBe(201);
      const result = await res.json() as any;
      expect(result).toHaveProperty('message');
      expect(result.message).toBe('Message added successfully');
    });

    it('should return 422 for invalid message format', async () => {
      const invalidMessage = { invalidField: 'test' };
      const res = await testClient(router).queue.message.$post({ json: invalidMessage as any });
      expect(res.status).toBe(422);
    });
  });

  describe('POST /queue/batch', () => {
    it('should enqueue multiple messages', async () => {
      const res = await testClient(router).queue.batch.$post({
        json: [
          { type: 'batch1', payload: { i: 1 } },
          { type: 'batch2', payload: { i: 2 } },
          { type: 'batch3', payload: { i: 3 } }
        ]
      });
      expect(res.status).toBe(201);
      const json = await res.json() as any;
      expect(json.message).toContain('3/3');
    });
  });
});
