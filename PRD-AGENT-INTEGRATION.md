# PRD: Intelligent Agent Integration for Rohan

## 1. Executive Summary

Enhance Rohan with an **Agentic Test Lifecycle Manager** that goes beyond simple test generation. The agent system will validate generated code, execute tests, diagnose failures, self-heal broken tests, and identify coverage gaps—creating a fully autonomous API testing pipeline.

**Current State**: Rohan generates tests via LLM and outputs static k6 scripts. If a test fails or has bugs, manual intervention is required.

**Target State**: An intelligent agent loop that continuously validates, executes, analyzes, and improves tests autonomously.

## 2. Problem Statement

### 2.1 Current Limitations

| Problem | Impact | Frequency |
|---------|--------|-----------|
| LLM generates syntactically invalid code | Test file is unusable | ~5-10% of tests |
| Generated test doesn't match API behavior | False positives/negatives | ~15-20% of tests |
| Missing edge cases and error scenarios | Incomplete coverage | Common |
| No feedback loop from execution results | Can't learn from failures | Always |
| Tests become stale as API evolves | Maintenance burden | Over time |
| Redundant tests covering same scenarios | Wasted execution time | ~10-15% |

### 2.2 User Pain Points

1. **"The generated test has a syntax error and won't run"**
2. **"The test passes but doesn't actually validate the right thing"**
3. **"I'm missing tests for error responses (400, 401, 404, 500)"**
4. **"The test failed but I don't know why or how to fix it"**
5. **"My API changed and now all tests are broken"**

## 3. Proposed Solution: Agentic Test Lifecycle

### 3.1 Agent Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Rohan Agent Orchestrator                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐               │
│  │  Validator  │   │  Executor   │   │  Analyzer   │               │
│  │    Agent    │──▶│    Agent    │──▶│    Agent    │               │
│  └─────────────┘   └─────────────┘   └─────────────┘               │
│         │                 │                 │                       │
│         ▼                 ▼                 ▼                       │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐               │
│  │  Self-Heal  │◀──│   Feedback  │◀──│  Coverage   │               │
│  │    Agent    │   │    Loop     │   │    Agent    │               │
│  └─────────────┘   └─────────────┘   └─────────────┘               │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Agent Roles

| Agent | Responsibility | Trigger |
|-------|---------------|---------|
| **Validator Agent** | Verify generated code compiles and follows best practices | After build |
| **Executor Agent** | Run tests against target API and capture results | On demand / CI |
| **Analyzer Agent** | Diagnose failures, identify root causes | After execution |
| **Self-Heal Agent** | Automatically fix broken tests | On failure |
| **Coverage Agent** | Identify missing test scenarios | After planning |
| **Optimizer Agent** | Remove redundant tests, improve assertions | Periodic |

## 4. Detailed Agent Specifications

### 4.1 Validator Agent

**Purpose**: Ensure generated test code is valid before execution.

#### Validation Checks

| Check | Description | Action on Failure |
|-------|-------------|-------------------|
| **Syntax Validation** | Parse JS/TS without errors | Regenerate with error context |
| **Import Validation** | All imports resolve correctly | Fix import paths |
| **k6 API Compliance** | Uses valid k6 APIs (`http`, `check`, etc.) | Replace invalid APIs |
| **Assertion Coverage** | Test has meaningful assertions | Add missing assertions |
| **Variable Safety** | No undefined variables or typos | Fix variable references |
| **Best Practices** | Follows k6 conventions | Suggest improvements |

#### Validation Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Generated  │────▶│   Validator  │────▶│    Valid?    │
│     Code     │     │     Agent    │     │              │
└──────────────┘     └──────────────┘     └──────┬───────┘
                                                 │
                           ┌─────────────────────┼─────────────────────┐
                           │                     │                     │
                           ▼                     ▼                     ▼
                     ┌──────────┐          ┌──────────┐          ┌──────────┐
                     │   Yes    │          │   Minor  │          │  Major   │
                     │ Proceed  │          │  Issues  │          │  Issues  │
                     └──────────┘          └────┬─────┘          └────┬─────┘
                                                │                     │
                                                ▼                     ▼
                                          ┌──────────┐          ┌──────────┐
                                          │ Auto-Fix │          │Regenerate│
                                          │ & Retry  │          │ w/Context│
                                          └──────────┘          └──────────┘
