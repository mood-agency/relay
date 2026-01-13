---
allowed-tools: Read, Write, Glob
---

# Generate k6 Tests from OpenAPI Spec

Generate exhaustive k6 test scripts from an OpenAPI specification file. Be thorough - missing a test case means missing a potential bug.

## Usage

```
/generate-k6-tests <openapi-spec.json> [-o <output-dir>]
```

Arguments:
- `$1` - Path to OpenAPI JSON specification file
- `-o <dir>` - Output directory (default: `tests/`)

## Instructions

### Step 1: Parse Arguments

Extract the spec path and output directory from `$ARGUMENTS`:
- First argument is the OpenAPI spec file path
- If `-o` flag is present, use the next argument as output directory
- Default output directory is `tests/`

### Step 2: Read and Parse OpenAPI Spec

1. Read the OpenAPI spec file using the Read tool
2. Parse the JSON to extract:
   - `info.title` - API title
   - `info.version` - API version
   - `paths` - All endpoint definitions
   - `components.schemas` - Reusable schemas

### Step 3: Extract Endpoints

For each path in `paths`, extract:
- HTTP method (GET, POST, PUT, PATCH, DELETE)
- Path template (e.g., `/users/{id}`)
- Path parameters (from `{param}` in path)
- Query parameters
- Request body schema (if applicable)
- Required/optional fields
- Field types and constraints
- Response schemas and status codes

### Step 4: Systematic Test Generation

For EACH endpoint, think through these questions and generate tests for EVERY applicable case:

#### 4.1 Required Fields Analysis
For each required field, generate:
- `Fail_<Action>_<Resource>_Missing_<Field>` - Omit this required field

#### 4.2 Optional Fields Analysis
For each optional field, generate:
- `<Action>_<Resource>_With_<Field>` - Include optional field
- `<Action>_<Resource>_Without_<Field>` - Exclude optional field

#### 4.3 Data Type Variations (for flexible/any type fields)
- `<Action>_<Resource>_String_<Field>` - String value
- `<Action>_<Resource>_Number_<Field>` - Number value
- `<Action>_<Resource>_Boolean_<Field>` - Boolean value
- `<Action>_<Resource>_Null_<Field>` - Null value
- `<Action>_<Resource>_Array_<Field>` - Array value
- `<Action>_<Resource>_Object_<Field>` - Object value
- `<Action>_<Resource>_Empty_Array_<Field>` - Empty array `[]`
- `<Action>_<Resource>_Empty_Object_<Field>` - Empty object `{}`

#### 4.4 Numeric Field Boundaries (for EACH numeric field)
- `<Action>_<Resource>_Zero_<Field>` - Value: `0`
- `<Action>_<Resource>_Negative_<Field>` - Value: `-1`
- `<Action>_<Resource>_Max_<Field>` - Value: `2147483647`
- `<Action>_<Resource>_Min_<Field>` - Value: `-2147483648`
- `<Action>_<Resource>_Large_<Field>` - Value: `999999999`
- `<Action>_<Resource>_Decimal_<Field>` - Value: `1.5` (if integer expected)
- `<Action>_<Resource>_Overflow_<Field>` - Value: `9007199254740992`

#### 4.5 String Field Variations (for EACH string field)
- `<Action>_<Resource>_Empty_<Field>` - Value: `""`
- `<Action>_<Resource>_Long_<Field>` - Value: 1000 character string
- `<Action>_<Resource>_Very_Long_<Field>` - Value: 10000 character string
- `<Action>_<Resource>_Special_Chars_<Field>` - Value: `"!@#$%^&*()"`
- `<Action>_<Resource>_Unicode_<Field>` - Value: `"日本語 中文 한국어"`
- `<Action>_<Resource>_Emoji_<Field>` - Value: `"🚀💻🔥"`
- `<Action>_<Resource>_Whitespace_<Field>` - Value: `"   "`
- `<Action>_<Resource>_Newlines_<Field>` - Value: `"line1\nline2\nline3"`
- `<Action>_<Resource>_Tabs_<Field>` - Value: `"col1\tcol2\tcol3"`

#### 4.6 Type Mismatch Tests (for EACH typed field)
- `Fail_<Action>_<Resource>_<Field>_Not_String` - Send number instead of string
- `Fail_<Action>_<Resource>_<Field>_Not_Number` - Send string instead of number
- `Fail_<Action>_<Resource>_<Field>_Not_Boolean` - Send string instead of boolean
- `Fail_<Action>_<Resource>_<Field>_Not_Array` - Send object instead of array
- `Fail_<Action>_<Resource>_<Field>_Not_Object` - Send array instead of object

