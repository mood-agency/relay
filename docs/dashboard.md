# Mission Control Dashboard

The Relay dashboard provides a real-time view of your queue operations.

## Accessing the Dashboard

Navigate to `http://localhost:3001/dashboard` in your browser.

The dashboard is served as a static React app from the backend and requires no separate server.

## Features

### Real-Time Statistics

The sidebar displays live counts for each message status:
- **Queued** - Messages waiting to be processed
- **Processing** - Messages currently being handled
- **Dead** - Failed messages (DLQ)
- **Acknowledged** - Successfully processed
- **Archived** - Long-term storage

Counts update automatically via Server-Sent Events.

### Queue Views

Navigate between different message states:

| View | Description |
|------|-------------|
| Main Queue | Messages waiting to be processed |
| Processing | Messages currently locked by consumers |
| Dead Letter | Failed messages after max attempts |
| Acknowledged | Successfully processed messages |
| Archived | Messages moved to long-term storage |

### Message Management

#### Inspect Messages
- View full payload in JSON format
- See message metadata (type, priority, attempts, timestamps)
- Track consumer that processed the message

#### Edit Messages
- Modify payload before reprocessing
- Change priority
- Update max attempts

#### Move Messages
- Move between queues (e.g., DLQ back to main queue)
- Bulk move selected messages

#### Delete Messages
- Delete individual or bulk selected messages
- Clear entire queue (with confirmation)

### Filtering

Each table supports filtering by:
- **Type** - Message type
- **Priority** - Priority level (0-9)
- **Date Range** - Created at timestamp
- **Consumer** - Consumer ID (processing view)

### Sorting

Click column headers to sort by:
- Created At
- Priority
- Type
- Attempt Count

### Pagination

Navigate large queues with configurable page sizes (100-1000 messages per page).

### Selection

- Click checkbox to select individual messages
- Shift+click for range selection
- Actions bar appears with bulk operations

---

## Activity Logs

The Activity Logs tab shows message lifecycle events:

| Event | Description |
|-------|-------------|
| `enqueue` | Message added to queue |
| `dequeue` | Message retrieved by consumer |
| `ack` | Message acknowledged |
| `nack` | Message rejected |
| `timeout` | Message lock expired |
| `move` | Message moved between statuses |
| `delete` | Message deleted |

Filter logs by:
- Time range
- Event type
- Message ID
- Consumer ID

---

## Anomalies

The Anomalies tab displays detected unusual patterns:

| Severity | Color | Description |
|----------|-------|-------------|
| Info | Blue | Informational alerts |
| Warning | Yellow | Potential issues |
| Critical | Red | Requires attention |

See [Anomaly Detection](anomaly-detection.md) for details on built-in detectors.

---

## Consumer Stats

The Consumer Stats tab shows per-consumer metrics:

- Messages processed
- Success/failure rate
- Average processing time
- Last activity timestamp

---

## Real-Time Updates

The dashboard uses Server-Sent Events (SSE) connected to `/api/queue/events`:

- New messages appear instantly
- Status changes animate
- Counts update in sidebar
- No manual refresh needed

Connection status is shown in the header.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Esc` | Close modal/dialog |
| `Enter` | Confirm action |

---

## Architecture

The dashboard is a React 18 application built with:
- **Vite** - Build tool
- **Tailwind CSS** - Styling
- **Shadcn UI** - Component library
- **Radix UI** - Accessible primitives

For component architecture details, see [Table Architecture](internals/table-architecture.md).
