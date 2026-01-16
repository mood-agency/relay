# Configuration

Relay is configured via environment variables. All variables are validated at startup using Zod schemas.

## Environment Variables

### General

| Variable | Description | Default |
|----------|-------------|---------|
| `NODE_ENV` | Environment mode (`development`, `production`, `local`, `test`) | `development` |
| `APP_URL` | Application URL | `http://localhost` |
| `PORT` | HTTP server port | `3001` |
| `LOG_LEVEL` | Logging verbosity (`fatal`, `error`, `warn`, `info`, `debug`, `trace`) | `info` |

### PostgreSQL Connection

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_HOST` | PostgreSQL server hostname | `localhost` |
| `POSTGRES_PORT` | PostgreSQL server port | `5432` |
| `POSTGRES_DATABASE` | Database name | `relay` |
| `POSTGRES_USER` | Database username | `postgres` |
| `POSTGRES_PASSWORD` | Database password | (empty) |
| `POSTGRES_SSL` | Enable SSL connection (`true`/`false`) | `false` |
| `POSTGRES_POOL_SIZE` | Connection pool size for write operations | `10` |
| `POSTGRES_READ_POOL_SIZE` | Separate pool for read operations (dashboard, metrics). Set to `0` to disable. | `0` |

### Queue Behavior

| Variable | Description | Default |
|----------|-------------|---------|
| `QUEUE_NAME` | Default queue name | `queue` |
| `ACK_TIMEOUT_SECONDS` | Time before unacknowledged messages are requeued | `30` |
| `MAX_ATTEMPTS` | Maximum retry attempts before moving to DLQ | `3` |
| `REQUEUE_BATCH_SIZE` | Messages processed per requeue worker cycle | `100` |
| `OVERDUE_CHECK_INTERVAL_MS` | Interval for checking timed-out messages | `5000` |
| `MAX_PRIORITY_LEVELS` | Number of priority levels (0 to N-1) | `10` |

### Security

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | API key for authentication. If set, all requests must include `X-API-KEY` header. | (disabled) |

When `SECRET_KEY` is set, these endpoints are excluded from authentication:
- `/health` - Health check
- `/queue/events` - SSE stream
- `/api/reference` - API documentation UI
- `/api/doc` - OpenAPI spec

### Dashboard

| Variable | Description | Default |
|----------|-------------|---------|
| `RELAY_ACTOR` | Actor name for system operations | `relay-actor` |
| `MANUAL_OPERATION_ACTOR` | Actor name for manual dashboard operations | `user-manual-operation` |

### Activity Logging

| Variable | Description | Default |
|----------|-------------|---------|
| `ACTIVITY_LOG_ENABLED` | Enable activity logging (`true`/`false`). Disable for maximum throughput. | `true` |
| `ACTIVITY_LOG_RETENTION_HOURS` | How long to retain activity logs | `24` |

### Anomaly Detection Thresholds

| Variable | Description | Default |
|----------|-------------|---------|
| `ACTIVITY_LARGE_PAYLOAD_THRESHOLD_BYTES` | Payload size to trigger large payload alert | `5000` |
| `ACTIVITY_BULK_OPERATION_THRESHOLD` | Batch size to trigger bulk operation alert | `5` |
| `ACTIVITY_FLASH_MESSAGE_THRESHOLD_MS` | Messages dequeued faster than this are flagged | `500` |
| `ACTIVITY_LONG_PROCESSING_THRESHOLD_MS` | Processing time to trigger long processing alert | `10000` |
| `ACTIVITY_ZOMBIE_THRESHOLD_MULTIPLIER` | Alert when processing > N x ack_timeout | `2` |
| `ACTIVITY_NEAR_DLQ_THRESHOLD` | Alert when attempts_remaining <= N | `1` |
| `ACTIVITY_BURST_THRESHOLD_COUNT` | Number of dequeues to trigger burst detection | `50` |
| `ACTIVITY_BURST_THRESHOLD_SECONDS` | Time window for burst detection | `5` |

### Enqueue Buffering

For high-throughput scenarios, buffering collects individual enqueue requests and flushes them as batches.

| Variable | Description | Default |
|----------|-------------|---------|
| `ENQUEUE_BUFFER_ENABLED` | Enable buffering for individual enqueue calls | `false` |
| `ENQUEUE_BUFFER_MAX_SIZE` | Maximum messages to buffer before flushing | `50` |
| `ENQUEUE_BUFFER_MAX_WAIT_MS` | Maximum time to wait before flushing buffer | `100` |

### SSE Events

| Variable | Description | Default |
|----------|-------------|---------|
| `EVENTS_CHANNEL` | PostgreSQL NOTIFY channel for events | `queue_events` |

---

## High Throughput Configuration

For production deployments handling 10,000+ messages/second:

```bash
# Increase connection pools
POSTGRES_POOL_SIZE=50
POSTGRES_READ_POOL_SIZE=20

