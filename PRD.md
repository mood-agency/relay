# Product Requirement Document (PRD): OpenAPI High-Performance Test Runner

## 1. Executive Summary
Develop a high-performance command-line interface (CLI) utility that ingests an OpenAPI (Swagger) JSON specification, automatically generates robust, multi-step test scenarios using an LLM, and executes them in parallel.

**Architecture**: The tool acts as a high-performance Rust runner embedding a JavaScript runtime (similar to **K6**). It generates JavaScript test scripts via an LLM and executes them efficiently.

## 2. Objectives
- **Automated Discovery**: Automatically parse all endpoints from a given OpenAPI V3 JSON file.
- **LLM-Driven Scripting**: Use an LLM to generate flexible JavaScript test scripts for complex workflows.
- **High Performance**: Execute JS-based tests in parallel using a Rust-based async runtime.
- **Ease of Use**: Simple CLI arguments to target a spec file and base URL.

## 3. Technology Stack Recommendation
**Selected Language: Rust**

### Rationale:
- **Host System**: Rust provides the high-performance concurrent engine (`tokio`) and CLI structure (`clap`).
- **Scripting Engine**: **JavaScript** (via `boa_engine` or `rquickjs`).
    - *Why JS?* Allows for complex logic, assertions, and data manipulation without recompiling the runner. It is the industry standard for API testing (K6, Postman).
- **Ecosystem**:
    - **Parsing**: `serde`, `serde_json`, `openapiv3`.
    - **JS Runtime**: `boa_engine` (pure Rust) or `rquickjs` (QuickJS-based) for executing generated test code.
    - **LLM Client**: `genai` (by Jeremy Chone) for connecting to OpenAI, Anthropic, Groq, or local models.
    - **CLI**: `clap`.
    - **HTTP**: `reqwest` with async support.

## 4. Functional Requirements

### 4.1. Input Handling
- CLI accepts OpenAPI v3.0+ JSON/YAML file (path or URL).
- CLI accepts target `Base URL`.
- CLI accepts LLM provider credentials via environment variable (`ROHAN_API_KEY`).

### 4.2. Test Generation Strategy (LLM-Driven)

#### Step 1: Test Planning (The Architect)
- **Input**: Parsed OpenAPI spec.
- **Output**: A list of structured test scenarios (JSON).
    - *Example*:
      ```json
      [{
        "name": "Checkout Flow",
        "steps": ["Login", "Add to Cart", "Checkout"],
        "priority": "critical",
        "tags": ["auth", "checkout"]
      }]
      ```

#### Step 2: Code Generation (The Builder)
- **Input**: A test scenario + relevant schemas.
- **Output**: **Executable JavaScript Code**.
    - The LLM writes a JS function that uses a global `http` client (provided by the Rust host) to make requests and `assert` functions to validate results.
    - *Example generated code*:
      ```javascript
      export default async function(client) {
          const res = await client.post("/login", { ... });
          if (res.status !== 200) throw new Error("Login failed");
      }
      ```

#### Prompt Engineering Strategy
1. **System Prompt**: Defines the code style, available APIs (`http.get`, `http.post`, `assert`)
2. **Few-Shot Examples**: Include 2-3 working test examples in the prompt
3. **Schema Injection**: Only inject schemas referenced by the current scenario (avoid token bloat)
4. **Validation**: Parse generated JS with the runtime before execution; reject malformed scripts

#### Prompt Customization
Prompts are stored in the `prompts/` directory and embedded at compile time. Users can override them:

| File | Purpose |
|------|---------|
| `planner_system.md` | System prompt for test scenario planning |
| `planner_user.md` | User prompt template for planning (uses `{{spec}}`) |
| `builder_system.md` | System prompt for JavaScript code generation |
| `builder_user.md` | User prompt template for code gen (uses `{{scenario_name}}`, `{{scenario_steps}}`, `{{spec}}`) |

**Override via CLI**: `--prompt-dir ./my-prompts/`
**Override via env**: `ROHAN_PROMPT_DIR=./my-prompts/`

This allows teams to customize prompts for their specific API conventions without recompiling.

### 4.3. Execution Engine
- **Runtime**: The Rust application initializes a pool of JS runtimes.
- **Parallelism**: Multiple JS scripts run concurrently in separate isolates/contexts.
- **Host Bindings**: Rust exposes a high-performance `client` object to the JS runtime (wrapping `reqwest`) to handle the actual HTTP I/O efficiently.

#### Runtime Pool Strategy
- Pre-initialize `concurrency` number of JS contexts at startup
- Each context is single-threaded; use `tokio::spawn_blocking` for parallelism
- Contexts are reused across scenarios (reset global state between runs)
- Memory limit per context: 64MB (configurable via `--js-heap-size`)

### 4.4. Reporting
- Console output with progress bar.
- Summary report: Total Tests, Passed, Failed, Latency metrics.
- Detailed logs: On failure, print the JS stack trace and the HTTP request/response details.

#### Output Formats
- **Text** (default): Human-readable console output with colors and progress
- **JSON**: Machine-readable for dashboards and programmatic consumption
- **JUnit XML**: For CI systems (Jenkins, GitHub Actions, Azure DevOps)

#### Metrics Captured
- p50, p95, p99 latency
- Requests per second (throughput)
- Error rate by endpoint
- Total test duration
- Pass/fail counts per scenario

