# PostQueueAckRequest

Acknowledged Message


## Fields

| Field                     | Type                      | Required                  | Description               |
| ------------------------- | ------------------------- | ------------------------- | ------------------------- |
| `id`                      | *str*                     | :heavy_check_mark:        | N/A                       |
| `type`                    | *Optional[str]*           | :heavy_minus_sign:        | N/A                       |
| `payload`                 | *OptionalNullable[Any]*   | :heavy_minus_sign:        | N/A                       |
| `created_at`              | *Optional[float]*         | :heavy_minus_sign:        | N/A                       |
| `priority`                | *Optional[float]*         | :heavy_minus_sign:        | N/A                       |
| `attempt_count`           | *Optional[float]*         | :heavy_minus_sign:        | N/A                       |
| `dequeued_at`             | *OptionalNullable[float]* | :heavy_minus_sign:        | N/A                       |
| `last_error`              | *OptionalNullable[str]*   | :heavy_minus_sign:        | N/A                       |
| `processing_duration`     | *Optional[float]*         | :heavy_minus_sign:        | N/A                       |