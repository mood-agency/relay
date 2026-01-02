import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OptimizedRedisQueue, QueueConfig } from '../redis.js';

// Mock config
const config = new QueueConfig({
  redis_host: 'localhost',
  redis_port: 6379,
  redis_db: 0,
  queue_name: 'test_queue',
  processing_queue_name: 'test_queue_processing',
  dead_letter_queue_name: 'test_queue_dlq',
  metadata_hash_name: 'test_queue_metadata',
  ack_timeout_seconds: 60,
  max_attempts: 3,
  batch_size: 10,
  redis_pool_size: 1,
  enable_message_encryption: 'false',
  secret_key: 'secret',
});

describe('Metrics Unit Tests', () => {
  let queue: OptimizedRedisQueue;
  let mockPipeline: any;

  beforeEach(() => {
    queue = new OptimizedRedisQueue(config);
    
    // Mock the pipeline
    mockPipeline = {
      xlen: vi.fn().mockReturnThis(),
      get: vi.fn().mockReturnThis(),
      hlen: vi.fn().mockReturnThis(),
      xpending: vi.fn().mockReturnThis(),
      xrevrange: vi.fn().mockReturnThis(),
      hgetall: vi.fn().mockReturnThis(),
      hget: vi.fn().mockReturnThis(),
      xrange: vi.fn().mockReturnThis(),
      exec: vi.fn(),
    };

    // Mock redisManager
    queue.redisManager = {
      pipeline: vi.fn(() => mockPipeline),
      redis: {
        pipeline: vi.fn(() => mockPipeline),
        ping: vi.fn(),
      }
    } as any;
    
    // Mock _getAllPriorityStreams to return a fixed list of 2 streams
    // This mocks the helper function which is mixed into the prototype
    queue['_getAllPriorityStreams'] = vi.fn().mockReturnValue(['test_queue_p1', 'test_queue_p0']);
    // Assuming p1 is higher priority than p0, or whatever the order is.
    // In the real implementation:
    // for (let i = max - 1; i >= 0; i--) ... push
    // So if max=2 (0, 1), loop 1, 0. Stream names: ..._1, ..._0.
    // So index 0 is p1, index 1 is p0.
  });

  describe('getMetrics', () => {
    it('should return correct metrics structure', async () => {
       // Mock exec results
       const execResult = [
         [null, 10], // p1 len
         [null, 5],  // p0 len
         [null, 2],  // dlq len
         [null, 3],  // ack len
         [null, 1],  // archived len
         [null, '100'], // total ack
         [null, 50], // metadata count
         [null, [2, 'min', 'max', []]], // p1 pending summary
         [null, [1, 'min', 'max', []]], // p0 pending summary
       ];
       
       mockPipeline.exec.mockResolvedValue(execResult);
       
       const metrics = await queue.getMetrics();
       
       expect(metrics).not.toHaveProperty('error');
       expect(metrics.main_queue_size).toBe(15); // 10 + 5
       expect(metrics.processing_queue_size).toBe(3); // 2 + 1
       expect(metrics.dead_letter_queue_size).toBe(2);
       expect(metrics.total_acknowledged).toBe(100);
       
       // Verify priority details
       // priorityCount = 2.
       // i=0 (p1): priority = 2-1-0 = 1.
       expect(metrics.details.priority_1_queued).toBe(10);
       expect(metrics.details.priority_1_processing).toBe(2);
       
       // i=1 (p0): priority = 2-1-1 = 0.
       expect(metrics.details.priority_0_queued).toBe(5);
       expect(metrics.details.priority_0_processing).toBe(1);
    });

    it('should handle Redis errors', async () => {
        queue.redisManager.pipeline = vi.fn(() => {
            throw new Error('Connection failed');
        });
        
        const res = await queue.getMetrics();
        expect(res).toHaveProperty('error');
        expect(res.error).toContain('Connection failed');
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status', async () => {
        queue.getMetrics = vi.fn().mockResolvedValue({ some: 'metrics' });
        (queue.redisManager.redis.ping as any).mockResolvedValue('PONG');
        
        const res = await queue.healthCheck();
        expect(res.status).toBe('healthy');
        expect(res.metrics).toEqual({ some: 'metrics' });
        expect(res).toHaveProperty('redis_ping_ms');
    });

    it('should return unhealthy when ping fails', async () => {
        (queue.redisManager.redis.ping as any).mockRejectedValue(new Error('Ping failed'));
        
        const res = await queue.healthCheck();
        expect(res.status).toBe('unhealthy');
        expect(res.error).toContain('Ping failed');
    });
  });

  describe('getQueueStatus', () => {
    it('should return queue status with messages and filter ghosts', async () => {
        // Mock deserialize to return simple object
        queue['_deserializeMessage'] = vi.fn((str) => ({ payload: str }));

        // Pipeline sequence in getQueueStatus (includeMessages=true):
        // 1. xlen streams (2)
        // 2. xlen dlq
        // 3. xlen ack
        // 4. xlen archived
        // 5. get total ack
        // 6. xrevrange streams (2)
        // 7. xrevrange dlq
        // 8. xrevrange ack
        // 9. xrevrange archived
        // 10. hgetall metadata
        // 11. xpending streams (2) (summary)
        // 12. xpending streams (2) (detail)

        const execResult = [
            // 1. xlen streams
            [null, 10], 
            [null, 5],
            // 2-5. lens
            [null, 2], [null, 3], [null, 1], [null, '100'],
            // 6. xrevrange streams
            [null, [['1-0', ['data', '"msg1"']]]], // p1 msgs
            [null, [['2-0', ['data', '"msg2"']]]], // p0 msgs
            // 7-9. xrevrange other queues
            [null, []], [null, []], [null, []],
            // 10. metadata
            [null, {}],
            // 11. xpending summary
            [null, [2, 'min', 'max', []]], // p1 summary
            [null, [0, null, null, null]], // p0 summary (empty)
            // 12. xpending detail
            [null, [['1-0', 'consumer', 1000, 1]]], // p1 detail (msg1 is pending)
            [null, []], // p0 detail
        ];

        mockPipeline.exec.mockResolvedValueOnce(execResult);

        // Second pipeline execution: check ghosts (xrange for pending messages)
        // We have 1 pending message: 1-0 in p1.
        // Mock result: found
        const checkResult = [
            [null, [['1-0', ['data', '"msg1"']]]]
        ];
        // Note: In getQueueStatus, it creates a NEW pipeline for checks.
        // mockPipeline is reused by our mock implementation.
        // But the mock implementation returns the SAME mockPipeline object.
        // So calling exec() again on it should return the next resolved value?
        // Wait, mockResolvedValueOnce queues return values.
        mockPipeline.exec.mockResolvedValueOnce(checkResult);

        // Third pipeline execution: fetch metadata for processing messages
        // We have 1 processing message: 1-0.
        const metaResult = [
            [null, JSON.stringify({ attempt_count: 5 })]
        ];
        mockPipeline.exec.mockResolvedValueOnce(metaResult);

        // Fourth pipeline execution: filter main messages that are pending
        // mainMessages has msg1 (1-0) and msg2 (2-0).
        // msg1 is pending.
        // The checkPipeline.xpending returns [[id, ...]] if pending.
        const filterResult = [
            [null, [['1-0', 'consumer', 1000, 1]]], // 1-0 is pending
            [null, []] // 2-0 is not pending (wait, checking msg2)
        ];
        // Wait, the code checks all main messages.
        // main messages: msg1 (from p1), msg2 (from p0).
        // msg1 is 1-0. msg2 is 2-0.
        // checkPipeline.xpending called for both.
        // If msg1 is pending, it returns non-empty array.
        
        mockPipeline.exec.mockResolvedValueOnce(filterResult);

        const status = await queue.getQueueStatus(null, true);

        expect(status.mainQueue.length).toBe(13); // 10+5 - 2(processing) = 13
        // Wait, calculation: totalMainLen (15) - processingLength (2).
        
        // Processing Queue should have 1 message (1-0)
        expect(status.processingQueue.length).toBe(2); // From summary (2)
        expect(status.processingQueue.messages).toHaveLength(1); // 1-0 confirmed exists
        expect(status.processingQueue.messages[0].id).toBe('1-0');
        expect(status.processingQueue.messages[0].attempt_count).toBe(5); // From metadata
        
        // Main Queue should NOT have msg1 (filtered out because it's pending)
        // It should have msg2.
        const mainStreamIds = status.mainQueue.messages.map(m => m._stream_id);
        expect(mainStreamIds).not.toContain('1-0');
        expect(mainStreamIds).toContain('2-0');
    });

    it('should return simple status when includeMessages is false', async () => {
        // Pipeline sequence (includeMessages=false):
        // 1. xlen streams (2)
        // 2-5. lens
        // 6. hgetall metadata
        // 7. xpending streams (2) (summary)
        // 8. xpending streams (2) (detail)

        const execResult = [
            [null, 10], [null, 5],
            [null, 2], [null, 3], [null, 1], [null, '100'],
            [null, { totalProcessed: '50' }],
            [null, [2, 'min', 'max', []]],
            [null, [0, null, null, null]],
            [null, []], [null, []] // Detail is fetched but ignored/empty?
            // Actually code fetches detail even if includeMessages=false?
            // Lines 147-149: loop for detail.
            // Lines 216: pendingSummaryStartIdx = priorityCount + 5;
            // Lines 217: pendingDetailStartIdx = pendingSummaryStartIdx + priorityCount;
            // Yes, it fetches detail.
        ];
        
        mockPipeline.exec.mockResolvedValueOnce(execResult);
        
        const status = await queue.getQueueStatus(null, false);
        
        expect(status.mainQueue.messages).toEqual([]);
        expect(status.processingQueue.messages).toEqual([]);
        expect(status.metadata.totalProcessed).toBe(0); // 0 hardcoded
    });

    it('should handle errors in getQueueStatus', async () => {
        queue.redisManager.redis.pipeline = vi.fn(() => {
            throw new Error('Pipeline error');
        });
        
        await expect(queue.getQueueStatus()).rejects.toThrow('Pipeline error');
    });
  });
});
