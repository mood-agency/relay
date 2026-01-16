
import { fetch } from "undici";

class DequeueTool {
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

    async dequeueMessages(count: number = 3, consumerId?: string, ack: boolean = false, timeout: number = 30, ackTimeout: number = 30) {
        const consumerName = consumerId || `consumer-script-test`;
        console.log(`⚡ Dequeuing ${count} messages as consumer "${consumerName}" (timeout: ${timeout}s, ackTimeout: ${ackTimeout}s)...`);

        let dequeuedCount = 0;

        for (let i = 0; i < count; i++) {
            try {
                const params = new URLSearchParams({
                    consumerId: consumerName,
                    timeout: timeout.toString(),
                    ackTimeout: ackTimeout.toString(),
                });
                const response = await fetch(`${this.apiBase}/queue/message?${params.toString()}`, {
                    headers: this.getHeaders(),
                });

                if (response.status === 200) {
                    const message = (await response.json()) as any;
                    dequeuedCount++;
                    console.log(`   ✅ Dequeued: ${message.type || "unknown"} (ID: ${(message.id || "N/A").slice(0, 8)}...)`);

                    if (ack) {
                        await this.acknowledgeMessage(message);
                    }
                } else if (response.status === 404) {
                    console.log(`ℹ️  No more messages available to dequeue.`);
                    break;
                } else {
                    const error = await response.text();
                    console.log(`❌ Failed to dequeue: ${response.status} - ${error}`);
                    break;
                }
            } catch (e) {
                console.log(`❌ Error dequeuing message: ${e}`);
                break;
            }
        }

        console.log(`\n📊 Summary: Dequeued ${dequeuedCount} messages.`);
    }

    async acknowledgeMessage(message: any) {
        try {
            const response = await fetch(`${this.apiBase}/queue/ack`, {
                method: "POST",
                headers: this.getHeaders("application/json"),
                body: JSON.stringify({
                    id: message.id,
                    _stream_id: message._stream_id,
                    _stream_name: message._stream_name
                }),
            });

            if (response.status === 200) {
                console.log(`   👍 Acknowledged message: ${message.id.slice(0, 8)}...`);
            } else {
                console.log(`   ❌ Failed to acknowledge: ${response.status}`);
            }
        } catch (e) {
            console.log(`   ❌ Error acknowledging: ${e}`);
        }
    }

    async checkQueueStatus() {
        try {
            const response = await fetch(`${this.apiBase}/queue/status`, {
                headers: this.getHeaders(),
            });
            if (response.status === 200) {
                const status = (await response.json()) as any;
                console.log(`\n📊 Current Queue Status:`);
                console.log(`   📥 Main: ${status.mainQueue.length}`);
                console.log(`   ⚡ Processing: ${status.processingQueue.length}`);
                console.log(`   💀 Dead Letter: ${status.deadLetterQueue.length}`);
            }
        } catch (e) {
            // Silently ignore status check errors
        }
    }
}

const main = async () => {
    const args = process.argv.slice(2);
    let url = "http://localhost:3000";
    let count = 10;
    let timeout = 30;
    let ackTimeout = 30;
    let consumerId: string | undefined;
    let ack = false;
    let apiKey = process.env.SECRET_KEY;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--url" && args[i + 1]) {
            url = args[i + 1];
            i++;
        } else if (args[i] === "--count" && args[i + 1]) {
            count = parseInt(args[i + 1], 10);
            i++;
        } else if (args[i] === "--timeout" && args[i + 1]) {
            timeout = parseInt(args[i + 1], 10);
            i++;
        } else if (args[i] === "--ack-timeout" && args[i + 1]) {
            ackTimeout = parseInt(args[i + 1], 10);
            i++;
        } else if (args[i] === "--consumer" && args[i + 1]) {
            consumerId = args[i + 1];
            i++;
        } else if (args[i] === "--ack") {
            ack = true;
        } else if (args[i] === "--api-key" && args[i + 1]) {
            apiKey = args[i + 1];
            i++;
        } else if (args[i] === "--help" || args[i] === "-h") {
            console.log(`
Usage: npx tsx dequeue_messages.ts [options]

Options:
  --url <url>           Base URL of the queue API (default: http://localhost:3000)
  --count <number>      Number of messages to dequeue (default: 10)
  --timeout <seconds>   Wait timeout for messages if queue is empty (default: 30)
  --ack-timeout <sec>   Processing timeout before message returns to queue (default: 30)
  --consumer <name>     Custom consumer ID
  --ack                 Automatically acknowledge dequeued messages
  --api-key <key>       API key for authentication (or set SECRET_KEY env var)
  -h, --help            Show this help message

Examples:
  npx tsx dequeue_messages.ts --count 5
  npx tsx dequeue_messages.ts --timeout 60 --ack-timeout 120
  npx tsx dequeue_messages.ts --ack --consumer my-worker
`);
            process.exit(0);
        }
    }

    console.log("🎯 Redis Queue Dequeue Tool");
    console.log("=".repeat(50));

    const tool = new DequeueTool(url, apiKey);
    await tool.checkQueueStatus();
    await tool.dequeueMessages(count, consumerId, ack, timeout, ackTimeout);
    await tool.checkQueueStatus();
};

main().catch(console.error);