```

#### Implementation

```javascript
// src/agents/validator.ts

interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  fixable: boolean;
}

interface ValidationError {
  type: 'syntax' | 'import' | 'api' | 'assertion' | 'variable';
  message: string;
  line?: number;
  column?: number;
  suggestedFix?: string;
}

async function validateTest(code: string): Promise<ValidationResult> {
  const results: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    fixable: true,
  };

  // 1. Syntax validation (using acorn or typescript compiler)
  const syntaxErrors = await checkSyntax(code);
  results.errors.push(...syntaxErrors);

  // 2. k6 API validation
  const apiErrors = await checkK6APIs(code);
  results.errors.push(...apiErrors);

  // 3. Assertion coverage
  const assertionWarnings = await checkAssertions(code);
  results.warnings.push(...assertionWarnings);

  // 4. Best practices
  const practiceWarnings = await checkBestPractices(code);
  results.warnings.push(...practiceWarnings);

  results.valid = results.errors.length === 0;
  return results;
}
```

#### CLI Integration

```bash
# Validate during build (enabled by default)
rohan build test-plan.json -o tests/ --validate

# Skip validation (faster, riskier)
rohan build test-plan.json -o tests/ --no-validate

# Validate existing tests
rohan validate-tests tests/

# Auto-fix issues
rohan validate-tests tests/ --fix
```

---

### 4.2 Executor Agent

**Purpose**: Run tests against the target API and capture structured results.

#### Execution Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| **Smoke** | Run each test once, fast feedback | Development |
| **Validation** | Run with realistic data, capture responses | CI pipeline |
| **Load** | Run with multiple VUs and iterations | Performance |
| **Chaos** | Random delays, concurrent requests | Resilience |

#### Result Capture

```typescript
interface TestExecutionResult {
  testName: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  duration: number;
  
  // HTTP details
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
  };
  response: {
    status: number;
    headers: Record<string, string>;
    body: string;
    timing: {
      dns: number;
      connect: number;
      tls: number;
      ttfb: number;
      download: number;
    };
  };
  
  // Assertion results
  checks: {
    name: string;
    passed: boolean;
    actual?: any;
    expected?: any;
  }[];
  
  // Error details (if failed)
  error?: {
    message: string;
    stack?: string;
    type: 'assertion' | 'network' | 'timeout' | 'script';
  };
}
```

#### CLI Integration

```bash
# Execute tests with agent (captures detailed results)
rohan exec tests/ --target http://localhost:8080 --agent

# Execute with auto-analysis
rohan exec tests/ --target http://localhost:8080 --analyze

# Execute with auto-healing
rohan exec tests/ --target http://localhost:8080 --heal
```

---

### 4.3 Analyzer Agent

**Purpose**: Diagnose test failures and identify root causes.

#### Failure Categories

| Category | Symptoms | Likely Cause |
|----------|----------|--------------|
| **Schema Mismatch** | Expected field missing | API changed or spec outdated |
| **Auth Failure** | 401/403 responses | Missing/invalid credentials |
| **Data Dependency** | 404 on resource | Previous step didn't create resource |
| **Timing Issue** | Intermittent failures | Race condition or slow API |
| **Assertion Logic** | Wrong comparison | Test logic error |
| **Environment** | Connection refused | Server not running |

#### Diagnosis Flow

```
┌──────────────────────────────────────────────────────────────┐
│                      Analyzer Agent                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Input: TestExecutionResult (failed)                         │
│                                                              │
│  1. Classify failure type                                    │
│     └─▶ Network? Auth? Assertion? Timeout?                   │
│                                                              │
│  2. Extract relevant context                                 │
│     └─▶ Request/Response bodies, headers, status             │
│                                                              │
│  3. Compare against OpenAPI spec                             │
│     └─▶ Does response match expected schema?                 │
│                                                              │
│  4. Check execution history                                  │
│     └─▶ Is this a new failure or recurring?                  │
│                                                              │
│  5. Generate diagnosis report                                │
│     └─▶ Root cause + confidence + suggested action           │
│                                                              │
│  Output: FailureDiagnosis                                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

