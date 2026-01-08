# PRD: Rohan Migration from Rust to Node.js

## 1. Executive Summary

Migrate the Rohan CLI tool from Rust to Node.js to improve developer experience, reduce iteration friction, and provide more reliable LLM provider connectivity.

**Current State**: Rust CLI (~1500 lines) that generates k6 test scripts from OpenAPI specs using LLMs.

**Target State**: Node.js CLI with identical functionality, better provider support, and faster development cycles.

## 2. Migration Rationale

### 2.1 Problems with Current Rust Implementation

| Issue | Impact | Severity |
|-------|--------|----------|
| `genai` crate provider connectivity issues | Cannot reliably connect to Groq and other OpenAI-compatible endpoints | High |
| 30-60s compilation times | Slow iteration when adjusting prompts or logic | Medium |
| Limited Rust expertise in team | Harder to maintain and extend | Medium |
| Complex async patterns | Tokio + channels adds cognitive overhead | Low |

### 2.2 Benefits of Node.js Migration

| Benefit | Description |
|---------|-------------|
| **Proven LLM SDKs** | `openai` package works with any OpenAI-compatible API; `@ai-sdk/groq` for native Groq support |
| **Zero compilation** | Save → Run immediately |
| **Simpler concurrency** | `Promise.all()` + `p-limit` vs tokio channels |
| **Same output format** | Tool generates JS; being in JS ecosystem is natural |
| **Easier onboarding** | More developers know JavaScript than Rust |
| **Rich CLI ecosystem** | Mature tools: `commander`, `ora`, `chalk`, `cli-progress` |

### 2.3 What We Preserve

- ✅ All CLI commands (`plan`, `build`, `exec`, `validate`)
- ✅ All CLI flags and options
- ✅ Test plan JSON format (backward compatible)
- ✅ Generated k6 script format
- ✅ All prompts (unchanged)
- ✅ Batching logic
- ✅ Rate limiting
- ✅ E2E workflow support

## 3. Technology Stack

### 3.1 Node.js Stack

| Component | Rust (Current) | Node.js (Target) |
|-----------|---------------|------------------|
| **Runtime** | Native binary | Node.js 20+ LTS |
| **CLI Framework** | `clap` | `commander` |
| **LLM Client** | `genai` | `ai` (Vercel AI SDK) + `@ai-sdk/groq` |
| **OpenAPI Parsing** | `openapiv3` | `@readme/openapi-parser` or native JSON |
| **HTTP Client** | `reqwest` | Native `fetch` |
| **Async/Parallel** | `tokio` + channels | `Promise.all()` + `p-limit` |
| **JSON** | `serde_json` | Native JSON |
| **File I/O** | `std::fs` | `fs/promises` |
| **Progress UI** | Custom | `ora` (spinners), `chalk` (colors) |
| **Config** | `dotenvy` | `dotenv` |

### 3.2 Dependencies

```json
{
  "dependencies": {
    "commander": "^12.0.0",
    "ai": "^3.0.0",
    "@ai-sdk/groq": "^0.0.1",
    "@ai-sdk/openai": "^0.0.1",
    "@ai-sdk/anthropic": "^0.0.1",
    "p-limit": "^5.0.0",
    "ora": "^8.0.0",
    "chalk": "^5.0.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "vitest": "^1.0.0"
  }
}
```

## 4. Architecture

### 4.1 Project Structure

