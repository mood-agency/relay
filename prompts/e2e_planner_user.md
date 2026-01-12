# E2E Test Planning User Prompt Template

Analyze the following complete OpenAPI specification and identify all possible end-to-end workflow test scenarios.

## Full API Specification
```json
{{spec}}
```

## Instructions

Examine ALL endpoints in this API and identify multi-step workflows. For each workflow, consider:

### 1. Resource Lifecycles
- Which endpoints operate on the same resource?
- What CRUD operations are available?
- Design complete lifecycle tests: Create → Read → Update → Delete → Verify Deleted

### 2. Data Flow Dependencies
- Which operations return IDs or data needed by other operations?
- What's the natural order of operations for this API?
- Design tests that chain operations using response data

### 3. State Verification
- After each mutation, how can we verify the change took effect?
- What should the state be after a sequence of operations?
- Include verification GETs after every create/update/delete

### 4. Edge Cases in Workflows
- What happens if we try to use a deleted resource?
- What if we create duplicates?
- Include error verification in workflows

### 5. Batch and List Operations
- If batch endpoints exist, verify they work with list endpoints
- Create multiple items, verify list returns correct count
- Delete items, verify they're removed from lists

### 6. Concurrent Access Patterns
- Two clients updating the same resource simultaneously
- Create while another client deletes the same resource
- Race conditions in batch operations
- Verify data consistency under concurrent modifications

### 7. Idempotency Verification
- Send the same POST request twice - verify no duplicate created (if idempotency supported)
- Retry request after timeout - verify consistent state
- PUT same data multiple times - verify resource unchanged after first call
- DELETE same resource twice - verify second call returns 404

## Required Scenarios

At minimum, generate scenarios for:
1. **CRUD Lifecycle** - Full create/read/update/delete cycle for each major resource
2. **Deletion Verification** - Create, delete, verify 404 on re-fetch
3. **Update Persistence** - Create, update, re-read to verify changes saved
4. **List Consistency** - Create items, verify list endpoint, delete items, verify removed
5. **Idempotency Check** - Repeat same request, verify no duplicates or side effects
6. **Concurrent Modification** - Simulate concurrent access to same resource

## Output Format

Return ONLY a JSON array of scenario objects. Each object must have:
- `name`: String - PascalCase test name
- `steps`: Array of strings - Each step describes ONE API call and expected result
- `description`: String - What this workflow verifies

CRITICAL: DO NOT use markdown code fences. Start directly with [ and end with ]
