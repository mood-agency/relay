import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/env', async () => {
  const actual = await vi.importActual<typeof import('../../../config/env')>('../../../config/env');
  return {
    default: { ...actual.default, QUEUE_NAME: 'test_queue' }
  };
});

import { router, testClient, setupQueueTests } from './setup';

describe('Queue Routes - Move Operations', () => {
  setupQueueTests();

  describe('POST /queue/move', () => {
    it('should move a selected message to processing and remove it from main', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'm1', payload: { n: 1 } } });
      await testClient(router).queue.message.$post({ json: { type: 'm2', payload: { n: 2 } } });

      const mainListRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { page: '1', limit: '50', sortBy: 'created_at', sortOrder: 'desc' }
      });
      expect(mainListRes.status).toBe(200);
      const mainList = await mainListRes.json() as any;
      expect(Array.isArray(mainList.messages)).toBe(true);
      expect(mainList.messages.length).toBeGreaterThan(0);

      const selected = mainList.messages[0];
      const toMove = {
        id: selected.id,
        type: selected.type,
        payload: selected.payload,
        priority: selected.priority,
      };

      const moveRes = await testClient(router).queue.move.$post({
        json: { messages: [toMove], fromQueue: 'main', toQueue: 'processing' }
      });
      expect(moveRes.status).toBe(200);
      const moveResult = await moveRes.json() as any;
      expect(moveResult.movedCount).toBe(1);

      const mainListAfterRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { page: '1', limit: '50', sortBy: 'created_at', sortOrder: 'desc' }
      });
      expect(mainListAfterRes.status).toBe(200);
      const mainListAfter = await mainListAfterRes.json() as any;
      const stillInMain = (mainListAfter.messages || []).some((m: any) => m.id === selected.id);
      expect(stillInMain).toBe(false);

      const processingRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      expect(processingRes.status).toBe(200);
      const processing = await processingRes.json() as any;
      const inProcessing = (processing.messages || []).some((m: any) => m.id === selected.id);
      expect(inProcessing).toBe(true);
    }, 15000);

    it('should store errorReason as last_error when moving to DLQ', async () => {
      await testClient(router).queue.message.$post({ json: { type: 'dlq-reason', payload: { n: 1 } } });

      const mainListRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { page: '1', limit: '50', sortBy: 'created_at', sortOrder: 'desc' }
      });
      expect(mainListRes.status).toBe(200);
      const mainList = await mainListRes.json() as any;
      const selected = (mainList.messages || []).find((m: any) => m.type === 'dlq-reason');
      expect(selected).toBeTruthy();

      const errorReason = "Invalid payload schema";
      const moveRes = await testClient(router).queue.move.$post({
        json: { messages: [selected], fromQueue: 'main', toQueue: 'dead', errorReason }
      });
      expect(moveRes.status).toBe(200);

      const deadRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'dead' },
        query: { page: '1', limit: '50', sortBy: 'created_at', sortOrder: 'desc' }
      });
      expect(deadRes.status).toBe(200);
      const deadList = await deadRes.json() as any;
      const deadMsg = (deadList.messages || []).find((m: any) => m.id === selected.id);
      expect(deadMsg).toBeTruthy();
      expect(deadMsg.last_error).toBe(errorReason);
    }, 15000);

    it('should correctly move a batch of messages to processing', async () => {
      // 1. Enqueue 5 messages
      for (let i = 0; i < 5; i++) {
        await testClient(router).queue.message.$post({ json: { type: 'batch-move', payload: { i } } });
      }

      // 2. Fetch messages to get IDs
      const listRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' },
        query: { limit: '10' }
      });
      const list = await listRes.json() as any;
      const messages = (list.messages || []).filter((m: any) => m.type === 'batch-move');

      expect(messages.length).toBe(5);

      // Select 2 specific messages (e.g. index 1 and 3)
      const selected = [messages[1], messages[3]];
      const selectedIds = selected.map((m: any) => m.id);

      // 3. Move them to Processing
      const moveRes = await testClient(router).queue.move.$post({
        json: { messages: selected, fromQueue: 'main', toQueue: 'processing' }
      });
      expect(moveRes.status).toBe(200);
      const moveResult = await moveRes.json() as any;
      expect(moveResult.movedCount).toBe(2);

      // 4. Verify Processing Queue
      const processingRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'processing' }
      });
      expect(processingRes.status).toBe(200);
      const processing = await processingRes.json() as any;
      const processingMessages = processing.messages || [];

      // Check count
      expect(processingMessages.length).toBe(2);

      // Check IDs match exactly what we selected
      const processingIds = processingMessages.map((m: any) => m.id);
      expect(processingIds.sort()).toEqual(selectedIds.sort());

      // 5. Verify processing fields are properly set (consumer_id, lock_token, locked_until, dequeued_at)
      for (const msg of processingMessages) {
        expect(msg.consumer_id).toBe('user-manual-operation'); // Should be set to manual operation actor for moved messages
        expect(msg.lock_token).toBeTruthy(); // Should have a lock token
        expect(msg.lock_token.length).toBeGreaterThan(0);
        expect(msg.locked_until).toBeTruthy(); // Should have a lock deadline
        expect(msg.dequeued_at).toBeTruthy(); // Should have dequeued_at timestamp
      }

      // 6. Verify Main Queue (should have 3 left)
      const mainRes = await testClient(router).queue[':queueType'].messages.$get({
        param: { queueType: 'main' }
      });
      const main = await mainRes.json() as any;
      const remaining = (main.messages || []).filter((m: any) => m.type === 'batch-move');
      expect(remaining.length).toBe(3);

      // Verify none of the selected IDs are in main
      const remainingIds = remaining.map((m: any) => m.id);
      for (const id of selectedIds) {
        expect(remainingIds).not.toContain(id);
      }
    }, 15000);
  });
});