```
rohan/
├── package.json
├── bin/
│   └── rohan.js              # CLI entry point (#!/usr/bin/env node)
├── src/
│   ├── cli.js                # Command definitions
│   ├── commands/
│   │   ├── plan.js           # plan command
│   │   ├── build.js          # build command
│   │   ├── exec.js           # exec command
│   │   └── validate.js       # validate command
│   ├── llm/
│   │   ├── client.js         # Multi-provider LLM client
│   │   └── providers.js      # Provider configurations
│   ├── generator/
│   │   ├── planner.js        # Test plan generation
│   │   ├── builder.js        # Script generation
│   │   └── templates.js      # Prompt template rendering
│   └── utils/
│       ├── openapi.js        # OpenAPI parsing helpers
│       ├── files.js          # File I/O utilities
│       └── progress.js       # Progress reporting
├── prompts/                   # Unchanged from Rust version
│   ├── planner_system.md
│   ├── planner_user.md
│   ├── builder_system.md
│   ├── builder_user.md
│   ├── planner_batch_system.md
│   ├── planner_batch_user.md
│   ├── builder_batch_system.md
│   ├── builder_batch_user.md
│   ├── e2e_planner_system.md
│   ├── e2e_planner_user.md
│   ├── e2e_builder_system.md
│   └── e2e_builder_user.md
└── tests/
    └── *.test.js             # Vitest unit tests
```

### 4.2 Component Mapping

```
┌─────────────────────────────────────────────────────────────────┐
│                        Rust → Node.js                           │
├─────────────────────────────────────────────────────────────────┤
│  src/main.rs          →  bin/rohan.js                          │
│  src/cli.rs           →  src/cli.js                            │
│  src/commands.rs      →  src/commands/*.js                     │
│  src/generator.rs     →  src/generator/*.js + src/llm/*.js     │
│  src/config.rs        →  src/utils/config.js                   │
├─────────────────────────────────────────────────────────────────┤
│  Cargo.toml           →  package.json                          │
│  prompts/*.md         →  prompts/*.md (unchanged)              │
└─────────────────────────────────────────────────────────────────┘
```

## 5. Functional Requirements

### 5.1 CLI Commands (Unchanged Interface)

```bash
# Generate test plan from OpenAPI spec
rohan plan api-spec.json -o test-plan.json -w 5 --batch-size 5

# Build k6 scripts from test plan
rohan build test-plan.json -o tests/ -w 5 --batch-size 5

# Show k6 run instructions
rohan exec tests/ --target http://localhost:8080

# Validate OpenAPI spec
rohan validate api-spec.json
```

