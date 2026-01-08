# Test Planning User Prompt Template

Analyze the following API endpoint and generate an exhaustive list of test case names.

## Endpoint Specification
```json
{{spec}}
```

## Instructions

For this endpoint, generate test names covering ALL of the following categories:

### 1. Happy Path Tests (prefix: `{Action}_{Resource}_`)
- Basic valid request with only required fields
- Valid request with all optional fields populated
- Valid request with various combinations of optional fields

### 2. Payload Data Type Variations (for each field that accepts data)
- `String_Payload` - string value
- `Number_Payload` - numeric value  
- `Boolean_Payload` - true/false
- `Null_Payload` - null value
- `Array_Payload` - array value
- `Empty_Array_Payload` - empty array `[]`
- `Object_Payload` - object value
- `Empty_Object_Payload` - empty object `{}`
- `Large_Payload` - very large data
- `Special_Chars_{Field}` - special characters, unicode, emojis
- `Long_{Field}_String` - extremely long string values

### 3. Boundary & Edge Cases (for numeric fields)
- `Zero_{Field}` - value of 0
- `Negative_{Field}` - negative numbers
- `Max_{Field}` - maximum allowed value
- `Min_{Field}` - minimum allowed value
- `Decimal_{Field}` - decimal numbers (if integer expected)

### 4. Validation Failure Tests (prefix: `Fail_`)
- `Fail_{Action}_Missing_{RequiredField}` - each required field omitted
- `Fail_{Action}_{Field}_Not_{ExpectedType}` - wrong type for each field
- `Fail_{Action}_Invalid_JSON` - malformed JSON body
- `Fail_{Action}_Empty_Body` - completely empty request body
- `Fail_{Action}_{Field}_Out_Of_Range` - values outside allowed range

### 5. Batch/Collection Operations (if applicable)
- `{Action}_Batch_Single_{Resource}` - batch with one item
- `{Action}_Batch_Multiple_{Resource}` - batch with few items
- `{Action}_Batch_Five_{Resource}` - batch with 5 items
- `{Action}_Batch_Ten_{Resource}` - batch with 10 items
- `{Action}_Batch_Mixed_Payloads` - batch with varied payload types
- `Fail_Batch_Not_An_Array` - non-array where array expected
- `Fail_Batch_Array_Of_Non_Objects` - array containing wrong types
- `Fail_Batch_Invalid_{Resource}_In_Array` - array with invalid item

### 6. Extra/Unexpected Data
- `{Action}_{Resource}_With_Extra_Fields` - request with undeclared fields

### 7. Query Parameter Variations (for GET endpoints)
- Test each optional query param present/absent
- Test invalid query param types
- Test boundary values for query params

## Naming Convention
- Use PascalCase with underscores: Create_Message_String_Payload
- Prefix failures with Fail_: Fail_Create_Message_Missing_Type
- Be specific about what's being tested: Create_Message_Zero_Priority

## Output Format
Reply in JSON format. Return ONLY a raw JSON array of test name strings.

CRITICAL: DO NOT use markdown code fences. Start directly with [ and end with ]

Example: ["Create_Message_Basic","Create_Message_String_Payload","Fail_Create_Message_Missing_Type"]

