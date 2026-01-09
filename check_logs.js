
const { OptimizedRedisQueue, QueueConfig } = require('./src/lib/queue/index.js');
const env = require('./src/config/env.js');

async function checkLogs() {
    const queueConfig = {
        redis_host: env.REDIS_HOST,
        redis_port: env.REDIS_PORT,
        redis_db: env.REDIS_DB,
        redis_password: env.REDIS_PASSWORD || undefined,
        queue_name: env.QUEUE_NAME,
        activity_log_enabled: true,
        activity_log_stream_name: 'queue_activity', // fallback
    };

    // We need more config for it to work
    const fullConfig = {
        ...queueConfig,
        activity_log_stream_name: env.ACTIVITY_LOG_STREAM_NAME || 'queue_activity',
    };

    const q = new OptimizedRedisQueue(new QueueConfig(fullConfig));
    const logs = await q.getActivityLogs({ limit: 5 });
    console.log(JSON.stringify(logs.logs, null, 2));
    process.exit(0);
}

checkLogs().catch(err => {
    console.error(err);
    process.exit(1);
});
