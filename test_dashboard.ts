
import { fetch } from "undici"; // Start with node native fetch if available, but since we have devDependencies, we can assume environment supports it or use global fetch if node > 18.
// We'll use global fetch which is available in Node 18+ and we have @types/node.

// Queue Tester Class
class QueueTester {
    private baseUrl: string;
    private apiBase: string;

    constructor(baseUrl: string = "http://localhost:3000") {
        this.baseUrl = baseUrl;
        this.apiBase = `${baseUrl}/api`;
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
            const priorities = [0, 0, 0, 1, 2];
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
                    headers: {
                        "Content-Type": "application/json",
                    },
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

    async dequeueSomeMessages(count: number = 3) {
        console.log(
            `\n⚡ Dequeuing ${count} messages (they'll go to processing queue)...`
        );

        const dequeuedMessages = [];

        for (let i = 0; i < count; i++) {
            try {
                const response = await fetch(`${this.apiBase}/queue/message?timeout=1`);
                if (response.status === 200) {
                    const message = (await response.json()) as any;
                    console.log(
                        `✅ Dequeued message: ${message.type || "unknown"} (ID: ${(message.id || "N/A").slice(0, 8)
                        }...)`
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
            const response = await fetch(`${this.apiBase}/queue/status`);
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

    async runDemo(messagesCount: number = 15) {
        console.log("🎯 Redis Queue Dashboard Demo");
        console.log("=".repeat(50));

        // Test dashboard access
        const dashboardOk = await this.testDashboardAccess();

        // Add sample messages
        await this.addSampleMessages(messagesCount);

        // Check initial status
        await this.checkQueueStatus();

        // Dequeue some messages
        const dequeued = await this.dequeueSomeMessages(5);

        // Acknowledge some messages
        if (dequeued && dequeued.length > 0) {
            await this.acknowledgeSomeMessages(dequeued.slice(0, 3)); // Acknowledge 3 of 5
        }

        // Check status after dequeuing
        await this.checkQueueStatus();

        console.log(`\n🎉 Demo completed!`);
        if (dashboardOk) {
            console.log(`🌐 Open your browser and go to: ${this.baseUrl}/dashboard`);
            console.log(`📊 You should see the messages in different queues`);
            console.log(`   - Main Queue: Queued messages`);
            console.log(`   - Processing: In-flight messages`);
            console.log(`   - Acknowledged: Successfully processed messages`);
            console.log(`🔄 The dashboard will auto-refresh every 5 seconds`);
        }

        console.log(`\n💡 Tips:`);
        console.log(
            `   - Messages in processing queue will return to main queue after 30 seconds`
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
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ id: message.id }),
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
    let messages = 35;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--url" && args[i + 1]) {
            url = args[i + 1];
            i++;
        } else if (args[i] === "--messages" && args[i + 1]) {
            messages = parseInt(args[i + 1], 10);
            i++;
        }
    }

    const tester = new QueueTester(url);
    await tester.runDemo(messages);
};

main().catch(console.error);
