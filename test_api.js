
async function testApi() {
    try {
        const res = await fetch('http://localhost:3000/api/queue/activity?limit=5');
        if (!res.ok) {
            console.error('API Error:', res.status, await res.text());
            return;
        }
        const data = await res.json();
        console.log('LOGS:', JSON.stringify(data.logs, null, 2));
    } catch (e) {
        console.error('Fetch Error:', e);
    }
}

testApi().catch(console.error);
