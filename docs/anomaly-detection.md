# Anomaly Detection

Relay includes a pluggable anomaly detection system that monitors queue operations and flags unusual patterns.

## Overview

Anomalies are detected during queue operations (enqueue, dequeue, ack, nack) and stored in the `anomalies` table. The dashboard displays detected anomalies in real-time.

## Built-in Detectors

| Detector | Event | Description |
|----------|-------|-------------|
| `flash_message` | dequeue | Messages dequeued within milliseconds of enqueue |
| `large_payload` | enqueue | Payload size exceeds threshold |
| `long_processing` | ack | Processing time exceeds threshold |
| `lock_stolen` | ack | Lock token mismatch (split-brain scenario) |
| `near_dlq` | nack | Message approaching max retry attempts |
| `dlq_movement` | nack | Message moved to dead letter queue |
| `zombie_message` | timeout | Message stuck in processing beyond timeout |
| `burst_dequeue` | dequeue | High rate of dequeue operations |
| `bulk_enqueue` | bulk | Large batch enqueue operation |
| `bulk_delete` | bulk | Large batch delete operation |
| `bulk_move` | bulk | Large batch move operation |
| `queue_cleared` | bulk | Queue was cleared |

## Detector Events

Detectors subscribe to specific events:

| Event | When Triggered |
|-------|----------------|
| `enqueue` | Message added to queue |
| `dequeue` | Message retrieved from queue |
| `ack` | Message acknowledged |
| `nack` | Message negatively acknowledged |
| `bulk_operation` | Batch operation performed |
| `periodic` | Regular interval check (for zombie detection) |

## Configuration

Anomaly thresholds are configured via environment variables:

```bash
# Payload size threshold (bytes)
ACTIVITY_LARGE_PAYLOAD_THRESHOLD_BYTES=5000

# Processing time threshold (ms)
ACTIVITY_LONG_PROCESSING_THRESHOLD_MS=10000

# Flash message threshold (ms) - messages dequeued faster than this
ACTIVITY_FLASH_MESSAGE_THRESHOLD_MS=500

# Zombie detection - multiplier of ack_timeout
ACTIVITY_ZOMBIE_THRESHOLD_MULTIPLIER=2

# Near-DLQ threshold - alert when attempts remaining <= N
ACTIVITY_NEAR_DLQ_THRESHOLD=1

# Burst detection
ACTIVITY_BURST_THRESHOLD_COUNT=50     # N dequeues within window
ACTIVITY_BURST_THRESHOLD_SECONDS=5    # Time window

# Bulk operation threshold
ACTIVITY_BULK_OPERATION_THRESHOLD=5
```

---

## Creating Custom Detectors

You can create custom detectors to monitor queue-specific patterns.

### Detector Interface

```typescript
import { AnomalyDetector } from './src/lib/queue/services/anomaly-detectors/types';

const myDetector: AnomalyDetector = {
  name: 'high_priority_flood',
  description: 'Detects excessive high-priority messages',
  events: ['enqueue'],  // Which events to listen to
  enabledByDefault: true,

  async detect(context) {
    const { message, queueName, config } = context;

    if (message && message.priority >= 5) {
      return {
        type: 'high_priority_flood',
        severity: 'warning',  // 'info' | 'warning' | 'critical'
        messageId: message.id,
        consumerId: null,
        details: {
          queue_name: queueName,
          priority: message.priority,
        },
      };
    }
    return null;
  },
};
```

### Context Object

The `detect` function receives a context object with:

| Property | Type | Description |
|----------|------|-------------|
| `message` | `Message \| null` | The message being processed |
| `queueName` | `string` | Name of the queue |
| `config` | `QueueConfig` | Queue configuration |
| `activityLog` | `ActivityLog \| null` | Activity log entry (for ack/nack events) |
| `previousStatus` | `string \| null` | Previous message status |

### Anomaly Result

Return `null` if no anomaly detected, or an object with:

| Property | Type | Description |
|----------|------|-------------|
| `type` | `string` | Unique identifier for the anomaly type |
| `severity` | `'info' \| 'warning' \| 'critical'` | Severity level |
| `messageId` | `string \| null` | Related message ID |
| `consumerId` | `string \| null` | Related consumer ID |
| `details` | `object` | Additional context data |

---

## Registering Custom Detectors

```typescript
import { PostgresQueue } from './src/lib/queue';

const queue = new PostgresQueue(config);
const registry = queue.getAnomalyDetectorRegistry();

// Register your detector
registry.register(myDetector);

// Check registered detectors
console.log(registry.getDetectors());
```

## Disabling Detectors

```typescript
// Disable a built-in detector
registry.setEnabled('flash_message', false);

// Check if detector is enabled
const isEnabled = registry.isEnabled('flash_message');
```

---

## Example: Rate Limit Detector

```typescript
const rateLimitDetector: AnomalyDetector = {
  name: 'consumer_rate_limit',
  description: 'Detects consumers exceeding rate limits',
  events: ['dequeue'],
  enabledByDefault: true,

  // Track dequeue counts per consumer
  consumerCounts: new Map<string, { count: number; resetAt: number }>(),

  async detect(context) {
    const { message } = context;
    if (!message?.consumer_id) return null;

    const consumerId = message.consumer_id;
    const now = Date.now();
    const windowMs = 60000; // 1 minute window
    const maxDequeues = 1000; // Max dequeues per window

    let entry = this.consumerCounts.get(consumerId);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      this.consumerCounts.set(consumerId, entry);
    }

    entry.count++;

    if (entry.count > maxDequeues) {
      return {
        type: 'consumer_rate_limit',
        severity: 'warning',
        messageId: message.id,
        consumerId: consumerId,
        details: {
          count: entry.count,
          limit: maxDequeues,
          window_ms: windowMs,
        },
      };
    }

    return null;
  },
};
```

---

## Viewing Anomalies

### Dashboard

Access the Anomalies tab in the dashboard at `http://localhost:3001/dashboard`.

### API

```bash
# Get recent anomalies
curl http://localhost:3001/api/queue/anomalies

# Filter by severity
curl "http://localhost:3001/api/queue/anomalies?severity=critical"

# Filter by type
curl "http://localhost:3001/api/queue/anomalies?type=zombie_message"
```
