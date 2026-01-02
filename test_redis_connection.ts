
import Redis from 'ioredis';

const redis = new Redis({
  host: 'localhost',
  port: 6379,
  db: 0,
});

redis.ping().then((result) => {
  console.log('Redis Ping Result:', result);
  process.exit(0);
}).catch((err) => {
  console.error('Redis Ping Error:', err);
  process.exit(1);
});
