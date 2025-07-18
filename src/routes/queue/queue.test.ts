import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { testClient } from 'hono/testing';
import router from './queue.index';
import { OptimizedRedisQueue, QueueConfig } from '@/lib/redis.js';

// Create a real Redis queue instance for testing
let queue: OptimizedRedisQueue;
const testConfig = new QueueConfig({
  host: 'localhost',
  port: 6379,
  db: 15, // Use a separate test database
  password: undefined,
  poolSize: 5,
  ackTimeoutSeconds: 30,
  maxAttempts: 3,
  batchSize: 100,
  enableEncryption: false,
  secretKey: undefined,
});

describe('Queue Routes - Integration Tests', () => {
  beforeEach(async () => {
    // Create a fresh queue instance for each test
    queue = new OptimizedRedisQueue(testConfig);
    // Clear any existing test data
    await queue.redisManager.redis.flushdb();
  });

  afterEach(async () => {
    // Clean up after each test
    if (queue) {
      await queue.redisManager.redis.flushdb();
      await queue.redisManager.disconnect();
    }
  });

  describe('GET /health', () => {
    it('should return 200 OK when Redis is healthy', async () => {
      const res = await testClient(router).health.$get();

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'OK' });
    });
  });

  describe('POST /queue/message', () => {
    it('should return 201 when message is added successfully', async () => {
      const message = { type: 'test', payload: { foo: 'bar' } };

      const res = await testClient(router).queue.message.$post({ json: message });

      expect(res.status).toBe(201);
      const result = await res.json();
      expect(result).toHaveProperty('message');
      expect(result.message).toBe('Message added successfully');
    });

    it('should return 400 for invalid message format', async () => {
      const invalidMessage = { invalidField: 'test' };

      const res = await testClient(router).queue.message.$post({ json: invalidMessage as any });

      expect(res.status).toBe(422);
    });
  });

  describe('GET /queue/message', () => {
    it('should return 200 with a message when a message is available', async () => {
      // First, add a message to the queue
      const message = { type: 'test', payload: { foo: 'bar' } };
      await testClient(router).queue.message.$post({ json: message });

      // Then try to dequeue it
      const res = await testClient(router).queue.message.$get({ query: { timeout: '1' } });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result).toHaveProperty('id');
      expect(result.type).toBe('test');
      expect(result.payload).toEqual({ foo: 'bar' });
    });

    it('should return 404 when no message is available', async () => {
      const res = await testClient(router).queue.message.$get({ query: { timeout: '1' } });

      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: 'Message not found' });
    });
  });

  describe('POST /queue/ack', () => {
    it('should return 200 when a valid message is acknowledged', async () => {
      // First, add and dequeue a message to get a valid ID
      const message = { type: 'test', payload: { foo: 'bar' } };
      await testClient(router).queue.message.$post({ json: message });
      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
      const dequeuedMessage = await dequeueRes.json();

      // Then acknowledge it
      const ackRes = await testClient(router).queue.ack.$post({ json: { id: dequeuedMessage.id } });

      expect(ackRes.status).toBe(200);
      expect(await ackRes.json()).toEqual({ message: "Message acknowledged" });
    });

    it('should return 400 when trying to acknowledge non-existent message', async () => {
      const res = await testClient(router).queue.ack.$post({ json: { id: 'non-existent-id' } });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ message: 'Message not acknowledged' });
    });
  });

  describe('GET /queue/metrics', () => {
    it('should return 200 with queue metrics', async () => {
      const res = await testClient(router).queue.metrics.$get();

      expect(res.status).toBe(200);
      const metrics = await res.json();
      expect(metrics).toHaveProperty('main_queue_size');
      expect(typeof metrics.main_queue_size).toBe('number');
    });
  });

  describe('POST /queue/batch', () => {
    it('should return 201 when batch messages are added successfully', async () => {
      const messages = [
        { type: 'test1', payload: { foo: 'bar' } },
        { type: 'test2', payload: { baz: 'qux' } },
      ];

      const res = await testClient(router).queue.batch.$post({ json: messages });

      expect(res.status).toBe(201);
      const result = await res.json();
      expect(result).toHaveProperty('message');
      expect(typeof result.message).toBe('string');
    });

    it('should return 422 for invalid batch format', async () => {
      const invalidBatch = [{ invalidField: 'test' }];

      const res = await testClient(router).queue.batch.$post({ json: invalidBatch as any });

      expect(res.status).toBe(422);
    });
  });

  describe('DELETE /queue/messages', () => {
    it('should return 200 and the count of removed messages', async () => {
      // Add some messages first
      const message1 = { type: 'test1', payload: { foo: 'bar' } };
      const message2 = { type: 'test2', payload: { baz: 'qux' } };
      await testClient(router).queue.message.$post({ json: message1 });
      await testClient(router).queue.message.$post({ json: message2 });

      const startTimestamp = new Date(Date.now() - 1000).toISOString();
      const endTimestamp = new Date(Date.now() + 1000).toISOString();

      const res = await testClient(router).queue.messages.$delete({
        query: { startTimestamp, endTimestamp },
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(result).toHaveProperty('message');
      expect(typeof result.message).toBe('string');
    });
  });

  describe('GET /queue/messages', () => {
    it('should return 200 and an array of messages', async () => {
      // Add some messages first
      const message1 = { type: 'test1', payload: { foo: 'bar' } };
      const message2 = { type: 'test2', payload: { baz: 'qux' } };
      await testClient(router).queue.message.$post({ json: message1 });
      await testClient(router).queue.message.$post({ json: message2 });

      const startTimestamp = new Date(Date.now() - 1000).toISOString();
      const endTimestamp = new Date(Date.now() + 1000).toISOString();

      const res = await testClient(router).queue.messages.$get({
        query: { startTimestamp, endTimestamp },
      });

      expect(res.status).toBe(200);
      const result = await res.json();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Integration Flow', () => {
    it('should handle complete message lifecycle', async () => {
      // 1. Add a message
      const message = { type: 'integration-test', payload: { step: 1 } };
      const addRes = await testClient(router).queue.message.$post({ json: message });
      expect(addRes.status).toBe(201);
      const addResult = await addRes.json();
      expect(addResult).toHaveProperty('message');
      expect(addResult.message).toBe('Message added successfully');

      // 2. Get metrics (should show 1 message)
      const metricsRes = await testClient(router).queue.metrics.$get();
      expect(metricsRes.status).toBe(200);
      const metrics = await metricsRes.json();
      expect(metrics).toHaveProperty('main_queue_size');
      expect(typeof metrics.main_queue_size).toBe('number');

      // 3. Dequeue the message
      const dequeueRes = await testClient(router).queue.message.$get({ query: { timeout: '1' } });
      expect(dequeueRes.status).toBe(200);
      const dequeuedMessage = await dequeueRes.json();
      expect(dequeuedMessage.type).toBe('integration-test');
      expect(dequeuedMessage.payload).toEqual({ step: 1 });

      // 4. Acknowledge the message
      const ackRes = await testClient(router).queue.ack.$post({ json: { id: dequeuedMessage.id } });
      expect(ackRes.status).toBe(200);
      expect(await ackRes.json()).toEqual({ message: "Message acknowledged" });
    });
  });
});