#### 4.7 Array/Batch Operations (if endpoint accepts arrays)
- `<Action>_Batch_Single_<Resource>` - Array with 1 item
- `<Action>_Batch_Two_<Resource>` - Array with 2 items
- `<Action>_Batch_Five_<Resource>` - Array with 5 items
- `<Action>_Batch_Ten_<Resource>` - Array with 10 items
- `<Action>_Batch_Large_<Resource>` - Array with 100 items
- `<Action>_Batch_Mixed_Types` - Array with mixed valid items
- `Fail_<Action>_Batch_Empty` - Empty array `[]`
- `Fail_<Action>_Batch_Not_Array` - Object instead of array
- `Fail_<Action>_Batch_Invalid_Item` - Array with one invalid item

#### 4.8 Query Parameter Tests (for GET endpoints with params)
- `Get_<Resource>_With_<Param>` - Include query param
- `Get_<Resource>_Without_<Param>` - Exclude query param
- `Get_<Resource>_Zero_<Param>` - Param value: `0`
- `Get_<Resource>_Negative_<Param>` - Param value: `-1`
- `Get_<Resource>_Max_<Param>` - Param value: `2147483647`
- `Get_<Resource>_Empty_<Param>` - Param value: ``
- `Fail_Get_<Resource>_Invalid_<Param>` - Invalid param value

#### 4.9 Path Parameter Tests (for endpoints with {id} etc)
- `<Action>_<Resource>_Valid_Id` - Valid ID format
- `Fail_<Action>_<Resource>_Invalid_Id` - Invalid ID format
- `Fail_<Action>_<Resource>_NonExistent_Id` - ID that doesn't exist
- `Fail_<Action>_<Resource>_Empty_Id` - Empty ID
- `<Action>_<Resource>_Numeric_Id` - Numeric ID
- `<Action>_<Resource>_UUID_Id` - UUID format ID

#### 4.10 Security Tests (for EACH string field)
- `Security_<Action>_SQL_Injection_<Field>` - Value: `"'; DROP TABLE users; --"`
- `Security_<Action>_SQL_Injection_Union_<Field>` - Value: `"' UNION SELECT * FROM users --"`
- `Security_<Action>_XSS_Script_<Field>` - Value: `"<script>alert('xss')</script>"`
- `Security_<Action>_XSS_Img_<Field>` - Value: `"<img src=x onerror=alert('xss')>"`
- `Security_<Action>_XSS_Event_<Field>` - Value: `"<div onmouseover='alert(1)'>"`
- `Security_<Action>_Path_Traversal_<Field>` - Value: `"../../etc/passwd"`
- `Security_<Action>_Path_Traversal_Windows_<Field>` - Value: `"..\\..\\windows\\system32"`
- `Security_<Action>_Command_Injection_<Field>` - Value: `"; rm -rf / ;"`
- `Security_<Action>_Command_Injection_Pipe_<Field>` - Value: `"| cat /etc/passwd"`
- `Security_<Action>_LDAP_Injection_<Field>` - Value: `"*)(uid=*))(|(uid=*"`
- `Security_<Action>_XML_Injection_<Field>` - Value: `"<foo><![CDATA[</foo>]]>"`
- `Security_<Action>_JSON_Injection_<Field>` - Value: `"\", \"admin\": true, \"x\": \""`

#### 4.11 Request Body Tests
- `Fail_<Action>_<Resource>_Empty_Body` - Empty string body
- `Fail_<Action>_<Resource>_Invalid_JSON` - Malformed JSON: `{invalid}`
- `Fail_<Action>_<Resource>_Null_Body` - JSON null: `null`
- `Fail_<Action>_<Resource>_Array_Body` - Array instead of object: `[]`
- `<Action>_<Resource>_Extra_Fields` - Valid request with extra unknown fields
- `<Action>_<Resource>_Min_Fields` - Only required fields
- `<Action>_<Resource>_All_Fields` - All fields populated

#### 4.12 Response Validation Tests
- `<Action>_<Resource>_Verify_Response_Structure` - Check response has expected fields
- `<Action>_<Resource>_Verify_Response_Types` - Check field types in response

#### 4.13 HTTP Method Tests
- `Fail_<Resource>_Wrong_Method_GET` - Use GET when POST expected
- `Fail_<Resource>_Wrong_Method_POST` - Use POST when GET expected
- `Fail_<Resource>_Wrong_Method_PUT` - Use PUT when not allowed
- `Fail_<Resource>_Wrong_Method_DELETE` - Use DELETE when not allowed

#### 4.14 Content-Type Tests
- `Fail_<Action>_<Resource>_No_Content_Type` - Omit Content-Type header
- `Fail_<Action>_<Resource>_Wrong_Content_Type` - Use `text/plain` instead of `application/json`
- `<Action>_<Resource>_Content_Type_Charset` - Use `application/json; charset=utf-8`

### Step 5: k6 Script Structure

Every test script MUST follow this exact structure:

```javascript
// Test: <TestName>
// Generated by Claude Code

import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export default function() {
    // Test implementation here
}
```

**HTTP Method Examples:**