#### Diagnosis Report

```typescript
interface FailureDiagnosis {
  testName: string;
  category: 'schema' | 'auth' | 'data' | 'timing' | 'logic' | 'environment';
  confidence: number; // 0-1
  
  rootCause: string;
  evidence: string[];
  
  suggestedAction: {
    type: 'fix_test' | 'fix_api' | 'update_spec' | 'add_setup' | 'retry';
    description: string;
    automated: boolean;
    codeChange?: string;
  };
  
  relatedTests?: string[]; // Other tests that might be affected
}
```

#### LLM Prompt for Diagnosis

```markdown
You are a test failure analyst. Given the following test execution details, diagnose the root cause.

**Test Name**: {{test_name}}
**Expected Behavior**: {{test_description}}

**Request**:
{{request_details}}

**Response**:
Status: {{status_code}}
Body: {{response_body}}

**Failed Checks**:
{{failed_checks}}

**OpenAPI Spec for Endpoint**:
{{endpoint_spec}}

Analyze this failure and provide:
1. Root cause category (schema_mismatch, auth_failure, data_dependency, timing_issue, assertion_logic, environment)
2. Detailed explanation
3. Evidence supporting your diagnosis
4. Specific fix recommendation (with code if applicable)
```

---

### 4.4 Self-Heal Agent

**Purpose**: Automatically fix broken tests based on diagnosis.

#### Healing Strategies

| Failure Type | Healing Strategy |
|--------------|------------------|
| **Syntax Error** | Parse error, regenerate section |
| **Schema Mismatch** | Update assertions to match actual response |
| **Missing Field** | Add optional chaining or remove assertion |
| **Wrong Status Code** | Update expected status based on spec |
| **Auth Failure** | Add authentication header setup |
| **Data Dependency** | Add setup step to create required data |
| **Timeout** | Increase timeout or add retry logic |
 
#### Healing Flow

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│    Diagnosis     │────▶│   Self-Heal      │────▶│   Healed Test    │
│     Report       │     │     Agent        │     │                  │
└──────────────────┘     └──────────────────┘     └────────┬─────────┘
                                                          │
                                                          ▼
                                                 ┌──────────────────┐
                                                 │   Re-Validate    │
                                                 │   & Re-Execute   │
                                                 └────────┬─────────┘
                                                          │
                           ┌──────────────────────────────┼──────────────┐
                           │                              │              │
                           ▼                              ▼              ▼
                    ┌──────────────┐              ┌──────────────┐ ┌──────────┐
                    │   Passed!    │              │ Still Fails  │ │  Max     │
                    │   Commit     │              │ Try Again    │ │ Retries  │
                    └──────────────┘              └──────────────┘ └──────────┘
```

#### Healing Limits

```typescript
interface HealingConfig {
  maxAttempts: number;        // Default: 3
  allowSchemaChanges: boolean; // Update assertions for new API shape
  allowNewSetupSteps: boolean; // Add data creation steps
  requireHumanReview: boolean; // Flag healed tests for review
  preserveOriginal: boolean;   // Keep .bak of original test
}
```

#### Example Healing

**Original (Broken)**:
```javascript
export default function() {
  const res = http.get(`${BASE_URL}/users/123`);
  check(res, {
    'has email': (r) => r.json().email !== undefined,  // FAILS: field is 'emailAddress'
  });
}
```

**Healed**:
```javascript
export default function() {
  const res = http.get(`${BASE_URL}/users/123`);
  check(res, {
    'has email': (r) => r.json().emailAddress !== undefined,  // HEALED: updated field name
  });
}
```

---

### 4.5 Coverage Agent

**Purpose**: Identify missing test scenarios and generate recommendations.

#### Coverage Dimensions

| Dimension | Description | Detection Method |
|-----------|-------------|------------------|
| **Endpoint Coverage** | All endpoints have tests | Compare spec vs test plan |
| **Method Coverage** | All HTTP methods tested | Analyze test methods |
| **Status Code Coverage** | 2xx, 4xx, 5xx responses | Check for error tests |
| **Parameter Coverage** | Required & optional params | Analyze endpoint params |
| **Edge Cases** | Boundary values, nulls | Semantic analysis |
| **Auth Scenarios** | Valid, invalid, missing | Check auth tests |
| **Data Variations** | Different payload shapes | Analyze test data |

#### Coverage Analysis Output

```typescript
interface CoverageReport {
  overall: number; // 0-100%
  