### 4.5. Error Handling
- **Invalid LLM Output**: Retry with refined prompt (max 3 attempts), then skip scenario with warning
- **Network Failures**: Configurable retry policy (`--retries N`, `--backoff-ms`)
- **Malformed Spec**: Fail fast with actionable error messages pointing to spec location
- **JS Runtime Errors**: Capture stack trace and continue with remaining tests
- **Timeout**: Kill long-running tests after configurable threshold

### 4.6. Configuration
- **Config File**: Optional `rohan.config.json` for persistent settings
- **Environment Variables**: 
    - `ROHAN_API_KEY`: LLM provider API key
    - `ROHAN_DEFAULT_MODEL`: Default LLM model
    - `ROHAN_TIMEOUT_MS`: Default request timeout
    - `ROHAN_PROMPT_DIR`: Custom prompt directory path
- **Headers**: `--header "Authorization: Bearer {token}"` for authenticated APIs
- **Timeout**: `--timeout 30000` (milliseconds per request)

## 5. User Interface (CLI)

### Commands
```bash
# Run tests
rohan run ./api-spec.json --target http://localhost:8080 --concurrency 50

# Generate test plan only (no execution)
rohan plan ./api-spec.json --output tests/

# Execute pre-generated scripts
rohan exec ./tests/ --target http://localhost:8080

# Validate an OpenAPI spec
rohan validate ./api-spec.json
```

### Flags
| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--target` | URL | *required* | Base URL of API under test |
| `--concurrency` | int | 10 | Number of parallel workers |
| `--timeout` | int | 30000 | Request timeout in milliseconds |
| `--retries` | int | 0 | Number of retry attempts on failure |
| `--backoff-ms` | int | 1000 | Backoff between retries |
| `--model` | string | `llama3-70b-8192` | LLM model identifier |
| `--output` | path | stdout | Report output destination |
| `--format` | enum | `text` | Output format: `text`, `json`, `junit` |
| `--header` | string[] | - | Custom headers (repeatable) |
| `--js-heap-size` | int | 64 | JS context memory limit (MB) |
| `--prompt-dir` | path | - | Custom prompt directory (overrides embedded) |
| `--verbose` | bool | false | Enable detailed logging |

## 6. Implementation Phases

### Phase 1: MVP (The Skeleton)
- [x] Setup Rust project with `clap` and basic `openapiv3` parsing.
- [x] Integrate `boa_engine` JS runtime.
- [x] Implement a simple "Hello World" JS execution from Rust.
- [x] Connect to LLM to generate a single test plan.
- [x] Expose basic `http.get` from Rust to JS.

### Phase 2: The Runner (K6-lite)
- [x] Expose full `http` client (GET, POST, PUT, DELETE) from Rust to JS.
- [x] Implement parallel execution of multiple JS scripts.
- [x] Add assertions and error handling in the JS<->Rust bridge.
- [x] Implement retry logic and timeout handling.
- [x] Add progress bar and basic console reporting.

### Phase 3: The Architect (Full Auto)
- [x] Implement the "Planner" step to analyze the full spec.
- [x] Generate complex, multi-step JS workflows.
- [x] Add reporting formats (JSON, JUnit).
- [x] Add metrics collection (latency percentiles, throughput).
- [x] Implement config file support.

## 7. Success Criteria
- Parse 95%+ of valid OpenAPI 3.x specs without errors
- Execute 1000 concurrent requests with <100ms overhead per request
- LLM generates syntactically valid JS on first attempt 90%+ of the time
- CLI response time <2s for specs with <100 endpoints
- Zero data loss on test results even on crash (atomic writes)

## 8. Non-Functional Requirements

### Performance
- Handle specs with 500+ endpoints
- Sustain 10,000 requests/second on modern hardware (8+ cores)
- Memory footprint <500MB for typical runs
- Startup time <1 second

### Security
- API keys never logged or written to disk
- Support for mTLS client certificates (future)
- Secrets injected exclusively via environment variables
- JS runtime sandboxed (no filesystem, no network except via `http` bridge)

### Compatibility
- **Platforms**: Windows, macOS, Linux (x64, ARM64)
- **Specs**: OpenAPI 3.0.x and 3.1.x (JSON and YAML)
- **LLM Providers**: OpenAI, Anthropic, Groq, local models via OpenAI-compatible API

## 9. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| LLM generates dangerous code (file access, etc.) | High | Low | Sandbox JS runtime; only expose `http` and `assert` APIs |
| Rate limiting by LLM provider | Medium | Medium | Cache generated tests locally; batch planning requests |
| JS engine performance bottleneck | Medium | Medium | Use `rquickjs` if `boa_engine` proves too slow; profile early |
| OpenAPI spec edge cases cause parsing failures | Low | High | Comprehensive parser test suite against real-world specs (Stripe, GitHub, etc.) |
| Network instability during test runs | Medium | Medium | Implement configurable retry with exponential backoff |

## 10. Out of Scope (v1.0)
- GUI / Web dashboard
- OpenAPI 2.0 (Swagger) support
- GraphQL support
- Built-in mock server
- Distributed execution across machines
- Load testing mode (sustained traffic generation)
- Authentication flow automation (OAuth2, etc.)
- Test result persistence / database

## 11. Future Considerations (v2.0+)
- Web UI for visualizing test results
- Plugin system for custom assertions
- OpenAPI 2.0 backward compatibility
- Integration with CI/CD webhooks
- Distributed mode with coordinator/worker architecture
- Historical trend analysis and regression detection
