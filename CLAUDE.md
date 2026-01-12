# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Relay is a language-agnostic message queue broker built on Redis Streams with a REST API. It enables polyglot message passing - producers in one language (Node.js) can send messages consumed by workers in any language (Python, Go, Ruby) via HTTP.

**Tech Stack:**
- Backend: TypeScript/Node.js with Hono framework
- Frontend: React 18 + Vite + Shadcn UI + Tailwind CSS
- Data: Redis Streams with ioredis
- Testing: Vitest

## Common Commands

```bash
# Development
pnpm run dev           # Backend only with hot reload
pnpm run dev:all       # Backend + Dashboard UI concurrent dev

# Build & Production
pnpm run build         # Compile TypeScript + build dashboard
pnpm start             # Run production build

# Testing
pnpm test              # Run Vitest (watch mode)
pnpm test -- --run     # Run tests once

# Dashboard only
pnpm dashboard:dev     # Dashboard dev server
pnpm dashboard:build   # Build dashboard for production
```

## Architecture

### Core Queue System (`/src/lib/queue/`)

The `OptimizedRedisQueue` class uses modular composition - methods are attached from separate modules:

- **queue.js** - Main class definition, composes all modules
- **producer.js** - `enqueueMessage()`, `enqueueBatch()`
- **consumer.js** - `dequeueMessage()`, `requeueFailedMessages()`
- **admin.js** - `moveMessages()`, `deleteMessage()`, `clearQueue()`
- **activity.js** - Activity logging and anomaly detection
- **metrics.js** - Queue statistics

### Redis Data Model

Priority streams (checked highest-first): `queue_p9` → `queue_p1` → `queue` (priority 0)

State queues:
- `queue_acknowledged` - Successfully processed
- `queue_dlq` - Dead Letter Queue (failed after max attempts)
- `queue_archived` - Long-term retention

Metadata: `queue_metadata` (Hash), `queue_activity` (Stream)

### Message Lifecycle

```
ENQUEUE → Priority Stream → DEQUEUE (XREADGROUP) → Processing (PEL)
    ↓
ACK → queue_acknowledged
NACK → Back to priority stream
TIMEOUT → requeueFailedMessages worker
MAX_ATTEMPTS exceeded → queue_dlq
```

### Split-Brain Prevention

Each dequeue generates a unique `lock_token`. ACK requests must include matching token - if message was re-queued (timeout), token won't match → 409 Conflict. Workers can use TOUCH endpoint for heartbeat to extend lock.

### API Structure (`/src/routes/queue/`)

- **queue.routes.ts** - OpenAPI route definitions with Zod schemas
- **queue.handlers.ts** - Handler implementations
- **queue.index.ts** - Router assembly

API authentication via `X-API-KEY` header when `SECRET_KEY` env var is set. Excluded endpoints: `/health`, `/queue/events`, `/api/reference`, `/api/doc`.

### Dashboard (`/dashboard-ui/`)

React app served as static assets from backend. Key components:
- `Dashboard.tsx` - Main container with tab state
- `queue/` - Queue view components (MainQueueTable, ProcessingQueueTable, etc.)
- `logs/` - Activity logs, anomalies, consumer stats
- `ui/` - Shadcn UI primitives

Real-time updates via Server-Sent Events at `/api/queue/events`.

## Configuration

Environment validated via Zod in `/src/config/env.ts`. Key variables:

```bash
REDIS_HOST, REDIS_PORT, REDIS_PASSWORD, REDIS_DB
QUEUE_NAME=queue
ACK_TIMEOUT_SECONDS=30
MAX_ATTEMPTS=3
SECRET_KEY=  # API key (optional)
ACTIVITY_LOG_ENABLED=true
```

Supports Infisical for secrets management (takes precedence over .env).

## Testing

Tests in `/src/routes/queue/queue.test.ts`. Requires running Redis instance.

```bash
# Run specific test file
pnpm test src/routes/queue/queue.test.ts
```