# Enable enqueue buffering
ENQUEUE_BUFFER_ENABLED=true
ENQUEUE_BUFFER_MAX_SIZE=100
ENQUEUE_BUFFER_MAX_WAIT_MS=50

# Disable activity logging for maximum throughput
ACTIVITY_LOG_ENABLED=false

# Increase burst threshold to reduce false positives
ACTIVITY_BURST_THRESHOLD_COUNT=200
```

---

## Docker Compose Example

```yaml
version: '3.8'
services:
  relay:
    build: .
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=production
      - POSTGRES_HOST=postgres
      - POSTGRES_PORT=5432
      - POSTGRES_DATABASE=relay
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=your-secure-password
      - SECRET_KEY=your-api-key
      - ACK_TIMEOUT_SECONDS=60
      - MAX_ATTEMPTS=5
    depends_on:
      - postgres

  postgres:
    image: postgres:16
    environment:
      - POSTGRES_DB=relay
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=your-secure-password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  postgres_data:
```

---

## Using Infisical for Secrets

Relay supports [Infisical](https://infisical.com/) for secrets management. When configured, Infisical secrets take precedence over `.env` files.

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `INFISICAL_CLIENT_ID` | Infisical service token client ID |
| `INFISICAL_CLIENT_SECRET` | Infisical service token client secret |
| `INFISICAL_PROJECT_ID` | Infisical project ID |
| `INFISICAL_ENVIRONMENT` | Infisical environment (default: `dev`) |

### Setup

1. Create a project in Infisical
2. Add your secrets (e.g., `SECRET_KEY`, `POSTGRES_PASSWORD`)
3. Create a service token with read access
4. Set the Infisical environment variables

```bash
export INFISICAL_CLIENT_ID=your-client-id
export INFISICAL_CLIENT_SECRET=your-client-secret
export INFISICAL_PROJECT_ID=your-project-id
export INFISICAL_ENVIRONMENT=production
```

Relay will automatically load secrets from Infisical at startup.

---

## Environment Examples

### Development

```bash
# .env
NODE_ENV=development
LOG_LEVEL=debug

POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DATABASE=relay
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

# No SECRET_KEY = no authentication required
```

### Production

```bash
# .env.production
NODE_ENV=production
LOG_LEVEL=info

POSTGRES_HOST=db.example.com
POSTGRES_PORT=5432
POSTGRES_DATABASE=relay_prod
POSTGRES_USER=relay_user
POSTGRES_PASSWORD=secure-password
POSTGRES_SSL=true
POSTGRES_POOL_SIZE=25
POSTGRES_READ_POOL_SIZE=10

SECRET_KEY=your-secure-api-key

ACK_TIMEOUT_SECONDS=60
MAX_ATTEMPTS=5

ACTIVITY_LOG_ENABLED=true
ACTIVITY_LOG_RETENTION_HOURS=168  # 7 days
```

### Testing

```bash
# .env.test
NODE_ENV=test
LOG_LEVEL=error

POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DATABASE=relay_test
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

ACTIVITY_LOG_ENABLED=false
```
