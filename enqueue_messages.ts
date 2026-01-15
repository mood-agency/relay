// Using global fetch available in Node 18+ (no import needed)

// Queue Tester Class
class QueueTester {
    private baseUrl: string;
    private apiBase: string;
    private apiKey: string | undefined;

    constructor(baseUrl: string = "http://localhost:3000", apiKey?: string) {
        this.baseUrl = baseUrl;
        this.apiBase = `${baseUrl}/api`;
        this.apiKey = apiKey;
    }

    private getHeaders(contentType?: string): Record<string, string> {
        const headers: Record<string, string> = {};
        if (contentType) {
            headers["Content-Type"] = contentType;
        }
        if (this.apiKey) {
            headers["X-API-KEY"] = this.apiKey;
        }
        return headers;
    }

    async addSampleMessages(count: number = 10, batchSize: number = 50) {
        console.log(`🚀 Adding ${count} sample messages to the queue in batches of ${batchSize}...`);

        const messageTypes = [
            "email_send",
            "image_process",
            "data_sync",
            "notification",
            "backup",
        ];
        const priorities = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

        const totalBatches = Math.ceil(count / batchSize);
        let totalAdded = 0;

        for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
            const startIdx = batchNum * batchSize;
            const endIdx = Math.min(startIdx + batchSize, count);
            const currentBatchSize = endIdx - startIdx;

            const batch: any[] = [];
            for (let i = startIdx; i < endIdx; i++) {
                batch.push({
                    type: messageTypes[Math.floor(Math.random() * messageTypes.length)],
                    payload: {
                        id: `task_${i + 1}`,
                        user_id: `user_${Math.floor(Math.random() * 100) + 1}`,
                        data: `Sample data for task ${i + 1}`,
                        timestamp: Date.now() / 1000,
                    },
                    priority: priorities[Math.floor(Math.random() * priorities.length)],
                    consumerId: 'producer-script-test',
                });
            }

            try {
                const response = await fetch(`${this.apiBase}/queue/batch`, {
                    method: "POST",
                    headers: this.getHeaders("application/json"),
                    body: JSON.stringify(batch),
                });

                if (response.status === 201) {
                    totalAdded += currentBatchSize;
                    console.log(`✅ Batch ${batchNum + 1}/${totalBatches}: Added ${currentBatchSize} messages (${totalAdded}/${count} total)`);
                } else {
                    const errorText = await response.text();
                    console.log(`❌ Batch ${batchNum + 1}/${totalBatches} failed: ${response.status} - ${errorText}`);
                }
            } catch (e) {
                console.log(`❌ Error sending batch ${batchNum + 1}/${totalBatches}: ${e}`);
            }

            // Small delay between batches to avoid overwhelming the server
            if (batchNum < totalBatches - 1) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }

        console.log(`📊 Finished: Added ${totalAdded}/${count} messages`);
    }

    async checkQueueStatus() {
        console.log(`\n📊 Checking queue status...`);

        try {
            const response = await fetch(`${this.apiBase}/queue/status`, {
                headers: this.getHeaders(),
            });
            if (response.status === 200) {
                const status = (await response.json()) as any;
                console.log(`✅ Queue Status:`);
                console.log(
                    `   📥 Main Queue: ${status.mainQueue.length} messages`
                );
                console.log(
                    `   ⚡ Processing Queue: ${status.processingQueue.length} messages`
                );
                console.log(
                    `   💀 Dead Letter Queue: ${status.deadLetterQueue.length} messages`
                );
                console.log(
                    `   📈 Total Processed: ${status.metadata.totalProcessed}`
                );
                console.log(`   📉 Total Failed: ${status.metadata.totalFailed}`);
                return status;
            } else {
                console.log(`❌ Failed to get queue status: ${response.status}`);
                return null;
            }
        } catch (e) {
            console.log(`❌ Error getting queue status: ${e}`);
            return null;
        }
    }

    async testDashboardAccess() {
        console.log(`\n🌐 Testing dashboard access...`);

        try {
            const response = await fetch(`${this.baseUrl}/dashboard`);
            if (response.status === 200) {
                console.log(`✅ Dashboard is accessible at ${this.baseUrl}/dashboard`);
                return true;
            } else {
                console.log(`❌ Dashboard not accessible: ${response.status}`);
                return false;
            }
        } catch (e) {
            console.log(`❌ Error accessing dashboard: ${e}`);
            return false;
        }
    }

    async runEnqueue(messagesCount: number = 15, batchSize: number = 50) {
        console.log("🎯 Redis Queue Enqueue Tool");
        console.log("=".repeat(50));

        // Test dashboard access
        await this.testDashboardAccess();

        // Add sample messages in batches
        await this.addSampleMessages(messagesCount, batchSize);

        // Check initial status
        await this.checkQueueStatus();

        console.log(`\n🎉 Enqueue completed!`);
        console.log(`📊 You can view the messages in the dashboard: ${this.baseUrl}/dashboard`);
    }
}

// Main execution
const main = async () => {
    const args = process.argv.slice(2);
    let url = "http://localhost:3000";
    let messages_number = 500;
    let batch_size = 50;
    let apiKey: string | undefined = process.env.SECRET_KEY;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--url" && args[i + 1]) {
            url = args[i + 1];
            i++;
        } else if (args[i] === "--messages" && args[i + 1]) {
            messages_number = parseInt(args[i + 1], 10);
            i++;
        } else if (args[i] === "--batch-size" && args[i + 1]) {
            batch_size = parseInt(args[i + 1], 10);
            i++;
        } else if (args[i] === "--api-key" && args[i + 1]) {
            apiKey = args[i + 1];
            i++;
        } else if (args[i] === "--help" || args[i] === "-h") {
            console.log(`
Usage: npx tsx test_dashboard.ts [options]

Options:
  --url <url>           Base URL of the queue API (default: http://localhost:3000)
  --messages <count>    Total number of messages to add (default: 500)
  --batch-size <size>   Number of messages per batch (default: 50)
  --api-key <key>       API key for authentication (or set SECRET_KEY env var)
  -h, --help            Show this help message

Examples:
  npx tsx test_dashboard.ts --messages 1000 --batch-size 100
  npx tsx test_dashboard.ts --url http://localhost:8080 --api-key mykey
`);
            process.exit(0);
        }
    }

    if (apiKey) {
        console.log("🔐 Using API key for authentication");
    } else {
        console.log("⚠️  No API key provided. Set SECRET_KEY env var or use --api-key flag");
    }

    console.log(`📦 Configuration: ${messages_number} messages in batches of ${batch_size}`);

    const tester = new QueueTester(url, apiKey);
    await tester.runEnqueue(messages_number, batch_size);
};

main().catch(console.error);