  byEndpoint: {
    path: string;
    method: string;
    coverage: number;
    missingScenarios: string[];
  }[];
  
  gaps: {
    category: string;
    description: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    suggestedTests: string[];
  }[];
  
  recommendations: {
    action: string;
    impact: string;
    effort: 'low' | 'medium' | 'high';
  }[];
}
```

#### Gap Detection Examples

| Gap Type | Example | Suggested Test |
|----------|---------|----------------|
| Missing error test | No 404 test for GET /users/{id} | `test_get_user_not_found` |
| Missing auth test | No 401 test for protected endpoint | `test_get_users_unauthorized` |
| Missing validation | No test for invalid email format | `test_create_user_invalid_email` |
| Missing boundary | No test for max string length | `test_create_user_name_too_long` |
| Missing combination | No test for multiple filters | `test_list_users_multiple_filters` |

#### CLI Integration

```bash
# Analyze coverage
rohan coverage test-plan.json --spec api-spec.json

# Generate missing tests
rohan coverage test-plan.json --spec api-spec.json --generate

# Target specific coverage %
rohan coverage test-plan.json --spec api-spec.json --target 80
```

---

### 4.6 Optimizer Agent

**Purpose**: Improve test quality and remove redundancy.

#### Optimization Tasks

| Task | Description | Benefit |
|------|-------------|---------|
| **Deduplication** | Find tests covering same scenario | Reduce execution time |
| **Assertion Strengthening** | Add more specific checks | Better failure detection |
| **Data Parameterization** | Extract hardcoded values | Reusability |
| **Dependency Ordering** | Ensure correct execution order | Reliability |
| **Performance Hints** | Add sleep(), batch requests | More realistic load |

#### Optimization Report

```typescript
interface OptimizationReport {
  duplicates: {
    tests: string[];
    reason: string;
    recommendation: 'merge' | 'delete' | 'keep';
  }[];
  
  weakAssertions: {
    test: string;
    currentAssertions: string[];
    suggestedAssertions: string[];
  }[];
  
  hardcodedValues: {
    test: string;
    values: { line: number; value: string; suggestion: string }[];
  }[];
  
  estimatedSavings: {
    executionTime: string;
    maintainability: string;
  };
}
```

---

## 5. Agent Orchestration

### 5.1 Orchestration Modes

| Mode | Description | Agents Active |
|------|-------------|---------------|
| **Generate** | Standard generation + validation | Validator |
| **Execute** | Run tests + analyze failures | Executor, Analyzer |
| **Heal** | Full autonomous loop | All agents |
| **Audit** | Coverage + optimization only | Coverage, Optimizer |

### 5.2 Full Autonomous Pipeline

```bash
# The dream command
rohan auto api-spec.json --target http://localhost:8080
```

**Pipeline Steps**:

1. **Plan**: Generate test scenarios from spec
2. **Validate Coverage**: Check for gaps, generate additional tests
3. **Build**: Generate k6 scripts
4. **Validate Code**: Ensure all scripts are valid
5. **Execute**: Run tests against target
6. **Analyze**: Diagnose any failures
7. **Heal**: Fix broken tests automatically
8. **Re-Execute**: Verify fixes work
9. **Report**: Generate comprehensive report

```
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│  Plan   │──▶│Coverage │──▶│  Build  │──▶│Validate │
└─────────┘   └─────────┘   └─────────┘   └─────────┘
                                               │
                                               ▼
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│ Report  │◀──│Re-Execute│◀──│  Heal   │◀──│ Execute │
└─────────┘   └─────────┘   └─────────┘   └─────────┘
                                               │
                                               ▼
                                          ┌─────────┐
                                          │ Analyze │
                                          └─────────┘