GET request:
```javascript
const res = http.get(`${BASE_URL}/path`);
check(res, {
    'status is 200': (r) => r.status === 200,
});
```

GET with query params:
```javascript
const res = http.get(`${BASE_URL}/path?param=value&other=123`);
check(res, {
    'status is 200': (r) => r.status === 200,
});
```

POST request with JSON body:
```javascript
const res = http.post(`${BASE_URL}/path`, JSON.stringify({
    field: 'value',
}), {
    headers: { 'Content-Type': 'application/json' },
});
check(res, {
    'status is 201': (r) => r.status === 201,
});
```

PUT request:
```javascript
const res = http.put(`${BASE_URL}/path/123`, JSON.stringify({
    field: 'updated',
}), {
    headers: { 'Content-Type': 'application/json' },
});
check(res, {
    'status is 200': (r) => r.status === 200,
});
```

DELETE request:
```javascript
const res = http.del(`${BASE_URL}/path/123`);
check(res, {
    'status is 200 or 204': (r) => r.status === 200 || r.status === 204,
});
```

Failure test (expects 4xx):
```javascript
check(res, {
    'status is 4xx': (r) => r.status >= 400 && r.status < 500,
});
```

Security test (should not crash server):
```javascript
check(res, {
    'status is not 5xx': (r) => r.status < 500,
});
```

Response body validation:
```javascript
check(res, {
    'status is 200': (r) => r.status === 200,
    'has id field': (r) => r.json().id !== undefined,
    'id is string': (r) => typeof r.json().id === 'string',
});
```

### Step 6: Boundary Values Reference

| Test Type | Value |
|-----------|-------|
| Zero | `0` |
| Negative | `-1` |
| Max Int | `2147483647` |
| Min Int | `-2147483648` |
| Large | `999999999` |
| Overflow | `9007199254740992` |
| Empty string | `""` |
| Empty array | `[]` |
| Empty object | `{}` |
| Long string | `'a'.repeat(1000)` |
| Very long string | `'a'.repeat(10000)` |
| Unicode | `"日本語 中文 한국어"` |
| Emoji | `"🚀💻🔥🎉"` |
| Special chars | `"!@#$%^&*()_+-=[]{}\\|;':\",./<>?"` |
| Whitespace | `"   "` |
| Newlines | `"line1\nline2\nline3"` |
| SQL Injection | `"'; DROP TABLE users; --"` |
| SQL Union | `"' UNION SELECT * FROM users --"` |
| XSS Script | `"<script>alert('xss')</script>"` |
| XSS Img | `"<img src=x onerror=alert('xss')>"` |
| Path Traversal | `"../../etc/passwd"` |
| Command Injection | `"; rm -rf / ;"` |

### Step 7: Write Output Files

1. Create the output directory if it doesn't exist
2. Write each test to a separate file:
   - Filename format: `test_<lowercase_test_name>.js`
   - Convert PascalCase to snake_case
   - Example: `Create_Message_Basic` -> `test_create_message_basic.js`

3. Create `manifest.json`:
```json
{
  "generated_at": "<ISO timestamp>",
  "api_title": "<from spec>",
  "api_version": "<from spec>",
  "total_tests": <count>,
  "endpoints_processed": <count>,
  "tests": [
    { "id": 1, "name": "Create_Message_Basic", "file": "test_create_message_basic.js", "category": "happy_path" },
    { "id": 2, "name": "Fail_Create_Message_Missing_Type", "file": "test_fail_create_message_missing_type.js", "category": "validation" }
  ]
}
```

### Step 8: Report Results

After generating all tests, report:
- Number of endpoints processed
- Number of tests generated by category:
  - Happy path
  - Boundary values
  - Type variations
  - Validation/negative
  - Security
  - Other
- Output directory path
- Example commands:
  ```bash
  # Run single test
  k6 run --env BASE_URL=http://localhost:8080 tests/test_create_message_basic.js

  # Run all tests (bash)
  for f in tests/*.js; do k6 run --env BASE_URL=http://localhost:8080 "$f"; done

  # Run all tests (PowerShell)
  Get-ChildItem tests\*.js | ForEach-Object { k6 run --env BASE_URL=http://localhost:8080 $_.FullName }
  ```

## Critical Guidelines

1. **BE EXHAUSTIVE**: Generate 50-150+ tests per endpoint depending on complexity
2. **ONE TEST = ONE THING**: Each test verifies only what its name describes
3. **Keep tests minimal**: 10-20 lines max per test
4. **Test EVERY field**: Generate boundary/type tests for each field in the schema
5. **Test EVERY parameter**: Query params, path params, headers
6. **Security for EVERY string**: SQL injection, XSS, etc. for each string field
7. **Use PascalCase_With_Underscores** for test names
8. **Always include imports and BASE_URL constant**
9. **Missing a test = missing a bug**: When in doubt, generate the test
