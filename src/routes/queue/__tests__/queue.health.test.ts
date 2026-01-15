import { describe, it, expect, vi } from 'vitest';

// Mock must be before imports that use the mocked module
vi.mock('../../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../../config/env')>('../../../config/env');
  return {
    default: { ...actual.default, QUEUE_NAME: 'test_queue' }
  };
});

import { router, testClient, setupQueueTests } from './setup';

describe('Queue Routes - Health Check', () => {
  setupQueueTests();

  describe('GET /health', () => {
    it('should return 200 OK when PostgreSQL is healthy', async () => {
      const res = await testClient(router).health.$get();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveProperty('status');
      expect(json.status).toBe('OK');
    });
  });
});
