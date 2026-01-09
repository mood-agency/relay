
import env from './src/config/env';

async function testApi() {
    try {
        const headers: any = {};
        if (env.SECRET_KEY) {
            headers['X-API-KEY'] = env.SECRET_KEY;
        }

        const res = await fetch(`http://localhost:${env.PORT}/api/queue/activity?limit=5`, {
            headers
        });

        if (!res.ok) {
            console.error('API Error:', res.status, await res.text());
            return;
        }
        const data: any = await res.json();
        console.log('LOGS:', JSON.stringify(data.logs, null, 2));
    } catch (e) {
        console.error('Fetch Error:', e);
    }
}

testApi().catch(console.error);
