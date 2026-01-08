
import { fetch } from "undici"; // Start with node native fetch if available, but since we have devDependencies, we can assume environment supports it or use global fetch if node > 18.
// We'll use global fetch which is available in Node 18+ and we have @types/node.

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

    async addSampleMessages(count: number = 10) {
        console.log(`🚀 Adding ${count} sample messages to the queue...`);

        const messageTypes = [
            "email_send",
            "image_process",
            "data_sync",
            "notification",
            "backup",
        ];

        for (let i = 0; i < count; i++) {
            const priorities = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
            const message = {
                type: messageTypes[Math.floor(Math.random() * messageTypes.length)],
                payload: {
                    id: `task_${i + 1}`,
                    user_id: `user_${Math.floor(Math.random() * 100) + 1}`,
                    data: `Sample data for task ${i + 1}`,
                    timestamp: Date.now() / 1000,
                },
                priority: priorities[Math.floor(Math.random() * priorities.length)], // Mostly priority 0
            };

            try {
                const response = await fetch(`${this.apiBase}/queue/message`, {
                    method: "POST",
                    headers: this.getHeaders("application/json"),
                    body: JSON.stringify(message),
                });

                if (response.status === 201) {
                    console.log(`✅ Added message ${i + 1}: ${message.type}`);
                } else {
                    console.log(`❌ Failed to add message ${i + 1}: ${response.status}`);
                }
            } catch (e) {
                console.log(`❌ Error adding message ${i + 1}: ${e}`);
            }

            // Small delay to avoid overwhelming the server
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    }

    async dequeueSomeMessages(count: number = 3, consumerId?: string) {
        const consumerName = consumerId || `test-worker-${Math.random().toString(36).substring(7)}`;
        console.log(
            `\n⚡ Dequeuing ${count} messages as consumer "${consumerName}"...`
        );

        const dequeuedMessages: any[] = [];

        for (let i = 0; i < count; i++) {
            try {
                // Random ackTimeout between 30 and 120 seconds
                const ackTimeout = Math.floor(Math.random() * (120 - 30 + 1)) + 30;
                const params = new URLSearchParams({
                    consumerId: consumerName,
                });
                const response = await fetch(`${this.apiBase}/queue/message?${params.toString()}`, {
                    headers: this.getHeaders(),
                });
                if (response.status === 200) {
                    const message = (await response.json()) as any;
                    console.log(
                        `✅ Dequeued message: ${message.type || "unknown"} (ID: ${(message.id || "N/A").slice(0, 8)
                        }...) [Consumer: ${message.consumer_id || consumerName}]`
                    );
                    dequeuedMessages.push(message);
                } else {
                    console.log(`❌ No messages available to dequeue`);
                    break;
                }
            } catch (e) {
                console.log(`❌ Error dequeuing message: ${e}`);
            }
        }
        return dequeuedMessages;
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

    async moveSomeMessagesToDeadLetter(count: number = 2) {
        console.log(`\n💀 Moving ${count} messages from main queue to dead letter queue...`);

        try {
            const params = new URLSearchParams({
                page: "1",
                limit: String(Math.max(count, 1)),
                sortBy: "created_at",
                sortOrder: "desc",
            });
            const listResponse = await fetch(
                `${this.apiBase}/queue/main/messages?${params.toString()}`,
                { headers: this.getHeaders() }
            );

            if (listResponse.status !== 200) {
                console.log(`❌ Failed to fetch main queue messages: ${listResponse.status}`);
                return 0;
            }

            const listData = (await listResponse.json()) as any;
            const messages = Array.isArray(listData?.messages) ? listData.messages : [];
            const toMove = messages.slice(0, count);

            if (toMove.length === 0) {
                console.log(`❌ No messages available in main queue to move`);
                return 0;
            }

            const moveResponse = await fetch(`${this.apiBase}/queue/move`, {
                method: "POST",
                headers: this.getHeaders("application/json"),
                body: JSON.stringify({
                    messages: toMove,
                    fromQueue: "main",
                    toQueue: "dead",
                }),
            });

            if (moveResponse.status !== 200) {
                console.log(`❌ Failed to move messages to DLQ: ${moveResponse.status}`);
                return 0;
            }

            const result = (await moveResponse.json()) as any;
            const movedCount = result?.movedCount ?? toMove.length;

            toMove.forEach((m: any) => {
                console.log(
                    `☠️  Moved to DLQ: ${m.type || "unknown"} (ID: ${(m.id || "N/A").slice(0, 8)}...)`
                );
            });

            return movedCount;
        } catch (e) {
            console.log(`❌ Error moving messages to DLQ: ${e}`);
            return 0;
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

    async runDemo(messagesCount: number = 15) {
        console.log("🎯 Redis Queue Dashboard Demo");
        console.log("=".repeat(50));

        // Test dashboard access
        const dashboardOk = await this.testDashboardAccess();

        // Add sample messages
        await this.addSampleMessages(messagesCount);

        // Check initial status
        await this.checkQueueStatus();

        // // Move some messages to DLQ (demo)
        await this.moveSomeMessagesToDeadLetter(2);

        // Dequeue some messages with different consumer IDs to demonstrate ownership tracking
        const dequeued1 = await this.dequeueSomeMessages(2, "worker-1");
        const dequeued2 = await this.dequeueSomeMessages(2, "worker-2");
        const dequeued = [...dequeued1, ...dequeued2];

        // // Acknowledge some messages
        // if (dequeued && dequeued.length > 0) {
        //     await this.acknowledgeSomeMessages(dequeued.slice(0, 3)); // Acknowledge 3 of 5
        // }

        // Check status after dequeuing
        await this.checkQueueStatus();

        console.log(`\n🎉 Demo completed!`);
        if (dashboardOk) {
            console.log(`🌐 Open your browser and go to: ${this.baseUrl}/dashboard`);
            console.log(`📊 You should see the messages in different queues`);
            console.log(`   - Main Queue: Queued messages`);
            console.log(`   - Processing: In-flight messages`);
            console.log(`   - Acknowledged: Successfully processed messages`);
            console.log(`⚡ The dashboard updates in real-time via SSE`);
        }

        console.log(`\n💡 Tips:`);
        console.log(
            `   - Messages in processing queue will return to main queue after timeout`
        );
        console.log(
            `   - The Processing queue shows which consumer owns each message`
        );
        console.log(
            `   - Use the 'Refresh Now' button to update the dashboard immediately`
        );
        console.log(`   - The dashboard shows real-time queue statistics`);
    }

    async acknowledgeSomeMessages(messages: any[]) {
        console.log(
            `\n✅ Acknowledging ${messages.length} messages (moving to acknowledged queue)...`
        );

        for (const message of messages) {
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
                    console.log(
                        `👍 Acknowledged message: ${message.type || "unknown"} (ID: ${(message.id || "N/A").slice(0, 8)
                        }...)`
                    );
                } else {
                    console.log(`❌ Failed to acknowledge message: ${response.status}`);
                }
            } catch (e) {
                console.log(`❌ Error acknowledging message: ${e}`);
            }
        }
    }
}

// Main execution
const main = async () => {
    const args = process.argv.slice(2);
    let url = "http://localhost:3000";
    let messages_number = 500;
    let apiKey: string | undefined = process.env.SECRET_KEY;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--url" && args[i + 1]) {
            url = args[i + 1];
            i++;
        } else if (args[i] === "--messages" && args[i + 1]) {
            messages_number = parseInt(args[i + 1], 10);
            i++;
        } else if (args[i] === "--api-key" && args[i + 1]) {
            apiKey = args[i + 1];
            i++;
        }
    }

    if (apiKey) {
        console.log("🔐 Using API key for authentication");
    } else {
        console.log("⚠️  No API key provided. Set SECRET_KEY env var or use --api-key flag");
    }

    const tester = new QueueTester(url, apiKey);
    await tester.runDemo(messages_number);
};

main().catch(console.error);
