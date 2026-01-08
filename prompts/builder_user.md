# Test Script Builder User Prompt Template

Generate a MINIMAL k6 test script for this test case. Test ONLY what the name describes.

## Test Name
{{test_name}}

## API Endpoint
```json
{{endpoint_spec}}
```

## Test Name Patterns
- `Create_*` / `Post_*` → POST request, expect 201
- `Get_*` → GET request, expect 200
- `Update_*` → PUT/PATCH request, expect 200
- `Delete_*` → DELETE request, expect 200/204
- `Fail_*` → Expect 4xx error status
- `*_String_Payload` → Use a string as payload value
- `*_Number_Payload` → Use a number as payload value
- `*_Null_Payload` → Use null as payload value
- `*_Array_Payload` → Use an array as payload value
- `*_Empty_*` → Use empty string/array/object
- `*_Missing_*` → Omit that field from request
- `*_Zero_*` → Use 0 for that field
- `*_Negative_*` → Use negative number for that field

## Required k6 Structure
Your output MUST include:
1. Imports: `import http from 'k6/http';` and `import { check } from 'k6';`
2. BASE_URL constant: `const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';`
3. Export default function: `export default function() { ... }`

## Rules
1. Write 10-20 lines of code MAX
2. ONE http call using full URL with BASE_URL
3. ONE or TWO checks (status check + optional body check)
4. For POST/PUT/PATCH with JSON, use `JSON.stringify(body)` and set Content-Type header
5. Do NOT validate fields that aren't mentioned in the test name
6. Return raw JavaScript code only, NO markdown code fences