```

### 5.3 Configuration

```json
// rohan.config.json
{
  "agent": {
    "enabled": true,
    "mode": "heal",
    
    "validator": {
      "enabled": true,
      "autoFix": true,
      "strictMode": false
    },
    
    "executor": {
      "mode": "validation",
      "timeout": 30000,
      "retries": 2
    },
    
    "analyzer": {
      "enabled": true,
      "compareWithSpec": true,
      "trackHistory": true
    },
    
    "healer": {
      "enabled": true,
      "maxAttempts": 3,
      "allowSchemaChanges": true,
      "requireReview": false
    },
    
    "coverage": {
      "target": 80,
      "includeErrorCases": true,
      "includeAuthCases": true
    },
    
    "optimizer": {
      "removeDuplicates": true,
      "strengthenAssertions": true
    }
  }
}
```

---

## 6. User Interface

### 6.1 CLI Commands

```bash
# Agent-enhanced commands
rohan plan api-spec.json --agent          # Plan with coverage analysis
rohan build test-plan.json --agent        # Build with validation
rohan exec tests/ --agent                 # Execute with analysis
rohan heal tests/ --target http://...     # Heal broken tests

# Standalone agent commands
rohan validate-code tests/                # Validate test code
rohan analyze-failures results.json       # Analyze failures
rohan coverage test-plan.json             # Coverage report
rohan optimize tests/                     # Optimization suggestions

# Full pipeline
rohan auto api-spec.json --target http://localhost:8080
```

### 6.2 Interactive Mode

```bash
# Interactive agent session
rohan agent --interactive

🤖 Rohan Agent v1.0
? What would you like to do?
  ▸ Generate tests for an API spec
    Analyze test coverage
    Fix broken tests
    Optimize existing tests
    Run full audit
