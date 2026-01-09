
import env from './src/config/env';

async function enqueueMessage() {
    try {
        const headers: any = { 'Content-Type': 'application/json' };
        if (env.SECRET_KEY) {
            headers['X-API-KEY'] = env.SECRET_KEY;
        }

        const payload = { test: "payload_" + Date.now() };
        const res = await fetch(`http://localhost:${env.PORT}/api/queue/message`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                type: 'test_type',
                payload,
                priority: 5
            })
        });

        if (!res.ok) {
            console.error('API Error:', res.status, await res.text());
            return;
        }
        console.log('✅ Message enqueued');

        // Wait for it to be logged
        await new Promise(resolve => setTimeout(resolve, 500));

        const res2 = await fetch(`http://localhost:${env.PORT}/api/queue/activity?limit=1`, {
            headers
        });
        const data: any = await res2.json();
        console.log('LATEST LOG:', JSON.stringify(data.logs[0], null, 2));
    } catch (e) {
        console.error('Error:', e);
    }
}

enqueueMessage().catch(console.error);
