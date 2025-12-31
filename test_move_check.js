import { OptimizedRedisQueue } from './src/lib/redis.js';
import Redis from 'ioredis';

const redis = new Redis({ host: 'localhost', port: 6379 });
const queue = new OptimizedRedisQueue({ redis_host: 'localhost', port: 6379 });

async function testMove() {
    console.log("Cleaning up...");
    await redis.flushall();
    
    console.log("Enqueuing messages...");
    const ids = [];
    for(let i=0; i<3; i++) {
        ids.push(await queue.enqueueMessage('test', { i }, 0));
    }
    
    console.log("Moving messages to DLQ...");
    // Fetch them first to get objects
    // Note: getMessages returns array of messages
    const result = await queue.getMessages('main');
    const messages = result; // getMessages returns array directly in OptimizedRedisQueue? 
    // Wait, getMessages in redis.js returns array? 
    // Let's check redis.js getMessages signature.
    // It calls getQueueMessages which returns array.
    // But getMessages method in redis.js wrapper?
    // OptimizedRedisQueue has getMessages? No, it has getQueueMessages.
    // The handler uses getMessages? No, handler calls queue.getMessages(queueType, ...).
    // Let's check redis.js exports.
    
    // Actually, let's just use queue.getQueueMessages directly if I can access it.
    // But wait, queue.getMessages IS getQueueMessages in my previous assumption?
    // Let's check redis.js again.
    
    // I will read redis.js to confirm method name.
}

testMove().catch(console.error);
