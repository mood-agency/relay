# Relay

> **A lightweight, language-agnostic message broker built on PostgreSQL.**

Most queue libraries lock you into a specific language ecosystem. Relay provides a REST API backed by PostgreSQL, allowing you to produce messages in one language (e.g., Node.js API) and consume them in another (e.g., Python/Go Worker) via HTTP.

## Key Features

- **Atomic Locking**: `SELECT FOR UPDATE SKIP LOCKED` ensures single-consumer delivery
- **ACID Compliant**: PostgreSQL transactions for data safety
- **Dead Letter Queue**: Automatic DLQ after N failures
- **Priority Queues**: 10 priority levels (0-9)
- **Built-in Retry Logic**: Configurable retry attempts
- **Split-Brain Prevention**: Lock tokens prevent duplicate processing
- **Real-time Updates**: LISTEN/NOTIFY for instant dashboard updates
- **Mission Control Dashboard**: GUI for inspecting and managing jobs
- **Activity Logging**: Message lifecycle tracking with anomaly detection

## Quick Comparison

| Feature | Relay | BullMQ / Sidekiq / Celery | Raw Database Polling |
|---------|-------|---------------------------|----------------------|
| **Worker Language** | **Any** | Locked to one | Any |
| **Architecture** | PostgreSQL | Redis + Lua | Table scans |
| **Reliability** | High (ACID) | High | Medium |
| **Complexity** | Low | High | High (manual safety) |
| **Infrastructure** | PostgreSQL | Redis + Framework | Database only |

---

## Installation

### 1. Clone and install

```bash
git clone https://github.com/mood-agency/relay.git
cd relay
pnpm install
```

### 2. Start PostgreSQL

```bash
docker run -d --name postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=relay \
  -p 5432:5432 \
  postgres:16
```

### 3. Configure environment

Create a `.env` file:

```ini
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DATABASE=relay
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

ACK_TIMEOUT_SECONDS=30
MAX_ATTEMPTS=3
# SECRET_KEY=your-secret-key  # Optional: enables API authentication
```

### 4. Run

```bash
# Development (API + Dashboard with hot-reload)
pnpm run dev:all

# Production
pnpm run build && pnpm start
```

- **API**: http://localhost:3001
- **Dashboard**: http://localhost:3001/dashboard
- **API Docs**: http://localhost:3001/api/reference

The database schema is created automatically on first startup.

---

## Quick Start

### Add a message

```bash
curl -X POST http://localhost:3001/api/queue/message \
  -H "Content-Type: application/json" \
  -d '{
    "type": "email_send",
    "payload": { "to": "user@example.com", "subject": "Welcome!" },
    "priority": 5
  }'
```

### Get a message

```bash
curl "http://localhost:3001/api/queue/message?timeout=30"
```

### Acknowledge

```bash
curl -X POST http://localhost:3001/api/queue/ack \
  -H "Content-Type: application/json" \
  -d '{ "id": "MESSAGE_ID", "lock_token": "LOCK_TOKEN" }'
```

---

## Polyglot Example

### Produce in Node.js

```javascript
await fetch('http://localhost:3001/api/queue/message', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    type: 'video_transcode',
    payload: { file: 'movie.mp4', quality: '1080p' },
    priority: 5
  })
});
```

### Consume in Python

```python
import requests

API_URL = 'http://localhost:3001/api/queue'

while True:
    response = requests.get(f'{API_URL}/message', params={'timeout': 30})

    if response.status_code == 200:
        message = response.json()
        print(f"Processing: {message['payload']}")

        # Process the message...

        requests.post(f'{API_URL}/ack', json={
            'id': message['id'],
            'lock_token': message['lock_token']
        })
    elif response.status_code == 404:
        continue  # No messages, keep polling
```

See [Getting Started](docs/getting-started.md) for Go, Ruby, and more examples.

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/queue/message` | Add a message |
| `GET` | `/api/queue/message` | Get a message (long-poll) |
| `POST` | `/api/queue/ack` | Acknowledge message |
| `POST` | `/api/queue/message/:id/nack` | Reject and requeue |
| `PUT` | `/api/queue/message/:id/touch` | Extend lock (heartbeat) |
| `POST` | `/api/queue/batch` | Add multiple messages |
| `GET` | `/api/queue/metrics` | Queue statistics |
| `GET` | `/api/queue/events` | SSE real-time updates |

See [API Reference](docs/api-reference.md) for complete documentation.

---

## Dashboard

Access at http://localhost:3001/dashboard

- Real-time statistics
- Browse and filter messages
- Move messages between queues
- Edit payloads
- Activity logs and anomaly detection

See [Dashboard Guide](docs/dashboard.md) for details.

---

## Documentation

| Document | Description |
|----------|-------------|
| [Getting Started](docs/getting-started.md) | Installation, first steps, polyglot examples |
| [Configuration](docs/configuration.md) | All environment variables |
| [API Reference](docs/api-reference.md) | Complete endpoint documentation |
| [Architecture](docs/architecture.md) | How Relay works internally |
| [Dashboard](docs/dashboard.md) | Dashboard features and usage |
| [Testing](docs/testing.md) | Tests, benchmarking, CLI tools |
| [Anomaly Detection](docs/anomaly-detection.md) | Built-in and custom detectors |

---

## Available Scripts

```bash
pnpm run dev          # Backend with hot-reload
pnpm run dev:all      # Backend + Dashboard
pnpm run build        # Build for production
pnpm start            # Run production build
pnpm test             # Run tests
pnpm dashboard:dev    # Dashboard dev server only
```

---

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Acknowledgments

Built with [Hono](https://hono.dev/), [PostgreSQL](https://www.postgresql.org/), [React](https://react.dev/), [Shadcn UI](https://ui.shadcn.com/), [Tailwind CSS](https://tailwindcss.com/), and [Vite](https://vite.dev/).
