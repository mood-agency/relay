# Getting Started

## Prerequisites

- **Node.js** 18 or later
- **pnpm** package manager
- **PostgreSQL** 14 or later

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/mood-agency/relay.git
cd relay
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Start PostgreSQL

Using Docker (recommended):

```bash
docker run -d --name postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=relay \
  -p 5432:5432 \
  postgres:16
```

Or connect to an existing PostgreSQL instance.

### 4. Configure environment

Create a `.env` file:

```bash
# PostgreSQL Connection
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DATABASE=relay
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

# Queue Configuration
ACK_TIMEOUT_SECONDS=30
MAX_ATTEMPTS=3

# Optional: API Security
# SECRET_KEY=your-secret-key-here
```

See [Configuration](configuration.md) for all options.

### 5. Start the application

```bash
# Development mode (API + Dashboard with hot-reload)
pnpm run dev:all

# Or production mode
pnpm run build
pnpm start
```

- **API**: `http://localhost:3001`
- **Dashboard**: `http://localhost:3001/dashboard`
- **API Docs**: `http://localhost:3001/api/reference`

The database schema is automatically created on first startup.

---

## Your First Queue Operation

### 1. Enqueue a message

```bash
curl -X POST http://localhost:3001/api/queue/message \
  -H "Content-Type: application/json" \
  -d '{
    "type": "email_send",
    "payload": {
      "to": "user@example.com",
      "subject": "Welcome!"
    }
  }'
```

Response:
```json
{
  "id": "msg_abc123...",
  "status": "queued"
}
```

### 2. Dequeue the message

```bash
curl "http://localhost:3001/api/queue/message?timeout=5"
```

Response:
```json
{
  "id": "msg_abc123...",
  "type": "email_send",
  "payload": { "to": "user@example.com", "subject": "Welcome!" },
  "lock_token": "lt_xyz789...",
  "status": "processing"
}
```

### 3. Acknowledge completion

```bash
curl -X POST http://localhost:3001/api/queue/ack \
  -H "Content-Type: application/json" \
  -d '{
    "id": "msg_abc123...",
    "lock_token": "lt_xyz789..."
  }'
```

---

## Polyglot Examples

The power of Relay is that any language can participate. Here are complete worker examples.

### Node.js Producer

```javascript
// producer.js
const API_URL = 'http://localhost:3001/api/queue';

async function enqueue(type, payload, priority = 0) {
  const response = await fetch(`${API_URL}/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 'X-API-KEY': process.env.SECRET_KEY // if auth enabled
    },
    body: JSON.stringify({ type, payload, priority })
  });
  return response.json();
}

// Usage
await enqueue('video_transcode', { file: 'movie.mp4', quality: '1080p' }, 5);
```

### Python Consumer

```python
# worker.py
import requests
import os
import time

API_URL = 'http://localhost:3001/api/queue'
HEADERS = {'X-API-KEY': os.environ.get('SECRET_KEY', '')}

def process_message(message):
    """Your processing logic here"""
    print(f"Processing: {message['payload']}")
    time.sleep(1)  # Simulate work
    return True

def run_worker():
    while True:
        # Long-poll for messages (waits up to 30 seconds)
        response = requests.get(
            f'{API_URL}/message',
            params={'timeout': 30},
            headers=HEADERS
        )

        if response.status_code == 200:
            message = response.json()
            print(f"Got message: {message['id']}")

            try:
                success = process_message(message)
                if success:
                    # Acknowledge with lock token
                    requests.post(
                        f'{API_URL}/ack',
                        headers={**HEADERS, 'Content-Type': 'application/json'},
                        json={
                            'id': message['id'],
                            'lock_token': message['lock_token']
                        }
                    )
                    print(f"Acknowledged: {message['id']}")
            except Exception as e:
                # Negative acknowledge on error
                requests.post(
                    f'{API_URL}/message/{message["id"]}/nack',
                    headers={**HEADERS, 'Content-Type': 'application/json'},
                    json={
                        'lock_token': message['lock_token'],
                        'error': str(e)
                    }
                )
                print(f"NACKed: {message['id']} - {e}")

        elif response.status_code == 404:
            # No messages available, loop continues
            continue

