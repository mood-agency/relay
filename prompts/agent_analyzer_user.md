# Analyzer Agent User Prompt

Analyze this OpenAPI specification to detect workflow patterns, authentication flows, state machines, and resource relationships.

## OpenAPI Specification
```json
{{spec}}
```

## Analysis Instructions

1. **Identify Workflow Patterns**
   - Look for CRUD operations (POST/GET/PUT/DELETE on same resource)
   - Look for multi-step workflows (e.g., create order → add items → checkout)
   - Look for state transitions in request/response schemas

2. **Detect Authentication Flows**
   - Look for /auth, /login, /token endpoints
   - Look for security schemes in the spec
   - Identify token refresh patterns

3. **Find State Machines**
   - Look for status/state fields in schemas
   - Look for endpoints that change state

4. **Map Resource Relationships**
   - Identify nested resources (path parameters)
   - Find references between resources (IDs in request bodies)
   - Detect dependencies (one resource required for another)

5. **Provide Coverage Recommendations**
   - What workflows should be tested end-to-end?
   - What edge cases should be covered?
   - What security scenarios should be tested?

Return your analysis as a JSON object with the structure defined in the system prompt.
