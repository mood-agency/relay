# Smart Planner User Prompt

Prioritize and categorize these test cases to achieve {{target_coverage}}% coverage target.

## Test Cases
```json
{{tests}}
```

## API Summary
```json
{{spec_summary}}
```

## Analysis Results (if available)
```json
{{analysis}}
```

## Prioritization Instructions

1. **Assign Priority**
   - `critical`: Auth, security, core business logic, payment-related
   - `high`: Main happy paths, CRUD operations
   - `medium`: Boundary tests, validation tests
   - `low`: Rare edge cases, optional features

2. **Assign Category**
   Based on test name patterns:
   - Names with `Basic`, `Valid`, `Success` → `happy_path`
   - Names with `Zero`, `Empty`, `Max`, `Min`, `Negative` → `boundary`
   - Names with `Fail`, `Invalid`, `Missing`, `Error` → `negative`
   - Names with `SQL`, `XSS`, `Injection`, `Security` → `security`
   - Names with `Flow`, `Workflow`, `Lifecycle` → `e2e`

3. **Estimate Coverage Impact**
   - First test for an endpoint: 3-5 points
   - Additional tests for same endpoint: 1-2 points
   - Security tests: 1-2 points
   - Edge cases: 0.5-1 point

Return a JSON array matching the structure in the system prompt.