if __name__ == '__main__':
    run_worker()
```

### Go Consumer

```go
// worker.go
package main

import (
    "bytes"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    "time"
)

var (
    apiURL = "http://localhost:3001/api/queue"
    apiKey = os.Getenv("SECRET_KEY")
)

type Message struct {
    ID        string                 `json:"id"`
    Type      string                 `json:"type"`
    Payload   map[string]interface{} `json:"payload"`
    LockToken string                 `json:"lock_token"`
}

func dequeue() (*Message, error) {
    req, _ := http.NewRequest("GET", apiURL+"/message?timeout=30", nil)
    req.Header.Set("X-API-KEY", apiKey)

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return nil, err
    }
    defer resp.Body.Close()

    if resp.StatusCode == 404 {
        return nil, nil // No messages
    }

    body, _ := io.ReadAll(resp.Body)
    var msg Message
    json.Unmarshal(body, &msg)
    return &msg, nil
}

func ack(id, lockToken string) error {
    data, _ := json.Marshal(map[string]string{
        "id":         id,
        "lock_token": lockToken,
    })

    req, _ := http.NewRequest("POST", apiURL+"/ack", bytes.NewBuffer(data))
    req.Header.Set("Content-Type", "application/json")
    req.Header.Set("X-API-KEY", apiKey)

    resp, err := http.DefaultClient.Do(req)
    if err != nil {
        return err
    }
    resp.Body.Close()
    return nil
}

func main() {
    for {
        msg, err := dequeue()
        if err != nil {
            fmt.Println("Error:", err)
            time.Sleep(time.Second)
            continue
        }

        if msg == nil {
            continue // No messages, loop
        }

        fmt.Printf("Processing: %s\n", msg.ID)

        // Your processing logic here
        time.Sleep(time.Second)

        if err := ack(msg.ID, msg.LockToken); err != nil {
            fmt.Println("ACK error:", err)
        } else {
            fmt.Printf("Acknowledged: %s\n", msg.ID)
        }
    }
}
```

### Ruby Consumer

```ruby
# worker.rb
require 'net/http'
require 'json'
require 'uri'

API_URL = 'http://localhost:3001/api/queue'
API_KEY = ENV['SECRET_KEY'] || ''

def dequeue
  uri = URI("#{API_URL}/message?timeout=30")
  req = Net::HTTP::Get.new(uri)
  req['X-API-KEY'] = API_KEY

  res = Net::HTTP.start(uri.hostname, uri.port) { |http| http.request(req) }

  return nil if res.code == '404'
  JSON.parse(res.body)
end

def ack(id, lock_token)
  uri = URI("#{API_URL}/ack")
  req = Net::HTTP::Post.new(uri)
  req['Content-Type'] = 'application/json'
  req['X-API-KEY'] = API_KEY
  req.body = { id: id, lock_token: lock_token }.to_json

  Net::HTTP.start(uri.hostname, uri.port) { |http| http.request(req) }
end

loop do
  message = dequeue
  next unless message

  puts "Processing: #{message['id']}"

  # Your processing logic here
  sleep 1

  ack(message['id'], message['lock_token'])
  puts "Acknowledged: #{message['id']}"
end
```

---

## Development vs Production

### Development

```bash
# Run with hot-reload
pnpm run dev:all

# Or just the API
pnpm run dev

# Or just the dashboard
pnpm dashboard:dev
```

### Production

```bash
# Build
pnpm run build

# Start
pnpm start
```

For production configuration, see [Configuration](configuration.md#production).

---

## Next Steps

- [Configuration](configuration.md) - All environment variables
- [API Reference](api-reference.md) - Complete endpoint documentation
- [Architecture](architecture.md) - How Relay works internally
- [Dashboard](dashboard.md) - Using the Mission Control dashboard
