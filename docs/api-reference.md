# API Reference

## Interactive Documentation

- **Scalar UI**: `http://localhost:3001/api/reference` - Interactive API explorer
- **OpenAPI Spec**: `http://localhost:3001/api/doc` - JSON schema

## Authentication

When `SECRET_KEY` is set, all requests must include the `X-API-KEY` header:

```bash
curl -H "X-API-KEY: your-secret-key" http://localhost:3001/api/queue/message
```

**Excluded endpoints** (no authentication required):
- `GET /health`
- `GET /api/queue/events` (SSE stream)
- `GET /api/reference`
- `GET /api/doc`

---

## Queue Operations

### POST /api/queue/message

Add a message to the queue.

**Request:**

```bash
curl -X POST http://localhost:3001/api/queue/message \
  -H "Content-Type: application/json" \
  -d '{
    "type": "email_send",
    "payload": {
      "to": "user@example.com",
      "subject": "Welcome!"
    },
    "priority": 5
  }'
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | No | Message type for filtering |
| `payload` | object | Yes | Message payload (JSONB) |
| `priority` | integer | No | Priority 0-9 (default: 0, higher = processed first) |
| `max_attempts` | integer | No | Max retry attempts (default: 3) |
| `ack_timeout_seconds` | integer | No | Lock timeout (default: 30) |

**Response:** `201 Created`

```json
{
  "id": "msg_abc123...",
  "type": "email_send",
  "payload": { "to": "user@example.com", "subject": "Welcome!" },
  "priority": 5,
  "status": "queued",
  "created_at": "2024-01-15T10:30:00Z"
}
```

---

### GET /api/queue/message

Dequeue a message from the queue. Uses long-polling.

**Request:**

```bash
curl "http://localhost:3001/api/queue/message?timeout=30&type=email_send"
```

**Query Parameters:**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `timeout` | integer | 30 | Long-poll timeout in seconds |
| `type` | string | (all) | Filter by message type |
| `consumer_id` | string | (auto) | Custom consumer identifier |
| `ack_timeout_seconds` | integer | 30 | Override lock timeout |

**Response:** `200 OK`

```json
{
  "id": "msg_abc123...",
  "type": "email_send",
  "payload": { "to": "user@example.com", "subject": "Welcome!" },
  "priority": 5,
  "status": "processing",
  "lock_token": "lt_xyz789...",
  "locked_until": "2024-01-15T10:31:00Z",
  "attempt_count": 1,
  "max_attempts": 3,
  "created_at": "2024-01-15T10:30:00Z",
  "dequeued_at": "2024-01-15T10:30:30Z"
}
```

**Response:** `404 Not Found` - No messages available

---

### POST /api/queue/ack

Acknowledge a message as successfully processed.

**Request:**

```bash
curl -X POST http://localhost:3001/api/queue/ack \
  -H "Content-Type: application/json" \
  -d '{
    "id": "msg_abc123...",
    "lock_token": "lt_xyz789..."
  }'
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Message ID |
| `lock_token` | string | Yes | Lock token from dequeue |

**Response:** `200 OK`

```json
{
  "id": "msg_abc123...",
  "status": "acknowledged",
  "acknowledged_at": "2024-01-15T10:31:00Z"
}
```

**Response:** `409 Conflict` - Lock token mismatch (split-brain prevention)

---

### POST /api/queue/message/:id/nack

Negative acknowledge - reject and requeue a message.

**Request:**

```bash
curl -X POST http://localhost:3001/api/queue/message/msg_abc123/nack \
  -H "Content-Type: application/json" \
  -d '{
    "lock_token": "lt_xyz789...",
    "error": "Connection timeout"
  }'
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `lock_token` | string | Yes | Lock token from dequeue |
| `error` | string | No | Error message for logging |

**Response:** `200 OK`

Message is requeued if attempts remaining, otherwise moved to DLQ (`status: dead`).

---

### PUT /api/queue/message/:id/touch

Extend message lock (heartbeat for long-running tasks).

**Request:**

```bash
curl -X PUT http://localhost:3001/api/queue/message/msg_abc123/touch \
  -H "Content-Type: application/json" \
  -d '{
    "lock_token": "lt_xyz789...",
    "extend_seconds": 30
  }'
```

**Body Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `lock_token` | string | Yes | Lock token from dequeue |
| `extend_seconds` | integer | No | Seconds to extend (default: original ack_timeout) |

**Response:** `200 OK`

```json
{
  "id": "msg_abc123...",
  "locked_until": "2024-01-15T10:32:00Z"
}
```

---

### POST /api/queue/batch

Add multiple messages at once.

**Request:**

```bash
curl -X POST http://localhost:3001/api/queue/batch \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "type": "email", "payload": { "to": "a@example.com" } },
      { "type": "email", "payload": { "to": "b@example.com" } }
    ]
  }'
```

**Response:** `201 Created`

```json
{
  "count": 2,
  "messages": [
    { "id": "msg_abc123...", "status": "queued" },
    { "id": "msg_def456...", "status": "queued" }
  ]
}
```

---

## Monitoring

### GET /health

Health check endpoint.

**Response:** `200 OK`

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

### GET /api/queue/metrics

Queue statistics.

**Response:**

```json
{
  "queued": 150,
  "processing": 5,
  "acknowledged": 10000,
  "dead": 12,
  "archived": 5000,
  "total": 15167
}
```

---

### GET /api/queue/status

Detailed queue status with breakdown by type.

**Response:**

```json
{
  "counts": {
    "queued": 150,
    "processing": 5,
    "acknowledged": 10000,
    "dead": 12,
    "archived": 5000
  },
  "by_type": {
    "email_send": { "queued": 100, "processing": 3 },
    "image_process": { "queued": 50, "processing": 2 }
  },
  "oldest_queued": "2024-01-15T09:00:00Z",
  "newest_queued": "2024-01-15T10:30:00Z"
}
```

---

### GET /api/queue/events

Server-Sent Events stream for real-time updates.

**Request:**

```bash
curl -N http://localhost:3001/api/queue/events
```

**Event Types:**

| Event | Data |
|-------|------|
| `enqueue` | `{ id, type, priority }` |
| `dequeue` | `{ id, consumer_id }` |
| `ack` | `{ id }` |
| `nack` | `{ id, error }` |
| `dead` | `{ id }` |
| `metrics` | `{ queued, processing, ... }` |

---

## Error Responses

### 400 Bad Request

Invalid request body or parameters.

```json
{
  "error": "Validation failed",
  "details": { "payload": "Required" }
}
```

### 401 Unauthorized

Missing or invalid API key (when `SECRET_KEY` is configured).

```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing API key"
}
```

### 404 Not Found

Message not found or no messages in queue.

```json
{
  "error": "Not Found",
  "message": "No messages available"
}
```

### 409 Conflict

Lock token mismatch (split-brain prevention).

```json
{
  "error": "Conflict",
  "message": "Lock token mismatch - message may have been requeued"
}
```

### 500 Internal Server Error

Server error.

```json
{
  "error": "Internal Server Error",
  "message": "Database connection failed"
}
```
