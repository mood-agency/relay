# MainQueueMessage


## Fields

| Field                   | Type                    | Required                | Description             |
| ----------------------- | ----------------------- | ----------------------- | ----------------------- |
| `id`                    | *str*                   | :heavy_check_mark:      | N/A                     |
| `type`                  | *str*                   | :heavy_check_mark:      | N/A                     |
| `payload`               | *OptionalNullable[Any]* | :heavy_minus_sign:      | N/A                     |
| `created_at`            | *float*                 | :heavy_check_mark:      | N/A                     |
| `priority`              | *Optional[float]*       | :heavy_minus_sign:      | N/A                     |
| `attempt_count`         | *float*                 | :heavy_check_mark:      | N/A                     |
| `dequeued_at`           | *Nullable[float]*       | :heavy_check_mark:      | N/A                     |
| `last_error`            | *Nullable[str]*         | :heavy_check_mark:      | N/A                     |
| `processing_duration`   | *float*                 | :heavy_check_mark:      | N/A                     |