# Redis Queue API

This is a simple Redis-based queue API built with Hono and TypeScript.

Using wsl

## Installation

1.  Clone the repository.
2.  Install dependencies using pnpm:

```bash
pnpm install
```

## Environment Variables

Create a `.env` file in the root of the project and add the necessary environment variables. You can use `.env.example` as a template.

## Usage
### Redis
Make sure redis is running 
``` bash
service redis-server restart
```

### Development

To run the application in development mode with hot-reloading, use:

```bash
pnpm run dev
```

### Production

To build and run the application in production mode, use:

```bash
pnpm start
```

## How the Queue Works

### Architecture Overview

This Redis Queue API implements a **reliable message queue system** with multiple Redis data structures to ensure message durability and at-least-once delivery.

### Redis Data Structures

The queue uses four main Redis keys:

1. **`queue`** - **Main Queue (List)**
   - Stores messages waiting to be processed
   - New messages are added here via `POST /api/queue/message`
   - Messages are dequeued from here via `GET /api/queue/message`

2. **`queue_processing`** - **Processing Queue (List)**
   - Temporary storage for messages currently being processed
   - Messages move here when dequeued from main queue
   - Prevents message loss if consumer crashes during processing

3. **`queue_dlq`** - **Dead Letter Queue (List)**
   - Stores messages that failed after maximum retry attempts
   - Messages that can't be processed successfully end up here
   - Useful for debugging and manual intervention

4. **`queue_metadata`** - **Metadata Hash**
   - Stores message metadata (timestamps, attempt counts, errors)
   - Key-value pairs with message ID as key

### Message Lifecycle

```
┌─────────────┐    POST     ┌─────────────┐    GET      ┌─────────────┐
│   Client    │ ────────────▶│ Main Queue  │ ────────────▶│ Processing  │
│             │             │             │             │   Queue     │
└─────────────┘             └─────────────┘             └─────────────┘
                                                               │
                                                               │ ACK
                                                               ▼
┌─────────────┐             ┌─────────────┐             ┌─────────────┐
│ Dead Letter │◀────────────│   Timeout   │             │  Deleted    │
│   Queue     │  Max Retry  │ (30 seconds)│             │ (Success)   │
└─────────────┘             └─────────────┘             └─────────────┘
                                   │
                                   ▼
                            ┌─────────────┐
                            │ Main Queue  │
                            │ (Retry)     │
                            └─────────────┘
```

### Configuration

- **ACK_TIMEOUT_SECONDS**: `30` - Time before unacknowledged messages return to main queue
- **MAX_ATTEMPTS**: `3` - Maximum retry attempts before moving to dead letter queue
- **BATCH_SIZE**: `100` - Maximum messages processed in batch operations

### Message Format

```json
{
  "type": "string",           // Required: Message type identifier
  "payload": {},              // Optional: Message data (any JSON)
  "priority": 0               // Optional: Message priority (higher = first)
}
```

### Reliability Features

- **At-least-once delivery**: Messages won't be lost even if consumers crash
- **Automatic retry**: Failed messages are retried up to MAX_ATTEMPTS
- **Dead letter queue**: Permanently failed messages are preserved for analysis
- **Timeout handling**: Unacknowledged messages are automatically requeued
- **Priority support**: Higher priority messages are processed first

## API Endpoints

### Queue Operations

- `POST /api/queue/message` - Add a message to the queue
- `GET /api/queue/message?timeout=30` - Get a message from the queue
- `POST /api/queue/ack` - Acknowledge message processing
- `POST /api/queue/batch` - Add multiple messages at once

### Monitoring

- `GET /api/health` - Health check endpoint
- `GET /api/queue/metrics` - Queue statistics and metrics
- `GET /api/queue/status` - Get detailed status of all queues with messages
- `GET /api/queue/messages?startTimestamp&endTimestamp` - Get messages by date range
- `DELETE /api/queue/messages?startTimestamp&endTimestamp` - Remove messages by date range

## 🎯 Web Dashboard

The API includes a beautiful web dashboard for real-time queue monitoring:

### Accessing the Dashboard

- **URL**: `http://localhost:3000/dashboard`
- **Root redirect**: `http://localhost:3000/` automatically redirects to dashboard

### Dashboard Features

- **📊 Real-time Statistics**: View total processed, failed, queued, and processing messages
- **📥 Main Queue**: See all messages waiting to be processed
- **⚡ Processing Queue**: Monitor messages currently being processed
- **💀 Dead Letter Queue**: View failed messages that exceeded retry limits
- **🔄 Auto-refresh**: Automatically updates every 5 seconds
- **📱 Responsive Design**: Works on desktop and mobile devices
- **🎨 Modern UI**: Beautiful gradient design with smooth animations

### Dashboard Controls

- **🔄 Refresh Now**: Manually refresh queue data
- **▶️ Auto Refresh**: Toggle automatic refresh (5-second intervals)
- **🗑️ Clear All Queues**: Clear all queues (coming soon)

### Testing the Dashboard

Use the included Python script to populate the dashboard with sample data:

```bash
# Install requests if not already installed
pip install requests

# Run the dashboard demo
python test_dashboard.py

# Add custom number of messages
python test_dashboard.py --messages 25

# Use different server URL
python test_dashboard.py --url http://localhost:8080
```

The script will:
1. Add sample messages to the main queue
2. Dequeue some messages (they'll appear in processing queue)
3. Display queue statistics
4. Provide dashboard access instructions

## Environment Variables

You can customize queue names via environment variables:

```bash
# Queue Names (optional - defaults provided)
QUEUE_NAME=my_custom_queue
PROCESSING_QUEUE_NAME=my_custom_queue_processing
DEAD_LETTER_QUEUE_NAME=my_custom_queue_dlq
METADATA_HASH_NAME=my_custom_queue_metadata
```

## Available Scripts

-   `dev`: Starts the application in development mode.
-   `build`: Compiles the TypeScript code.
-   `start`: Builds and starts the application in production mode.
-   `test`: Runs the test suite.

## Create API client
```bash
speakeasy generate sdk --schema http://localhost:3000/api/doc --lang python --out ./redis-queue-sdk-python
```                                                     