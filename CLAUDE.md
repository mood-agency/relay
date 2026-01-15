# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Relay is a language-agnostic message queue broker built on PostgreSQL with a REST API. It enables polyglot message passing - producers in one language (Node.js) can send messages consumed by workers in any language (Python, Go, Ruby) via HTTP.

**Tech Stack:**
- Backend: TypeScript/Node.js with Hono framework
- Frontend: React 18 + Vite + Shadcn UI + Tailwind CSS
- Data: PostgreSQL with pg driver
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

The `PostgresQueue` class in `pg-queue.ts` provides all queue operations:

- **pg-queue.ts** - Main queue class with all methods
- **pg-connection.ts** - PostgreSQL connection pool and LISTEN/NOTIFY
- **schema.sql** - Database schema (auto-applied on startup)
- **config.js** - Queue configuration
- **utils.js** - Helpers (ID generation, logging)

### PostgreSQL Data Model

Single `messages` table with `status` column for lifecycle tracking:

```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    type TEXT,
    payload JSONB NOT NULL,
    priority INTEGER DEFAULT 0,
    status TEXT DEFAULT 'queued',  -- queued, processing, acknowledged, dead, archived
    attempt_count INTEGER DEFAULT 0,
    lock_token TEXT,
    locked_until TIMESTAMPTZ,
    ...
);
```

Supporting tables:
- `activity_logs` - Message lifecycle events
- `anomalies` - Detected unusual patterns
- `consumer_stats` - Per-consumer statistics

### Message Lifecycle

```
ENQUEUE → status='queued' → DEQUEUE (SELECT FOR UPDATE SKIP LOCKED) → status='processing'
    ↓
ACK → status='acknowledged'
NACK → status='queued' (retry) or status='dead' (max attempts)
TIMEOUT → requeueFailedMessages worker checks locked_until
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

Real-time updates via Server-Sent Events at `/api/queue/events` using PostgreSQL LISTEN/NOTIFY.

## Configuration

Environment validated via Zod in `/src/config/env.ts`. Key variables:

```bash
POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DATABASE, POSTGRES_USER, POSTGRES_PASSWORD
QUEUE_NAME=queue
ACK_TIMEOUT_SECONDS=30
MAX_ATTEMPTS=3
SECRET_KEY=  # API key (optional)
ACTIVITY_LOG_ENABLED=true
DASHBOARD_CONSUMER_NAME=relay-dashboard  # Consumer name for dashboard operations
```

Supports Infisical for secrets management (takes precedence over .env).

## Testing

Tests in `/src/routes/queue/queue.test.ts`. Requires running PostgreSQL instance.

```bash
# Run specific test file
pnpm test src/routes/queue/queue.test.ts
```
