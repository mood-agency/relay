# Batch Test Script Builder User Prompt Template

Generate MINIMAL k6 test scripts for ALL the following tests. Each test should test ONLY what its name describes.

## Tests to Generate
{{tests}}

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

## Required k6 Structure for Each Script
Each script MUST include:
1. Imports: `import http from 'k6/http';` and `import { check } from 'k6';`
2. BASE_URL constant: `const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';`
3. Export default function: `export default function() { ... }`

## Rules
1. Write 10-20 lines of code MAX per script
2. ONE http call using full URL with BASE_URL
3. ONE or TWO checks (status check + optional body check)
4. For POST/PUT/PATCH with JSON, use `JSON.stringify(body)` and set Content-Type header
5. Do NOT validate fields that aren't mentioned in the test name

## Output Format
Return a JSON object where each key is the test_name and value is the complete JavaScript code.

CRITICAL:
- DO NOT use markdown code fences
- Start directly with { and end with }
- Properly escape the JavaScript code for JSON (escape quotes, use \n for newlines)
- **EVERY test_name from the input MUST appear in your output - DO NOT SKIP ANY**

Example format:
{"Test_Name_1":"import http from 'k6/http';\nimport { check } from 'k6';\n\nconst BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';\n\nexport default function() {\n    const res = http.get(`${BASE_URL}/endpoint`);\n    check(res, { 'status is 200': (r) => r.status === 200 });\n}","Test_Name_2":"...code..."}