```

### 6.3 Output Formats

| Format | Use Case |
|--------|----------|
| **Console** | Human-readable, colored output |
| **JSON** | Machine-readable for CI/CD |
| **HTML** | Visual report with charts |
| **Markdown** | Documentation and PR comments |

---

## 7. Implementation Plan

### Phase 1: Validator Agent (Week 1-2)

- [ ] Implement JavaScript/TypeScript syntax validation
- [ ] Implement k6 API compliance checks
- [ ] Implement assertion coverage analysis
- [ ] Add `--validate` flag to build command
- [ ] Add `rohan validate-code` command
- [ ] Implement auto-fix for common issues

**Deliverable**: `rohan build --validate` catches and fixes 90% of syntax issues

### Phase 2: Executor Agent (Week 3-4)

- [ ] Create structured result capture format
- [ ] Implement k6 execution wrapper
- [ ] Capture request/response details
- [ ] Track assertion results
- [ ] Store execution history
- [ ] Add `--agent` flag to exec command

**Deliverable**: `rohan exec --agent` produces detailed JSON results

### Phase 3: Analyzer Agent (Week 5-6)

- [ ] Implement failure categorization
- [ ] Create diagnosis prompt templates
- [ ] Compare responses against OpenAPI spec
- [ ] Track failure patterns over time
- [ ] Generate actionable recommendations
- [ ] Add `rohan analyze-failures` command

**Deliverable**: Accurate diagnosis for 80%+ of failures

### Phase 4: Self-Heal Agent (Week 7-8)

- [ ] Implement healing strategies for each failure type
- [ ] Create healing prompt templates
- [ ] Add re-validation loop
- [ ] Implement healing limits and safety
- [ ] Add `rohan heal` command
- [ ] Track healing success rate

**Deliverable**: Autonomous fixing of 60%+ of failures

### Phase 5: Coverage Agent (Week 9-10)

- [ ] Implement endpoint coverage analysis
- [ ] Detect missing error scenarios
- [ ] Detect missing auth scenarios
- [ ] Generate suggested test names
- [ ] Optionally generate test code
- [ ] Add `rohan coverage` command

**Deliverable**: Coverage reports with actionable gap list

### Phase 6: Optimizer Agent (Week 11-12)

- [ ] Implement duplicate detection
- [ ] Analyze assertion quality
- [ ] Detect hardcoded values
- [ ] Generate optimization report
- [ ] Add `rohan optimize` command

**Deliverable**: Optimization suggestions that improve suite quality

### Phase 7: Orchestration & Polish (Week 13-14)

- [ ] Implement `rohan auto` full pipeline
- [ ] Add interactive mode
- [ ] Create HTML report generator
- [ ] Performance optimization
- [ ] Documentation and examples

**Deliverable**: Production-ready agent system

---

## 8. Success Metrics

| Metric | Target |
|--------|--------|
| Code validation accuracy | 95%+ |
| Failure diagnosis accuracy | 80%+ |
| Auto-heal success rate | 60%+ |
| Coverage gap detection | 90%+ |
| Time to first working test | <5 minutes |
| Tests requiring manual fix | <10% |
| User intervention rate | <20% |

---

## 9. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| LLM hallucinations in diagnosis | Wrong fixes applied | Medium | Confidence thresholds, human review flag |
| Infinite healing loop | Stuck tests | Low | Max attempts limit, circuit breaker |
| Over-aggressive optimization | Valid tests removed | Medium | Conservative defaults, preview mode |
| API rate limits on LLM | Slow agent loop | Medium | Caching, batching, local model option |
| Complex multi-step failures | Hard to diagnose | Medium | Execution history, dependency tracking |

---

## 10. Future Enhancements

### 10.1 Learning & Adaptation
- Learn from successful heals to improve future generations
- Build library of common patterns and fixes
- User feedback loop to improve prompts

### 10.2 Advanced Agents
- **Mutation Testing Agent**: Verify tests actually catch bugs
- **Regression Agent**: Detect behavior changes between versions
- **Security Agent**: Generate security-focused tests (injection, auth bypass)
- **Performance Agent**: Identify slow endpoints and bottlenecks

### 10.3 Integrations
- GitHub Actions integration for PR checks
- Slack/Teams notifications for failures
- Dashboard for test health monitoring
- IDE extension for real-time validation

---

## 11. Appendix

### A. Example Agent Interaction

```
$ rohan auto api-spec.json --target http://localhost:8080

🤖 Rohan Agent v1.0

📋 Planning tests...
   Found 15 endpoints
   Generated 47 test scenarios
   
🔍 Checking coverage...
   ⚠️  Missing error tests for 5 endpoints
   ⚠️  Missing auth tests for 3 endpoints
   Generating 12 additional tests...
   
👷 Building scripts...
   Generated 59 test files
   
✅ Validating code...
   57 valid, 2 with issues
   🔧 Auto-fixing test_create_user_invalid.js (syntax error)
   🔧 Auto-fixing test_delete_order.js (missing import)
   
🏃 Executing tests...
   [████████████████████████████████] 59/59
   
   ✅ 54 passed
   ❌ 5 failed
   
🔬 Analyzing failures...
   • test_get_user_profile: Schema mismatch (field renamed: email → emailAddress)
   • test_create_order: Auth failure (missing Bearer token)
   • test_update_product: Data dependency (product doesn't exist)
   • test_delete_category: Timing issue (eventual consistency)
   • test_batch_users: Assertion logic error
   
🩹 Healing tests...
   ✅ test_get_user_profile: Fixed field name
   ✅ test_create_order: Added auth header
   ✅ test_update_product: Added setup step
   ⏭️  test_delete_category: Added retry logic
   ❌ test_batch_users: Requires manual review
   
🏃 Re-executing healed tests...
   ✅ 4/5 now passing
   
📊 Final Report
   Total: 59 tests
   Passing: 58 (98.3%)
   Needs Review: 1
   Coverage: 87%
   
   Report saved to: rohan-report.html
```

### B. Prompt Templates

See `prompts/agent/` directory for:
- `validator_system.md`
- `analyzer_system.md`
- `healer_system.md`
- `coverage_system.md`
- `optimizer_system.md`