### 5.2 CLI Flags (Preserved)

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-o, --output` | path | varies | Output file/directory |
| `-w, --workers` | int | 5 | Parallel LLM workers |
| `--model` | string | `llama-3.3-70b-versatile` | LLM model |
| `--provider` | string | `groq` | LLM provider (NEW) |
| `--api-base` | URL | auto | Custom API endpoint |
| `--batch-size` | int | 5 | Endpoints per LLM request |
| `--rpm` | int | 0 | Rate limit (requests/min) |
| `--e2e` | bool | false | E2E workflow mode |
| `--overwrite` | bool | false | Overwrite existing files |
| `--verbose` | bool | false | Detailed logging |
| `--prompt-dir` | path | - | Custom prompts directory |

### 5.3 New Features (Migration Bonus)

| Feature | Description |
|---------|-------------|
| `--provider` flag | Explicit provider selection: `groq`, `openai`, `anthropic`, `together`, `fireworks` |
| Better error messages | Clearer LLM API errors with provider-specific hints |
| `--dry-run` | Show what would be generated without calling LLM |
| Config file | `rohan.config.js` for project-level defaults |

## 6. LLM Provider Support

### 6.1 Supported Providers

| Provider | Package | Models |
|----------|---------|--------|
| Groq | `@ai-sdk/groq` | `llama-3.3-70b-versatile`, `mixtral-8x7b-32768` |
| OpenAI | `@ai-sdk/openai` | `gpt-4o`, `gpt-4o-mini` |
| Anthropic | `@ai-sdk/anthropic` | `claude-sonnet-4-20250514`, `claude-3-5-haiku-20241022` |
| Together | `@ai-sdk/openai` (compat) | `meta-llama/Llama-3-70b-chat-hf` |
| Fireworks | `@ai-sdk/openai` (compat) | `accounts/fireworks/models/llama-v3-70b-instruct` |
| Ollama | `@ai-sdk/openai` (compat) | Any local model |

### 6.2 Provider Resolution

```javascript
// Auto-detect from model name or explicit --provider flag
function resolveProvider(model, explicitProvider) {
  if (explicitProvider) return explicitProvider;
  
  if (model.startsWith('gpt-')) return 'openai';
  if (model.startsWith('claude-')) return 'anthropic';
  if (model.includes('llama') || model.includes('mixtral')) return 'groq';
  
  return 'groq'; // default
}
```

### 6.3 Environment Variables

| Variable | Provider |
|----------|----------|
| `GROQ_API_KEY` | Groq |
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic |
| `TOGETHER_API_KEY` | Together |
| `FIREWORKS_API_KEY` | Fireworks |

## 7. Data Formats (Unchanged)

### 7.1 Test Plan JSON

```json
{
  "version": "1.0",
  "spec_path": "api-spec.json",
  "api_title": "My API",
  "api_version": "1.0.0",
  "e2e": false,
  "tests": [
    {
      "name": "Get_Message_Basic",
      "method": "GET",
      "path": "/messages",
      "endpoint_spec": { ... }
    }
  ],
  "scenarios": []
}
```

### 7.2 Generated k6 Script

```javascript
// Test: Get_Message_Basic
// Generated by Rohan

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export default function() {
    const res = http.get(`${BASE_URL}/messages`);
    check(res, {
        'status is 200': (r) => r.status === 200,
    });
}
```

### 7.3 Manifest JSON

```json
[
  { "id": 1, "name": "Get_Message_Basic", "file": "test_get_message_basic.js" },
  { "id": 2, "name": "Create_Message_Basic", "file": "test_create_message_basic.js" }
]
```

## 8. Implementation Plan

### Phase 1: Core Infrastructure (Day 1-2)

- [ ] Initialize Node.js project with `package.json`
- [ ] Set up project structure
- [ ] Implement CLI skeleton with `commander`
- [ ] Implement LLM client wrapper with provider support
- [ ] Port prompt loading and template rendering
- [ ] Add basic `validate` command

**Deliverable**: `rohan validate api-spec.json` works

### Phase 2: Test Planning (Day 3-4)

- [ ] Port `plan` command logic
- [ ] Implement endpoint extraction from OpenAPI
- [ ] Implement individual endpoint processing
- [ ] Implement batched endpoint processing
- [ ] Add progress reporting with `ora`
- [ ] Add rate limiting with `p-limit`

**Deliverable**: `rohan plan api-spec.json -o test-plan.json` works

### Phase 3: Script Building (Day 5-6)

- [ ] Port `build` command logic
- [ ] Implement individual test script generation
- [ ] Implement batched script generation
- [ ] Implement incremental file writing
- [ ] Add manifest generation
- [ ] Handle `--overwrite` flag

**Deliverable**: `rohan build test-plan.json -o tests/` works

### Phase 4: E2E & Polish (Day 7-8)

- [ ] Port E2E planning logic
- [ ] Port E2E building logic
- [ ] Implement `exec` command (show k6 instructions)
- [ ] Add `--verbose` logging
- [ ] Add `--dry-run` option
- [ ] Error handling and user-friendly messages

**Deliverable**: Full feature parity with Rust version

### Phase 5: Testing & Documentation (Day 9-10)

- [ ] Port unit tests to Vitest
- [ ] Test against real OpenAPI specs (Stripe, GitHub)
- [ ] Test all LLM providers
- [ ] Update README.md
- [ ] Update/archive Rust PRD
- [ ] Create migration guide for existing users

**Deliverable**: Production-ready release

## 9. Migration Checklist

### 9.1 Code Migration

| Rust File | Node.js File | Status |
|-----------|--------------|--------|
| `src/main.rs` | `bin/rohan.js` | ⬜ |
| `src/cli.rs` | `src/cli.js` | ⬜ |
| `src/commands.rs` | `src/commands/*.js` | ⬜ |
| `src/generator.rs` | `src/generator/*.js` | ⬜ |
| `src/config.rs` | `src/utils/config.js` | ⬜ |

### 9.2 Feature Parity

| Feature | Rust | Node.js |
|---------|------|---------|
| `plan` command | ✅ | ⬜ |
| `build` command | ✅ | ⬜ |
| `exec` command | ✅ | ⬜ |
| `validate` command | ✅ | ⬜ |
| Batching | ✅ | ⬜ |
| Rate limiting | ✅ | ⬜ |
| E2E mode | ✅ | ⬜ |
| Custom prompts | ✅ | ⬜ |
| Progress reporting | ✅ | ⬜ |
| Groq support | ⚠️ Issues | ⬜ |
| OpenAI support | ✅ | ⬜ |
| Anthropic support | ⚠️ Limited | ⬜ |

### 9.3 Tests

| Test Category | Count | Migrated |
|---------------|-------|----------|
| Template rendering | 10 | ⬜ |
| JSON parsing | 15 | ⬜ |
| Filename conversion | 8 | ⬜ |
| OpenAPI validation | 12 | ⬜ |

## 10. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Performance regression | Low | Low | LLM calls dominate; Node.js I/O is fast enough |
| Missing edge cases | Medium | Medium | Comprehensive test suite; test with real specs |
| Breaking changes for users | Low | High | Keep CLI interface identical; same JSON formats |
| Dependency vulnerabilities | Low | Medium | Use well-maintained packages; regular updates |

## 11. Success Criteria

| Metric | Target |
|--------|--------|
| All CLI commands work identically | 100% |
| Existing test plans load correctly | 100% |
| Generated scripts identical format | 100% |
| All prompts work unchanged | 100% |
| Groq provider connects reliably | Yes |
| OpenAI provider connects reliably | Yes |
| Anthropic provider connects reliably | Yes |
| Time to generate 100 tests | ≤ Rust version |

## 12. Post-Migration

### 12.1 Deprecation of Rust Version

1. Archive `src/*.rs` files to `archive/rust/`
2. Keep Rust `Cargo.toml` for reference
3. Update main README to reflect Node.js
4. Tag final Rust release as `v0.x-rust-final`

### 12.2 Distribution Options

| Method | Command |
|--------|---------|
| npx (recommended) | `npx rohan plan api-spec.json` |
| Global install | `npm install -g rohan` |
| Local install | `npm install rohan && npx rohan` |
| Standalone binary | Bundle with `pkg` or `bun build --compile` |

### 12.3 Future Enhancements (Post-Migration)

- [ ] Watch mode for prompt development
- [ ] Interactive mode for reviewing generated tests
- [ ] Plugin system for custom generators
- [ ] Web UI for test plan visualization
- [ ] Integration with k6 Cloud

---

## Appendix A: Quick Start (Post-Migration)

```bash
# Install
npm install -g rohan

# Set API key
export GROQ_API_KEY="your-key"

# Generate tests
rohan plan api-spec.json -o test-plan.json
rohan build test-plan.json -o tests/

# Run with k6
k6 run --env BASE_URL=http://localhost:8080 tests/test_get_users_basic.js
```

## Appendix B: Provider Configuration Examples

```bash
# Groq (default)
export GROQ_API_KEY="gsk_..."
rohan plan api-spec.json --model llama-3.3-70b-versatile

# OpenAI
export OPENAI_API_KEY="sk-..."
rohan plan api-spec.json --provider openai --model gpt-4o

# Anthropic
export ANTHROPIC_API_KEY="sk-ant-..."
rohan plan api-spec.json --provider anthropic --model claude-sonnet-4-20250514

# Local Ollama
rohan plan api-spec.json --provider ollama --model llama3 --api-base http://localhost:11434/v1
```
