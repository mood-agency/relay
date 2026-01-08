# E2E Test Script Builder User Prompt Template

Generate a multi-step k6 E2E test script for this workflow scenario.

## Scenario Name
{{test_name}}

## Scenario Steps
{{steps}}

## Scenario Description
{{description}}

## Relevant API Endpoints
```json
{{endpoint_spec}}
```

## Requirements

1. **Chain all steps in sequence** - Each step in the scenario should be one HTTP call
2. **Pass data between steps** - Extract IDs, tokens, or other data from responses and use in subsequent calls
3. **Verify at each critical point** - Use `check()` after mutations to verify success
4. **Verify final state** - The last step should verify the expected end state
5. **Fail on critical errors** - Use `fail()` if a step that must succeed fails

## Step Interpretation Guide

- "POST /path -> expect 201, capture id" = Make POST, check 201, extract id from response
- "GET /path/{id} -> expect 200" = Make GET using captured id, check 200
- "DELETE /path/{id} -> expect 200/204" = Make DELETE, check either 200 or 204
- "GET /path/{id} -> expect 404" = Make GET, verify resource no longer exists
- "verify X" = Add a check() assertion for X

## Required k6 Structure

```javascript
import http from 'k6/http';
import { check, fail } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export default function() {
    // Step 1: ...
    // Step 2: ...
    // etc.
}
```

## Output
Return raw JavaScript code only. NO markdown code fences.
